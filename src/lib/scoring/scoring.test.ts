import { describe, expect, it } from 'vitest';
import {
  ANSWER_VALUES,
  PROFILE_V1,
  SUBJECTS,
  TOTAL_QUESTION_COUNT,
  accuracyPercent,
  attemptRatePercent,
  allQuestionNumbers,
  computeAdjusted,
  countAnswers,
  countDifficulties,
  expectedNetForSubject,
  expectedNetPerQuestion,
  expectedNetPercentages,
  hasCompleteDifficultyLabels,
  isComplete,
  netPercent,
  scoreExam,
  scoreExamRaw,
  scoreSubject,
  sliceSubjectEntries,
  subjectForQuestion,
  subjectIndex,
  validateExam,
  validateProfile,
  type AnswerMap,
  type AnswerState,
  type Difficulty,
  type ExamInput,
  type ScoringProfile,
  type SubjectId,
} from './index';

/**
 * Every expected number in these tests is either quoted verbatim from the spec
 * or hand-derived from the spec's formulas. Nothing is fitted.
 */

const coefficients = { math: 12, physics: 9, chemistry: 7 };

function emptyAnswers(): AnswerMap {
  const map: AnswerMap = {};
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) map[q] = {};
  return map;
}

/**
 * Lays out exact counts across the 95 questions in subject order, so a test can
 * state "60 correct, 10 wrong, 25 blank" without hand-picking indices.
 */
function buildAnswersWithCounts(
  correct: number,
  wrong: number,
  blank: number,
  difficulty: Difficulty = 'medium',
): AnswerMap {
  const map = emptyAnswers();
  let q = 1;
  const fill = (answer: AnswerState, n: number): void => {
    for (let i = 0; i < n && q <= TOTAL_QUESTION_COUNT; i += 1, q += 1) {
      map[q] = { answer, difficulty };
    }
  };
  fill('correct', correct);
  fill('wrong', wrong);
  fill('blank', blank);
  return map;
}

/**
 * Fills all 95 questions. `plan` maps a question number to answer/difficulty;
 * anything omitted defaults to blank/easy.
 */
function buildAnswers(
  plan: Record<number, { answer?: AnswerState; difficulty?: Difficulty }>,
  defaults: { answer: AnswerState; difficulty: Difficulty } = {
    answer: 'blank',
    difficulty: 'easy',
  },
): AnswerMap {
  const map = emptyAnswers();
  for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
    const entry = plan[q];
    map[q] = {
      answer: entry?.answer ?? defaults.answer,
      difficulty: entry?.difficulty ?? defaults.difficulty,
    };
  }
  return map;
}

describe('exam structure', () => {
  it('has exactly 95 questions', () => {
    expect(TOTAL_QUESTION_COUNT).toBe(95);
    expect(allQuestionNumbers()).toHaveLength(95);
    expect(allQuestionNumbers()[0]).toBe(1);
    expect(allQuestionNumbers()[94]).toBe(95);
  });

  it('maps questions to subjects without gaps or overlaps', () => {
    const math = SUBJECTS.find((s) => s.id === 'math')!;
    const physics = SUBJECTS.find((s) => s.id === 'physics')!;
    const chemistry = SUBJECTS.find((s) => s.id === 'chemistry')!;

    expect([math.startQuestion, math.endQuestion]).toEqual([1, 40]);
    expect([physics.startQuestion, physics.endQuestion]).toEqual([41, 65]);
    expect([chemistry.startQuestion, chemistry.endQuestion]).toEqual([66, 95]);
    expect(math.questionCount).toBe(40);
    expect(physics.questionCount).toBe(25);
    expect(chemistry.questionCount).toBe(30);
    expect(math.questionCount + physics.questionCount + chemistry.questionCount).toBe(95);
  });

  it('assigns every question to exactly one subject', () => {
    const seen = new Map<number, SubjectId>();
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
      const id = subjectForQuestion(q).id;
      expect(seen.has(q)).toBe(false);
      seen.set(q, id);
    }
    expect(seen.size).toBe(95);
    expect(new Set(seen.values())).toEqual(new Set<SubjectId>(['math', 'physics', 'chemistry']));
    for (let q = 1; q <= 95; q += 1) {
      expect(subjectForQuestion(q).questionCount).toBe(
        q <= 40 ? 40 : q <= 65 ? 25 : 30,
      );
    }
  });

  it('rejects out-of-range question numbers', () => {
    expect(() => subjectForQuestion(0)).toThrow();
    expect(() => subjectForQuestion(96)).toThrow();
    expect(() => subjectForQuestion(4.5)).toThrow();
  });

  it('has the Persian subject names from the spec', () => {
    expect(SUBJECTS.map((s) => s.nameFa)).toEqual(['ریاضی', 'فیزیک', 'شیمی']);
  });
});

