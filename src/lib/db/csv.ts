/**
 * CSV export.
 *
 * Both exports carry the scoring parameters and the difficulty labels, so every
 * displayed number can be recomputed in a spreadsheet from these files alone.
 */
import {
  DIFFICULTY_ORDER,
  SUBJECTS,
  TOTAL_QUESTION_COUNT,
  TOTAL_COEFFICIENT,
  expectedNetPerQuestion,
  scoreExam,
  subjectForQuestion,
  type AnswerMap,
  type AnswerState,
  type Difficulty,
  type SubjectId,
} from '../scoring';
import type { ExamRecord } from './models';

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `${lines.join('\n')}\n`;
}

const ANSWER_WORD: Record<AnswerState, string> = {
  correct: 'correct',
  wrong: 'wrong',
  blank: 'blank',
};

/** One row per question, for every exam. */
export function questionsCsv(exams: ExamRecord[]): string {
  const headers = [
    'exam_id',
    'exam_date',
    'provider',
    'exam_status',
    'subject',
    'subject_fa',
    'question_number',
    'answer',
    'difficulty',
    'profile_version',
    'engine_version',
    'completed',
  ];
  const rows: (string | number | null)[][] = [];

  for (const exam of exams) {
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
      const entry = exam.answers[q] ?? {};
      const subject = subjectForQuestion(q);
      rows.push([
        exam.id,
        exam.date,
        exam.provider,
        exam.status,
        subject.nameEn,
        subject.nameFa,
        q,
        entry.answer ? ANSWER_WORD[entry.answer] : '',
        entry.difficulty ?? '',
        exam.profileVersion,
        exam.engineVersion,
        entry.answer ? 1 : 0,
      ]);
    }
  }
  return toCsv(headers, rows);
}

/** One row per exam, including every stored result and its derivation inputs. */
export function examsCsv(exams: ExamRecord[]): string {
  const headers: string[] = [
    'exam_id',
    'exam_date',
    'provider',
    'status',
    'notes',
    'correct_total',
    'wrong_total',
    'blank_total',
    'attempted_total',
    'raw_net_percent_overall',
    'weighted_raw_score',
    'accuracy_percent_overall',
    'attempt_rate_percent_overall',
  ];

  for (const s of SUBJECTS) {
    headers.push(
      `${s.id}_correct`,
      `${s.id}_wrong`,
      `${s.id}_blank`,
      `${s.id}_raw_net_percent`,
      `${s.id}_easy`,
      `${s.id}_medium`,
      `${s.id}_hard`,
      `${s.id}_expected_net_percent`,
      `${s.id}_performance_points`,
      `${s.id}_tau`,
      `${s.id}_coefficient`,
      `${s.id}_weighted_raw_contribution`,
    );
  }

  headers.push(
    'overall_personal_difficulty_index',
    'coefficient_total',
    'expected_net_per_easy_question',
    'expected_net_per_medium_question',
    'expected_net_per_hard_question',
    'index_A',
    'index_B',
    'index_sigma',
    'profile_version',
    'engine_version',
    'revision',
    'completed_at',
    'answer_coverage',
    'difficulty_coverage',
  );

  const rows: (string | number | null)[][] = [];
  const muEasy = expectedNetPerQuestion('easy');
  const muMedium = expectedNetPerQuestion('medium');
  const muHard = expectedNetPerQuestion('hard');

  for (const exam of exams) {
    // Recompute from stored inputs so drafts and resaved rows are consistent
    // with the inputs, not with a stale snapshot.
    const scored = scoreExam({
      date: exam.date,
      provider: exam.provider,
      answers: exam.answers as AnswerMap,
      profile: exam.profileSnapshot,
    });
    const raw = scored.raw;
    const adj = scored.adjusted;

    let answered = 0;
    let labeled = 0;
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
      const e = exam.answers[q];
      if (e?.answer) answered += 1;
      if (e?.difficulty) labeled += 1;
    }

    const row: (string | number | null)[] = [
      exam.id,
      exam.date,
      exam.provider,
      exam.status,
      exam.notes,
      raw.correct,
      raw.wrong,
      raw.blank,
      raw.attempted,
      round(raw.netPercent),
      round(raw.weightedRawScore),
      raw.accuracyPercent === null ? '' : round(raw.accuracyPercent),
      raw.attemptRatePercent === null ? '' : round(raw.attemptRatePercent),
    ];

    for (const s of SUBJECTS) {
      const sr = raw.subjects[s.id as SubjectId];
      const sa = adj.subjects[s.id as SubjectId];
      row.push(
        sr.correct,
        sr.wrong,
        sr.blank,
        round(sr.netPercent),
        sr.difficultyCounts.easy,
        sr.difficultyCounts.medium,
        sr.difficultyCounts.hard,
        round(sa.expectedNetPercent),
        round(sa.performancePoints),
        round(sa.index),
        s.coefficient,
        round(raw.contributions[s.id as SubjectId]),
      );
    }

    row.push(
      round(adj.overallIndex),
      TOTAL_COEFFICIENT,
      round(muEasy, 12),
      round(muMedium, 12),
      round(muHard, 12),
      exam.profileSnapshot.A,
      exam.profileSnapshot.B,
      exam.profileSnapshot.sigma,
      exam.profileVersion,
      exam.engineVersion,
      exam.revision,
      exam.completedAt,
      round((100 * answered) / TOTAL_QUESTION_COUNT),
      round((100 * labeled) / TOTAL_QUESTION_COUNT),
    );

    rows.push(row);
  }
  return toCsv(headers, rows);
}

function round(value: number, decimals = 2): number | null {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Difficulty-band counts per subject, for the difficulty-mix chart data. */
export function difficultyMixRows(exams: ExamRecord[]): {
  date: string;
  examId: string;
  subject: SubjectId;
  easy: number;
  medium: number;
  hard: number;
  total: number;
}[] {
  const out: {
    date: string;
    examId: string;
    subject: SubjectId;
    easy: number;
    medium: number;
    hard: number;
    total: number;
  }[] = [];
  for (const exam of exams) {
    for (const s of SUBJECTS) {
      const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
      for (let q = s.startQuestion; q <= s.endQuestion; q += 1) {
        const d = exam.answers[q]?.difficulty;
        if (d) counts[d] += 1;
      }
      out.push({
        date: exam.date,
        examId: exam.id,
        subject: s.id,
        ...counts,
        total: s.questionCount,
      });
    }
  }
  return out;
}

export const DIFFICULTY_BANDS = DIFFICULTY_ORDER;