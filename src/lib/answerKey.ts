import {
  DIFFICULTY_LABELS,
  SUBJECTS,
  TOTAL_QUESTION_COUNT,
  subjectForQuestion,
  type AnswerState,
  type Difficulty,
  type QuestionEntry,
  type SubjectId,
} from '../lib/scoring';

export interface ParseResult {
  answers: { question: number; value: AnswerState }[];
  difficulties: { question: number; value: Difficulty }[];
  /** Lines the parser could not interpret, kept for the preview. */
  unrecognized: string[];
  questions: number[];
}

const ANSWER_WORDS: Record<string, AnswerState> = {
  c: 'correct',
  correct: 'correct',
  r: 'correct',
  right: 'correct',
  t: 'correct',
  true: 'correct',
  ok: 'correct',
  '1': 'correct',
  b: 'blank',
  blank: 'blank',
  n: 'blank',
  unanswered: 'blank',
  none: 'blank',
  '-': 'blank',
  '0': 'blank',
  w: 'wrong',
  wrong: 'wrong',
  x: 'wrong',
  i: 'wrong',
  incorrect: 'wrong',
  f: 'wrong',
  false: 'wrong',
  '2': 'wrong',
};

const DIFFICULTY_WORDS: Record<string, Difficulty> = {
  e: 'easy',
  easy: 'easy',
  a: 'easy',
  آسان: 'easy',
  '1': 'easy',
  g: 'easy', // گام transliterated
  گام: 'easy',
  m: 'medium',
  medium: 'medium',
  med: 'medium',
  متوسط: 'medium',
  '2': 'medium',
  h: 'hard',
  hard: 'hard',
  سخت: 'hard',
  difficult: 'hard',
  '3': 'hard',
};

/**
 * Parses pasted answer-key text. Each token carries at most a question number,
 * an answer word, and a difficulty word -- for example:
 *
 *   1 c e
 *   2 - h
 *   3 w m
 *
 * Answers and difficulties are collected independently, so a line with only an
 * answer is perfectly valid. Nothing is inferred: a question absent from the
 * text is simply not included, and the caller shows the diff before saving.
 */
export function parseAnswerKey(text: string): ParseResult {
  // Keyed by question so a repeated question collapses to its last value, which
  // is what a corrected re-paste should do.
  const answerByQuestion = new Map<number, AnswerState>();
  const difficultyByQuestion = new Map<number, Difficulty>();
  const unrecognized: string[] = [];
  const seenQuestions: number[] = [];

  const lines = text.split(/[\r\n;]+/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;

    const tokens = line
      .split(/[\s:=|,]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    // The question number must lead the line. Anything else is prose (a total,
    // a header) and is reported rather than guessed at.
    const first = tokens[0];
    const n = first !== undefined && /^\d{1,3}$/.test(first) ? Number(first) : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > TOTAL_QUESTION_COUNT) {
      unrecognized.push(line);
      continue;
    }
    const question = n;
    seenQuestions.push(question);

    // Positional values: the first value token is the answer, later ones are
    // the difficulty — EXCEPT that a later answer word corrects the answer,
    // which is what a re-typed line like "1 c w" means. The ambiguity this
    // resolves: '1'/'2' are both answer digits and difficulty bands, so a
    // numeric token only counts as a difficulty AFTER the answer is set;
    // word tokens keep correcting the answer in place, as they always did.
    let answerSet = answerByQuestion.has(question);
    for (const token of tokens.slice(1)) {
      const key = token.toLowerCase();
      const answer = ANSWER_WORDS[key];
      if (answer && (!/^[0-3]$/.test(key) || !answerSet)) {
        answerByQuestion.set(question, answer);
        answerSet = true;
        continue;
      }
      const difficulty = DIFFICULTY_WORDS[key] ?? DIFFICULTY_WORDS[token];
      if (difficulty) difficultyByQuestion.set(question, difficulty);
    }
  }

  const questions = [...new Set(seenQuestions)].sort((a, b) => a - b);
  return {
    answers: questions
      .filter((q) => answerByQuestion.has(q))
      .map((q) => ({ question: q, value: answerByQuestion.get(q)! })),
    difficulties: questions
      .filter((q) => difficultyByQuestion.has(q))
      .map((q) => ({ question: q, value: difficultyByQuestion.get(q)! })),
    unrecognized,
    questions,
  };
}

export interface FilterState {
  subject: SubjectId | 'all';
  difficulty: Difficulty | 'unlabeled' | 'all';
  answer: AnswerState | 'unanswered' | 'all';
  query: string;
}

export const EMPTY_FILTER: FilterState = {
  subject: 'all',
  difficulty: 'all',
  answer: 'all',
  query: '',
};

export function matchesFilter(
  questionNumber: number,
  entry: QuestionEntry,
  filter: FilterState,
): boolean {
  if (filter.subject !== 'all' && subjectForQuestion(questionNumber).id !== filter.subject) {
    return false;
  }
  if (filter.difficulty === 'unlabeled') {
    if (entry.difficulty) return false;
  } else if (filter.difficulty !== 'all' && entry.difficulty !== filter.difficulty) {
    return false;
  }
  if (filter.answer === 'unanswered') {
    if (entry.answer) return false;
  } else if (filter.answer !== 'all' && entry.answer !== filter.answer) {
    return false;
  }
  if (filter.query.trim() !== '') {
    const q = filter.query.trim().toLowerCase();
    if (!String(questionNumber).includes(q)) return false;
  }
  return true;
}

export function subjectSummaryText(subjectId: SubjectId): string {
  const s = SUBJECTS.find((x) => x.id === subjectId);
  if (!s) return '';
  return `${s.nameEn} \u2014 ${s.nameFa}`;
}

export function difficultyLabel(d: Difficulty): string {
  return DIFFICULTY_LABELS[d].en;
}