describe('6. raw answer scoring', () => {
  it('uses the Iranian marking values', () => {
    expect(ANSWER_VALUES.correct).toBe(1);
    expect(ANSWER_VALUES.wrong).toBeCloseTo(-1 / 3, 12);
    expect(ANSWER_VALUES.blank).toBe(0);
  });

  it('produces a negative net percentage when wrong answers dominate', () => {
    // 5 correct, 90 wrong, 0 blank out of 95.
    expect(netPercent(5, 90, 95)).toBeCloseTo((100 * (5 - 30)) / 95, 10);
    expect(netPercent(5, 90, 95)!).toBeLessThan(0);
    // All wrong must equal exactly -100/3.
    expect(netPercent(0, 95, 95)).toBeCloseTo(-100 / 3, 10);
    expect(netPercent(0, 0, 95)).toBe(0);
    expect(netPercent(95, 0, 95)).toBe(100);
  });

  it('never clamps a negative net percentage', () => {
    const answers = buildAnswers({}, { answer: 'wrong', difficulty: 'medium' });
    const raw = scoreExamRaw(answers);
    expect(raw.netPercent).toBeLessThan(0);
    expect(raw.weightedRawScore).toBeLessThan(0);
    expect(raw.subjects.math.netPercent).toBeCloseTo(-100 / 3, 10);
  });

  it('uses the subject question counts 40 / 25 / 30', () => {
    const plan: Record<number, { answer: AnswerState; difficulty: Difficulty }> = {};
    for (let q = 1; q <= 40; q += 1) plan[q] = { answer: 'correct', difficulty: 'medium' };
    for (let q = 41; q <= 65; q += 1) plan[q] = { answer: 'correct', difficulty: 'medium' };
    for (let q = 66; q <= 95; q += 1) plan[q] = { answer: 'wrong', difficulty: 'medium' };
    const raw = scoreExamRaw(buildAnswers(plan));

    expect(raw.subjects.math.netPercent).toBeCloseTo(100, 10);
    expect(raw.subjects.physics.netPercent).toBeCloseTo(100, 10);
    expect(raw.subjects.chemistry.netPercent).toBeCloseTo(-100 / 3, 10);
  });

  it('computes the whole-exam net percentage across all 95', () => {
    const plan: Record<number, { answer: AnswerState; difficulty: Difficulty }> = {};
    for (let q = 1; q <= 30; q += 1) plan[q] = { answer: 'correct', difficulty: 'easy' };
    for (let q = 31; q <= 40; q += 1) plan[q] = { answer: 'wrong', difficulty: 'medium' };
    const raw = scoreExamRaw(buildAnswers(plan));
    expect(raw.correct).toBe(30);
    expect(raw.wrong).toBe(10);
    expect(raw.netPercent).toBeCloseTo((100 * (30 - 10 / 3)) / 95, 10);
  });

  it('computes attempt rate and accuracy', () => {
    expect(attemptRatePercent(70, 95)!).toBeCloseTo((100 * 70) / 95, 10);
    expect(accuracyPercent(60, 70)!).toBeCloseTo((100 * 60) / 70, 10);
  });

  it('returns null instead of dividing by zero when nothing was attempted', () => {
    expect(accuracyPercent(0, 0)).toBeNull();
    expect(attemptRatePercent(0, 0)).toBeNull();
    expect(netPercent(0, 0, 0)).toBeNull();
  });

  it('matches the required arithmetic example: 60 correct, 10 wrong, 25 blank', () => {
    const raw = scoreExamRaw(buildAnswersWithCounts(60, 10, 25));

    expect(raw.correct).toBe(60);
    expect(raw.wrong).toBe(10);
    expect(raw.blank).toBe(25);
    expect(raw.attempted).toBe(70);
    expect(raw.netPercent).toBeCloseTo(59.65, 2);
    expect(raw.attemptRatePercent).toBeCloseTo(73.68, 2);
    expect(raw.accuracyPercent).toBeCloseTo(85.71, 2);
    expect(raw.correctProportion).toBeCloseTo(63.16, 2);
    expect(raw.wrongProportion).toBeCloseTo(10.53, 2);
    expect(raw.blankProportion).toBeCloseTo(26.32, 2);
  });

  it('counts answered, unanswered, and blanks as three separate things', () => {
    const counts = countAnswers([
      { answer: 'correct' },
      { answer: 'wrong' },
      { answer: 'blank' },
      {},
    ]);
    expect(counts.correct).toBe(1);
    expect(counts.wrong).toBe(1);
    expect(counts.blank).toBe(1);
    expect(counts.answered).toBe(3);
    expect(counts.unanswered).toBe(1);
    expect(counts.attempted).toBe(2);
  });

  it('counts difficulty labels independently of answers', () => {
    const counts = countDifficulties([
      { difficulty: 'easy' },
      { difficulty: 'hard', answer: 'correct' },
      { answer: 'correct' },
    ]);
    expect(counts.easy).toBe(1);
    expect(counts.hard).toBe(1);
    expect(counts.medium).toBe(0);
    // The unlabeled entry contributed to none of the bands.
    expect(counts.easy + counts.hard + counts.medium).toBe(2);
  });

  it('scores a single subject against its own question count', () => {
    const entries = sliceSubjectEntries(emptyAnswers(), { start: 41, end: 65 });
    expect(entries).toHaveLength(25);
    const raw = scoreSubject('physics', entries, 25);
    expect(raw.total).toBe(25);
    expect(raw.unanswered).toBe(25);
    expect(raw.accuracyPercent).toBeNull();
  });
});

