import { describe, expect, it } from 'vitest';
import {
  coverageOf,
  difficultySlice,
  rollingAverage,
  SMALL_SAMPLE_THRESHOLD,
  allDifficultySlices,
  mean,
} from './stats';
import { suggestNextExamDate } from '../examCadence';
import {
  formatAxisNumber,
  formatCount,
  formatDelta,
  formatIndex,
  formatPercent,
  formatPoints,
  round,
} from './format';
import { TOTAL_QUESTION_COUNT, type AnswerMap, type Difficulty } from './index';

function answersWith(
  plan: Record<number, { answer?: 'correct' | 'wrong' | 'blank'; difficulty?: Difficulty }>,
): AnswerMap {
  const map: AnswerMap = {};
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) map[q] = plan[q] ?? {};
  return map;
}

describe('per-question difficulty statistics', () => {
  it('reports counts and percentages for one subject x difficulty cell', () => {
    const map = answersWith({
      1: { answer: 'correct', difficulty: 'easy' },
      2: { answer: 'wrong', difficulty: 'easy' },
      3: { answer: 'blank', difficulty: 'easy' },
      4: { answer: 'correct', difficulty: 'hard' },
      // Physics easy, to prove the slice is subject-scoped.
      41: { answer: 'correct', difficulty: 'easy' },
    });

    const slice = difficultySlice(map, 'math', 'easy');
    expect(slice.questionCount).toBe(3);
    expect(slice.correct).toBe(1);
    expect(slice.wrong).toBe(1);
    expect(slice.blank).toBe(1);
    expect(slice.netPercent).toBeCloseTo((100 * (1 - 1 / 3)) / 3, 10);
    expect(slice.attemptRatePercent).toBeCloseTo((100 * 2) / 3, 10);
    expect(slice.accuracyPercent).toBeCloseTo(50, 10);
    expect(slice.smallSample).toBe(true);
  });

  it('never mixes subjects into one cell', () => {
    const map = answersWith({});
    for (let q = 41; q <= 65; q += 1) map[q] = { answer: 'correct', difficulty: 'medium' };
    const physics = difficultySlice(map, 'physics', 'medium');
    expect(physics.questionCount).toBe(25);
    expect(difficultySlice(map, 'math', 'medium').questionCount).toBe(0);
  });

  it('returns nulls rather than dividing by zero for an empty cell', () => {
    const slice = difficultySlice(answersWith({}), 'chemistry', 'easy');
    expect(slice.questionCount).toBe(0);
    expect(slice.netPercent).toBeNull();
    expect(slice.accuracyPercent).toBeNull();
    expect(slice.attemptRatePercent).toBeNull();
    expect(slice.smallSample).toBe(false); // zero is "no data", not "small sample"
  });

  it('flags small samples but not a full band', () => {
    const map = answersWith({});
    for (let q = 1; q <= 5; q += 1) map[q] = { answer: 'correct', difficulty: 'hard' };
    expect(difficultySlice(map, 'math', 'hard').questionCount).toBe(5);
    expect(difficultySlice(map, 'math', 'hard').smallSample).toBe(false);
    for (let q = 6; q <= 9; q += 1) map[q] = { answer: 'correct', difficulty: 'hard' };
    expect(difficultySlice(map, 'math', 'hard').questionCount).toBe(9);
    expect(SMALL_SAMPLE_THRESHOLD).toBe(5);

    // Shrink to four and it must be flagged.
    const small = answersWith({
      1: { answer: 'correct', difficulty: 'hard' },
      2: { answer: 'correct', difficulty: 'hard' },
      3: { answer: 'correct', difficulty: 'hard' },
      4: { answer: 'correct', difficulty: 'hard' },
    });
    expect(difficultySlice(small, 'math', 'hard').questionCount).toBe(4);
    expect(difficultySlice(small, 'math', 'hard').smallSample).toBe(true);
  });

  it('produces nine cells across three subjects and three bands', () => {
    const slices = allDifficultySlices(answersWith({}));
    expect(slices).toHaveLength(9);
    expect(new Set(slices.map((s) => s.subjectId)).size).toBe(3);
  });
});

