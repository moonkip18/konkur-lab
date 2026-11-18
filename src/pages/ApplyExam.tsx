import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ANSWER_LABELS,
  DIFFICULTY_LABELS,
  SUBJECTS,
  TOTAL_QUESTION_COUNT,
  coverageOf,
  formatPercent,
  scoreExamRaw,
  computeAdjusted,
  hasCompleteDifficultyLabels,
  subjectForQuestion,
  type AnswerMap,
  type AnswerState,
  type Difficulty,
  type QuestionEntry,
  type SubjectId,
} from '../lib/scoring';
import type { ExamRecord } from '../lib/db/models';
import {
  completeExam,
  describeStorageError,
  emptyExam,
  findDuplicate,
  reopenExam,
  setQuestion,
  updateExamMeta,
} from '../lib/db/examRepo';
import { db } from '../lib/db/db';
import { suggestNextExamDate } from '../lib/examCadence';
import { EMPTY_FILTER, matchesFilter, parseAnswerKey, type FilterState } from '../lib/answerKey';
import { useUndoable } from '../lib/undo';
import { useApp } from '../state/AppContext';
import { Chip, CoverageBar, EstimationDisclaimer, Note } from '../components/primitives';

const ANSWER_ORDER: AnswerState[] = ['correct', 'blank', 'wrong'];
const DIFFICULTY_ORDER_UI: Difficulty[] = ['easy', 'medium', 'hard'];

export function ApplyExam(): JSX.Element {
  const { exams, settings, refresh } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const drafts = useMemo(() => exams.filter((e) => e.status === 'draft'), [exams]);
  const completed = useMemo(
    () => exams.filter((e) => e.status === 'completed' || e.status === 'archived'),
    [exams],
  );

  // Default to the newest draft; otherwise nothing is selected until the user
  // creates an exam. No exam is ever auto-created.
  useEffect(() => {
    if (selectedId && exams.some((e) => e.id === selectedId)) return;
    if (drafts.length > 0) setSelectedId(drafts[drafts.length - 1]!.id);
  }, [drafts, selectedId, exams]);

  const selected = exams.find((e) => e.id === selectedId) ?? null;

  const suggestedDate = useMemo(
    () => suggestNextExamDate(completed.map((e) => e.date), settings.examIntervalDays),
    [completed, settings.examIntervalDays],
  );

  const createDraft = useCallback(async () => {
    setStorageError(null);
    const date = suggestedDate ?? new Date().toISOString().slice(0, 10);
    const exam = emptyExam(date, settings.defaultProvider);
    try {
      await db.exams.put(exam);
      setSelectedId(exam.id);
      setStatus('Draft created. Nothing is scored until you complete it.');
      refresh();
    } catch (e) {
      setStorageError(describeStorageError(e));
    }
  }, [suggestedDate, settings.defaultProvider, refresh]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Apply Exam <span className="fa muted">ثبت آزمون</span>
        </h1>
        <p>
          A digital پاسخنامه کلیدی. For each of the 95 questions, mark the answer and the
          official Maz difficulty label. The two selections are independent.
        </p>
      </div>

      {storageError ? (
        <div style={{ marginBottom: 16 }}>
          <Note warn>
            <strong>Storage problem.</strong> {storageError}
          </Note>
        </div>
      ) : null}
      {status ? (
        <div style={{ marginBottom: 16 }}>
          <Note>{status}</Note>
        </div>
      ) : null}

      <div className="row row-wrap spread" style={{ marginBottom: 18 }}>
        <div className="row row-wrap">
          <select
            className="select"
            aria-label="Select exam"
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
            style={{ minWidth: 240 }}
          >
            <option value="">Select an exam…</option>
            <optgroup label="Drafts">
              {drafts.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.date} · {e.provider}
                </option>
              ))}
            </optgroup>
            <optgroup label="Completed">
              {completed.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.date} · {e.provider} · {e.status}
                </option>
              ))}
            </optgroup>
          </select>
          <button className="btn btn-primary" type="button" onClick={createDraft}>
            New draft
          </button>
        </div>
        {suggestedDate ? (
          <span className="chip">Next suggested date · {suggestedDate} (+{settings.examIntervalDays}d)</span>
        ) : (
          <span className="chip">No exam history yet</span>
        )}
      </div>

      {selected ? (
        <ExamEditor key={selected.id} exam={selected} onChanged={refresh} />
      ) : (
        <div className="empty">
          <h3>No exam selected</h3>
          <p>
            Create a draft to start entering answers. A draft saves as you type and can be
            completed once all 95 answers and all 95 difficulty labels are present.
          </p>
          <button className="btn btn-primary" type="button" onClick={createDraft} style={{ marginTop: 18 }}>
            Create first draft
          </button>
        </div>
      )}
    </div>
  );
}

