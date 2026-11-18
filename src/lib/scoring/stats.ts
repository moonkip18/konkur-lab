import type { AnswerMap, QuestionEntry } from './raw';
import {
  DIFFICULTY_ORDER,
  SUBJECTS,
  TOTAL_QUESTION_COUNT,
  type Difficulty,
  type SubjectId,
} from './types';

export interface DifficultySlice {
  subjectId: SubjectId;
  difficulty: Difficulty;
  questionCount: number;
  correct: number;
  wrong: number;
  blank: number;
  unanswered: number;
  attempted: number;
  netPercent: number | null;
  attemptRatePercent: number | null;
  accuracyPercent: number | null;
  /** True when the sample is too small to interpret with confidence. */
  smallSample: boolean;
}

export const SMALL_SAMPLE_THRESHOLD = 5;

export function sliceQuestions(
  answers: AnswerMap,
  subjectId: SubjectId,
  difficulty: Difficulty,
): QuestionEntry[] {
  const subject = SUBJECTS.find((s) => s.id === subjectId);
  if (!subject) throw new Error(`Unknown subject: ${subjectId}`);
  const out: QuestionEntry[] = [];
  for (let q = subject.startQuestion; q <= subject.endQuestion; q += 1) {
    const entry = answers[q] ?? {};
    if (entry.difficulty === difficulty) out.push(entry);
  }
  return out;
}

/** Counts and percentages for one subject x difficulty cell of one exam. */
export function difficultySlice(
  answers: AnswerMap,
  subjectId: SubjectId,
  difficulty: Difficulty,
): DifficultySlice {
  const entries = sliceQuestions(answers, subjectId, difficulty);
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  let unanswered = 0;
  for (const e of entries) {
    if (e.answer === 'correct') correct += 1;
    else if (e.answer === 'wrong') wrong += 1;
    else if (e.answer === 'blank') blank += 1;
    else unanswered += 1;
  }
  const n = entries.length;
  const attempted = correct + wrong;
  return {
    subjectId,
    difficulty,
    questionCount: n,
    correct,
    wrong,
    blank,
    unanswered,
    attempted,
    netPercent: n === 0 ? null : (100 * (correct - wrong / 3)) / n,
    attemptRatePercent: n === 0 ? null : (100 * attempted) / n,
    accuracyPercent: attempted === 0 ? null : (100 * correct) / attempted,
    smallSample: n > 0 && n < SMALL_SAMPLE_THRESHOLD,
  };
}

export function allDifficultySlices(answers: AnswerMap): DifficultySlice[] {
  const out: DifficultySlice[] = [];
  for (const subject of SUBJECTS) {
    for (const d of DIFFICULTY_ORDER) out.push(difficultySlice(answers, subject.id, d));
  }
  return out;
}

export interface Coverage {
  answered: number;
  labeled: number;
  total: number;
  answerCoverage: number;
  difficultyCoverage: number;
  complete: boolean;
}

export function coverageOf(answers: AnswerMap): Coverage {
  let answered = 0;
  let labeled = 0;
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    const e = answers[q];
    if (e?.answer) answered += 1;
    if (e?.difficulty) labeled += 1;
  }
  return {
    answered,
    labeled,
    total: TOTAL_QUESTION_COUNT,
    answerCoverage: answered / TOTAL_QUESTION_COUNT,
    difficultyCoverage: labeled / TOTAL_QUESTION_COUNT,
    complete: answered === TOTAL_QUESTION_COUNT && labeled === TOTAL_QUESTION_COUNT,
  };
}

/** Mean of the finite values; null when nothing usable was supplied. */
export function mean(values: readonly (number | null | undefined)[]): number | null {
  const usable = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

/**
 * Trailing rolling mean. Returns one entry per input with the window size that
 * actually contributed, so callers can label a partial window honestly.
 */
export function rollingAverage(
  values: readonly (number | null)[],
  window: number,
): { value: number | null; windowSize: number }[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    const usable = slice.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return {
      value: usable.length === 0 ? null : usable.reduce((a, b) => a + b, 0) / usable.length,
      windowSize: usable.length,
    };
  });
}