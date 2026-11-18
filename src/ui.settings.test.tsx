import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider } from './state/AppContext';
import { Settings } from './pages/Settings';
import { db } from './lib/db/db';
import { completeExam, emptyAnswers, emptyExam, listExams } from './lib/db/examRepo';
import { buildBackup, serialiseBackup } from './lib/db/backup';
import { examsCsv, questionsCsv } from './lib/db/csv';
import { TOTAL_QUESTION_COUNT } from './lib/scoring';
import { downloadFile } from './lib/storage';
import type { ExamRecord } from './lib/db/models';

vi.mock('./lib/storage', async () => {
  const actual = await vi.importActual<typeof import('./lib/storage')>('./lib/storage');
  return { ...actual, downloadFile: vi.fn() };
});

function renderSettings(): void {
  render(
    <AppProvider>
      <Settings />
    </AppProvider>,
  );
}

async function seed(date: string, seedValue: number): Promise<ExamRecord> {
  const exam = emptyExam(date, 'Maz');
  const answers = emptyAnswers();
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    const roll = (q * 37 + seedValue * 11) % 100;
    answers[q] = {
      answer: roll < 50 ? 'correct' : roll < 75 ? 'wrong' : 'blank',
      difficulty: (q * 13 + seedValue * 5) % 3 === 0 ? 'easy' : (q + seedValue) % 3 === 1 ? 'medium' : 'hard',
    };
  }
  exam.answers = answers;
  await db.exams.put(exam);
  return completeExam(exam.id);
}

/** jsdom File.text() is available; the app reads via FileReader. */
function fileFrom(name: string, contents: string): File {
  return new File([contents], name, { type: 'application/json' });
}

describe('JSON export', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.close();
  });

  it('writes a complete backup file and records the backup date', async () => {
    const user = userEvent.setup();
    await seed('2026-07-16', 1);
    renderSettings();
    await waitFor(() => expect(screen.getByRole('button', { name: /export json backup/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /export json backup/i }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const [filename, contents] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(filename).toMatch(/^konkur-backup-\d{4}-\d{2}-\d{2}\.json$/);

    const parsed = JSON.parse(contents as string);
    expect(parsed.metadata.app).toBe('konkur-progress-lab');
    expect(parsed.exams).toHaveLength(1);
    expect(Object.keys(parsed.exams[0].answers)).toHaveLength(95);
    expect(parsed.exams[0].profileSnapshot.version).toBe('v1');
    expect(parsed.exams[0].result.adjusted.overallIndex).toBeTypeOf('number');

    // The backup date is remembered so the reminder can be honest.
    await waitFor(async () => {
      expect(await db.meta.get('lastBackupAt')).toBeDefined();
    });
    expect(await screen.findByText(/last successful backup/i)).toBeInTheDocument();
  });

  it('says the last backup is overdue once the interval passes', async () => {
    await db.exams.clear();
    await db.meta.put({ key: 'lastBackupAt', value: '2026-01-01T00:00:00.000Z' });
    renderSettings();
    await waitFor(() => expect(screen.getByText(/backup overdue/i)).toBeInTheDocument());
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });
});

describe('CSV export', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.close();
  });

  it('downloads a question-level file with one row per question', async () => {
    const user = userEvent.setup();
    await seed('2026-07-16', 1);
    renderSettings();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /export question-level csv/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: /export question-level csv/i }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());

    const [filename, contents] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(filename).toMatch(/\.csv$/);
    const lines = (contents as string).trim().split('\n');
    expect(lines).toHaveLength(1 + TOTAL_QUESTION_COUNT);
    expect(lines[0]).toContain('question_number');
    expect(lines[0]).toContain('difficulty');
  });

  it('downloads an exam-level file carrying results and scale parameters', async () => {
    const user = userEvent.setup();
    const done = await seed('2026-07-16', 1);
    renderSettings();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /export exam-level csv/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: /export exam-level csv/i }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());

    const contents = vi.mocked(downloadFile).mock.calls[0]![1] as string;
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(2);
    const headers = lines[0]!.split(',');
    const values = lines[1]!.split(',');
    const get = (name: string): string => values[headers.indexOf(name)]!;
    expect(get('exam_id')).toBe(done.id);
    expect(get('index_A')).toBe('5000');
    expect(get('math_coefficient')).toBe('12');
    expect(get('difficulty_coverage')).toBe('100');
  });
});