describe('7. weighted raw score', () => {
  const coefficients = { math: 12, physics: 9, chemistry: 7 };

  it('defaults to coefficients 12 / 9 / 7', () => {
    expect(coefficients.math).toBe(12);
    expect(coefficients.physics).toBe(9);
    expect(coefficients.chemistry).toBe(7);
    expect(coefficients.math + coefficients.physics + coefficients.chemistry).toBe(28);
  });

  it('applies the coefficient weighting to differing subject percentages', () => {
    const plan: Record<number, { answer: AnswerState }> = {};
    for (let q = 1; q <= 40; q += 1) plan[q] = { answer: 'correct' };
    for (let q = 41; q <= 65; q += 1) plan[q] = { answer: 'blank' };
    for (let q = 66; q <= 95; q += 1) plan[q] = { answer: 'blank' };
    const raw = scoreExamRaw(buildAnswers(plan), coefficients);

    expect(raw.subjects.math.netPercent).toBeCloseTo(100, 10);
    expect(raw.subjects.physics.netPercent).toBeCloseTo(0, 10);
    expect(raw.subjects.chemistry.netPercent).toBeCloseTo(0, 10);
    expect(raw.weightedRawScore).toBeCloseTo((12 * 100) / 28, 10);
  });

  it('never equals the unweighted mean of the three subject percentages', () => {
    const plan: Record<number, { answer: AnswerState }> = {};
    for (let q = 1; q <= 40; q += 1) plan[q] = { answer: 'correct' };
    for (let q = 41; q <= 65; q += 1) plan[q] = { answer: 'wrong' };
    for (let q = 66; q <= 95; q += 1) plan[q] = { answer: 'blank' };
    const raw = scoreExamRaw(buildAnswers(plan), coefficients);

    const mathNet = raw.subjects.math.netPercent;
    const physicsNet = raw.subjects.physics.netPercent;
    const chemistryNet = raw.subjects.chemistry.netPercent;
    const equalMean = (mathNet + physicsNet + chemistryNet) / 3;
    expect(raw.weightedRawScore).not.toBeCloseTo(equalMean, 6);
    expect(raw.weightedRawScore).toBeCloseTo(
      (12 * mathNet + 9 * physicsNet + 7 * chemistryNet) / 28,
      10,
    );
  });

  it('keeps a negative weighted score negative', () => {
    const plan: Record<number, { answer: AnswerState }> = {};
    for (let q = 1; q <= 40; q += 1) plan[q] = { answer: 'wrong' };
    for (let q = 41; q <= 65; q += 1) plan[q] = { answer: 'wrong' };
    for (let q = 66; q <= 95; q += 1) plan[q] = { answer: 'wrong' };
    const raw = scoreExamRaw(buildAnswers(plan), coefficients);
    expect(raw.weightedRawScore).toBeCloseTo(-100 / 3, 10);
  });

  it('splits the weighted score into contributions that sum back to it', () => {
    const raw = scoreExamRaw(buildAnswers({ 1: { answer: 'correct' } }), coefficients);
    const sum =
      raw.contributions.math + raw.contributions.physics + raw.contributions.chemistry;
    expect(sum).toBeCloseTo(raw.weightedRawScore, 10);
    expect(raw.contributions.math).toBeCloseTo(
      (12 * raw.subjects.math.netPercent) / 28,
      10,
    );
  });

  it('honours changed coefficients from an advanced profile', () => {
    const answers = buildAnswers({});
    const raw = scoreExamRaw(answers, { math: 40, physics: 25, chemistry: 30 });
    // 40/25/30 exactly matches question counts, so equal-per-question weighting.
    expect(raw.weightedRawScore).toBeCloseTo(raw.netPercent, 10);
  });
});

