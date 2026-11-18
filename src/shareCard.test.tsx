import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { buildShareText, renderShareCard, ShareCard } from './components/ShareCard';
import { pointFor } from './lib/chartData';
import { completeExam, emptyAnswers, emptyExam } from './lib/db/examRepo';
import { db } from './lib/db/db';
import { TOTAL_QUESTION_COUNT } from './lib/scoring';
import type { Difficulty } from './lib/scoring';
import type { ExamRecord } from './lib/db/models';

async function seedCompleted(date: string, seed: number): Promise<ExamRecord> {
  const answers = emptyAnswers();
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    const band = (q * 13 + seed * 7) % 100;
    const difficulty: Difficulty = band < 30 ? 'easy' : band < 85 ? 'medium' : 'hard';
    const roll = (q * 37 + seed * 11) % 100;
    const answer = roll < 45 + seed * 3 ? 'correct' : roll < 70 ? 'wrong' : 'blank';
    answers[q] = { answer, difficulty };
  }
  const exam = emptyExam(date, 'Maz');
  exam.answers = answers;
  await db.exams.put(exam);
  return completeExam(exam.id);
}

describe('share card', () => {
  it('builds text with raw numbers, the index, and the estimation line', async () => {
    await db.delete();
    await db.open();
    const exam = await seedCompleted('2026-07-16', 3);
    const point = pointFor(exam, 'gregorian');
    const text = buildShareText(point, 'gregorian');
    expect(text).toContain('16 Jul 2026');
    expect(text).toContain('estimation');
    expect(text).toContain('not an official');
  });

  it('renders a non-blank canvas', async () => {
    await db.delete();
    await db.open();
    const exam = await seedCompleted('2026-07-16', 1);
    const point = pointFor(exam, 'gregorian');
    const canvas = document.createElement('canvas');
    renderShareCard(canvas, point, 'gregorian');
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it('shows a clipboard fallback when Web Share is unavailable', async () => {
    await db.delete();
    await db.open();
    const exam = await seedCompleted('2026-07-16', 2);
    const point = pointFor(exam, 'gregorian');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ShareCard exam={exam} point={point} mode="gregorian" />);
    fireEvent.click(screen.getByRole('button', { name: /share \/ copy summary/i }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]?.[0]).toContain('estimation');
  });
});
