import { beforeEach, describe, expect, it } from 'vitest';
import { KonkurDB, db, ensureSchemaMeta, loadSettings, saveSettings, setLastBackupAt, getLastBackupAt } from './db';
import {
  ExamWriteError,
  completeExam,
  deleteExam,
  emptyAnswers,
  emptyExam,
  findDuplicate,
  listExams,
  reopenExam,
  setArchived,
  setQuestion,
  updateExamMeta,
} from './examRepo';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from './models';
import type { AnswerMap, Difficulty } from '../scoring';
import { TOTAL_QUESTION_COUNT } from '../scoring';

function answersFor(
  correctCount: number,
  wrongCount: number,
  difficulty: Difficulty = 'medium',
): AnswerMap {
  const map = emptyAnswers();
  let q = 1;
  const put = (answer: 'correct' | 'wrong', n: number): void => {
    for (let i = 0; i < n; i += 1, q += 1) map[q] = { answer, difficulty };
  };
  put('correct', correctCount);
  put('wrong', wrongCount);
  for (; q <= TOTAL_QUESTION_COUNT; q += 1) map[q] = { answer: 'blank', difficulty };
  return map;
}

async function seedCompleteExam(date: string, correct = 60, wrong = 10): Promise<string> {
  const exam = emptyExam(date, 'Maz');
  exam.answers = answersFor(correct, wrong);
  await db.exams.put(exam);
  const done = await completeExam(exam.id);
  return done.id;
}

describe('schema and settings', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await ensureSchemaMeta();
  });

  it('creates all three tables', async () => {
    expect(await db.exams.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
    expect((await db.meta.get('schemaVersion'))?.value).toBe(SCHEMA_VERSION);
  });

  it('round-trips settings and fills defaults on a fresh install', async () => {
    expect(await loadSettings()).toBeNull();
    await saveSettings({ ...DEFAULT_SETTINGS, dateDisplay: 'jalali' });
    expect((await loadSettings())?.dateDisplay).toBe('jalali');
  });

  it('persists the last backup timestamp', async () => {
    expect(await getLastBackupAt()).toBeNull();
    await setLastBackupAt('2026-07-16T10:00:00.000Z');
    expect(await getLastBackupAt()).toBe('2026-07-16T10:00:00.000Z');
  });
});

describe('data survives a full database close and reopen', () => {
  it('reads back exams after close + reopen (simulates page refresh)', async () => {
    await db.delete();
    await db.open();
    const id = await seedCompleteExam('2026-07-16');

    await db.close();
    await db.open();

    const reloaded = await db.exams.get(id);
    expect(reloaded).toBeDefined();
    expect(reloaded?.status).toBe('completed');
    expect(reloaded?.result).not.toBeNull();
    expect(reloaded?.result?.raw.netPercent).toBeCloseTo(59.6491, 4);
    // 60/10/25 laid out in question order: math 100, physics 73.33, chem -5.56.
    expect(reloaded?.result?.raw.weightedRawScore).toBeCloseTo(65.0397, 4);
    expect(reloaded?.answers[1]?.answer).toBe('correct');
    expect(Object.keys(reloaded?.answers ?? {})).toHaveLength(95);
  });

  it('keeps a separate database instance over the same storage consistent', async () => {
    await db.delete();
    await db.open();
    const id = await seedCompleteExam('2026-06-30');
    const second = new KonkurDB('konkur-lab');
    const seen = await second.exams.get(id);
    expect(seen?.date).toBe('2026-06-30');
    second.close();
  });
});

