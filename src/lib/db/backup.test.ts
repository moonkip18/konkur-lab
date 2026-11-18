import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { buildBackup, parseBackup, serialiseBackup, validateBackup } from './backup';
import { examsCsv, questionsCsv, toCsv } from './csv';
import { completeExam, deleteExam, emptyAnswers, emptyExam, listExams } from './examRepo';
import { SCHEMA_VERSION, type ExamRecord } from './models';
import { PROFILE_V1, SCORING_ENGINE_VERSION, scoreExam, TOTAL_QUESTION_COUNT } from '../scoring';
import type { Difficulty } from '../scoring';

function makeAnswers(
  correctCount: number,
  wrongCount: number,
  difficulty: Difficulty = 'medium',
) {
  const map = emptyAnswers();
  let q = 1;
  for (let i = 0; i < correctCount; i += 1, q += 1) map[q] = { answer: 'correct', difficulty };
  for (let i = 0; i < wrongCount; i += 1, q += 1) map[q] = { answer: 'wrong', difficulty };
  for (; q <= TOTAL_QUESTION_COUNT; q += 1) map[q] = { answer: 'blank', difficulty };
  return map;
}

async function seed(date: string, correct = 60, wrong = 10): Promise<ExamRecord> {
  const exam = emptyExam(date, 'Maz');
  exam.answers = makeAnswers(correct, wrong);
  exam.notes = `seed ${date}`;
  await db.exams.put(exam);
  return completeExam(exam.id);
}

describe('JSON backup round trip', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('serialises and re-reads a backup with no drift', async () => {
    await seed('2026-06-30');
    await seed('2026-07-16');
    const exams = await listExams();

    const text = serialiseBackup(buildBackup(exams, { now: new Date('2026-07-16T12:00:00Z') }));
    const parsed = parseBackup(text);

    expect(parsed.errors).toEqual([]);
    expect(parsed.file?.exams).toHaveLength(2);
    expect(parsed.file?.metadata.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.file?.metadata.engineVersion).toBe(SCORING_ENGINE_VERSION);
    expect(parsed.file?.metadata.examCount).toBe(2);

    // Everything needed to reproduce a score is in the file.
    const first = parsed.file!.exams[0]!;
    expect(Object.keys(first.answers)).toHaveLength(95);
    expect(first.profileSnapshot).toEqual(PROFILE_V1);
    expect(first.result?.adjusted.overallIndex).toBeCloseTo(
      scoreExam({
        date: first.date,
        provider: first.provider,
        answers: first.answers,
        profile: first.profileSnapshot,
      }).adjusted.overallIndex,
      12,
    );
  });

  it('restores into an empty database and reproduces identical scores', async () => {
    await seed('2026-06-30', 55, 15);
    await seed('2026-07-16', 60, 10);
    const original = await listExams();
    const text = serialiseBackup(buildBackup(original));

    const scoresBefore = original.map((e) => e.result?.adjusted.overallIndex);

    await db.exams.clear();
    expect(await db.exams.count()).toBe(0);

    const parsed = parseBackup(text);
    expect(parsed.file).not.toBeNull();
    await db.transaction('rw', db.exams, async () => {
      await db.exams.bulkPut(parsed.file!.exams);
    });

    const restored = await listExams();
    expect(restored).toHaveLength(2);
    expect(restored.map((e) => e.result?.adjusted.overallIndex)).toEqual(scoresBefore);
    expect(restored[0]?.notes).toBe(original[0]?.notes);
    expect(restored[0]?.revision).toBe(original[0]?.revision);
  });

  it('carries drafts through a round trip unchanged', async () => {
    const draft = emptyExam('2026-08-01', 'Maz');
    draft.answers[1] = { answer: 'correct', difficulty: 'hard' };
    await db.exams.put(draft);

    const parsed = parseBackup(serialiseBackup(buildBackup(await listExams())));
    expect(parsed.file?.exams[0]?.status).toBe('draft');
    expect(parsed.file?.exams[0]?.result).toBeNull();
    expect(parsed.file?.exams[0]?.answers[1]).toEqual({ answer: 'correct', difficulty: 'hard' });
  });
});

