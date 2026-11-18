import { PROFILE_V1, expectedNetPerQuestion, assertValidProfile, type ScoringProfile } from './profile';
import { sliceSubjectEntries, type AnswerMap, type SubjectRawScore } from './raw';
import { SUBJECTS, TOTAL_QUESTION_COUNT, type Difficulty, type SubjectId } from './types';

export interface SubjectExpected {
  subjectId: SubjectId;
  difficultyCounts: Record<Difficulty, number>;
  unlabeled: number;
  /** Model-expected net percentage for this subject's actual labels. */
  expectedNetPercent: number;
}

export interface SubjectAdjusted extends SubjectExpected {
  subjectId: SubjectId;
  /** RawNet_s - ExpectedNet_s, in percentage points. */
  performancePoints: number;
  /** tau_s = A + B * (Performance_s / sigma). No clamping. */
  index: number;
  /** c_s * tau_s, the numerator of the weighted overall index. */
  weightedContribution: number;
}

export interface AdjustedScore {
  profileVersion: string;
  engineVersion: string;
  expected: Record<SubjectId, SubjectExpected>;
  subjects: Record<SubjectId, SubjectAdjusted>;
  /** T = (12*tM + 9*tP + 7*tC) / 28. */
  overallIndex: number;
  coefficientTotal: number;
}

/** Bumped whenever the formulas themselves change, so stored results stay honest. */
export const SCORING_ENGINE_VERSION = 'engine-1.0.0';

/**
 * ExpectedNet_s = 100 * sum(mu_{d_i}) / N_s, using the labels actually entered
 * for this exam. Missing labels make the expected score unavailable rather than
 * silently treated as easy.
 */
export function expectedNetForSubject(
  subjectId: SubjectId,
  answers: AnswerMap,
  profile: ScoringProfile = PROFILE_V1,
): SubjectExpected {
  const subject = SUBJECTS.find((s) => s.id === subjectId);
  if (!subject) throw new Error(`Unknown subject: ${subjectId}`);
  const entries = sliceSubjectEntries(answers, {
    start: subject.startQuestion,
    end: subject.endQuestion,
  });
  return expectedNetFromEntries(subjectId, entries, subject.questionCount, profile);
}

export function expectedNetFromEntries(
  subjectId: SubjectId,
  entries: readonly { difficulty?: Difficulty | null }[],
  expectedCount: number,
  profile: ScoringProfile = PROFILE_V1,
): SubjectExpected {
  const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  let unlabeled = 0;
  let sum = 0;
  for (const e of entries) {
    const d = e?.difficulty;
    if (d === 'easy' || d === 'medium' || d === 'hard') {
      counts[d] += 1;
      sum += expectedNetPerQuestion(d, profile);
    } else {
      unlabeled += 1;
    }
  }
  return {
    subjectId,
    difficultyCounts: counts,
    unlabeled,
    expectedNetPercent: (100 * sum) / expectedCount,
  };
}

/** tau_s = A + B * Performance_s / sigma */
export function subjectIndex(performancePoints: number, profile: ScoringProfile = PROFILE_V1): number {
  return profile.A + (profile.B * performancePoints) / profile.sigma;
}

export interface AdjustedInput {
  answers: AnswerMap;
  /** Subject raw scores, typically from scoreExamRaw(). */
  rawSubjects: Record<SubjectId, SubjectRawScore>;
}

/**
 * Full adjusted score for one exam. Pure: it reads only this exam's answers and
 * the profile snapshot -- never any other exam.
 */
export function computeAdjusted(
  input: AdjustedInput,
  profile: ScoringProfile = PROFILE_V1,
): AdjustedScore {
  assertValidProfile(profile);

  const expected = {} as Record<SubjectId, SubjectExpected>;
  const subjects = {} as Record<SubjectId, SubjectAdjusted>;
  let coefficientTotal = 0;
  let weightedIndex = 0;

  for (const subject of SUBJECTS) {
    const exp = expectedNetForSubject(subject.id, input.answers, profile);
    expected[subject.id] = exp;

    const raw = input.rawSubjects[subject.id];
    const rawNet = raw?.netPercent;
    const performance = Number.isFinite(rawNet) ? rawNet - exp.expectedNetPercent : Number.NaN;
    const index = Number.isFinite(performance) ? subjectIndex(performance, profile) : Number.NaN;
    const coefficient = profile.subjectCoefficients[subject.id];
    coefficientTotal += coefficient;
    if (Number.isFinite(index)) weightedIndex += coefficient * index;

    subjects[subject.id] = {
      ...exp,
      subjectId: subject.id,
      performancePoints: performance,
      index,
      weightedContribution: coefficient * index,
    };
  }

  return {
    profileVersion: profile.version,
    engineVersion: SCORING_ENGINE_VERSION,
    expected,
    subjects,
    overallIndex: coefficientTotal === 0 ? Number.NaN : weightedIndex / coefficientTotal,
    coefficientTotal,
  };
}

/** True when every one of the 95 questions carries a difficulty label. */
export function hasCompleteDifficultyLabels(answers: AnswerMap): boolean {
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    const d = answers[q]?.difficulty;
    if (d !== 'easy' && d !== 'medium' && d !== 'hard') return false;
  }
  return true;
}