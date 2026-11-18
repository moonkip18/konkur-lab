import {
  computeAdjusted,
  hasCompleteDifficultyLabels,
  SCORING_ENGINE_VERSION,
  type AdjustedScore,
} from './adjusted';
import { PROFILE_V1, validateProfile, type ScoringProfile } from './profile';
import { scoreExamRaw, type AnswerMap, type OverallRawScore, type SubjectRawScore } from './raw';
import {
  SUBJECTS,
  TOTAL_QUESTION_COUNT,
  subjectForQuestion,
  type AnswerState,
  type Difficulty,
  type SubjectId,
} from './types';

/**
 * Hard rule of the app: an exam's score is a pure function of its own answers,
 * its own difficulty labels, and its profile snapshot. This module deliberately
 * exposes no function that accepts more than one exam, which is what makes the
 * historical-independence guarantee structurally true rather than a convention.
 */
export interface ExamQuestion {
  questionNumber: number;
  subjectId: SubjectId;
  answer?: AnswerState | null;
  difficulty?: Difficulty | null;
}

export interface ExamInput {
  id?: string;
  date: string;
  provider: string;
  answers: AnswerMap;
  /** Optional override; otherwise PROFILE_V1 is used and snapshotted. */
  profile?: ScoringProfile;
}

export interface ExamScoreResult {
  engineVersion: string;
  profileVersion: string;
  raw: OverallRawScore & { subjects: Record<SubjectId, SubjectRawScore> };
  adjusted: AdjustedScore;
}

export interface ValidationIssue {
  code: string;
  message: string;
  questionNumber?: number;
  subjectId?: SubjectId;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  answerCoverage: number;
  difficultyCoverage: number;
  answeredCount: number;
  labeledCount: number;
}

function isIsoDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // Reject 2025-02-30 style dates that Date silently rolls over.
  return d.toISOString().slice(0, 10) === value;
}

export function validateExam(input: ExamInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  const answers = input.answers ?? {};

  if (!isIsoDate(input.date)) {
    issues.push({ code: 'invalid_date', message: 'Exam date must be a valid ISO date (YYYY-MM-DD).' });
  }
  if (typeof input.provider !== 'string' || input.provider.trim() === '') {
    issues.push({ code: 'invalid_provider', message: 'Provider is required.' });
  }
  if (input.profile) {
    for (const p of validateProfile(input.profile)) {
      issues.push({ code: 'invalid_profile', message: `${p.field}: ${p.message}` });
    }
  }

  const subjectCounts: Record<SubjectId, { correct: number; wrong: number; blank: number }> = {
    math: { correct: 0, wrong: 0, blank: 0 },
    physics: { correct: 0, wrong: 0, blank: 0 },
    chemistry: { correct: 0, wrong: 0, blank: 0 },
  };

  let answered = 0;
  let labeled = 0;

  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    const entry = answers[q];
    if (entry === undefined) {
      issues.push({
        code: 'missing_question',
        message: `Question ${q} has no record.`,
        questionNumber: q,
      });
      continue;
    }
    const subject = subjectForQuestion(q);
    const answer = entry.answer;
    if (answer === 'correct' || answer === 'wrong' || answer === 'blank') {
      answered += 1;
      subjectCounts[subject.id][answer] += 1;
    } else {
      issues.push({
        code: 'missing_answer',
        message: `Question ${q} has no answer recorded.`,
        questionNumber: q,
        subjectId: subject.id,
      });
    }
    const d = entry.difficulty;
    if (d === 'easy' || d === 'medium' || d === 'hard') {
      labeled += 1;
    } else {
      issues.push({
        code: 'missing_difficulty',
        message: `Question ${q} has no difficulty label.`,
        questionNumber: q,
        subjectId: subject.id,
      });
    }
  }

  for (const subject of SUBJECTS) {
    const c = subjectCounts[subject.id];
    const sum = c.correct + c.wrong + c.blank;
    if (sum !== subject.questionCount) {
      issues.push({
        code: 'subject_count_mismatch',
        message: `${subject.nameEn}: correct + wrong + blank (${sum}) must equal ${subject.questionCount}.`,
        subjectId: subject.id,
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    answerCoverage: answered / TOTAL_QUESTION_COUNT,
    difficultyCoverage: labeled / TOTAL_QUESTION_COUNT,
    answeredCount: answered,
    labeledCount: labeled,
  };
}

export function isComplete(input: ExamInput): boolean {
  return validateExam(input).ok;
}

/** Raw + adjusted scores for one exam. Independent of every other exam. */
export function scoreExam(input: ExamInput): ExamScoreResult {
  const profile = input.profile ?? PROFILE_V1;
  const raw = scoreExamRaw(input.answers, profile.subjectCoefficients);
  const adjusted = computeAdjusted({ answers: input.answers, rawSubjects: raw.subjects }, profile);
  return {
    engineVersion: SCORING_ENGINE_VERSION,
    profileVersion: profile.version,
    raw,
    adjusted,
  };
}

export interface ProvisionalSummary {
  raw: OverallRawScore & { subjects: Record<SubjectId, SubjectRawScore> };
  adjustedAvailable: boolean;
  reason?: string;
}

/**
 * Draft-safe summary. Adjusted numbers appear only when all 95 difficulty
 * labels exist, so a half-entered exam never shows a plausible-looking index.
 */
export function summariseProvisional(input: ExamInput): ProvisionalSummary {
  const profile = input.profile ?? PROFILE_V1;
  const raw = scoreExamRaw(input.answers, profile.subjectCoefficients);
  if (hasCompleteDifficultyLabels(input.answers)) {
    return { raw, adjustedAvailable: true };
  }
  return {
    raw,
    adjustedAvailable: false,
    reason: 'Difficulty-adjusted score needs a difficulty label on all 95 questions.',
  };
}

export function toQuestionList(answers: AnswerMap): ExamQuestion[] {
  const out: ExamQuestion[] = [];
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    const entry = answers[q] ?? {};
    out.push({
      questionNumber: q,
      subjectId: subjectForQuestion(q).id,
      answer: entry.answer ?? null,
      difficulty: entry.difficulty ?? null,
    });
  }
  return out;
}

