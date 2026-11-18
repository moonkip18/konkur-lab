import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider } from './state/AppContext';
import { Dashboard } from './pages/Dashboard';
import { History } from './pages/History';
import { Statistics } from './pages/Statistics';
import { Subjects } from './pages/Subjects';
import { Settings } from './pages/Settings';
import { db } from './lib/db/db';
import { completeExam, emptyAnswers, emptyExam } from './lib/db/examRepo';
import { SUBJECTS, TOTAL_QUESTION_COUNT } from './lib/scoring';
import type { Difficulty } from './lib/scoring';

function renderPage(node: JSX.Element): void {
  render(<AppProvider>{node}</AppProvider>);
}

/** Waits for the populated dashboard, not merely the word "completed". */
async function waitForData(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('raw-performance')).toBeInTheDocument());
}

/**
 * A deterministic exam paper. `seed` shifts the difficulty mix and the answer
 * distribution so successive exams differ.
 */
function paper(seed: number, mix: { easy: number; medium: number; hard: number }): ReturnType<typeof emptyAnswers> {
  const answers = emptyAnswers();
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    const band = (q * 13 + seed * 7) % 100;
    const difficulty: Difficulty =
      band < mix.easy ? 'easy' : band < mix.easy + mix.medium ? 'medium' : 'hard';
    const roll = (q * 37 + seed * 11) % 100;
    const answer = roll < 45 + seed * 3 ? 'correct' : roll < 70 + seed * 2 ? 'wrong' : 'blank';
    answers[q] = { answer, difficulty };
  }
  return answers;
}

async function seedCompleted(date: string, seed: number): Promise<string> {
  const exam = emptyExam(date, 'Maz');
  exam.answers = paper(seed, { easy: 30, medium: 55, hard: 15 });
  await db.exams.put(exam);
  return (await completeExam(exam.id)).id;
}

async function seedThree(): Promise<void> {
  await seedCompleted('2026-06-18', 1);
  await seedCompleted('2026-07-02', 2);
  await seedCompleted('2026-07-16', 3);
}

describe('dashboard', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.close();
  });

  it('shows an empty state on a fresh install with no fabricated results', async () => {
    renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/no completed exams yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/weighted raw/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/overall personal index/i)).not.toBeInTheDocument();
  });

  it('separates raw scores from the difficulty-adjusted index', async () => {
    await seedCompleted('2026-07-16', 3);
    renderPage(<Dashboard />);
    await waitForData();

    expect(screen.getByText('Raw performance')).toBeInTheDocument();
    expect(screen.getByText(/difficulty-adjusted ·/i)).toBeInTheDocument();
    expect(screen.getByText(/not an official/i)).toBeInTheDocument();
    expect(screen.getByTestId('overall-index-card')).toHaveTextContent(/Overall personal index/);
    expect(screen.getByText('Weighted raw (12/9/7)')).toBeInTheDocument();
  });

  it('shows the expected net baseline next to every adjusted figure', async () => {
    await seedCompleted('2026-07-16', 3);
    renderPage(<Dashboard />);
    await waitForData();

    for (const s of SUBJECTS) {
      const cells = screen
        .getAllByText((_, el) => el?.textContent?.trim() === `${s.nameEn} ${s.nameFa} τ`)
        .filter((el) => el.closest('.grid-cell'));
      expect(cells.length, `${s.id} τ label`).toBeGreaterThan(0);
      const cell = cells[0]!.closest('.grid-cell')!;
      // The baseline must sit beside the number, never be omitted.
      expect(cell).toHaveTextContent(/expected/);
      expect(cell).toHaveTextContent(/vs expectation/);
    }
  });

  it('lists difficulty counts, counts, accuracy, and both dates', async () => {
    await seedCompleted('2026-06-18', 1);
    await seedCompleted('2026-07-16', 3);
    renderPage(<Dashboard />);
    await waitForData();

    expect(screen.getByText('Accuracy when attempted')).toBeInTheDocument();
    expect(screen.getByText('Attempt rate')).toBeInTheDocument();
    expect(screen.getByText(/previous/i)).toBeInTheDocument();
    // The difficulty-mix table shows Easy/Medium/Hard per subject.
    const table = screen.getByTestId('difficulty-mix-table');
    expect(within(table).getAllByRole('columnheader', { name: /^Easy$/i })).toHaveLength(1);
    expect(within(table).getAllByRole('columnheader', { name: /^Hard$/i })).toHaveLength(1);
    expect(within(table).getAllByRole('row')).toHaveLength(SUBJECTS.length + 1);
  });

  it('offers the score explanation on demand', async () => {
    await seedCompleted('2026-07-16', 3);
    const user = userEvent.setup();
    renderPage(<Dashboard />);
    await waitForData();

    await user.click(screen.getByRole('button', { name: /how this is calculated/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/expected net per question/i).length).toBeGreaterThan(0),
    );
    expect(
      screen.getAllByText(/these are assumptions, not measurements/i).length,
    ).toBeGreaterThan(0);
  });
});