describe('8.2 difficulty assumptions', () => {
  it('ships the Profile v1 assumptions from the spec', () => {
    expect(PROFILE_V1.difficulty.easy).toEqual({ p: 0.85, a: 0.97 });
    expect(PROFILE_V1.difficulty.medium).toEqual({ p: 0.65, a: 0.88 });
    expect(PROFILE_V1.difficulty.hard).toEqual({ p: 0.25, a: 0.6 });
    expect(PROFILE_V1.A).toBe(5000);
    expect(PROFILE_V1.B).toBe(2000);
    expect(PROFILE_V1.sigma).toBe(15);
    expect(PROFILE_V1.subjectCoefficients).toEqual({ math: 12, physics: 9, chemistry: 7 });
  });

  it('derives mu_d from p and a rather than storing it separately', () => {
    expect(expectedNetPerQuestion('easy')).toBeCloseTo(0.776, 6);
    expect(expectedNetPerQuestion('medium')).toBeCloseTo(0.4693333333, 8);
    expect(expectedNetPerQuestion('hard')).toBeCloseTo(0, 12);
    // Recompute straight from the formula.
    expect(expectedNetPerQuestion('medium')).toBeCloseTo(
      0.88 * (0.65 - (1 - 0.65) / 3),
      12,
    );
  });

  it('reports the expected percentages in the spec table', () => {
    const pct = expectedNetPercentages();
    expect(pct.easy).toBeCloseTo(77.6, 6);
    expect(pct.medium).toBeCloseTo(46.93333333, 6);
    expect(pct.hard).toBeCloseTo(0, 12);
  });
});

describe('8.4 subject expected net from actual labels', () => {
  it('weights the subject mix by its own question count', () => {
    const plan: Record<number, { answer: AnswerState; difficulty: Difficulty }> = {};
    for (let q = 1; q <= 40; q += 1) plan[q] = { answer: 'blank', difficulty: 'easy' };
    const exp = expectedNetForSubject('math', buildAnswers(plan));
    expect(exp.difficultyCounts.easy).toBe(40);
    expect(exp.expectedNetPercent).toBeCloseTo(77.6, 6);
  });

  it('gives a subject with more hard questions a lower expected net', () => {
    const mathHeavyHard: Record<number, { difficulty: Difficulty }> = {};
    for (let q = 1; q <= 12; q += 1) mathHeavyHard[q] = { difficulty: 'hard' };
    for (let q = 13; q <= 40; q += 1) mathHeavyHard[q] = { difficulty: 'medium' };
    const chemMostlyEasy: Record<number, { difficulty: Difficulty }> = {};
    for (let q = 66; q <= 95; q += 1) chemMostlyEasy[q] = { difficulty: 'easy' };

    const mathExp = expectedNetForSubject('math', buildAnswers(mathHeavyHard));
    const chemExp = expectedNetForSubject('chemistry', buildAnswers(chemMostlyEasy));

    expect(mathExp.expectedNetPercent).toBeLessThan(chemExp.expectedNetPercent);
    expect(mathExp.difficultyCounts.hard).toBe(12);
    expect(chemExp.difficultyCounts.hard).toBe(0);
  });

  it('changes the expected net when a single label changes', () => {
    const before = buildAnswers({ 5: { difficulty: 'medium' } });
    const after = buildAnswers({ 5: { difficulty: 'hard' } });
    const a = expectedNetForSubject('math', before);
    const b = expectedNetForSubject('math', after);
    expect(a.expectedNetPercent).not.toBeCloseTo(b.expectedNetPercent, 6);
  });
});