interface EditorProps {
  exam: ExamRecord;
  onChanged: () => void;
}

function ExamEditor({ exam, onChanged }: EditorProps): JSX.Element {
  const readOnly = exam.status !== 'draft';
  const history = useUndoable<AnswerMap>(exam.answers);
  const answers = history.value;

  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [focused, setFocused] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<AnswerMap | null>(null);
  /** Last known persisted state, used to diff and write only real changes. */
  const persisted = useRef<AnswerMap>(exam.answers);

  /**
   * Flushes by diffing the pending map against what is on disk.
   *
   * Two details matter. First, a plain single-field write would lose data:
   * debounce an answer and a difficulty edit together and only the last field
   * would persist -- so every changed field is diffed and written separately.
   * Second, an edit can land *while* the loop is awaiting the database; the
   * snapshot is therefore only cleared if `pending` still points at it, and a
   * newer edit schedules another flush instead of being dropped.
   */
  const flush = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const snapshot = pending.current;
    if (!snapshot) return;

    for (const key of Object.keys(snapshot)) {
      const q = Number(key);
      const nextEntry = snapshot[q] ?? {};
      const prevEntry = persisted.current[q] ?? {};
      const answerChanged = (prevEntry.answer ?? null) !== (nextEntry.answer ?? null);
      const difficultyChanged = (prevEntry.difficulty ?? null) !== (nextEntry.difficulty ?? null);
      if (!answerChanged && !difficultyChanged) continue;
      try {
        await setQuestion(exam.id, q, {
          ...(answerChanged ? { answer: nextEntry.answer ?? null } : {}),
          ...(difficultyChanged ? { difficulty: nextEntry.difficulty ?? null } : {}),
        });
        persisted.current = { ...persisted.current, [q]: { ...nextEntry } };
      } catch (e) {
        setError(describeStorageError(e));
      }
    }
    onChanged();

    if (pending.current === snapshot) {
      pending.current = null;
      return;
    }
    // An edit arrived mid-write; drain it rather than dropping it.
    void flush();
  }, [exam.id, onChanged]);

  const commit = useCallback(
    (next: AnswerMap) => {
      pending.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void flush();
      }, 220);
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // The debounce is 220ms; a tab close inside that window would silently drop
  // the newest edits. The unmount path calls the flush ref directly. For
  // beforeunload the flush is fired synchronously with best-effort Dexie
  // promises; IndexedDB writes usually complete during teardown.
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    const onBeforeUnload = (): void => {
      const snapshot = pending.current;
      if (!snapshot) return;
      pending.current = null;
      for (const key of Object.keys(snapshot)) {
        const q = Number(key);
        const nextEntry = snapshot[q] ?? {};
        const prevEntry = persisted.current[q] ?? {};
        if (
          (prevEntry.answer ?? null) === (nextEntry.answer ?? null) &&
          (prevEntry.difficulty ?? null) === (nextEntry.difficulty ?? null)
        ) {
          continue;
        }
        void setQuestion(exam.id, q, {
          ...((prevEntry.answer ?? null) !== (nextEntry.answer ?? null)
            ? { answer: nextEntry.answer ?? null }
            : {}),
          ...((prevEntry.difficulty ?? null) !== (nextEntry.difficulty ?? null)
            ? { difficulty: nextEntry.difficulty ?? null }
            : {}),
        }).catch(() => undefined);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      void flushRef.current();
    };
  }, [exam.id]);

  // Keep the diff baseline in step with an external change (import, undo of a
  // completed exam) without discarding local edits.
  useEffect(() => {
    if (pending.current === null) persisted.current = exam.answers;
  }, [exam.answers]);

  const setAnswer = useCallback(
    (questionNumber: number, value: AnswerState | null) => {
      if (readOnly) return;
      const next: AnswerMap = { ...answers };
      const entry: QuestionEntry = { ...(next[questionNumber] ?? {}) };
      if (value) entry.answer = value;
      else delete entry.answer;
      next[questionNumber] = entry;
      history.update(next, `q${questionNumber}:answer`);
      commit(next);
    },
    [answers, history, commit, readOnly],
  );

  const setDifficulty = useCallback(
    (questionNumber: number, value: Difficulty | null) => {
      if (readOnly) return;
      const next: AnswerMap = { ...answers };
      const entry: QuestionEntry = { ...(next[questionNumber] ?? {}) };
      if (value) entry.difficulty = value;
      else delete entry.difficulty;
      next[questionNumber] = entry;
      history.update(next, `q${questionNumber}:difficulty`);
      commit(next);
    },
    [answers, history, commit, readOnly],
  );

  // Undo and redo change the local map, so they must be flushed the same way
  // ordinary edits are; otherwise a refresh would resurrect an undone value.
  const flushPending = flush;

  // Undo and redo change the local map, so they are committed like any other
  // edit; otherwise a refresh would resurrect an undone value. The hook returns
  // the resulting map so the flush diff sees the change.
  const handleUndo = useCallback(() => {
    commit(history.undo());
  }, [history, commit]);

  const handleRedo = useCallback(() => {
    commit(history.redo());
  }, [history, commit]);

  const coverage = useMemo(() => coverageOf(answers), [answers]);
  const raw = useMemo(
    () => scoreExamRaw(answers, exam.profileSnapshot.subjectCoefficients),
    [answers, exam.profileSnapshot.subjectCoefficients],
  );
  const adjustedAvailable = hasCompleteDifficultyLabels(answers);
  const adjusted = useMemo(
    () =>
      adjustedAvailable
        ? computeAdjusted({ answers, rawSubjects: raw.subjects }, exam.profileSnapshot)
        : null,
    [adjustedAvailable, answers, raw.subjects, exam.profileSnapshot],
  );

  const visibleSubjects = useMemo(
    () => (filter.subject === 'all' ? SUBJECTS : SUBJECTS.filter((s) => s.id === filter.subject)),
    [filter.subject],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setFocused((q) => Math.min(TOTAL_QUESTION_COUNT, Math.max(1, q + delta)));
        document.getElementById(`q-${Math.min(TOTAL_QUESTION_COUNT, Math.max(1, focused + delta))}`)?.focus();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const next = Math.min(TOTAL_QUESTION_COUNT, focused + 1);
        setFocused(next);
        document.getElementById(`q-${next}`)?.focus();
      }
    },
    [focused],
  );

  const doComplete = useCallback(async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await flushPending();
      await completeExam(exam.id);
      onChanged();
      setMessage('Exam completed. Its score was computed from its own inputs only.');
    } catch (e) {
      setError(describeStorageError(e));
    } finally {
      setBusy(false);
    }
  }, [exam.id, flushPending, onChanged]);

  const doReopen = useCallback(async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await reopenExam(exam.id);
      onChanged();
      setMessage('Reopened as a draft. The stored result was cleared and the revision recorded.');
    } catch (e) {
      setError(describeStorageError(e));
    } finally {
      setBusy(false);
    }
  }, [exam.id, onChanged]);

  const missingAnswers = TOTAL_QUESTION_COUNT - coverage.answered;
  const missingLabels = TOTAL_QUESTION_COUNT - coverage.labeled;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <ExamMeta exam={exam} readOnly={readOnly} onChanged={onChanged} />

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        <div className="grid-cell">
          <CoverageBar value={coverage.answerCoverage} complete={missingAnswers === 0} label="Answers" />
        </div>
        <div className="grid-cell">
          <CoverageBar value={coverage.difficultyCoverage} complete={missingLabels === 0} label="Difficulty labels" />
        </div>
        <div className="grid-cell">
          <div className="metric">{coverage.answered}/95</div>
          <div className="metric-label">Answers recorded</div>
          <div className="metric-sub">{missingAnswers} remaining</div>
        </div>
        <div className="grid-cell">
          <div className="metric">{coverage.labeled}/95</div>
          <div className="metric-label">Labels recorded</div>
          <div className="metric-sub">{missingLabels} remaining</div>
        </div>
      </div>

