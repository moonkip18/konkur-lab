import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { daysSince } from './examCadence';
import { formatBytes } from './storage';
import { buildPoints, pointFor, latestTwo, withRolling } from './chartData';
import { completeExam, emptyAnswers, emptyExam, sortExams, trendExams } from './db/examRepo';
import { db } from './db/db';
import { TOTAL_QUESTION_COUNT, type AnswerMap } from './scoring';
import type { ExamRecord } from './db/models';

function answersWith(seed: number): AnswerMap {
  const map = emptyAnswers();
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    const roll = (q * 37 + seed * 11) % 100;
    map[q] = {
      answer: roll < 50 ? 'correct' : roll < 75 ? 'wrong' : 'blank',
      difficulty: (q + seed) % 3 === 0 ? 'easy' : (q + seed) % 3 === 1 ? 'medium' : 'hard',
    };
  }
  return map;
}

async function seed(
  date: string,
  seedValue: number,
  status: ExamRecord['status'] = 'completed',
): Promise<ExamRecord> {
  const exam = emptyExam(date, 'Maz');
  exam.answers = answersWith(seedValue);
  await db.exams.put(exam);
  if (status === 'draft') return exam;
  const done = await completeExam(exam.id);
  if (status === 'archived') await db.exams.update(done.id, { status: 'archived' });
  return (await db.exams.get(done.id))!;
}

describe('chart data flattening', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.close();
  });

  it('produces one point per completed exam, in date order', async () => {
    await seed('2026-07-16', 3);
    await seed('2026-06-18', 1);
    const all = await db.exams.toArray();
    const points = buildPoints(all, 'gregorian');

    expect(points.map((p) => p.date)).toEqual(['2026-06-18', '2026-07-16']);
    expect(points[0]!.examId).toBeDefined();
  });

  it('formats labels per the date-display mode', async () => {
    const exam = await seed('2026-07-16', 3);
    expect(pointFor(exam, 'gregorian').label).toBe('16 Jul 2026');
    expect(pointFor(exam, 'jalali').label).toBe('25 تیر 1405');
  });

  it('carries raw, expected, deviation, and index for every subject', async () => {
    const exam = await seed('2026-07-16', 3);
    const point = pointFor(exam, 'gregorian');
    for (const id of ['math', 'physics', 'chemistry'] as const) {
      const sub = point.subjects[id];
      expect(sub.expectedNet).toBe(exam.result!.adjusted.subjects[id].expectedNetPercent);
      expect(sub.performance).toBeCloseTo(sub.rawNet - sub.expectedNet, 10);
      expect(sub.index).toBe(exam.result!.adjusted.subjects[id].index);
    }
    expect(point.overallIndex).toBe(exam.result!.adjusted.overallIndex);
  });

  it('builds difficulty-band breakdowns from that exam labels alone', async () => {
    const exam = await seed('2026-07-16', 3);
    const point = pointFor(exam, 'gregorian');

    let mathTotal = 0;
    for (const d of ['easy', 'medium', 'hard'] as const) {
      mathTotal += point.subjects.math.difficultyCounts[d];
      // A band with no questions must be null, never 0.
      if (point.subjects.math.difficultyCounts[d] === 0) {
        expect(point.difficultyNet.math[d]).toBeNull();
        expect(point.accuracyBySubjectDifficulty.math[d]).toBeNull();
      }
    }
    expect(mathTotal).toBe(40);
    expect(point.difficultyMix.easy + point.difficultyMix.medium + point.difficultyMix.hard).toBe(95);
  });

  it('leaves draft exams out of the chart rows', async () => {
    await seed('2026-07-16', 3);
    await seed('2026-07-09', 5, 'draft');
    const all = await db.exams.toArray();
    expect(buildPoints(all, 'gregorian')).toHaveLength(1);
  });

  it('excludes archived exams unless explicitly included', async () => {
    await seed('2026-06-18', 1, 'archived');
    await seed('2026-07-16', 3);
    const all = await db.exams.toArray();
    expect(trendExams(all, false).map((e) => e.date)).toEqual(['2026-07-16']);
    expect(trendExams(all, true).map((e) => e.date)).toEqual(['2026-06-18', '2026-07-16']);
  });

  it('sorts by date and falls back to creation time', () => {
    const base = emptyExam('2026-07-16', 'Maz');
    const sameDayLater = { ...base, id: 'b', createdAt: '2026-07-16T00:00:02.000Z' };
    const sameDayEarlier = { ...base, id: 'a', createdAt: '2026-07-16T00:00:01.000Z' };
    const earlier = { ...base, id: 'c', date: '2026-06-30' };
    expect(sortExams([sameDayLater, earlier, sameDayEarlier]).map((e) => e.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('reports the latest two completed exams for comparison columns', async () => {
    await seed('2026-06-18', 1);
    await seed('2026-07-16', 3);
    const all = await db.exams.toArray();
    const { latest, previous } = latestTwo(all);
    expect(latest?.date).toBe('2026-07-16');
    expect(previous?.date).toBe('2026-06-18');

    const { latest: only, previous: none } = latestTwo([all[0]!]);
    expect(only?.date).toBe('2026-06-18');
    expect(none).toBeNull();
    expect(latestTwo([]).latest).toBeNull();
  });

  it('attaches the contributing window size to rolling averages', async () => {
    await seed('2026-06-18', 1);
    await seed('2026-07-02', 2);
    await seed('2026-07-16', 3);
    const points = buildPoints(await db.exams.toArray(), 'gregorian');
    const rolling = withRolling(points, (p) => p.overallIndex, 3);
    expect(rolling.map((r) => r.windowSize)).toEqual([1, 2, 3]);
    // The trailing average must equal the mean of its own inputs.
    const last = rolling[2]!.value!;
    const mean =
      points.reduce((a, p) => a + (p.overallIndex ?? 0), 0) / 3;
    expect(last).toBeCloseTo(mean, 8);
  });

  it('does not mutate stored results while building chart data', async () => {
    const exam = await seed('2026-07-16', 3);
    const before = JSON.stringify(exam.result);
    buildPoints(await db.exams.toArray(), 'gregorian');
    buildPoints(await db.exams.toArray(), 'jalali');
    expect(JSON.stringify((await db.exams.get(exam.id))!.result)).toBe(before);
  });
});

describe('small helpers', () => {
  it('measures days between dates', () => {
    expect(daysSince('2026-07-02', '2026-07-16')).toBe(14);
    expect(daysSince('2026-07-16', '2026-07-02')).toBe(-14);
    expect(daysSince('bad', '2026-07-16')).toBeNaN();
  });

  it('formats byte counts', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});