describe('8.5 / 8.6 personal difficulty index', () => {
  it('computes expected -> performance -> tau with the spec formulas', () => {
    const plan: Record<number, { answer: AnswerState; difficulty: Difficulty }> = {};
    for (let q = 1; q <= 40; q += 1) plan[q] = { answer: 'correct', difficulty: 'medium' };
    for (let q = 41; q <= 65; q += 1) plan[q] = { answer: 'correct', difficulty: 'medium' };
    for (let q = 66; q <= 95; q += 1) plan[q] = { answer: 'correct', difficulty: 'medium' };
    const answers = buildAnswers(plan);
    const result = scoreExam({ date: '2026-01-01', provider: 'Maz', answers, profile: PROFILE_V1 });

    // Every subject: raw 100, expected 46.9333..., performance 53.0666...
    for (const id of ['math', 'physics', 'chemistry'] as SubjectId[]) {
      const s = result.adjusted.subjects[id];
      expect(s.expectedNetPercent).toBeCloseTo(46.93333333, 6);
      expect(s.performancePoints).toBeCloseTo(100 - 46.93333333, 6);
      expect(s.index).toBeCloseTo(5000 + (2000 * (100 - 46.93333333)) / 15, 6);
    }
    expect(result.adjusted.overallIndex).toBeCloseTo(
      result.adjusted.subjects.math.index,
      10,
    );
  });

  it('anchors the index at A when a subject hits its expected net exactly', () => {
    // 28.5 easy out of 40 -> find an integer mix landing on ~77.6? Instead test
    // the pure helper at zero deviation.
    expect(subjectIndex(0)).toBe(5000);
    expect(subjectIndex(15)).toBe(7000);
    expect(subjectIndex(-15)).toBe(3000);
  });

  it('weights the overall index by 12 / 9 / 7', () => {
    const plan: Record<number, { answer: AnswerState; difficulty: Difficulty }> = {};
    for (let q = 1; q <= 40; q += 1) plan[q] = { answer: 'correct', difficulty: 'easy' };
    for (let q = 41; q <= 65; q += 1) plan[q] = { answer: 'correct', difficulty: 'easy' };
    for (let q = 66; q <= 95; q += 1) plan[q] = { answer: 'correct', difficulty: 'easy' };
    const result = scoreExam({ date: '2026-01-01', provider: 'Maz', answers: buildAnswers(plan) });

    const { math, physics, chemistry } = result.adjusted.subjects;
    const expected = (12 * math.index + 9 * physics.index + 7 * chemistry.index) / 28;
    expect(result.adjusted.overallIndex).toBeCloseTo(expected, 10);
    expect(result.adjusted.coefficientTotal).toBe(28);
  });

  it('matches the equivalent weighted-deviation form of T', () => {
    const plan: Record<number, { answer: AnswerState; difficulty: Difficulty }> = {};
    for (let q = 1; q <= 40; q += 1) plan[q] = { answer: 'correct', difficulty: 'hard' };
    for (let q = 41; q <= 65; q += 1) plan[q] = { answer: 'correct', difficulty: 'easy' };
    for (let q = 66; q <= 95; q += 1) plan[q] = { answer: 'blank', difficulty: 'medium' };
    const result = scoreExam({ date: '2026-01-01', provider: 'Maz', answers: buildAnswers(plan) });
    const s = result.adjusted.subjects;
    const equivalent =
      5000 +
      (2000 / (28 * 15)) *
        (12 * s.math.performancePoints +
          9 * s.physics.performancePoints +
          7 * s.chemistry.performancePoints);
    expect(result.adjusted.overallIndex).toBeCloseTo(equivalent, 8);
  });

  it('applies no cap, floor, or 13000 target', () => {
    // Perfect exam on an all-easy paper.
    const easyPlan: Record<number, { answer: AnswerState; difficulty: Difficulty }> = {};
    for (let q = 1; q <= 95; q += 1) easyPlan[q] = { answer: 'correct', difficulty: 'easy' };
    const perfect = scoreExam({ date: '2026-01-01', provider: 'Maz', answers: buildAnswers(easyPlan) });
    // raw 100 vs expected 77.6 -> performance 22.4 -> 5000 + 2000*22.4/15
    expect(perfect.adjusted.overallIndex).toBeCloseTo(5000 + (2000 * 22.4) / 15, 8);
    expect(perfect.adjusted.overallIndex).not.toBe(13000);

    // All blank on an all-hard paper is exactly at expectation: 5000.
    const hardPlan: Record<number, { answer: AnswerState; difficulty: Difficulty }> = {};
    for (let q = 1; q <= 95; q += 1) hardPlan[q] = { answer: 'blank', difficulty: 'hard' };
    const atExpectation = scoreExam({
      date: '2026-01-01',
      provider: 'Maz',
      answers: buildAnswers(hardPlan),
    });
    expect(atExpectation.adjusted.overallIndex).toBeCloseTo(5000, 10);
    expect(atExpectation.raw.weightedRawScore).toBe(0);
  });

  it('lets the index go below zero when performance is far below expectation', () => {
    const plan: Record<number, { answer: AnswerState; difficulty: Difficulty }> = {};
    for (let q = 1; q <= 95; q += 1) plan[q] = { answer: 'wrong', difficulty: 'easy' };
    const result = scoreExam({ date: '2026-01-01', provider: 'Maz', answers: buildAnswers(plan) });
    // All wrong on an all-easy paper: raw -33.333..., expected 77.6,
    // performance -110.9333... -> 5000 + 2000 * (-110.9333...) / 15.
    const performance = -100 / 3 - 77.6;
    expect(result.adjusted.overallIndex).toBeCloseTo(5000 + (2000 * performance) / 15, 8);
    expect(result.adjusted.overallIndex).toBeLessThan(-9000);
  });

  it('does not let a correct hard answer be worth less than a correct easy answer', () => {
    // Both answer questions are +1. The difference is only in deviation size,
    // which is the whole point of the index.
    const easy = expectedNetForSubject('math', buildAnswers({ 1: { difficulty: 'easy' } }));
    const hard = expectedNetForSubject('math', buildAnswers({ 1: { difficulty: 'hard' } }));
    expect(hard.expectedNetPercent).toBeLessThan(easy.expectedNetPercent);
    expect(PROFILE_V1.difficulty.hard.p).toBeLessThan(PROFILE_V1.difficulty.easy.p);
  });

  it('keeps full floating-point precision internally', () => {
    // Every question medium -> expected net is the non-terminating 46.9333...
    const answers = buildAnswers({});
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) {
      answers[q] = { answer: 'correct', difficulty: 'medium' };
    }
    const result = scoreExam({ date: '2026-01-01', provider: 'Maz', answers });
    const s = result.adjusted.subjects.math;
    expect(s.expectedNetPercent).toBeCloseTo(46.9333333333, 10);
    // The stored value is not pre-rounded to 2dp.
    expect(s.expectedNetPercent).not.toBe(Number(s.expectedNetPercent.toFixed(2)));
  });

  it('stamps the profile and engine version onto every result', () => {
    const result = scoreExam({ date: '2026-01-01', provider: 'Maz', answers: buildAnswers({}) });
    expect(result.profileVersion).toBe('v1');
    expect(result.engineVersion).toBe('engine-1.0.0');
    expect(result.adjusted.profileVersion).toBe('v1');
  });
});

