import Dexie from 'dexie';
import { SCORING_ENGINE_VERSION } from '../scoring';
import { PROFILE_V1, SUBJECTS, isValidIsoDate, scoreExam, validateExam } from '../scoring';
import type { AnswerMap } from '../scoring';
import { db, ensureSchemaMeta, withTransaction } from './db';
import type { ExamRecord, SubjectLayoutSnapshot } from './models';
import type { AnswerState, Difficulty, QuestionEntry } from '../scoring';

export function currentSubjectLayout(): SubjectLayoutSnapshot[] {
  return SUBJECTS.map((s) => ({
    id: s.id,
    nameEn: s.nameEn,
    nameFa: s.nameFa,
    startQuestion: s.startQuestion,
    endQuestion: s.endQuestion,
    questionCount: s.questionCount,
    coefficient: s.coefficient,
  }));
}

export function emptyAnswers(): AnswerMap {
  const map: AnswerMap = {};
  for (let q = 1; q <= 95; q += 1) map[q] = {};
  return map;
}

let idCounter = 0;

/**
 * Sortable local id. Ids are opaque and never reused; ordering comes from the
 * exam date, not from the id.
 */
export function newExamId(now: Date = new Date()): string {
  idCounter += 1;
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `exam-${stamp}-${String(idCounter).padStart(4, '0')}`;
}

export function emptyExam(date: string, provider: string, id = newExamId()): ExamRecord {
  const now = new Date().toISOString();
  return {
    id,
    date,
    provider,
    status: 'draft',
    notes: '',
    answers: emptyAnswers(),
    profileVersion: PROFILE_V1.version,
    profileSnapshot: structuredClone(PROFILE_V1),
    engineVersion: SCORING_ENGINE_VERSION,
    result: null,
    subjectLayout: currentSubjectLayout(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    revision: 0,
  };
}

export async function listExams(): Promise<ExamRecord[]> {
  await ensureSchemaMeta();
  const rows = await db.exams.toArray();
  return sortExams(rows);
}

/** Chronological by date; same-date exams fall back to creation time. */
export function sortExams(exams: ExamRecord[]): ExamRecord[] {
  return [...exams].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

export function completedExams(exams: ExamRecord[]): ExamRecord[] {
  return sortExams(exams.filter((e) => e.status === 'completed' && e.result !== null));
}

/**
 * Exams shown on trend charts. Drafts never appear. Archived exams are held
 * back unless the user asks for them, since archiving means "keep it, but stop
 * it driving the summaries".
 */
export function trendExams(exams: ExamRecord[], includeArchived: boolean): ExamRecord[] {
  return sortExams(
    exams.filter((e) => {
      if (e.result === null) return false;
      if (e.status === 'draft') return false;
      if (e.status === 'archived' && !includeArchived) return false;
      return true;
    }),
  );
}

export async function getExam(id: string): Promise<ExamRecord | undefined> {
  return db.exams.get(id);
}

export async function saveExam(exam: ExamRecord): Promise<ExamRecord> {
  const next: ExamRecord = { ...exam, updatedAt: new Date().toISOString() };
  await db.exams.put(next);
  return next;
}

export async function deleteExam(id: string): Promise<void> {
  await db.exams.delete(id);
}

/**
 * Replaces a question entry, leaving the other field untouched. This is the only
 * write path the answer-key UI uses, which is what keeps answer and difficulty
 * independent.
 */
export async function setQuestion(
  id: string,
  questionNumber: number,
  patch: { answer?: AnswerState | null; difficulty?: Difficulty | null },
): Promise<void> {
  await db.transaction('rw', db.exams, async () => {
    const exam = await db.exams.get(id);
    if (!exam) throw new ExamWriteError('Exam not found.');
    // Copy first, then write only the patched key, so an answer change can never
    // disturb a difficulty label or vice versa.
    const entry: QuestionEntry = { ...(exam.answers[questionNumber] ?? {}) };
    if ('answer' in patch) {
      if (patch.answer) entry.answer = patch.answer;
      else delete entry.answer;
    }
    if ('difficulty' in patch) {
      if (patch.difficulty) entry.difficulty = patch.difficulty;
      else delete entry.difficulty;
    }
    const answers: AnswerMap = { ...exam.answers, [questionNumber]: entry };
    await db.exams.update(id, { answers, updatedAt: new Date().toISOString() });
  });
}

export class ExamWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExamWriteError';
  }
}