describe('coverage', () => {
  it('counts answers and labels separately', () => {
    const map = answersWith({
      1: { answer: 'correct' },
      2: { difficulty: 'easy' },
      3: { answer: 'wrong', difficulty: 'hard' },
    });
    const coverage = coverageOf(map);
    expect(coverage.answered).toBe(2);
    expect(coverage.labeled).toBe(2);
    expect(coverage.answerCoverage).toBeCloseTo(2 / 95, 10);
    expect(coverage.difficultyCoverage).toBeCloseTo(2 / 95, 10);
    expect(coverage.complete).toBe(false);
  });

  it('reports a blank answer as answered', () => {
    const map = answersWith({ 1: { answer: 'blank' } });
    expect(coverageOf(map).answered).toBe(1);
  });

  it('reports a complete exam', () => {
    const map = answersWith({});
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) map[q] = { answer: 'correct', difficulty: 'easy' };
    const coverage = coverageOf(map);
    expect(coverage.complete).toBe(true);
    expect(coverage.answerCoverage).toBe(1);
  });
});

describe('rolling average', () => {
  it('labels each point with how many exams contributed', () => {
    const out = rollingAverage([10, 20, 30, 40], 3);
    expect(out[0]).toEqual({ value: 10, windowSize: 1 });
    expect(out[1]).toEqual({ value: 15, windowSize: 2 });
    expect(out[2]).toEqual({ value: 20, windowSize: 3 });
    expect(out[3]).toEqual({ value: 30, windowSize: 3 });
  });

  it('skips gaps instead of treating them as zero', () => {
    const out = rollingAverage([10, null, 30], 3);
    expect(out[2]?.value).toBeCloseTo(20, 10);
    expect(out[2]?.windowSize).toBe(2);
  });

  it('returns null when nothing is available', () => {
    expect(rollingAverage([null, null], 3)[1]).toEqual({ value: null, windowSize: 0 });
    expect(mean([])).toBeNull();
    expect(mean([1, null, 3])).toBe(2);
  });
});

describe('next exam suggestion', () => {
  it('suggests 14 days after the most recent exam', () => {
    expect(suggestNextExamDate(['2026-06-30', '2026-07-16'])).toBe('2026-07-30');
    expect(suggestNextExamDate(['2026-07-16', '2026-06-30'])).toBe('2026-07-30');
  });

  it('returns null with no history instead of inventing a date', () => {
    expect(suggestNextExamDate([])).toBeNull();
  });

  it('honours a changed interval', () => {
    expect(suggestNextExamDate(['2026-07-16'], 7)).toBe('2026-07-23');
    expect(suggestNextExamDate(['2026-07-16'], 30)).toBe('2026-08-15');
  });

  it('crosses month and year boundaries', () => {
    expect(suggestNextExamDate(['2026-12-25'])).toBe('2027-01-08');
  });
});

describe('display formatting', () => {
  it('rounds percentages to two decimals', () => {
    expect(formatPercent(59.6491228)).toBe('59.65%');
    expect(formatPercent(100)).toBe('100.00%');
    expect(formatPercent(-33.3333)).toBe('-33.33%');
  });

  it('shows N/A instead of NaN or Infinity', () => {
    expect(formatPercent(Number.NaN)).toBe('N/A');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('N/A');
    expect(formatPercent(null)).toBe('N/A');
    expect(formatIndex(Number.NaN)).toBe('N/A');
    expect(formatPoints(undefined)).toBe('N/A');
  });

  it('signs deviation points explicitly', () => {
    expect(formatPoints(12.5)).toBe('+12.50 pp');
    expect(formatPoints(-12.5)).toBe('-12.50 pp');
    expect(formatPoints(0)).toBe('0.00 pp');
  });

  it('rounds index values to whole numbers', () => {
    expect(formatIndex(7414.18)).toBe('7,414');
    expect(formatIndex(4999.6)).toBe('5,000');
    expect(formatIndex(-1200.4)).toBe('-1,200');
  });

  it('compacts axis labels', () => {
    expect(formatAxisNumber(5400)).toBe('5.4k');
    expect(formatAxisNumber(5000)).toBe('5k');
    expect(formatAxisNumber(750)).toBe('750');
    expect(formatAxisNumber(12.5)).toBe('12.5');
  });

  it('shows an em dash for a missing comparison', () => {
    expect(formatDelta(50, 40)).toBe('+10');
    expect(formatDelta(30, 40)).toBe('−10');
    expect(formatDelta(40, null)).toBe('—');
  });

  it('exposes raw counts and a plain round helper', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('N/A');
    expect(round(1.005)).toBe(1.01);
    expect(round(Number.NaN)).toBeNaN();
  });
});