describe('import preview refuses invalid files before writing', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('rejects non-JSON text', () => {
    const parsed = parseBackup('not json at all');
    expect(parsed.file).toBeNull();
    expect(parsed.errors[0]?.message).toMatch(/not valid JSON/i);
  });

  it('rejects a JSON object with the wrong app id', () => {
    const parsed = parseBackup(JSON.stringify({ metadata: { app: 'something-else' }, exams: [] }));
    expect(parsed.file).toBeNull();
    expect(parsed.errors.some((e) => /Not a Konkur Progress Lab backup/.test(e.message))).toBe(true);
  });

  it('rejects a file with no exams array', () => {
    const parsed = parseBackup(JSON.stringify({ metadata: { app: 'konkur-progress-lab' } }));
    expect(parsed.file).toBeNull();
    expect(parsed.errors.some((e) => /no "exams" array/.test(e.message))).toBe(true);
  });

  it('flags a completed exam whose stored result contradicts its inputs', async () => {
    await seed('2026-07-16');
    const exams = await listExams();
    const tampered = structuredClone(exams);
    tampered[0]!.answers[1] = { answer: 'wrong', difficulty: 'medium' };

    const validation = validateBackup(buildBackup(tampered));
    expect(validation.ok).toBe(false);
    expect(
      validation.errors.some((e) => /does not match its own inputs/.test(e.message)),
    ).toBe(true);
  });

  it('flags a completed exam with no stored result', async () => {
    await seed('2026-07-16');
    const exams = structuredClone(await listExams());
    exams[0]!.result = null;
    const validation = validateBackup(buildBackup(exams));
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => /no stored result/.test(e.message))).toBe(true);
  });

  it('flags out-of-range question numbers and invalid dates', async () => {
    await seed('2026-07-16');
    const exams = structuredClone(await listExams());
    exams[0]!.answers[200] = { answer: 'correct', difficulty: 'easy' };
    exams[0]!.date = '2026-02-30';
    const validation = validateBackup(buildBackup(exams));
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => /out-of-range/.test(e.message))).toBe(true);
    expect(validation.errors.some((e) => /invalid date/.test(e.message))).toBe(true);
  });

  it('flags duplicate ids inside the file', async () => {
    await seed('2026-07-16');
    const one = await listExams();
    const validation = validateBackup(buildBackup([...one, ...structuredClone(one)]));
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => /Duplicate exam id/.test(e.message))).toBe(true);
  });

  it('reports same date+provider duplicates as a conflict count, not an error', async () => {
    await seed('2026-07-16');
    const exams = structuredClone(await listExams());
    const clone = structuredClone(exams[0]!);
    clone.id = 'another-id';
    const validation = validateBackup(buildBackup([...exams, clone]));
    expect(validation.duplicateDates).toEqual([{ date: '2026-07-16', provider: 'Maz', count: 2 }]);
    // Distinct ids and valid contents, so this is a warning-level conflict only.
    expect(validation.errors).toEqual([]);
  });

  it('warns, but does not fail, on an engine or schema version mismatch', async () => {
    await seed('2026-07-16');
    const backup = buildBackup(await listExams());
    backup.metadata.engineVersion = 'engine-0.0.1';
    backup.metadata.schemaVersion = SCHEMA_VERSION + 1;
    const validation = validateBackup(backup);
    expect(validation.engineMismatch).toBe(true);
    expect(validation.schemaMismatch).toBe(true);
    expect(validation.warnings.length).toBeGreaterThanOrEqual(2);
    // A version difference must not make an otherwise valid file unusable.
    expect(validation.errors).toEqual([]);
  });

  it('leaves the database untouched when a write inside the transaction throws', async () => {
    await seed('2026-06-30');
    const before = await listExams();

    const bad = structuredClone(before);
    bad[0]!.date = '2026-02-30';

    await expect(
      db.transaction('rw', db.exams, async () => {
        await db.exams.clear();
        await db.exams.bulkPut(bad);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const after = await listExams();
    expect(after).toHaveLength(1);
    expect(after[0]?.date).toBe('2026-06-30');
    expect(after[0]?.result).toEqual(before[0]?.result);
  });

  it('does not touch other exams when one is deleted', async () => {
    const a = await seed('2026-06-30');
    const b = await seed('2026-07-16');
    await deleteExam(a.id);
    const left = await listExams();
    expect(left.map((e) => e.id)).toEqual([b.id]);
    expect(left[0]?.result).toEqual(b.result);
  });
});

describe('CSV export', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('escapes commas, quotes, and newlines', () => {
    const csv = toCsv(['a', 'b'], [['plain', 'has,comma'], ['has"quote', 'has\nnewline']]);
    expect(csv).toBe('a,b\nplain,"has,comma"\n"has""quote","has\nnewline"\n');
  });

  it('emits one question row per exam question with all required columns', async () => {
    await seed('2026-07-16');
    const csv = questionsCsv(await listExams());
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'exam_id,exam_date,provider,exam_status,subject,subject_fa,question_number,answer,difficulty,profile_version,engine_version,completed',
    );
    expect(lines).toHaveLength(1 + TOTAL_QUESTION_COUNT);

    const first = lines[1]!.split(',');
    expect(first[4]).toBe('Math');
    expect(first[5]).toBe('ریاضی');
    expect(first[6]).toBe('1');
    expect(first[7]).toBe('correct');
    expect(first[8]).toBe('medium');

    const last = lines[95]!.split(',');
    expect(last[4]).toBe('Chemistry');
    expect(last[6]).toBe('95');
    expect(last[7]).toBe('blank');
  });

  it('leaves answer and difficulty blank when unset', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    exam.answers[1] = { answer: 'correct', difficulty: 'hard' };
    await db.exams.put(exam);
    const lines = questionsCsv(await listExams()).trim().split('\n');
    expect(lines[1]!.split(',')[7]).toBe('correct');
    expect(lines[2]!.split(',')[7]).toBe('');
    expect(lines[2]!.split(',')[8]).toBe('');
  });

  it('emits exam-level rows carrying inputs, results, and scale parameters', async () => {
    const done = await seed('2026-07-16');
    const exams = await listExams();
    const csv = examsCsv(exams);
    const lines = csv.trim().split('\n');
    const headers = lines[0]!.split(',');
    const values = lines[1]!.split(',');

    const get = (name: string): string => values[headers.indexOf(name)]!;
    expect(get('exam_id')).toBe(done.id);
    expect(get('correct_total')).toBe('60');
    expect(get('wrong_total')).toBe('10');
    expect(get('blank_total')).toBe('25');
    expect(get('attempted_total')).toBe('70');
    expect(Number(get('weighted_raw_score'))).toBeCloseTo(65.04, 2);
    expect(Number(get('math_coefficient'))).toBe(12);
    expect(Number(get('physics_coefficient'))).toBe(9);
    expect(Number(get('chemistry_coefficient'))).toBe(7);
    expect(Number(get('coefficient_total'))).toBe(28);
    expect(get('profile_version')).toBe('v1');
    expect(get('engine_version')).toBe(SCORING_ENGINE_VERSION);
    expect(get('index_A')).toBe('5000');
    expect(get('index_B')).toBe('2000');
    expect(get('index_sigma')).toBe('15');
    expect(get('difficulty_coverage')).toBe('100');
    expect(Number(get('expected_net_per_easy_question'))).toBeCloseTo(0.776, 6);
    expect(Number(get('expected_net_per_medium_question'))).toBeCloseTo(0.469333333333, 6);
    expect(Number(get('expected_net_per_hard_question'))).toBe(0);
  });

  it('carries difficulty counts, expected nets, and deviations per subject', async () => {
    await seed('2026-07-16');
    const csv = examsCsv(await listExams());
    const headers = csv.trim().split('\n')[0]!.split(',');
    const values = csv.trim().split('\n')[1]!.split(',');
    const get = (name: string): string => values[headers.indexOf(name)]!;

    expect(get('math_easy')).toBe('0');
    expect(get('math_medium')).toBe('40');
    expect(get('math_hard')).toBe('0');
    expect(Number(get('math_expected_net_percent'))).toBeCloseTo(46.9333, 2);
    expect(Number(get('math_performance_points'))).toBeCloseTo(53.0667, 2);
    // tau = 5000 + 2000 * 53.0667 / 15
    expect(Number(get('math_tau'))).toBeCloseTo(5000 + (2000 * 53.0667) / 15, 1);
    // Chemistry was all wrong/blank on a medium paper, dragging the weighted index
    // well below the math term: T = (12*12075.6 + 9*8520 + 7*-1998.5) / 28.
    expect(Number(get('overall_personal_difficulty_index'))).toBeCloseTo(7414.18, 1);
    expect(Number(get('chemistry_performance_points'))).toBeCloseTo(-52.4889, 2);
  });

  it('recomputes from inputs so a stale stored result cannot leak into the CSV', async () => {
    const done = await seed('2026-07-16');
    // Corrupt the stored result only.
    await db.exams.update(done.id, { result: null });
    const csv = examsCsv(await listExams());
    const headers = csv.trim().split('\n')[0]!.split(',');
    const values = csv.trim().split('\n')[1]!.split(',');
    expect(values[headers.indexOf('weighted_raw_score')]).toBe('65.04');
  });

  it('exports a header-only file for an empty database', async () => {
    expect(questionsCsv([]).trim().split('\n')).toHaveLength(1);
    expect(examsCsv([]).trim().split('\n')).toHaveLength(1);
  });
});