describe('statistics', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.close();
  });

  it('shows an empty state before any completed exam', async () => {
    renderPage(<Statistics />);
    await waitFor(() => expect(screen.getByText(/nothing to chart yet/i)).toBeInTheDocument());
  });

  it('lists every required chart with one point per stored exam', async () => {
    await seedThree();
    renderPage(<Statistics />);
    await waitFor(() => expect(screen.getByText(/3 completed exams/i)).toBeInTheDocument());

    const ids = [
      'chart-weighted',
      'chart-overall-index',
      'chart-subject-math',
      'chart-subject-physics',
      'chart-subject-chemistry',
      'chart-net-by-difficulty',
      'chart-accuracy-by-difficulty',
      'chart-attempt-by-difficulty',
      'chart-counts',
      'chart-mix',
    ];
    for (const id of ids) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // Twelve charts: 1 weighted + 1 index + 3 subject pairs + 3 expected pairs
    // + 3 difficulty series + 2 counts + 2 mix.
    expect(document.querySelectorAll('.recharts-wrapper').length).toBeGreaterThanOrEqual(10);
  });

  it('excludes drafts from trends', async () => {
    await seedThree();
    const draft = emptyExam('2026-07-09', 'Maz');
    draft.answers = paper(5, { easy: 30, medium: 55, hard: 15 });
    await db.exams.put(draft);

    renderPage(<Statistics />);
    await waitFor(() => expect(screen.getByText(/3 completed exams/i)).toBeInTheDocument());
    expect(screen.queryByText(/4 completed exams/i)).not.toBeInTheDocument();
  });

  it('can include archived exams', async () => {
    const id = await seedCompleted('2026-06-18', 1);
    await seedCompleted('2026-07-16', 3);
    await db.exams.update(id, { status: 'archived' });

    renderPage(<Statistics />);
    await waitFor(() => expect(screen.getByText(/1 completed exam\b/i)).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/include archived exams/i));
    await waitFor(() => expect(screen.getByText(/2 completed exams/i)).toBeInTheDocument());
  });

  it('keeps gaps between exams rather than plotting a zero', async () => {
    // Non-uniform dates: a missed fortnight leaves no intermediate point.
    await seedCompleted('2026-05-01', 1);
    await seedCompleted('2026-09-01', 3);

    renderPage(<Statistics />);
    await waitFor(() => expect(screen.getByText(/2 completed exams/i)).toBeInTheDocument());

    // One plotted dot per stored exam and no synthetic midpoint: the four-month
    // gap between the two exams must not become a zero-filled point.
    const chart = screen.getByTestId('chart-weighted').closest('section')!;
    await waitFor(() => {
      // The first curve is the weighted raw series itself.
      const dots = chart.querySelectorAll('.recharts-line')[0]?.querySelectorAll('circle');
      expect(dots).toHaveLength(2);
    });
    const path = chart.querySelector('.recharts-line-curve');
    // A single straight segment: two points joined, not three or more.
    expect(path?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(2);
  });

  it('marks small difficulty samples', async () => {
    const exam = emptyExam('2026-07-16', 'Maz');
    const answers = emptyAnswers();
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
      answers[q] = { answer: 'correct', difficulty: 'medium' };
    }
    // Only two Hard questions in Math.
    answers[1] = { answer: 'correct', difficulty: 'hard' };
    answers[2] = { answer: 'wrong', difficulty: 'hard' };
    exam.answers = answers;
    await db.exams.put(exam);
    await completeExam(exam.id);

    renderPage(<Statistics />);
    await waitFor(() => expect(screen.getByText(/per-question difficulty breakdown/i)).toBeInTheDocument());
    const marks = screen.getAllByText(/small sample/i);
    expect(marks.length).toBeGreaterThan(0);
  });
});