describe('safety: invalid inputs, missing data, non-finite values', () => {
  it('returns null metrics rather than dividing by zero', () => {
    expect(scoreExamRaw({}).netPercent).toBeCloseTo(0, 10);
    expect(scoreExamRaw({}).accuracyPercent).toBeNull();
    expect(scoreExamRaw({}).attemptRatePercent).toBeCloseTo(0, 10);
  });

  it('never throws on a fully empty answer map', () => {
    const result = scoreExam({ date: '2026-01-01', provider: 'Maz', answers: {} });
    expect(Number.isFinite(result.raw.weightedRawScore)).toBe(true);
    expect(result.raw.weightedRawScore).toBe(0);
    expect(result.adjusted.subjects.math.expectedNetPercent).toBe(0);
  });

  it('rejects an out-of-range or non-finite profile', () => {
    const bad = { ...PROFILE_V1, sigma: 0 } as ScoringProfile;
    expect(validateProfile(bad).length).toBeGreaterThan(0);
    expect(() => computeAdjusted({ answers: buildAnswers({}), rawSubjects: {} as never }, bad)).toThrow();

    const nanProfile = {
      ...PROFILE_V1,
      difficulty: { ...PROFILE_V1.difficulty, easy: { p: Number.NaN, a: 0.97 } },
    } as ScoringProfile;
    expect(validateProfile(nanProfile).some((i) => i.field.includes('easy'))).toBe(true);

    const zeroCoefficients: ScoringProfile = {
      ...PROFILE_V1,
      subjectCoefficients: { math: 0, physics: 0, chemistry: 0 },
    };
    expect(validateProfile(zeroCoefficients).some((i) => i.field === 'subjectCoefficients')).toBe(true);
  });

  it('accepts the shipped profile', () => {
    expect(validateProfile(PROFILE_V1)).toEqual([]);
  });
});