{readOnly ? (
          <Note warn>
            <span data-testid="readonly-note">
              This exam is <strong>{exam.status}</strong>. Answers are locked so its stored score
              cannot change silently. Reopen it to edit, which clears the stored result and records
              revision {exam.revision + 1}.
            </span>
          </Note>
        ) : null}
      {error ? (
        <Note warn>
          <strong>Could not save.</strong> {error}
        </Note>
      ) : null}
      {message ? <Note>{message}</Note> : null}

      <LiveSummary raw={raw} adjusted={adjusted} adjustedAvailable={adjustedAvailable} />
      <EstimationDisclaimer compact />

      <div className="row row-wrap" style={{ gap: 8 }}>
        <button className="btn btn-sm" type="button" onClick={handleUndo} disabled={!history.canUndo}>
          Undo
        </button>
        <button className="btn btn-sm" type="button" onClick={handleRedo} disabled={!history.canRedo}>
          Redo
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowPaste((s) => !s)}>
          {showPaste ? 'Hide paste' : 'Paste entry'}
        </button>
        <div style={{ flex: 1 }} />
        {readOnly ? (
          <button className="btn btn-sm" type="button" onClick={doReopen} disabled={busy}>
            Reopen for editing
          </button>
        ) : (
          <>
            <button className="btn btn-sm" type="button" onClick={doComplete} disabled={busy || !coverage.complete}>
              Complete exam
            </button>
          </>
        )}
      </div>

      {!readOnly && !coverage.complete ? (
        <Note>
          Completing requires all 95 answers <em>and</em> all 95 difficulty labels. Missing items are
          never treated as blank or as easy.
        </Note>
      ) : null}

      {showPaste && !readOnly ? (
        <PastePanel
          answers={answers}
          onApply={(map) => {
            // Both steps are required: history.update puts the merged map on
            // screen, commit schedules the same diff for persistence. Calling
            // only update() made pasted entries vanish on reload.
            history.update(map, 'paste');
            commit(map);
          }}
        />
      ) : null}

      <FilterBar filter={filter} onChange={setFilter} />

      <QuickNav focused={focused} onJump={setFocused} />

      <div className="row row-wrap spread">
        <div className="row">
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={() => {
              const prev = Math.max(1, focused - 1);
              setFocused(prev);
              document.getElementById(`q-${prev}`)?.focus();
            }}
          >
            ← Previous
          </button>
          <span className="tiny faint mono" style={{ minWidth: 92, textAlign: 'center' }}>
            Question {focused} / 95
          </span>
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={() => {
              const next = Math.min(TOTAL_QUESTION_COUNT, focused + 1);
              setFocused(next);
              document.getElementById(`q-${next}`)?.focus();
            }}
          >
            Next →
          </button>
        </div>
        <JumpInput onJump={setFocused} />
      </div>

      <div onKeyDown={onKeyDown}>
        {visibleSubjects.map((subject) => (
          <SubjectSection
            key={subject.id}
            subjectId={subject.id}
            answers={answers}
            filter={filter}
            readOnly={readOnly}
            focused={focused}
            onFocus={setFocused}
            onAnswer={setAnswer}
            onDifficulty={setDifficulty}
          />
        ))}
      </div>
    </div>
  );
}