describe('restore preview and commit', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.close();
  });

  async function importFile(contents: string, name = 'backup.json'): Promise<void> {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText(/backup file/i)).toBeInTheDocument());
    await user.upload(screen.getByLabelText(/backup file/i), fileFrom(name, contents));
  }

  it('previews a valid backup before writing anything', async () => {
    await seed('2026-07-16', 1);
    const text = serialiseBackup(buildBackup(await listExams()));
    await importFile(text);

    await waitFor(() => expect(screen.getByText(/1 exam,/)).toBeInTheDocument());
    expect(screen.getByText(/no duplicate date\+provider pairs/i)).toBeInTheDocument();

    // Nothing was written yet.
    expect(await db.exams.count()).toBe(1);
  });

  it('refuses a non-JSON file and leaves the database untouched', async () => {
    const existing = await seed('2026-06-30', 1);
    await importFile('this is not json');

    await waitFor(() => expect(screen.getByText(/not valid JSON/i)).toBeInTheDocument());
    const rows = await db.exams.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(existing.id);
    expect(rows[0]?.result).not.toBeNull();
  });

  it('refuses a file whose completed exam contradicts its own inputs', async () => {
    const existing = await seed('2026-06-30', 1);
    const exams = structuredClone(await listExams());
    exams[0]!.answers[1] = { answer: 'wrong', difficulty: 'medium' };
    await importFile(serialiseBackup(buildBackup(exams)));

    await waitFor(() => expect(screen.getByText(/will not be imported/i)).toBeInTheDocument());
    expect(screen.getAllByText(/does not match its own inputs/i).length).toBeGreaterThan(0);
    const confirm = screen.getByRole('button', { name: /replace all exams/i });
    expect(confirm).toBeDisabled();

    const rows = await db.exams.toArray();
    expect(rows[0]?.result).toEqual(existing.result);
  });

  it('replaces all exams on an explicit confirm', async () => {
    const user = userEvent.setup();
    await seed('2026-06-30', 1);
    const backupText = serialiseBackup(buildBackup(await listExams()));

    renderSettings();
    await waitFor(() => expect(screen.getByLabelText(/backup file/i)).toBeInTheDocument());
    await user.upload(screen.getByLabelText(/backup file/i), fileFrom('b.json', backupText));
    await waitFor(() => expect(screen.getByText(/1 exam,/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /replace all exams/i }));
    await waitFor(() => expect(screen.getByText(/imported 1 exam/i)).toBeInTheDocument());
    expect(await db.exams.count()).toBe(1);
  });

  it('restores multiple exams with identical scores from the file', async () => {
    const user = userEvent.setup();
    await seed('2026-06-18', 1);
    await seed('2026-07-16', 3);
    const before = await listExams();
    const scoresBefore = before.map((e) => e.result?.adjusted.overallIndex);
    const text = serialiseBackup(buildBackup(before));

    renderSettings();
    await waitFor(() => expect(screen.getByLabelText(/backup file/i)).toBeInTheDocument());
    await user.upload(screen.getByLabelText(/backup file/i), fileFrom('b.json', text));
    await waitFor(() => expect(screen.getByText(/2 exams,/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /replace all exams/i }));

    await waitFor(async () => expect(await db.exams.count()).toBe(2));
    const after = await listExams();
    expect(after.map((e) => e.result?.adjusted.overallIndex)).toEqual(scoresBefore);
  });
});

describe('data integrity', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.close();
  });

  it('exports reproduce every displayed number from the stored inputs', async () => {
    await seed('2026-07-16', 3);
    const exams = await listExams();
    const exam = exams[0]!;

    const csv = examsCsv(exams);
    const headers = csv.trim().split('\n')[0]!.split(',');
    const values = csv.trim().split('\n')[1]!.split(',');
    const get = (name: string): number => Number(values[headers.indexOf(name)]!);

    expect(get('weighted_raw_score')).toBeCloseTo(exam.result!.raw.weightedRawScore, 2);
    expect(get('overall_personal_difficulty_index')).toBeCloseTo(
      exam.result!.adjusted.overallIndex,
      2,
    );
    for (const id of ['math', 'physics', 'chemistry'] as const) {
      expect(get(`${id}_tau`)).toBeCloseTo(exam.result!.adjusted.subjects[id].index, 2);
      expect(get(`${id}_expected_net_percent`)).toBeCloseTo(
        exam.result!.adjusted.subjects[id].expectedNetPercent,
        2,
      );
    }
  });

  it('question CSV round-trips through the parser back to the same answers', async () => {
    await seed('2026-07-16', 2);
    const exams = await listExams();
    const rows = questionsCsv(exams).trim().split('\n').slice(1);
    const wordToAnswer: Record<string, string> = { correct: 'correct', wrong: 'wrong', blank: 'blank' };
    const wordToDifficulty: Record<string, string> = { easy: 'easy', medium: 'medium', hard: 'hard' };

    const rebuilt: Record<number, Record<string, string>> = {};
    for (const row of rows) {
      const cells = row.split(',');
      const q = Number(cells[6]);
      rebuilt[q] = { answer: wordToAnswer[cells[7]!]!, difficulty: wordToDifficulty[cells[8]!]! };
    }
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
      expect(rebuilt[q]!.answer).toBe(exams[0]!.answers[q]!.answer);
      expect(rebuilt[q]!.difficulty).toBe(exams[0]!.answers[q]!.difficulty);
    }
  });
});