describe('exam lifecycle', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('starts as a draft with 95 empty question slots and no result', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    expect(exam.status).toBe('draft');
    expect(exam.result).toBeNull();
    expect(exam.revision).toBe(0);
    expect(Object.keys(exam.answers)).toHaveLength(95);
    for (const e of Object.values(exam.answers)) {
      expect(e.answer).toBeUndefined();
      expect(e.difficulty).toBeUndefined();
    }
  });

  it('refuses to complete an exam with missing inputs', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    exam.answers = answersFor(60, 10);
    delete exam.answers[42];
    await db.exams.put(exam);
    await expect(completeExam(exam.id)).rejects.toBeInstanceOf(ExamWriteError);
    expect((await db.exams.get(exam.id))?.status).toBe('draft');
  });

  it('refuses to complete when answers exist but a difficulty label is missing', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    exam.answers = answersFor(60, 10);
    const entry = { ...exam.answers[42] };
    delete entry.difficulty;
    exam.answers[42] = entry;
    await db.exams.put(exam);
    await expect(completeExam(exam.id)).rejects.toBeInstanceOf(ExamWriteError);
  });

  it('completes a full exam and freezes the result', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    exam.answers = answersFor(60, 10);
    await db.exams.put(exam);
    const done = await completeExam(exam.id);
    expect(done.status).toBe('completed');
    expect(done.completedAt).not.toBeNull();
    expect(done.result?.profileVersion).toBe('v1');
    expect(done.result?.engineVersion).toBe('engine-1.0.0');
    expect(done.result?.raw.correct).toBe(60);
    expect(done.result?.raw.wrong).toBe(10);
    expect(done.result?.raw.blank).toBe(25);
  });

  it('increments the revision when a completed exam is reopened', async () => {
    const id = await seedCompleteExam('2026-07-16');
    const reopened = await reopenExam(id);
    expect(reopened.status).toBe('draft');
    expect(reopened.result).toBeNull();
    expect(reopened.revision).toBe(1);

    // Re-completing and reopening again increments further.
    await db.exams.update(id, { status: 'completed' });
    const again = await reopenExam(id);
    expect(again.revision).toBe(2);
  });

  it('treats reopening an already-open draft as a no-op', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    await db.exams.put(exam);
    const reopened = await reopenExam(exam.id);
    expect(reopened.revision).toBe(0);
    expect(reopened.status).toBe('draft');
  });

  it('archives and un-archives without touching the stored result', async () => {
    const id = await seedCompleteExam('2026-07-16');
    const before = (await db.exams.get(id))!.result;
    const archived = await setArchived(id, true);
    expect(archived.status).toBe('archived');
    expect(archived.result).toEqual(before);
    const restored = await setArchived(id, false);
    expect(restored.status).toBe('completed');
    expect(restored.result).toEqual(before);
  });

  it('rejects an invalid date on metadata update', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    await db.exams.put(exam);
    await expect(updateExamMeta(exam.id, { date: '2026-02-31' })).rejects.toBeInstanceOf(
      ExamWriteError,
    );
  });

  it('finds a same-date, same-provider duplicate', async () => {
    const id = await seedCompleteExam('2026-07-16');
    const dup = await findDuplicate('2026-07-16', 'Maz');
    expect(dup?.id).toBe(id);
    expect(await findDuplicate('2026-07-16', 'Maz', id)).toBeNull();
    expect(await findDuplicate('2026-07-16', 'Gaj')).toBeNull();
  });

  it('sorts exams by date then creation time', async () => {
    await seedCompleteExam('2026-07-30');
    await seedCompleteExam('2026-06-30');
    await seedCompleteExam('2026-07-16');
    const all = await listExams();
    expect(all.map((e) => e.date)).toEqual(['2026-06-30', '2026-07-16', '2026-07-30']);
  });

  it('deletes an exam without touching the others', async () => {
    const a = await seedCompleteExam('2026-06-30');
    const b = await seedCompleteExam('2026-07-16');
    await deleteExam(a);
    const all = await listExams();
    expect(all.map((e) => e.id)).toEqual([b]);
  });
});

describe('setQuestion keeps answer and difficulty independent', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('sets only the answer when only the answer is patched', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    await db.exams.put(exam);
    await setQuestion(exam.id, 5, { answer: 'correct' });
    const after = (await db.exams.get(exam.id))!;
    expect(after.answers[5]).toEqual({ answer: 'correct' });
    expect(after.answers[6]).toEqual({});
  });

  it('sets only the difficulty when only the difficulty is patched', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    exam.answers[5] = { answer: 'wrong' };
    await db.exams.put(exam);
    await setQuestion(exam.id, 5, { difficulty: 'hard' });
    const after = (await db.exams.get(exam.id))!;
    expect(after.answers[5]).toEqual({ answer: 'wrong', difficulty: 'hard' });
  });

  it('clears a value when patched with null', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    exam.answers[5] = { answer: 'correct', difficulty: 'easy' };
    await db.exams.put(exam);
    await setQuestion(exam.id, 5, { answer: null });
    const after = (await db.exams.get(exam.id))!;
    expect(after.answers[5]).toEqual({ difficulty: 'easy' });
  });

  it('survives a reload with the selection intact', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    await db.exams.put(exam);
    await setQuestion(exam.id, 95, { answer: 'blank', difficulty: 'medium' });

    await db.close();
    await db.open();

    const after = (await db.exams.get(exam.id))!;
    expect(after.answers[95]).toEqual({ answer: 'blank', difficulty: 'medium' });
  });
});

describe('versioned migrations', () => {
  it('opens a v1 database and leaves existing records intact', async () => {
    await db.delete();
    await db.open();
    const id = await seedCompleteExam('2026-06-30');

    // A fresh instance reuses the same schema version, so no upgrade runs and
    // no data is rebuilt.
    const reopened = new KonkurDB('konkur-lab');
    const rows = await reopened.exams.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    reopened.close();
  });

  it('declares the current version on the instance', async () => {
    await db.delete();
    await db.open();
    expect(db.verno).toBe(1);
  });
});