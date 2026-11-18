import {
  ANSWER_VALUES,
  SUBJECTS,
  TOTAL_QUESTION_COUNT,
  type AnswerState,
  type Difficulty,
  type SubjectId,
} from './types';

export interface QuestionEntry {
  answer?: AnswerState | null;
  difficulty?: Difficulty | null;
}

export type AnswerMap = Record<number, QuestionEntry>;

export interface AnswerCounts {
  correct: number;
  wrong: number;
  blank: number;
  answered: number;
  /** Questions with no answer recorded at all -- distinct from "blank". */
  unanswered: number;
  attempted: number;
  total: number;
}

export interface SubjectRawScore extends AnswerCounts {
  subjectId: SubjectId;
  /** Iranian-style net percentage; may be negative. */
  netPercent: number;
  attemptRatePercent: number | null;
  accuracyPercent: number | null;
  correctProportion: number | null;
  wrongProportion: number | null;
  blankProportion: number | null;
  difficultyCounts: Record<Difficulty, number>;
  unlabeled: number;
}

export interface OverallRawScore extends AnswerCounts {
  netPercent: number;
  attemptRatePercent: number | null;
  accuracyPercent: number | null;
  correctProportion: number | null;
  wrongProportion: number | null;
  blankProportion: number | null;
  unlabeled: number;
  /** Coefficient-weighted raw score out of 100; may be negative. */
  weightedRawScore: number;
  contributions: Record<SubjectId, number>;
}

export function countAnswers(entries: readonly QuestionEntry[]): AnswerCounts {
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  let unanswered = 0;
  for (const e of entries) {
    const a = e?.answer;
    if (a === 'correct') correct += 1;
    else if (a === 'wrong') wrong += 1;
    else if (a === 'blank') blank += 1;
    else unanswered += 1;
  }
  const attempted = correct + wrong;
  return {
    correct,
    wrong,
    blank,
    answered: correct + wrong + blank,
    unanswered,
    attempted,
    total: entries.length,
  };
}

export function countDifficulties(entries: readonly QuestionEntry[]): Record<Difficulty, number> {
  const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const e of entries) {
    const d = e?.difficulty;
    if (d === 'easy') counts.easy += 1;
    else if (d === 'medium') counts.medium += 1;
    else if (d === 'hard') counts.hard += 1;
  }
  return counts;
}

/**
 * Net percentage: 100 * (C - W/3) / N. Negative values are meaningful and are
 * never clamped.
 */
export function netPercent(correct: number, wrong: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const value = ANSWER_VALUES.correct * correct + ANSWER_VALUES.wrong * wrong;
  return (100 * value) / total;
}

export function attemptRatePercent(attempted: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return (100 * attempted) / total;
}

export function accuracyPercent(correct: number, attempted: number): number | null {
  if (!Number.isFinite(attempted) || attempted <= 0) return null;
  return (100 * correct) / attempted;
}

function proportion(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return (100 * part) / total;
}

export interface SubjectQuestionFilter {
  start: number;
  end: number;
}

/** Subject-level raw score computed from whatever answers are currently set. */
export function scoreSubject(
  subjectId: SubjectId,
  entries: readonly QuestionEntry[],
  expectedCount: number,
): SubjectRawScore {
  const counts = countAnswers(entries);
  const difficultyCounts = countDifficulties(entries);
  const unlabeled = entries.filter((e) => !e?.difficulty).length;
  const net = netPercent(counts.correct, counts.wrong, expectedCount);
  return {
    subjectId,
    ...counts,
    // A subject that is only partially entered reports on its expected size so
    // provisional percentages stay comparable across drafts.
    netPercent: net ?? Number.NaN,
    attemptRatePercent: attemptRatePercent(counts.attempted, expectedCount),
    accuracyPercent: accuracyPercent(counts.correct, counts.attempted),
    correctProportion: proportion(counts.correct, expectedCount),
    wrongProportion: proportion(counts.wrong, expectedCount),
    blankProportion: proportion(counts.blank, expectedCount),
    difficultyCounts,
    unlabeled,
  };
}

export function sliceSubjectEntries(
  answers: AnswerMap,
  filter: SubjectQuestionFilter,
): QuestionEntry[] {
  const out: QuestionEntry[] = [];
  for (let q = filter.start; q <= filter.end; q += 1) {
    out.push(answers[q] ?? {});
  }
  return out;
}

/** Full-exam raw score: per-subject nets, overall net, and the weighted score. */
export function scoreExamRaw(
  answers: AnswerMap,
  coefficients: Record<SubjectId, number> = {
    math: 12,
    physics: 9,
    chemistry: 7,
  },
): OverallRawScore & { subjects: Record<SubjectId, SubjectRawScore> } {
  const subjects = {} as Record<SubjectId, SubjectRawScore>;
  const coeffSum = SUBJECTS.reduce((sum, s) => sum + coefficients[s.id], 0);

  for (const subject of SUBJECTS) {
    const entries = sliceSubjectEntries(answers, {
      start: subject.startQuestion,
      end: subject.endQuestion,
    });
    subjects[subject.id] = scoreSubject(subject.id, entries, subject.questionCount);
  }

  const allEntries: QuestionEntry[] = [];
  for (const subject of SUBJECTS) {
    for (let q = subject.startQuestion; q <= subject.endQuestion; q += 1) {
      allEntries.push(answers[q] ?? {});
    }
  }
  const counts = countAnswers(allEntries);

  // Recompute contributions against the final coefficient total so the parts
  // Contributions are computed once, against the final coefficient total, so
  // the three parts always sum exactly to the weighted score.
  const finalContributions = {} as Record<SubjectId, number>;
  let weighted = 0;
  for (const subject of SUBJECTS) {
    const c = coefficients[subject.id];
    const contribution = (c * subjects[subject.id].netPercent) / (coeffSum || 1);
    finalContributions[subject.id] = contribution;
    weighted += contribution;
  }

  return {
    ...counts,
    subjects,
    netPercent: netPercent(counts.correct, counts.wrong, TOTAL_QUESTION_COUNT) ?? Number.NaN,
    attemptRatePercent: attemptRatePercent(counts.attempted, TOTAL_QUESTION_COUNT),
    accuracyPercent: accuracyPercent(counts.correct, counts.attempted),
    correctProportion: proportion(counts.correct, TOTAL_QUESTION_COUNT),
    wrongProportion: proportion(counts.wrong, TOTAL_QUESTION_COUNT),
    blankProportion: proportion(counts.blank, TOTAL_QUESTION_COUNT),
    unlabeled: allEntries.filter((e) => !e?.difficulty).length,
    weightedRawScore: coeffSum === 0 ? Number.NaN : weighted,
    contributions: finalContributions,
  };
}