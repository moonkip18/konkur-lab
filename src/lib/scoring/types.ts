export type AnswerState = 'correct' | 'blank' | 'wrong';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type ExamStatus = 'draft' | 'completed' | 'archived';
export type SubjectId = 'math' | 'physics' | 'chemistry';

export interface SubjectDefinition {
  id: SubjectId;
  nameEn: string;
  nameFa: string;
  startQuestion: number;
  endQuestion: number;
  questionCount: number;
  coefficient: number;
}

/** Fixed exam layout: 95 questions, coefficients 12 / 9 / 7. */
export const SUBJECTS: readonly SubjectDefinition[] = [
  {
    id: 'math',
    nameEn: 'Math',
    nameFa: 'ریاضی',
    startQuestion: 1,
    endQuestion: 40,
    questionCount: 40,
    coefficient: 12,
  },
  {
    id: 'physics',
    nameEn: 'Physics',
    nameFa: 'فیزیک',
    startQuestion: 41,
    endQuestion: 65,
    questionCount: 25,
    coefficient: 9,
  },
  {
    id: 'chemistry',
    nameEn: 'Chemistry',
    nameFa: 'شیمی',
    startQuestion: 66,
    endQuestion: 95,
    questionCount: 30,
    coefficient: 7,
  },
] as const;

export const TOTAL_QUESTION_COUNT = 95;
export const TOTAL_COEFFICIENT = 28;

export const ANSWER_VALUES: Readonly<Record<AnswerState, number>> = {
  correct: 1,
  wrong: -1 / 3,
  blank: 0,
};

export const ANSWER_LABELS: Readonly<Record<AnswerState, { en: string; fa: string }>> = {
  correct: { en: 'Correct', fa: 'درست' },
  blank: { en: 'Blank', fa: 'نزده' },
  wrong: { en: 'Wrong', fa: 'غلط' },
};

export const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'medium', 'hard'] as const;

export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, { en: string; fa: string }>> = {
  easy: { en: 'Easy', fa: 'آسان' },
  medium: { en: 'Medium', fa: 'متوسط' },
  hard: { en: 'Hard', fa: 'سخت' },
};

export function getSubject(id: SubjectId): SubjectDefinition {
  const found = SUBJECTS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown subject: ${id}`);
  return found;
}

export function subjectForQuestion(questionNumber: number): SubjectDefinition {
  if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > TOTAL_QUESTION_COUNT) {
    throw new Error(`Question number out of range: ${questionNumber}`);
  }
  const found = SUBJECTS.find(
    (s) => questionNumber >= s.startQuestion && questionNumber <= s.endQuestion,
  );
  if (!found) throw new Error(`No subject owns question ${questionNumber}`);
  return found;
}

/** All 95 question numbers, in order. */
export function allQuestionNumbers(): number[] {
  return Array.from({ length: TOTAL_QUESTION_COUNT }, (_, i) => i + 1);
}