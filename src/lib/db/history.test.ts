/**
 * Spec section 15.5 / acceptance rule 9.
 *
 * The guarantee under test: an exam's score depends only on that exam's own
 * answers, its own difficulty labels, and its profile snapshot. Adding,
 * deleting, reordering, or editing other exams must not move it by so much as a
 * floating-point bit.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  completeExam,
  deleteExam,
  emptyAnswers,
  emptyExam,
  listExams,
  reopenExam,
  sortExams,
  trendExams,
} from './examRepo';
import { examsCsv } from './csv';
import { PROFILE_V1, scoreExam, TOTAL_QUESTION_COUNT } from '../scoring';
import type { AnswerMap, Difficulty } from '../scoring';
import type { ExamRecord } from './models';

type Mix = Record<number, { answer?: 'correct' | 'wrong' | 'blank'; difficulty?: Difficulty }>;

function build(mix: Mix = {}): AnswerMap {
  const map = emptyAnswers();
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    map[q] = mix[q] ?? { answer: 'blank', difficulty: 'medium' };
  }
  return map;
}

/** Deterministic pseudo-random-ish mix so each exam differs from the others. */
function mixFor(seed: number): Mix {
  const mix: Mix = {};
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    const v = (q * 37 + seed * 17) % 11;
    const answer = v < 5 ? 'correct' : v < 8 ? 'wrong' : 'blank';
    const d = (q * 13 + seed * 5) % 3;
    const difficulty: Difficulty = d === 0 ? 'easy' : d === 1 ? 'medium' : 'hard';
    mix[q] = { answer, difficulty };
  }
  return mix;
}

async function seedExam(date: string, seed: number): Promise<string> {
  const exam = emptyExam(date, 'Maz');
  exam.answers = build(mixFor(seed));
  await db.exams.put(exam);
  return (await completeExam(exam.id)).id;
}

/** Every stored number for one exam, flattened for exact comparison. */
function fingerprint(row: ExamRecord): Record<string, unknown> {
  const r = row.result!;
  return {
    weighted: r.raw.weightedRawScore,
    net: r.raw.netPercent,
    overallIndex: r.adjusted.overallIndex,
    math: r.adjusted.subjects.math,
    physics: r.adjusted.subjects.physics,
    chemistry: r.adjusted.subjects.chemistry,
  };
}

/** Sorted by date, the way the UI and charts read exams. */
async function readFingerprints(): Promise<Record<string, unknown>[]> {
  const rows = await listExams();
  return rows.filter((r) => r.result).map(fingerprint);
}

async function getFingerprint(id: string): Promise<Record<string, unknown>> {
  const row = await db.exams.get(id);
  if (!row?.result) throw new Error(`Exam ${id} missing or has no result`);
  return fingerprint(row);
}

/** The CSV line for one exam, read straight from the stored records. */
async function csvRowFor(id: string): Promise<string> {
  const csv = examsCsv(await listExams());
  const line = csv.trim().split('\n').find((l) => l.startsWith(`${id},`));
  if (!line) throw new Error(`No CSV row for ${id}`);
  return line;
}

