import { useMemo } from 'react';
import {
  SUBJECTS,
  TOTAL_QUESTION_COUNT,
  allQuestionNumbers,
  difficultySlice,
  formatDate,
  rollingAverage,
  scoreExam,
  type Difficulty,
  type DifficultySlice,
  type SubjectId,
} from '../lib/scoring';
import { trendExams } from '../lib/db/examRepo';
import type { ExamRecord } from '../lib/db/models';

export interface ExamPoint {
  examId: string;
  date: string;
  label: string;
  rawWeighted: number | null;
  overallIndex: number | null;
  rawNetOverall: number | null;
  accuracy: number | null;
  attemptRate: number | null;
  correct: number;
  wrong: number;
  blank: number;
  attempted: number;
  subjects: Record<SubjectId, ExamPointSubject>;
  /** Raw net, expected net, and deviation per subject. */
  difficultyMix: Record<Difficulty, number>;
  mixBySubject: Record<SubjectId, Record<Difficulty, number>>;
  /** Raw net % by difficulty band, per subject. */
  difficultyNet: Record<SubjectId, Record<Difficulty, number | null>>;
  accuracyBySubjectDifficulty: Record<SubjectId, Record<Difficulty, number | null>>;
  attemptRateBySubjectDifficulty: Record<SubjectId, Record<Difficulty, number | null>>;
  difficultyCounts: Record<Difficulty, number>;
}

export interface ExamPointSubject {
  rawNet: number;
  expectedNet: number;
  performance: number;
  index: number;
  coefficient: number;
  correct: number;
  wrong: number;
  blank: number;
  attempted: number;
  difficultyCounts: Record<Difficulty, number>;
}

/**
 * Flattens exams into chart rows.
 *
 * Reads stored results where they exist so historical charts display exactly
 * what was recorded at the time. Nothing here is fed back into scoring.
 */
export function buildPoints(exams: ExamRecord[], mode: 'gregorian' | 'jalali'): ExamPoint[] {
  const rows = trendExams(exams, true).filter((e) => e.result !== null);
  return rows.map((exam) => pointFor(exam, mode));
}

export function pointFor(exam: ExamRecord, mode: 'gregorian' | 'jalali'): ExamPoint {
  const stored = exam.result;
  // Recompute so difficulty-band breakdowns are available even for rows whose
  // stored result predates a field; the aggregate numbers still come from the
  // stored snapshot.
  const fresh = scoreExam({
    date: exam.date,
    provider: exam.provider,
    answers: exam.answers,
    profile: exam.profileSnapshot,
  });
  const source = stored ?? fresh;

  const subjects = {} as Record<SubjectId, ExamPointSubject>;
  const mixBySubject = {} as Record<SubjectId, Record<Difficulty, number>>;
  const difficultyNet = {} as Record<SubjectId, Record<Difficulty, number | null>>;
  const accuracyBySubjectDifficulty = {} as Record<SubjectId, Record<Difficulty, number | null>>;
  const attemptRateBySubjectDifficulty = {} as Record<SubjectId, Record<Difficulty, number | null>>;

  for (const s of SUBJECTS) {
    const rawSub = source.raw.subjects[s.id];
    const adjSub = source.adjusted.subjects[s.id];
    subjects[s.id] = {
      rawNet: rawSub.netPercent,
      expectedNet: adjSub.expectedNetPercent,
      performance: adjSub.performancePoints,
      index: adjSub.index,
      coefficient: s.coefficient,
      correct: rawSub.correct,
      wrong: rawSub.wrong,
      blank: rawSub.blank,
      attempted: rawSub.attempted,
      difficultyCounts: rawSub.difficultyCounts,
    };
    mixBySubject[s.id] = rawSub.difficultyCounts;

    const net: Record<Difficulty, number | null> = { easy: null, medium: null, hard: null };
    const acc: Record<Difficulty, number | null> = { easy: null, medium: null, hard: null };
    const att: Record<Difficulty, number | null> = { easy: null, medium: null, hard: null };
    for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
      const slice: DifficultySlice = freshSlice(exam, s.id, d);
      net[d] = slice.questionCount === 0 ? null : slice.netPercent;
      acc[d] = slice.accuracyPercent;
      att[d] = slice.attemptRatePercent;
    }
    difficultyNet[s.id] = net;
    accuracyBySubjectDifficulty[s.id] = acc;
    attemptRateBySubjectDifficulty[s.id] = att;
  }

  const difficultyMix: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const s of SUBJECTS) {
    difficultyMix.easy += mixBySubject[s.id].easy;
    difficultyMix.medium += mixBySubject[s.id].medium;
    difficultyMix.hard += mixBySubject[s.id].hard;
  }

  return {
    examId: exam.id,
    date: exam.date,
    label: formatDate(exam.date, mode),
    rawWeighted: source.raw.weightedRawScore,
    overallIndex: source.adjusted.overallIndex,
    rawNetOverall: source.raw.netPercent,
    accuracy: source.raw.accuracyPercent,
    attemptRate: source.raw.attemptRatePercent,
    correct: source.raw.correct,
    wrong: source.raw.wrong,
    blank: source.raw.blank,
    attempted: source.raw.attempted,
    subjects,
    difficultyMix,
    mixBySubject,
    difficultyNet,
    accuracyBySubjectDifficulty,
    attemptRateBySubjectDifficulty,
    difficultyCounts: difficultyMix,
  };
}

function freshSlice(exam: ExamRecord, subjectId: SubjectId, d: Difficulty): DifficultySlice {
  return difficultySlice(exam.answers, subjectId, d);
}

/** Trailing rolling mean with the contributing window size attached. */
export function withRolling(
  points: ExamPoint[],
  key: (p: ExamPoint) => number | null,
  window: number,
): { value: number | null; windowSize: number }[] {
  return rollingAverage(
    points.map(key),
    window,
  );
}

export function useChartData(exams: ExamRecord[], mode: 'gregorian' | 'jalali'): ExamPoint[] {
  return useMemo(() => buildPoints(exams, mode), [exams, mode]);
}

/** Latest completed exam, plus the one before it for the comparison column. */
export function latestTwo(exams: ExamRecord[]): { latest: ExamRecord | null; previous: ExamRecord | null } {
  const done = trendExams(exams, false);
  if (done.length === 0) return { latest: null, previous: null };
  const latest = done[done.length - 1]!;
  const previous = done.length >= 2 ? done[done.length - 2]! : null;
  return { latest, previous };
}

export function allQuestionList(): { questionNumber: number; subjectId: SubjectId }[] {
  return allQuestionNumbers().map((questionNumber) => ({
    questionNumber,
    subjectId: SUBJECTS.find(
      (s) => questionNumber >= s.startQuestion && questionNumber <= s.endQuestion,
    )!.id,
  }));
}

export const TOTAL_QUESTIONS = TOTAL_QUESTION_COUNT;