function ExamMeta({
  exam,
  readOnly,
  onChanged,
}: {
  exam: ExamRecord;
  readOnly: boolean;
  onChanged: () => void;
}): JSX.Element {
  const [date, setDate] = useState(exam.date);
  const [provider, setProvider] = useState(exam.provider);
  const [notes, setNotes] = useState(exam.notes);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<ExamRecord | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const apply = useCallback(async () => {
    setError(null);
    setDuplicate(null);
    if (date !== exam.date || provider !== exam.provider) {
      const clash = await findDuplicate(date, provider, exam.id);
      if (clash && !confirmDuplicate) {
        setDuplicate(clash);
        return;
      }
    }
    try {
      await updateExamMeta(exam.id, { date, provider });
      onChanged();
    } catch (e) {
      setError(describeStorageError(e));
    }
  }, [date, provider, exam.id, exam.date, exam.provider, confirmDuplicate, onChanged]);

  return (
    <div className="card-quiet stack" style={{ gap: 12 }}>
      <div className="row row-wrap" style={{ gap: 12 }}>
        <div className="field" style={{ maxWidth: 180 }}>
          <label htmlFor={`date-${exam.id}`}>Exam date (ISO)</label>
          <input
            id={`date-${exam.id}`}
            className="input"
            type="date"
            value={date}
            disabled={readOnly}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label htmlFor={`provider-${exam.id}`}>Provider</label>
          <input
            id={`provider-${exam.id}`}
            className="input"
            value={provider}
            disabled={readOnly}
            onChange={(e) => setProvider(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor={`notes-${exam.id}`}>Notes</label>
          <input
            id={`notes-${exam.id}`}
            className="input"
            value={notes}
            disabled={readOnly}
            placeholder="Optional"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={async () => {
              try {
                await updateExamMeta(exam.id, { notes });
                onChanged();
              } catch (e) {
                setError(describeStorageError(e));
              }
            }}
          />
        </div>
        <button className="btn btn-sm" type="button" onClick={apply} disabled={readOnly}>
          Save details
        </button>
      </div>
      <div className="row row-wrap" style={{ gap: 8 }}>
        <Chip tone={exam.status === 'completed' ? 'ok' : undefined}>{exam.status}</Chip>
        <Chip>profile {exam.profileVersion}</Chip>
        <Chip>engine {exam.engineVersion}</Chip>
        {exam.revision > 0 ? <Chip>revision {exam.revision}</Chip> : null}
        <span className="tiny faint mono">id {exam.id}</span>
      </div>
      {error ? (
        <Note warn>
          <strong>Could not save details.</strong> {error}
        </Note>
      ) : null}
      {duplicate ? (
        <Note warn>
          <strong>Possible duplicate.</strong> Another {duplicate.provider} exam already exists on{' '}
          {duplicate.date}. Saving anyway requires confirmation.
          <div style={{ marginTop: 8 }}>
            <button
              className="btn btn-sm btn-danger"
              type="button"
              onClick={() => {
                setConfirmDuplicate(true);
                void apply();
              }}
            >
              Save as a duplicate anyway
            </button>
          </div>
        </Note>
      ) : null}
    </div>
  );
}

function LiveSummary({
  raw,
  adjusted,
  adjustedAvailable,
}: {
  raw: ReturnType<typeof scoreExamRaw>;
  adjusted: ReturnType<typeof computeAdjusted> | null;
  adjustedAvailable: boolean;
}): JSX.Element {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      <div className="grid-cell">
        <div className="metric">{formatPercent(raw.netPercent)}</div>
        <div className="metric-label">Raw net (all 95)</div>
        <div className="metric-sub">
          C {raw.correct} · W {raw.wrong} · B {raw.blank} · unset {raw.unanswered}
        </div>
      </div>
      <div className="grid-cell">
        <div className="metric">{formatPercent(raw.weightedRawScore)}</div>
        <div className="metric-label">Weighted raw (12/9/7)</div>
        <div className="metric-sub">never the equal average</div>
      </div>
      <div className="grid-cell">
        <div className="metric">{formatPercent(raw.attemptRatePercent, 1)}</div>
        <div className="metric-label">Attempt rate</div>
        <div className="metric-sub">{raw.attempted} attempted</div>
      </div>
      <div className="grid-cell">
        <div className="metric">{formatPercent(raw.accuracyPercent, 1)}</div>
        <div className="metric-label">Accuracy when attempted</div>
        <div className="metric-sub">of {raw.attempted} attempts</div>
      </div>
      {SUBJECTS.map((s) => {
        const sub = raw.subjects[s.id];
        const adj = adjusted?.subjects[s.id];
        return (
          <div className="grid-cell" key={s.id}>
            <div className="metric">{formatPercent(sub.netPercent)}</div>
            <div className="metric-label">
              {s.nameEn} · <span className="fa">{s.nameFa}</span> raw
            </div>
            <div className="metric-sub">
              {s.questionCount}q · E{sub.difficultyCounts.easy} M{sub.difficultyCounts.medium} H
              {sub.difficultyCounts.hard}
            </div>
            <div className="metric-sub">
              {adjustedAvailable && adj ? (
                <>
                  τ {Math.round(adj.index).toLocaleString('en-US')} · exp{' '}
                  {formatPercent(adj.expectedNetPercent)}
                </>
              ) : (
                <span className="faint">adjusted index needs all 95 labels</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FilterBar({
  filter,
  onChange,
}: {
  filter: FilterState;
  onChange: (f: FilterState) => void;
}): JSX.Element {
  return (
    <div className="row row-wrap" style={{ gap: 8 }}>
      <select
        className="select"
        aria-label="Filter by subject"
        value={filter.subject}
        onChange={(e) => onChange({ ...filter, subject: e.target.value as FilterState['subject'] })}
      >
        <option value="all">All subjects</option>
        {SUBJECTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nameEn} ({s.nameFa})
          </option>
        ))}
      </select>
      <select
        className="select"
        aria-label="Filter by difficulty"
        value={filter.difficulty}
        onChange={(e) => onChange({ ...filter, difficulty: e.target.value as FilterState['difficulty'] })}
      >
        <option value="all">Any difficulty</option>
        <option value="easy">Easy only</option>
        <option value="medium">Medium only</option>
        <option value="hard">Hard only</option>
        <option value="unlabeled">Unlabeled only</option>
      </select>
      <select
        className="select"
        aria-label="Filter by answer"
        value={filter.answer}
        onChange={(e) => onChange({ ...filter, answer: e.target.value as FilterState['answer'] })}
      >
        <option value="all">Any answer</option>
        <option value="correct">Correct only</option>
        <option value="blank">Blank only</option>
        <option value="wrong">Wrong only</option>
        <option value="unanswered">Unanswered only</option>
      </select>
      <input
        className="input"
        style={{ maxWidth: 130 }}
        placeholder="Question #"
        aria-label="Filter by question number"
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
      />
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => onChange(EMPTY_FILTER)}>
        Reset filters
      </button>
    </div>
  );
}

function QuickNav({
  focused,
  onJump,
}: {
  focused: number;
  onJump: (q: number) => void;
}): JSX.Element {
  return (
    <div className="row row-wrap" style={{ gap: 6 }}>
      {SUBJECTS.map((s) => (
        <button
          key={s.id}
          className={`btn btn-sm${subjectForQuestion(focused).id === s.id ? ' btn-primary' : ' btn-ghost'}`}
          type="button"
          onClick={() => {
            onJump(s.startQuestion);
            document.getElementById(`q-${s.startQuestion}`)?.focus();
          }}
        >
          {s.nameEn} · <span className="fa">{s.nameFa}</span> {s.startQuestion}–{s.endQuestion}
        </button>
      ))}
    </div>
  );
}

function JumpInput({ onJump }: { onJump: (q: number) => void }): JSX.Element {
  const [value, setValue] = useState('');
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(value);
        if (Number.isInteger(n) && n >= 1 && n <= TOTAL_QUESTION_COUNT) {
          onJump(n);
          document.getElementById(`q-${n}`)?.focus();
          setValue('');
        }
      }}
    >
      <input
        className="input"
        style={{ maxWidth: 90 }}
        inputMode="numeric"
        placeholder="Go to #"
        aria-label="Jump to question"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="btn btn-sm btn-ghost" type="submit">
        Jump
      </button>
    </form>
  );
}

function SubjectSection({
  subjectId,
  answers,
  filter,
  readOnly,
  focused,
  onFocus,
  onAnswer,
  onDifficulty,
}: {
  subjectId: SubjectId;
  answers: AnswerMap;
  filter: FilterState;
  readOnly: boolean;
  focused: number;
  onFocus: (q: number) => void;
  onAnswer: (q: number, v: AnswerState | null) => void;
  onDifficulty: (q: number, v: Difficulty | null) => void;
}): JSX.Element {
  const subject = SUBJECTS.find((s) => s.id === subjectId)!;
  const questions: number[] = [];
  for (let q = subject.startQuestion; q <= subject.endQuestion; q += 1) questions.push(q);

  let correct = 0;
  let wrong = 0;
  let blank = 0;
  let unset = 0;
  let easy = 0;
  let medium = 0;
  let hard = 0;
  for (const q of questions) {
    const e = answers[q] ?? {};
    if (e.answer === 'correct') correct += 1;
    else if (e.answer === 'wrong') wrong += 1;
    else if (e.answer === 'blank') blank += 1;
    else unset += 1;
    if (e.difficulty === 'easy') easy += 1;
    else if (e.difficulty === 'medium') medium += 1;
    else if (e.difficulty === 'hard') hard += 1;
  }

  const visible = questions.filter((q) => matchesFilter(q, answers[q] ?? {}, filter));

  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <header
        className="row spread row-wrap"
        style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', gap: 10 }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 550 }}>
            {subject.nameEn} <span className="fa muted">{subject.nameFa}</span>
          </div>
          <div className="tiny faint mono" data-testid={`range-${subject.id}`}>
            Questions {subject.startQuestion}–{subject.endQuestion} · {subject.questionCount} · coefficient{' '}
            {subject.coefficient}
          </div>
        </div>
        <div className="row row-wrap tiny" style={{ gap: 6 }}>
          <Chip tone={correct + wrong + blank === subject.questionCount ? 'ok' : undefined}>
            C{correct} W{wrong} B{blank} —{unset}
          </Chip>
          <Chip>
            E{easy} M{medium} H{hard}
          </Chip>
          <Chip tone={easy + medium + hard === subject.questionCount ? 'ok' : undefined}>
            labels {easy + medium + hard}/{subject.questionCount}
          </Chip>
        </div>
      </header>
      {visible.length === 0 ? (
        <div style={{ padding: 20 }} className="tiny faint">
          No questions match the current filter.
        </div>
      ) : (
        <div>
          {visible.map((q) => (
            <QuestionRow
              key={q}
              questionNumber={q}
              entry={answers[q] ?? {}}
              readOnly={readOnly}
              focused={focused === q}
              onFocus={() => onFocus(q)}
              onAnswer={onAnswer}
              onDifficulty={onDifficulty}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function QuestionRow({
  questionNumber,
  entry,
  readOnly,
  focused,
  onFocus,
  onAnswer,
  onDifficulty,
}: {
  questionNumber: number;
  entry: QuestionEntry;
  readOnly: boolean;
  focused: boolean;
  onFocus: () => void;
  onAnswer: (q: number, v: AnswerState | null) => void;
  onDifficulty: (q: number, v: Difficulty | null) => void;
}): JSX.Element {
  return (
    <div
      className="row row-wrap"
      id={`q-${questionNumber}`}
      tabIndex={-1}
      onFocus={onFocus}
      style={{
        gap: 12,
        padding: '9px 16px',
        borderBottom: '1px solid var(--line)',
        background: focused ? 'rgba(255,255,255,0.035)' : undefined,
        outline: 'none',
      }}
    >
      <div className="mono" style={{ minWidth: 34, fontSize: 12, color: 'var(--ink-dim)' }}>
        {questionNumber}
      </div>

      <div className="choice-group" role="group" aria-label={`Question ${questionNumber} answer`}>
        {ANSWER_ORDER.map((value) => (
          <button
            key={value}
            type="button"
            className={`choice choice-answer choice-${value}${entry.answer === value ? ' selected' : ''}`}
            aria-pressed={entry.answer === value}
            disabled={readOnly}
            onClick={() => onAnswer(questionNumber, entry.answer === value ? null : value)}
          >
            {ANSWER_LABELS[value].en}
            <span className="fa choice-fa">{ANSWER_LABELS[value].fa}</span>
          </button>
        ))}
      </div>

      <div className="row row-wrap" style={{ gap: 6 }}>
        <span className="tiny faint" style={{ minWidth: 62 }}>
          Difficulty
        </span>
        <div className="choice-group" role="group" aria-label={`Question ${questionNumber} difficulty`}>
          {DIFFICULTY_ORDER_UI.map((value) => (
            <button
              key={value}
              type="button"
              className={`choice choice-diff choice-diff-${value}${entry.difficulty === value ? ' selected' : ''}`}
              aria-pressed={entry.difficulty === value}
              disabled={readOnly}
              onClick={() => onDifficulty(questionNumber, entry.difficulty === value ? null : value)}
            >
              {DIFFICULTY_LABELS[value].en}
              <span className="fa choice-fa">{DIFFICULTY_LABELS[value].fa}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PastePanel({
  answers,
  onApply,
}: {
  answers: AnswerMap;
  onApply: (map: AnswerMap) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [applied, setApplied] = useState(false);
  const parsed = useMemo(() => parseAnswerKey(text), [text]);

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="eyebrow">Paste entry</div>
      <p className="tiny faint" style={{ maxWidth: '62ch' }}>
        One question per line: <span className="mono">12 c e</span>, or{' '}
        <span className="mono">12: wrong, hard</span>. Answers and difficulties are read
        independently, so a line may carry only one of them. Nothing is written until you apply.
      </p>
      <textarea
        className="textarea mono"
        rows={5}
        aria-label="Paste answer key text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setApplied(false);
        }}
      />
      <div className="row row-wrap tiny" style={{ gap: 10 }}>
        <span>
          {parsed.answers.length} answers · {parsed.difficulties.length} labels ·{' '}
          {parsed.questions.length} questions
        </span>
        {parsed.unrecognized.length > 0 ? (
          <span className="neg">skipped: {parsed.unrecognized.join(' | ')}</span>
        ) : null}
        {applied ? <span className="pos">applied</span> : null}
      </div>
      {parsed.questions.length > 0 ? <PastePreview parsed={parsed} answers={answers} onApply={onApply} onApplied={() => setApplied(true)} /> : null}
    </div>
  );
}

const PREVIEW_LIMIT = 12;

function PastePreview({
  parsed,
  answers,
  onApply,
  onApplied,
}: {
  parsed: ReturnType<typeof parseAnswerKey>;
  answers: AnswerMap;
  onApply: (map: AnswerMap) => void;
  onApplied: () => void;
}): JSX.Element {
  const rows = parsed.questions.slice(0, PREVIEW_LIMIT);

  /**
   * Merges rather than replaces: a paste containing answers only must not wipe
   * every difficulty label already entered.
   */
  const merged = useMemo(() => {
    const next: AnswerMap = {};
    for (let q = 1; q <= TOTAL_QUESTION_COUNT; q += 1) next[q] = { ...(answers[q] ?? {}) };
    for (const a of parsed.answers) next[a.question] = { ...next[a.question], answer: a.value };
    for (const d of parsed.difficulties) next[d.question] = { ...next[d.question], difficulty: d.value };
    return next;
  }, [parsed, answers]);

  const changes = useMemo(() => {
    const list: { question: number; field: string; from: string; to: string }[] = [];
    for (const q of parsed.questions) {
      const before = answers[q] ?? {};
      const a = parsed.answers.find((x) => x.question === q);
      const d = parsed.difficulties.find((x) => x.question === q);
      if (a && (before.answer ?? null) !== a.value) {
        list.push({ question: q, field: 'answer', from: before.answer ?? 'unset', to: a.value });
      }
      if (d && (before.difficulty ?? null) !== d.value) {
        list.push({ question: q, field: 'difficulty', from: before.difficulty ?? 'unset', to: d.value });
      }
    }
    return list;
  }, [parsed, answers, merged]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th className="n">#</th>
              <th>Answer</th>
              <th>Difficulty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q}>
                <td className="n">{q}</td>
                <td>{parsed.answers.find((a) => a.question === q)?.value ?? <span className="faint">—</span>}</td>
                <td>
                  {parsed.difficulties.find((d) => d.question === q)?.value ?? (
                    <span className="faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {parsed.questions.length > rows.length ? (
        <div className="tiny faint">…and {parsed.questions.length - rows.length} more</div>
      ) : null}
      <div className="tiny faint">
        {changes.length} change{changes.length === 1 ? '' : 's'} to existing selections. Everything
        else is left untouched.
      </div>
      <button
        className="btn btn-sm btn-primary"
        type="button"
        disabled={changes.length === 0}
        onClick={() => {
          onApply(merged);
          onApplied();
        }}
      >
        Apply {changes.length} change{changes.length === 1 ? '' : 's'}
      </button>
    </div>
  );
}