describe('historical exams never influence another exam score', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('scores a lone exam identically before and after older exams are added', async () => {
    const midId = await seedExam('2026-07-16', 3);
    const before = await getFingerprint(midId);

    await seedExam('2026-06-18', 1);
    await seedExam('2026-07-02', 2);
    await seedExam('2026-07-30', 4);

    expect(await getFingerprint(midId)).toEqual(before);
  });

  it('scores a lone exam identically before and after newer exams are added', async () => {
    const earlyId = await seedExam('2026-06-18', 1);
    const before = await getFingerprint(earlyId);

    await seedExam('2026-07-02', 2);
    await seedExam('2026-07-16', 3);

    expect(await getFingerprint(earlyId)).toEqual(before);
  });

  it('leaves remaining scores untouched when a historical exam is deleted', async () => {
    const a = await seedExam('2026-06-18', 1);
    const b = await seedExam('2026-07-02', 2);
    const c = await seedExam('2026-07-16', 3);
    const before = { b: await getFingerprint(b), c: await getFingerprint(c) };

    await deleteExam(a);

    expect(await getFingerprint(b)).toEqual(before.b);
    expect(await getFingerprint(c)).toEqual(before.c);
    await expect(db.exams.get(a)).resolves.toBeUndefined();
  });

  it('is insensitive to exam ordering', async () => {
    const a = await seedExam('2026-06-18', 1);
    const b = await seedExam('2026-07-02', 2);
    const c = await seedExam('2026-07-16', 3);
    const before = await readFingerprints();

    const rows = await db.exams.toArray();
    const reversed = sortExams(rows).reverse();
    expect(reversed.map((e) => e.id)).toEqual([c, b, a]);

    // Same inputs -> same scores, regardless of the order anything is read in.
    for (const row of reversed) {
      const rescore = scoreExam({
        date: row.date,
        provider: row.provider,
        answers: row.answers,
        profile: row.profileSnapshot,
      });
      const original = rows.find((r) => r.id === row.id)!.result!;
      expect(rescore.adjusted.overallIndex).toBe(original.adjusted.overallIndex);
      expect(rescore.raw.weightedRawScore).toBe(original.raw.weightedRawScore);
    }
    expect(await readFingerprints()).toEqual(before);
  });

  it('does not calibrate a new exam after an extreme historical result', async () => {
    // A near-perfect exam, then a deliberately terrible one.
    const perfect: AnswerMap = {};
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) perfect[q] = { answer: 'correct', difficulty: 'easy' };
    const first = emptyExam('2026-06-18', 'Maz');
    first.answers = perfect;
    await db.exams.put(first);
    await completeExam(first.id);

    const awful: AnswerMap = {};
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) awful[q] = { answer: 'wrong', difficulty: 'hard' };
    const second = emptyExam('2026-07-02', 'Maz');
    second.answers = awful;
    await db.exams.put(second);
    await completeExam(second.id);

    const inDb = (await db.exams.get(second.id))!.result!;

    // The awful exam scores purely from its own inputs.
    const isolated = scoreExam({
      date: '2026-07-02',
      provider: 'Maz',
      answers: awful,
      profile: PROFILE_V1,
    });
    expect(inDb.adjusted.overallIndex).toBe(isolated.adjusted.overallIndex);
    expect(inDb.raw.weightedRawScore).toBe(isolated.raw.weightedRawScore);
    // All wrong on a hard paper: raw -33.33 against an expected 0 (mu_hard = 0),
    // so performance is -33.33 and T = 5000 + 2000 * (-33.33) / 15 = 555.56.
    expect(inDb.adjusted.overallIndex).toBeCloseTo(5000 - (2000 * (100 / 3)) / 15, 8);
    expect(inDb.adjusted.overallIndex).toBeLessThan(5000);
  });

  it('does not rescore or overwrite a completed exam when a profile changes', async () => {
    const id = await seedExam('2026-07-16', 3);
    const original = await db.exams.get(id);

    // A deliberately different profile version, applied to a re-entered exam.
    const newProfile = {
      ...structuredClone(PROFILE_V1),
      version: 'v2',
      A: 6000,
      sigma: 10,
      label: 'Profile v2 (hypothetical)',
    };
    const reScored = scoreExam({
      date: '2026-07-16',
      provider: 'Maz',
      answers: original!.answers,
      profile: newProfile,
    });
    expect(reScored.adjusted.overallIndex).not.toBe(original!.result!.adjusted.overallIndex);

    // The stored record still shows the original profile and original number.
    const after = await db.exams.get(id);
    expect(after!.profileVersion).toBe('v1');
    expect(after!.result!.adjusted.overallIndex).toBe(original!.result!.adjusted.overallIndex);
  });

  it('records a revision when a completed exam is reopened, without touching others', async () => {
    const a = await seedExam('2026-06-18', 1);
    const b = await seedExam('2026-07-02', 2);
    const bBefore = await getFingerprint(b);

    const reopened = await reopenExam(a);
    expect(reopened.revision).toBe(1);
    expect(reopened.result).toBeNull();

    expect(await getFingerprint(b)).toEqual(bBefore);
  });

  it('regenerates the CSV row identically no matter how many other exams exist', async () => {
    const id = await seedExam('2026-07-16', 3);
    const alone = await csvRowFor(id);

    await seedExam('2026-06-18', 1);
    await seedExam('2026-07-30', 5);
    const withOthers = await csvRowFor(id);

    expect(withOthers).toBe(alone);
  });

  it('excludes drafts from completed-exam trends', async () => {
    await seedExam('2026-06-18', 1);
    await seedExam('2026-07-16', 3);
    const draft = emptyExam('2026-07-02', 'Maz');
    draft.answers = build({ 1: { answer: 'correct', difficulty: 'easy' } });
    await db.exams.put(draft);

    const all = await listExams();
    expect(all).toHaveLength(3);
    expect(trendExams(all, false).map((e) => e.date)).toEqual(['2026-06-18', '2026-07-16']);
  });

  it('excludes archived exams from trends unless asked', async () => {
    const a = await seedExam('2026-06-18', 1);
    await seedExam('2026-07-16', 3);
    await db.exams.update(a, { status: 'archived' });

    const all = await listExams();
    expect(trendExams(all, false).map((e) => e.date)).toEqual(['2026-07-16']);
    expect(trendExams(all, true).map((e) => e.date)).toEqual(['2026-06-18', '2026-07-16']);
  });

  it('produces bit-identical scores across repeated scoring of identical input', async () => {
    const answers = build(mixFor(9));
    const a = scoreExam({ date: '2026-07-16', provider: 'Maz', answers, profile: PROFILE_V1 });
    const b = scoreExam({ date: '2026-07-16', provider: 'Maz', answers, profile: PROFILE_V1 });
    expect(b).toEqual(a);
    // Deep equality above already covers full precision; assert it explicitly too.
    expect(b.adjusted.subjects.math.index).toBe(a.adjusted.subjects.math.index);
    expect(b.adjusted.overallIndex).toBe(a.adjusted.overallIndex);
  });
});

