import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Bounded undo/redo over the answer map.
 *
 * History holds full snapshots rather than per-edit diffs: the maps are tiny
 * (95 short entries) and snapshotting removes any chance of an inverse edit
 * being subtly wrong. Coalescing consecutive edits to the same question within
 * `coalesceMs` keeps a burst of keystrokes to one undo step.
 */
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  lastEditKey: string | null;
  lastEditAt: number;
}

const MAX_DEPTH = 100;
const COALESCE_MS = 600;

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [], lastEditKey: null, lastEditAt: 0 };
}

/** Replaces `present`, pushing the old value onto the undo stack. */
export function pushEdit<T>(
  history: HistoryState<T>,
  next: T,
  editKey?: string,
  now: number = Date.now(),
): HistoryState<T> {
  const coalesce =
    editKey !== undefined &&
    editKey === history.lastEditKey &&
    now - history.lastEditAt < COALESCE_MS &&
    history.past.length > 0;

  const past = coalesce ? history.past : [...history.past, history.present].slice(-MAX_DEPTH);
  return {
    past,
    present: next,
    // A new edit invalidates any redo branch.
    future: [],
    lastEditKey: editKey ?? null,
    lastEditAt: editKey !== undefined ? now : 0,
  };
}

export function undo<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, MAX_DEPTH),
    lastEditKey: null,
    lastEditAt: 0,
  };
}

export function redo<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.future.length === 0) return history;
  const next = history.future[0]!;
  return {
    past: [...history.past, history.present].slice(-MAX_DEPTH),
    present: next,
    future: history.future.slice(1),
    lastEditKey: null,
    lastEditAt: 0,
  };
}

export function canUndo<T>(h: HistoryState<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: HistoryState<T>): boolean {
  return h.future.length > 0;
}

export interface UndoableApi<T> {
  /** The value currently on screen. */
  value: T;
  update: (next: T, editKey?: string) => void;
  /** Returns the value now on screen after the step (unchanged if no-op). */
  undo: () => T;
  redo: () => T;
  reset: (value: T) => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoable<T>(initial: T): UndoableApi<T> {
  const [history, setHistory] = useState<HistoryState<T>>(() => createHistory(initial));
  const ref = useRef(history);
  ref.current = history;

  const update = useCallback((next: T, editKey?: string) => {
    setHistory((h) => pushEdit(h, next, editKey));
  }, []);

  const doUndo = useCallback((): T => {
    const next = undo(ref.current);
    setHistory(next);
    return next.present;
  }, []);
  const doRedo = useCallback((): T => {
    const next = redo(ref.current);
    setHistory(next);
    return next.present;
  }, []);
  const reset = useCallback((value: T) => setHistory(createHistory(value)), []);

  return useMemo(
    () => ({
      value: history.present,
      update,
      undo: doUndo,
      redo: doRedo,
      reset,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
    }),
    [history, update, doUndo, doRedo, reset],
  );
}