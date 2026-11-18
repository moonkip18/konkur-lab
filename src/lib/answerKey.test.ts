import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, matchesFilter, parseAnswerKey } from './answerKey';
import { canRedo, canUndo, createHistory, pushEdit, redo, undo } from './undo';

describe('paste parsing', () => {
  it('parses answers and difficulties from a compact column format', () => {
    const parsed = parseAnswerKey('1 c e\n2 w m\n3 - h');
    expect(parsed.answers).toEqual([
      { question: 1, value: 'correct' },
      { question: 2, value: 'wrong' },
      { question: 3, value: 'blank' },
    ]);
    expect(parsed.difficulties).toEqual([
      { question: 1, value: 'easy' },
      { question: 2, value: 'medium' },
      { question: 3, value: 'hard' },
    ]);
    expect(parsed.unrecognized).toEqual([]);
  });

  it('parses answers and difficulties independently', () => {
    const answerOnly = parseAnswerKey('1 c\n2 correct\n3 blank');
    expect(answerOnly.answers).toHaveLength(3);
    expect(answerOnly.difficulties).toHaveLength(0);

    const difficultyOnly = parseAnswerKey('1 e\n2 hard\n3 متوسط');
    expect(difficultyOnly.difficulties).toEqual([
      { question: 1, value: 'easy' },
      { question: 2, value: 'hard' },
      { question: 3, value: 'medium' },
    ]);
    expect(difficultyOnly.answers).toHaveLength(0);
  });

  it('accepts full words, digits, separators, and commas', () => {
    const parsed = parseAnswerKey('4: wrong, hard; 5=true, E; 6=false, سخت');
    expect(parsed.answers).toEqual([
      { question: 4, value: 'wrong' },
      { question: 5, value: 'correct' },
      { question: 6, value: 'wrong' },
    ]);
    expect(parsed.difficulties).toEqual([
      { question: 4, value: 'hard' },
      { question: 5, value: 'easy' },
      { question: 6, value: 'hard' },
    ]);
  });

  it('reports lines with no question number instead of guessing', () => {
    const parsed = parseAnswerKey('correct easy\n7 c e\ntotal 95');
    expect(parsed.unrecognized).toEqual(['correct easy', 'total 95']);
    expect(parsed.answers).toEqual([{ question: 7, value: 'correct' }]);
  });

  it('ignores out-of-range question numbers', () => {
    const parsed = parseAnswerKey('0 c\n96 c\n95 c');
    expect(parsed.questions).toEqual([95]);
  });

  it('lets a later token for the same question win', () => {
    const parsed = parseAnswerKey('1 c w');
    expect(parsed.answers).toEqual([{ question: 1, value: 'wrong' }]);
  });

  it('returns empty results for empty input', () => {
    const parsed = parseAnswerKey('');
    expect(parsed.answers).toEqual([]);
    expect(parsed.difficulties).toEqual([]);
    expect(parsed.unrecognized).toEqual([]);
  });

  it('parses a full official key: answer only, one question per line', () => {
    // Official Maz keys publish answers without difficulty labels; the entry
    // form's difficulty step happens separately.
    const lines = Array.from({ length: 95 }, (_, i) => `${i + 1} ${['c', 'w', 'b'][i % 3]}`).join('\n');
    const parsed = parseAnswerKey(lines);
    expect(parsed.answers).toHaveLength(95);
    expect(parsed.difficulties).toHaveLength(0);
    expect(parsed.unrecognized).toEqual([]);
    expect(parsed.questions).toEqual(Array.from({ length: 95 }, (_, i) => i + 1));
  });

  it('parses numeric difficulty bands 1/2/3 from official keys', () => {
    const parsed = parseAnswerKey('1 c 1\n2 w 2\n3 b 3');
    expect(parsed.difficulties).toEqual([
      { question: 1, value: 'easy' },
      { question: 2, value: 'medium' },
      { question: 3, value: 'hard' },
    ]);
  });

  it('parses Persian difficulty words گام/متوسط/سخت', () => {
    const parsed = parseAnswerKey('1 c گام\n2 w متوسط\n3 b سخت');
    expect(parsed.difficulties).toEqual([
      { question: 1, value: 'easy' },
      { question: 2, value: 'medium' },
      { question: 3, value: 'hard' },
    ]);
  });
});