/**
 * Freezes a score snapshot onto the exam and moves it to completed. Refuses
 * unless all 95 answers and all 95 difficulty labels are present.
 */
export async function completeExam(id: string): Promise<ExamRecord> {
  const exam = await db.exams.get(id);
  if (!exam) throw new ExamWriteError('Exam not found.');

  const validation = validateExam({
    date: exam.date,
    provider: exam.provider,
    answers: exam.answers,
    profile: exam.profileSnapshot,
  });
  if (!validation.ok) {
    throw new ExamWriteError(
      `Cannot complete: ${validation.issues.length} unresolved input(s). First issue: ${validation.issues[0]?.message ?? ''}`,
    );
  }

  const result = scoreExam({
    date: exam.date,
    provider: exam.provider,
    answers: exam.answers,
    profile: exam.profileSnapshot,
  });

  const completed: ExamRecord = {
    ...exam,
    status: 'completed',
    result,
    engineVersion: result.engineVersion,
    profileVersion: result.profileVersion,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.exams.put(completed);
  return completed;
}

/**
 * Reopens a completed exam. The stored result is cleared -- deliberately, so a
 * reopened exam cannot keep displaying a score its answers no longer support --
 * and the revision counter records that it happened.
 */
export async function reopenExam(id: string): Promise<ExamRecord> {
  const exam = await db.exams.get(id);
  if (!exam) throw new ExamWriteError('Exam not found.');
  // Reopening an already-open draft is a no-op: there is no frozen result to
  // invalidate, and no reason to bump the revision counter.
  if (exam.status === 'draft') return exam;
  const next: ExamRecord = {
    ...exam,
    status: 'draft',
    result: null,
    completedAt: null,
    revision: exam.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await db.exams.put(next);
  return next;
}

export async function setArchived(id: string, archived: boolean): Promise<ExamRecord> {
  const exam = await db.exams.get(id);
  if (!exam) throw new ExamWriteError('Exam not found.');
  const next: ExamRecord = {
    ...exam,
    status: archived ? 'archived' : 'completed',
    updatedAt: new Date().toISOString(),
  };
  await db.exams.put(next);
  return next;
}

export async function updateExamMeta(
  id: string,
  patch: { date?: string; provider?: string; notes?: string },
): Promise<ExamRecord> {
  const exam = await db.exams.get(id);
  if (!exam) throw new ExamWriteError('Exam not found.');
  if (patch.date !== undefined && !isValidIsoDate(patch.date)) {
    throw new ExamWriteError('Exam date must be a valid date (YYYY-MM-DD).');
  }
  const next: ExamRecord = { ...exam, ...patch, updatedAt: new Date().toISOString() };
  await db.exams.put(next);
  return next;
}

export interface DuplicateCheck {
  duplicate: ExamRecord | null;
}

/** Finds another exam with the same date and provider. */
export async function findDuplicate(
  date: string,
  provider: string,
  exceptId?: string,
): Promise<ExamRecord | null> {
  const candidates = await db.exams.where('date').equals(date).toArray();
  return (
    candidates.find((e) => e.provider === provider && e.id !== exceptId) ?? null
  );
}

export async function clearAllExams(): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.table('exams').clear();
  });
}

export function describeStorageError(error: unknown): string {
  if (error instanceof Dexie.QuotaExceededError) {
    return 'The browser storage quota is full. Export a backup and clear old data.';
  }
  if (error instanceof ExamWriteError) return error.message;
  // Dexie surfaces request failures as plain Errors carrying a Dexie prefix,
  // so match on that before falling through to the generic branch.
  if (error instanceof Error) {
    if (error.name === 'DexieError' || error.name.startsWith('Dexie')) {
      return `Local database error: ${error.message}`;
    }
    return error.message;
  }
  return 'Unknown storage error.';
}