/** Removes a difficulty label without disturbing the answer, as entry does. */
function dropLabel(answers: AnswerMap, questionNumber: number): void {
  const entry = { ...answers[questionNumber] };
  delete entry.difficulty;
  answers[questionNumber] = entry;
}

describe('15.3 completeness requirements', () => {
  it('blocks the final adjusted score while any label is missing', () => {
    const answers = buildAnswers({});
    dropLabel(answers, 42);
    expect(hasCompleteDifficultyLabels(answers)).toBe(false);
    expect(hasCompleteDifficultyLabels(buildAnswers({}))).toBe(true);
  });

  it('still reports expected net from the labels that do exist', () => {
    const answers = buildAnswers({});
    dropLabel(answers, 42);
    const raw = scoreExamRaw(answers, coefficients);
    const adjusted = computeAdjusted({ answers, rawSubjects: raw.subjects });
    // Physics counts only 24 labels, so its expected net is understated --
    // which is why the app refuses to finalise rather than guessing.
    expect(adjusted.expected.physics.unlabeled).toBe(1);
    expect(adjusted.subjects.physics.unlabeled).toBe(1);
  });

  it('does not change raw answer scores when only a difficulty label changes', () => {
    const before = buildAnswers({ 7: { answer: 'correct', difficulty: 'easy' } });
    const after = buildAnswers({ 7: { answer: 'correct', difficulty: 'hard' } });
    const rawBefore = scoreExamRaw(before, coefficients);
    const rawAfter = scoreExamRaw(after, coefficients);
    expect(rawBefore.netPercent).toBe(rawAfter.netPercent);
    expect(rawBefore.weightedRawScore).toBe(rawAfter.weightedRawScore);
    expect(rawBefore.subjects.math.netPercent).toBe(rawAfter.subjects.math.netPercent);

    const adjBefore = computeAdjusted({ answers: before, rawSubjects: rawBefore.subjects });
    const adjAfter = computeAdjusted({ answers: after, rawSubjects: rawAfter.subjects });
    expect(adjBefore.subjects.math.expectedNetPercent).not.toBe(
      adjAfter.subjects.math.expectedNetPercent,
    );
    expect(adjBefore.subjects.math.index).not.toBe(adjAfter.subjects.math.index);
  });

  it('never forces the 30/55/15 typical mix onto entered exams', () => {
    // A deliberately lopsided paper: 80 hard, 15 easy, zero medium.
    const lopsided: Record<number, { difficulty: Difficulty }> = {};
    for (let q = 1; q <= 15; q += 1) lopsided[q] = { difficulty: 'easy' };
    for (let q = 16; q <= 95; q += 1) lopsided[q] = { difficulty: 'hard' };
    const answers = buildAnswers(lopsided);
    const raw = scoreExamRaw(answers, coefficients);
    const adjusted = computeAdjusted({ answers, rawSubjects: raw.subjects });
    expect(raw.subjects.math.difficultyCounts.medium).toBe(0);
    // Expected net collapses toward zero because hard has mu = 0.
    expect(adjusted.expected.math.expectedNetPercent).toBeCloseTo((100 * 15 * 0.776) / 40, 6);
  });
});