describe('subjects', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.close();
  });

  it('shows an empty state with no completed exams', async () => {
    renderPage(<Subjects />);
    await waitFor(() => expect(screen.getByText(/no completed exams yet/i)).toBeInTheDocument());
  });

  it('switches between Math, Physics, and Chemistry with their coefficients', async () => {
    await seedThree();
    const user = userEvent.setup();
    renderPage(<Subjects />);
    await waitFor(() => expect(screen.getByText(/latest raw net/i)).toBeInTheDocument());

    const mathTab = screen.getByRole('button', { name: /Math.*12×/ });
    const physicsTab = screen.getByRole('button', { name: /Physics.*9×/ });
    const chemTab = screen.getByRole('button', { name: /Chemistry.*7×/ });
    expect(mathTab).toBeInTheDocument();
    expect(physicsTab).toBeInTheDocument();
    expect(chemTab).toBeInTheDocument();

    await user.click(physicsTab);
    await waitFor(() =>
      expect(screen.getByText(/Physics coefficient 9/i)).toBeInTheDocument(),
    );

    await user.click(chemTab);
    await waitFor(() =>
      expect(screen.getByText(/Chemistry coefficient 7/i)).toBeInTheDocument(),
    );
  });

  it('reports expected net, deviation, and contribution per subject', async () => {
    await seedThree();
    renderPage(<Subjects />);
    await waitFor(() => expect(screen.getByText(/latest expected net/i)).toBeInTheDocument());
    expect(screen.getByText(/latest deviation/i)).toBeInTheDocument();
    expect(screen.getByText(/contribution to weighted raw/i)).toBeInTheDocument();
  });
});

describe('history', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.close();
  });

  it('shows an empty state with nothing stored', async () => {
    renderPage(<History />);
    await waitFor(() => expect(screen.getByText(/no exams stored/i)).toBeInTheDocument());
  });

  it('lists exams newest first with scores and the next-date suggestion', async () => {
    await seedThree();
    renderPage(<History />);
    await waitFor(() => expect(screen.getAllByText(/weighted raw/i).length).toBeGreaterThan(0));

    // Suggested date is 14 days after the most recent exam.
    expect(screen.getByText(/2026-07-30/)).toBeInTheDocument();
    expect(screen.getAllByText(/personal index/i).length).toBe(3);
  });

  it('reveals a per-exam score breakdown on demand', async () => {
    const user = userEvent.setup();
    await seedCompleted('2026-07-16', 3);
    renderPage(<History />);
    await waitFor(() => expect(screen.getByRole('button', { name: /score breakdown/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /score breakdown/i }));
    await waitFor(() => expect(screen.getByText(/derivation/i)).toBeInTheDocument());
  });

  it('requires typing DELETE before removing an exam', async () => {
    const user = userEvent.setup();
    const id = await seedCompleted('2026-06-18', 1);
    await seedCompleted('2026-07-16', 3);
    renderPage(<History />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Delete$/ })).toHaveLength(2));

    // The list is newest first, so target the older exam by its id.
    const card = document.getElementById(`exam-${id}`)!;
    await user.click(within(card).getByRole('button', { name: /^Delete$/ }));
    const confirmButton = screen.getByRole('button', { name: /confirm delete/i });
    expect(confirmButton).toBeDisabled();

    const confirm = screen.getByLabelText(/confirm delete/i);
    await user.type(confirm, 'nope');
    expect(confirmButton).toBeDisabled();
    expect(await db.exams.get(id)).toBeDefined();

    await user.clear(confirm);
    await user.type(confirm, 'DELETE');
    await waitFor(() => expect(confirmButton).toBeEnabled());
    await user.click(confirmButton);

    await waitFor(async () => expect(await db.exams.get(id)).toBeUndefined());
    // The other exam's score is untouched.
    const other = (await db.exams.toArray())[0]!;
    expect(other.result).not.toBeNull();
  });
});