describe('filters', () => {
  const entries: Record<number, { answer?: 'correct' | 'wrong' | 'blank'; difficulty?: 'easy' | 'medium' | 'hard' }> = {
    1: { answer: 'correct', difficulty: 'easy' },
    41: { answer: 'wrong', difficulty: 'hard' },
    42: {},
    43: { answer: 'blank', difficulty: 'medium' },
  };

  it('passes everything through with the default filter', () => {
    expect(matchesFilter(1, entries[1]!, EMPTY_FILTER)).toBe(true);
    expect(matchesFilter(42, entries[42]!, EMPTY_FILTER)).toBe(true);
  });

  it('filters by subject', () => {
    expect(matchesFilter(1, entries[1]!, { ...EMPTY_FILTER, subject: 'math' })).toBe(true);
    expect(matchesFilter(41, entries[41]!, { ...EMPTY_FILTER, subject: 'math' })).toBe(false);
    expect(matchesFilter(41, entries[41]!, { ...EMPTY_FILTER, subject: 'physics' })).toBe(true);
  });

  it('filters by difficulty, including unlabeled', () => {
    expect(matchesFilter(41, entries[41]!, { ...EMPTY_FILTER, difficulty: 'hard' })).toBe(true);
    expect(matchesFilter(1, entries[1]!, { ...EMPTY_FILTER, difficulty: 'hard' })).toBe(false);
    // q42 carries no label at all, which is what "unlabeled" means.
    expect(matchesFilter(42, entries[42]!, { ...EMPTY_FILTER, difficulty: 'unlabeled' })).toBe(true);
    expect(matchesFilter(43, entries[43]!, { ...EMPTY_FILTER, difficulty: 'unlabeled' })).toBe(false);
    expect(matchesFilter(1, entries[1]!, { ...EMPTY_FILTER, difficulty: 'unlabeled' })).toBe(false);
  });

  it('distinguishes unanswered from blank', () => {
    expect(matchesFilter(43, entries[43]!, { ...EMPTY_FILTER, answer: 'blank' })).toBe(true);
    expect(matchesFilter(42, entries[42]!, { ...EMPTY_FILTER, answer: 'blank' })).toBe(false);
    expect(matchesFilter(42, entries[42]!, { ...EMPTY_FILTER, answer: 'unanswered' })).toBe(true);
    expect(matchesFilter(43, entries[43]!, { ...EMPTY_FILTER, answer: 'unanswered' })).toBe(false);
  });

  it('combines filters with AND', () => {
    const filter = {
      subject: 'math' as const,
      difficulty: 'unlabeled' as const,
      answer: 'unanswered' as const,
      query: '',
    };
    expect(matchesFilter(42, entries[42]!, filter)).toBe(false); // 42 is physics
    expect(matchesFilter(2, {}, filter)).toBe(true); // math, unlabeled, unanswered
    expect(matchesFilter(1, entries[1]!, filter)).toBe(false); // labeled and answered
  });

  it('matches a question-number query', () => {
    expect(matchesFilter(41, entries[41]!, { ...EMPTY_FILTER, query: '4' })).toBe(true);
    expect(matchesFilter(41, entries[41]!, { ...EMPTY_FILTER, query: '9' })).toBe(false);
  });
});

describe('undo / redo', () => {
  const base = () => createHistory<number[]>([1]);

  it('starts with nothing to undo or redo', () => {
    const h = base();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('moves one step back and forward', () => {
    let h = pushEdit(base(), [1, 2], 'q:1:answer');
    h = pushEdit(h, [1, 2, 3], 'q:2:answer');
    expect(h.present).toEqual([1, 2, 3]);

    h = undo(h);
    expect(h.present).toEqual([1, 2]);
    expect(canRedo(h)).toBe(true);

    h = undo(h);
    expect(h.present).toEqual([1]);

    h = redo(h);
    expect(h.present).toEqual([1, 2]);
    h = redo(h);
    expect(h.present).toEqual([1, 2, 3]);
    expect(canRedo(h)).toBe(false);
  });

  it('clears the redo branch when a new edit lands after undo', () => {
    let h = pushEdit(base(), [2]);
    h = pushEdit(h, [3]);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = pushEdit(h, [99]);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toEqual([99]);
  });

  it('coalesces rapid edits to the same question into one undo step', () => {
    let h = base();
    h = pushEdit(h, [1, 2], 'q:1:answer', 1000);
    h = pushEdit(h, [1, 2, 2], 'q:1:answer', 1200);
    expect(h.past).toEqual([[1]]);
    h = undo(h);
    expect(h.present).toEqual([1]);
  });

  it('does not coalesce edits to different questions', () => {
    let h = base();
    h = pushEdit(h, [2], 'q:1:answer', 1000);
    h = pushEdit(h, [2, 3], 'q:2:answer', 1100);
    expect(h.past).toEqual([[1], [2]]);
  });

  it('does not coalesce edits separated by more than the window', () => {
    let h = base();
    h = pushEdit(h, [2], 'q:1:answer', 1000);
    h = pushEdit(h, [2, 2], 'q:1:answer', 5000);
    expect(h.past).toHaveLength(2);
  });

  it('treats answer and difficulty edits on one question as separate steps', () => {
    let h = base();
    h = pushEdit(h, [2], 'q:1:answer', 1000);
    h = pushEdit(h, [2, 3], 'q:1:difficulty', 1050);
    expect(h.past).toHaveLength(2);
  });

  it('bounds the undo stack', () => {
    let h = createHistory<number>(0);
    for (let i = 1; i <= 250; i += 1) {
      h = pushEdit(h, i, `k${i}`, i * 10_000);
    }
    expect(h.past.length).toBeLessThanOrEqual(100);
  });
});