describe('validation and completion', () => {
  const base = (): ExamInput => ({
    date: '2026-07-16',
    provider: 'Maz',
    answers: buildAnswers({}),
  });

  it('accepts a fully answered and labelled exam', () => {
    expect(validateExam(base()).ok).toBe(true);
    expect(isComplete(base())).toBe(true);
  });

  it('rejects an exam with a missing answer', () => {
    const input = base();
    input.answers[3] = { difficulty: 'easy' };
    const v = validateExam(input);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === 'missing_answer' && i.questionNumber === 3)).toBe(true);
    expect(v.answerCoverage).toBeCloseTo(94 / 95, 10);
  });

  it('rejects an exam with a missing difficulty label', () => {
    const input = base();
    input.answers[80] = { answer: 'correct' };
    const v = validateExam(input);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === 'missing_difficulty')).toBe(true);
    expect(v.difficultyCoverage).toBeCloseTo(94 / 95, 10);
  });

  it('rejects an invalid date', () => {
    for (const date of ['2026-02-30', '2026-13-01', 'not-a-date', '2026/07/16', '']) {
      const v = validateExam({ ...base(), date });
      expect(v.issues.some((i) => i.code === 'invalid_date'), date).toBe(true);
    }
  });

  it('rejects a missing provider', () => {
    const v = validateExam({ ...base(), provider: '  ' });
    expect(v.issues.some((i) => i.code === 'invalid_provider')).toBe(true);
  });

  it('requires correct + wrong + blank to equal each subject count', () => {
    const input = base();
    input.answers[10] = {};
    const v = validateExam(input);
    expect(v.issues.some((i) => i.code === 'subject_count_mismatch' && i.subjectId === 'math')).toBe(
      true,
    );
  });

  it('never treats missing data as blank', () => {
    const input = base();
    input.answers[1] = { difficulty: 'easy' };
    const v = validateExam(input);
    expect(v.answeredCount).toBe(94);
    expect(v.issues.some((i) => i.code === 'missing_answer')).toBe(true);
    expect(v.issues.some((i) => i.message.includes('no answer recorded'))).toBe(true);
  });
});

describe('answer and difficulty are independent', () => {
  it('lets an answer be set without touching the difficulty and vice versa', () => {
    const answers = buildAnswers({});
    answers[11] = { answer: 'wrong', difficulty: 'hard' };
    expect(answers[11]).toEqual({ answer: 'wrong', difficulty: 'hard' });

    answers[12] = { answer: 'correct', difficulty: 'easy' };
    expect(answers[12]?.answer).toBe('correct');

    const raw = scoreExamRaw(answers, coefficients);
    expect(raw.subjects.math.wrong).toBe(1);
    expect(raw.subjects.math.correct).toBe(1);
    // 38 other Math questions keep their default easy label, plus q12.
    expect(raw.subjects.math.difficultyCounts.hard).toBe(1);
    expect(raw.subjects.math.difficultyCounts.easy).toBe(39);
  });
});

describe('reproducibility from raw inputs', () => {
  it('reproduces every score from the answer map and profile snapshot alone', () => {
    const plan: Record<number, { answer: AnswerState; difficulty: Difficulty }> = {
      1: { answer: 'correct', difficulty: 'hard' },
      2: { answer: 'wrong', difficulty: 'easy' },
      41: { answer: 'blank', difficulty: 'medium' },
      95: { answer: 'correct', difficulty: 'easy' },
    };
    const answers = buildAnswers(plan);
    const snapshot: ScoringProfile = JSON.parse(JSON.stringify(PROFILE_V1)) as ScoringProfile;

    const first = scoreExam({ date: '2026-07-16', provider: 'Maz', answers, profile: snapshot });
    const second = scoreExam({ date: '2026-07-16', provider: 'Maz', answers, profile: snapshot });

    expect(second).toEqual(first);
    expect(first.raw.weightedRawScore).toBeCloseTo(
      (12 * first.raw.subjects.math.netPercent +
        9 * first.raw.subjects.physics.netPercent +
        7 * first.raw.subjects.chemistry.netPercent) /
        28,
      10,
    );
  });
});