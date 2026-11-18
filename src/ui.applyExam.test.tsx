import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider } from './state/AppContext';
import { ApplyExam } from './pages/ApplyExam';
import { db } from './lib/db/db';
import { emptyAnswers, emptyExam } from './lib/db/examRepo';
import { SUBJECTS, TOTAL_QUESTION_COUNT } from './lib/scoring';
import type { ExamRecord } from './lib/db/models';

function renderApply(): void {
  render(
    <AppProvider>
      <ApplyExam />
    </AppProvider>,
  );
}

async function waitReady(): Promise<void> {
  await waitFor(() => expect(screen.getByLabelText(/select exam/i)).toBeInTheDocument());
}

async function createDraft(): Promise<string> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /create first draft/i }));
  await waitFor(async () => {
    expect(await db.exams.count()).toBe(1);
  });
  const row = (await db.exams.toArray())[0]!;
  return row.id;
}

describe('answer-key entry interface', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.close();
  });

  it('starts with an empty state and no exam created for the user', async () => {
    renderApply();
    await waitReady();
    expect(screen.getByText(/no exam selected/i)).toBeInTheDocument();
    expect(await db.exams.count()).toBe(0);
  });

  it('renders all 95 questions in three labelled sections with correct ranges', async () => {
    renderApply();
    await waitReady();
    await createDraft();

    await waitFor(() => {
      expect(screen.getByTestId('range-math')).toHaveTextContent('Questions 1–40');
      expect(screen.getByTestId('range-physics')).toHaveTextContent('Questions 41–65');
      expect(screen.getByTestId('range-chemistry')).toHaveTextContent('Questions 66–95');
    });

    // Every question number appears exactly once, numbered 1 through 95.
    const groups = screen.getAllByRole('group', { name: /answer$/i });
    expect(groups).toHaveLength(TOTAL_QUESTION_COUNT);
    const numbers = groups.map((g) => {
      const match = /Question (\d+) answer/.exec(g.getAttribute('aria-label') ?? '');
      return Number(match?.[1]);
    });
    expect(numbers).toEqual(Array.from({ length: 95 }, (_, i) => i + 1));

    // Section boundaries: question 40 is Math, 41 is Physics, 95 is Chemistry.
    const mathGroup = screen.getByRole('group', { name: 'Question 40 answer' });
    const physicsGroup = screen.getByRole('group', { name: 'Question 41 answer' });
    const chemGroup = screen.getByRole('group', { name: 'Question 95 answer' });
    expect(mathGroup).toBeInTheDocument();
    expect(physicsGroup).toBeInTheDocument();
    expect(chemGroup).toBeInTheDocument();
  });

  it('offers exactly three mutually exclusive answer and difficulty choices per question', async () => {
    renderApply();
    await waitReady();
    await createDraft();

    const answerGroup = screen.getByRole('group', { name: 'Question 5 answer' });
    const answerButtons = within(answerGroup).getAllByRole('button');
    expect(answerButtons.map((b) => b.textContent?.replace(/[^\x20-\x7E]/g, '').trim())).toEqual([
      'Correct',
      'Blank',
      'Wrong',
    ]);

    const diffGroup = screen.getByRole('group', { name: 'Question 5 difficulty' });
    const diffButtons = within(diffGroup).getAllByRole('button');
    expect(diffButtons).toHaveLength(3);
    expect(diffButtons[0]?.textContent).toContain('Easy');
    expect(diffButtons[1]?.textContent).toContain('Medium');
    expect(diffButtons[2]?.textContent).toContain('Hard');
  });

  it('preselects nothing', async () => {
    renderApply();
    await waitReady();
    await createDraft();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Question 1 answer' })).toBeInTheDocument());

    const groups = [
      ...screen.getAllByRole('group', { name: /answer$/i }),
      ...screen.getAllByRole('group', { name: /difficulty$/i }),
    ];
    expect(groups.length).toBe(95 * 2);
    for (const g of groups) {
      for (const button of within(g).getAllByRole('button')) {
        expect(button).toHaveAttribute('aria-pressed', 'false');
      }
    }
  });

  it('keeps answer and difficulty selections independent', async () => {
    const user = userEvent.setup();
    renderApply();
    await waitReady();
    await createDraft();

    const answerGroup = await screen.findByRole('group', { name: 'Question 12 answer' });
    await user.click(within(answerGroup).getByRole('button', { name: /Correct/ }));

    const diffGroup = screen.getByRole('group', { name: 'Question 12 difficulty' });
    for (const b of within(diffGroup).getAllByRole('button')) {
      expect(b).toHaveAttribute('aria-pressed', 'false');
    }

    await user.click(within(diffGroup).getByRole('button', { name: /Hard/ }));
    // Selecting difficulty did not disturb the answer.
    expect(within(answerGroup).getByRole('button', { name: /Correct/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Now change only the answer; difficulty stays put.
    await user.click(within(answerGroup).getByRole('button', { name: /Wrong/ }));
    expect(within(diffGroup).getByRole('button', { name: /Hard/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(answerGroup).getByRole('button', { name: /Wrong/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(answerGroup).getByRole('button', { name: /Correct/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await waitFor(async () => {
      const stored = (await db.exams.toArray())[0]!;
      expect(stored.answers[12]).toEqual({ answer: 'wrong', difficulty: 'hard' });
    });
  });

  it('persists selections to IndexedDB so they survive a reload', async () => {
    const user = userEvent.setup();
    renderApply();
    await waitReady();
    const id = await createDraft();

    const group = await screen.findByRole('group', { name: 'Question 30 answer' });
    await user.click(within(group).getByRole('button', { name: /Blank/ }));
    const diff = screen.getByRole('group', { name: 'Question 30 difficulty' });
    await user.click(within(diff).getByRole('button', { name: /Medium/ }));

    await waitFor(async () => {
      const stored = await db.exams.get(id);
      expect(stored?.answers[30]).toEqual({ answer: 'blank', difficulty: 'medium' });
    });

    // Simulate a page refresh: unmount, close and reopen the DB, re-render.
    cleanup();
    await db.close();
    await db.open();
    renderApply();
    await waitReady();

    const reread = await screen.findByRole('group', { name: 'Question 30 answer' });
    expect(within(reread).getByRole('button', { name: /Blank/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const rereadDiff = screen.getByRole('group', { name: 'Question 30 difficulty' });
    expect(within(rereadDiff).getByRole('button', { name: /Medium/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('supports undo and redo', async () => {
    const user = userEvent.setup();
    renderApply();
    await waitReady();
    const id = await createDraft();

    const group = await screen.findByRole('group', { name: 'Question 8 answer' });
    await user.click(within(group).getByRole('button', { name: /Correct/ }));
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: /Correct/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );

    await user.click(screen.getByRole('button', { name: /^Undo$/i }));
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: /Correct/ })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );

    await user.click(screen.getByRole('button', { name: /^Redo$/i }));
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: /Correct/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );

    await waitFor(async () => {
      expect((await db.exams.get(id))?.answers[8]?.answer).toBe('correct');
    });
  });

  it('reports live subject counts as selections change', async () => {
    const user = userEvent.setup();
    renderApply();
    await waitReady();
    await createDraft();

    const mathSection = (await screen.findByTestId('range-math')).closest('section')!;
    expect(within(mathSection).getByText(/C0 W0 B0 —40/)).toBeInTheDocument();

    const g1 = within(mathSection).getByRole('group', { name: 'Question 1 answer' });
    await user.click(within(g1).getByRole('button', { name: /Correct/ }));
    const g2 = within(mathSection).getByRole('group', { name: 'Question 2 answer' });
    await user.click(within(g2).getByRole('button', { name: /Wrong/ }));
    const g3 = within(mathSection).getByRole('group', { name: 'Question 3 answer' });
    await user.click(within(g3).getByRole('button', { name: /Blank/ }));

    await waitFor(() => {
      expect(within(mathSection).getByText(/C1 W1 B1 —37/)).toBeInTheDocument();
    });
  });

  it('shows coverage and blocks completion until all answers and labels exist', async () => {
    const user = userEvent.setup();
    renderApply();
    await waitReady();
    await createDraft();

    const complete = screen.getByRole('button', { name: /complete exam/i });
    expect(complete).toBeDisabled();

    const g1 = await screen.findByRole('group', { name: 'Question 1 answer' });
    await user.click(within(g1).getByRole('button', { name: /Correct/ }));
    await waitFor(() => expect(screen.getAllByText('1/95').length).toBe(1));
    expect(screen.getByRole('button', { name: /complete exam/i })).toBeDisabled();

    await waitFor(() => expect(screen.getByText(/all 95 answers/i)).toBeInTheDocument());
  });

  it('completes an exam once every answer and label is present, and stores a score', async () => {
    const user = userEvent.setup();
    // Seed a fully filled draft up front so the editor starts complete.
    const answers = emptyAnswers();
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
      answers[q] = { answer: q <= 60 ? 'correct' : q <= 70 ? 'wrong' : 'blank', difficulty: 'medium' };
    }
    const exam = emptyExam('2026-07-16', 'Maz');
    exam.answers = answers;
    await db.exams.put(exam);

    renderApply();
    await waitReady();

    await waitFor(() => expect(screen.getAllByText('95/95').length).toBe(2));
    const complete = screen.getByRole('button', { name: /complete exam/i });
    await waitFor(() => expect(complete).toBeEnabled());
    await user.click(complete);

    await waitFor(async () => {
      const stored = await db.exams.get(exam.id);
      expect(stored?.status).toBe('completed');
      expect(stored?.result?.raw.correct).toBe(60);
      expect(stored?.result?.profileVersion).toBe('v1');
    });
    expect(await screen.findByText(/exam completed/i)).toBeInTheDocument();
  });

  it('locks a completed exam until it is explicitly reopened', async () => {
    const user = userEvent.setup();
    const exam: ExamRecord = emptyExam('2026-07-16', 'Maz');
    exam.status = 'completed';
    exam.completedAt = new Date().toISOString();
    await db.exams.put(exam);

    renderApply();
    await waitReady();
    // The live query resolves asynchronously, so wait for the option to exist.
    // No draft is present, so the exam is picked explicitly from the selector.
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /2026-07-16/ })).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText(/select exam/i), exam.id);
    await waitFor(() =>
      expect(screen.getByTestId('readonly-note')).toHaveTextContent(/completed/),
    );

    const group = screen.getByRole('group', { name: 'Question 1 answer' });
    for (const b of within(group).getAllByRole('button')) {
      expect(b).toBeDisabled();
    }

    await user.click(screen.getByRole('button', { name: /reopen for editing/i }));
    await waitFor(async () => {
      expect((await db.exams.get(exam.id))?.status).toBe('draft');
      expect((await db.exams.get(exam.id))?.revision).toBe(1);
    });
  });

  it('filters the question list by subject and by answer status', async () => {
    const user = userEvent.setup();
    renderApply();
    await waitReady();
    await createDraft();

    const g = await screen.findByRole('group', { name: 'Question 66 answer' });
    await user.click(within(g).getByRole('button', { name: /Wrong/ }));

    await user.selectOptions(screen.getByLabelText(/filter by subject/i), 'chemistry');
    await waitFor(() => {
      expect(screen.getAllByRole('group', { name: /answer$/i })).toHaveLength(30);
    });

    await user.selectOptions(screen.getByLabelText(/filter by answer/i), 'wrong');
    await waitFor(() => {
      expect(screen.getAllByRole('group', { name: /answer$/i })).toHaveLength(1);
    });

    await user.selectOptions(screen.getByLabelText(/filter by answer/i), 'correct');
    await waitFor(() => {
      expect(screen.queryAllByRole('group', { name: /answer$/i })).toHaveLength(0);
      expect(screen.getByText(/no questions match/i)).toBeInTheDocument();
    });
  });

  it('distinguishes unset from blank in the coverage display', async () => {
    const user = userEvent.setup();
    renderApply();
    await waitReady();
    await createDraft();

    expect(await screen.findAllByText('0/95')).toHaveLength(2);
    const g = await screen.findByRole('group', { name: 'Question 2 answer' });
    await user.click(within(g).getByRole('button', { name: /Blank/ }));
    await waitFor(() => expect(screen.getAllByText('1/95').length).toBe(1));
    // The label counter is still 0: a blank answer is not a difficulty label.
    expect(screen.getAllByText('0/95').length).toBe(1);
  });

  it('jumps to a question number', async () => {
    const user = userEvent.setup();
    renderApply();
    await waitReady();
    await createDraft();

    await screen.findByRole('group', { name: 'Question 1 answer' });
    await user.type(screen.getByLabelText(/jump to question/i), '66');
    await user.click(screen.getByRole('button', { name: /^Jump$/i }));

    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Question 66 answer' })).toBeInTheDocument(),
    );
  });

  it('shows the adjusted score only after all difficulty labels exist', async () => {
    const user = userEvent.setup();
    renderApply();
    await waitReady();
    await createDraft();

    const mathSection = (await screen.findByTestId('range-math')).closest('section')!;
    const g1 = within(mathSection).getByRole('group', { name: 'Question 1 answer' });
    await user.click(within(g1).getByRole('button', { name: /Correct/ }));
    const d1 = within(mathSection).getByRole('group', { name: 'Question 1 difficulty' });
    await user.click(within(d1).getByRole('button', { name: /Easy/ }));

    await waitFor(() =>
      expect(screen.getAllByText(/adjusted index needs all 95 labels/i).length).toBeGreaterThan(0),
    );
  });

  it('renders every subject header with its Persian name and coefficient', async () => {
    renderApply();
    await waitReady();
    await createDraft();

    for (const s of SUBJECTS) {
      expect(await screen.findByText(new RegExp(`coefficient\\s*${s.coefficient}`))).toBeInTheDocument();
    }
    expect(screen.getAllByText('ریاضی').length).toBeGreaterThan(0);
    expect(screen.getAllByText('فیزیک').length).toBeGreaterThan(0);
    expect(screen.getAllByText('شیمی').length).toBeGreaterThan(0);
  });

  it('persists pasted answers so they survive a reload', async () => {
    const user = userEvent.setup();
    renderApply();
    await waitReady();
    const id = await createDraft();

    await screen.findByRole('group', { name: 'Question 1 answer' });
    await user.click(screen.getByRole('button', { name: /paste entry/i }));

    const box = screen.getByLabelText(/paste answer key text/i);
    await user.type(box, '1 correct easy\n2 wrong hard');

    // The preview reports the merged diff; applying it is what must persist.
    // The paste path used to update history without scheduling the save, so
    // the rows never reached IndexedDB.
    await user.click(screen.getByRole('button', { name: /apply 4 changes/i }));

    await waitFor(async () => {
      const stored = await db.exams.get(id);
      expect(stored?.answers[1]).toEqual({ answer: 'correct', difficulty: 'easy' });
      expect(stored?.answers[2]).toEqual({ answer: 'wrong', difficulty: 'hard' });
    });
  });
});