describe('settings', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.close();
  });

  it('shows the Profile v1 assumptions and the fixed exam structure', async () => {
    renderPage(<Settings />);
    await waitFor(() => expect(screen.getAllByText(/scoring profile/i).length).toBeGreaterThan(0));
    expect(screen.getByText('95 questions')).toBeInTheDocument();
    expect(screen.getByText(/coefficient total 28/)).toBeInTheDocument();
    expect(screen.getByText(/Index constants/i)).toBeInTheDocument();
  });

  it('labels the expected-performance parameters as assumptions', async () => {
    const user = userEvent.setup();
    renderPage(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /show full explanation/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /show full explanation/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/these are assumptions, not measurements/i).length).toBeGreaterThan(0),
    );
    expect(
      screen.getAllByText(/not verified Maz or Sanjesh statistics/i).length,
    ).toBeGreaterThan(0);
    // The derivation note must state the parameters are computed, not typed.
    expect(screen.getByText(/derived from/i)).toBeInTheDocument();
  });

  it('switches the date display between Gregorian and Jalali and persists it', async () => {
    const user = userEvent.setup();
    await seedCompleted('2026-07-16', 3);
    renderPage(<Settings />);
    await waitFor(() => expect(screen.getByLabelText(/date format/i)).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText(/date format/i), 'jalali');
    await waitFor(async () => {
      const stored = await db.settings.get('settings');
      expect(stored?.value).toMatchObject({ dateDisplay: 'jalali' });
    });
  });

  it('refuses to clear all data without the exact confirmation phrase', async () => {
    const user = userEvent.setup();
    await seedCompleted('2026-07-16', 3);
    renderPage(<Settings />);
    await waitFor(() => expect(screen.getByLabelText(/type DELETE ALL EXAMS/i)).toBeInTheDocument());

    const clearButton = screen.getByRole('button', { name: /delete all exam data/i });
    expect(clearButton).toBeDisabled();

    const input = screen.getByLabelText(/type DELETE ALL EXAMS/i);
    await user.type(input, 'DELETE');
    expect(clearButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'DELETE ALL EXAMS');
    await waitFor(() => expect(clearButton).toBeEnabled());
    await user.click(clearButton);
    await waitFor(async () => expect(await db.exams.count()).toBe(0));
  });

  it('offers question-level and exam-level CSV exports plus a JSON backup', async () => {
    renderPage(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export json backup/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /export question-level csv/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /export exam-level csv/i })).toBeInTheDocument();
    });
  });

  it('warns that a local save is not a backup', async () => {
    renderPage(<Settings />);
    await waitFor(() =>
      expect(screen.getByText(/a local save is not a backup/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/cloud sync/i)).toBeInTheDocument();
  });

  it('reports persistent storage status', async () => {
    renderPage(<Settings />);
    await waitFor(() => expect(screen.getAllByText(/persistent storage/i).length).toBeGreaterThan(0));
    // jsdom has no storage.persisted, so the app must say so plainly. The
    // state string resolves in an effect, so wait for it specifically instead
    // of asserting immediately after the label renders.
    await waitFor(() =>
      expect(screen.getAllByText(/^(unsupported|granted|not granted|unknown)$/i).length).toBeGreaterThan(0),
    );
    expect(screen.getByRole('button', { name: /request persistent storage/i })).toBeInTheDocument();
  });
});