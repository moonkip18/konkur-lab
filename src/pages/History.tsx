import { useMemo, useState } from 'react';
import {
  SUBJECTS,
  TOTAL_COEFFICIENT,
  formatDate,
  formatIndex,
  formatPercent,
} from '../lib/scoring';
import { suggestNextExamDate } from '../lib/examCadence';
import {
  deleteExam,
  describeStorageError,
  reopenExam,
  setArchived,
} from '../lib/db/examRepo';
import { useApp } from '../state/AppContext';
import { Chip, DateText, Empty, EstimationDisclaimer, Note, StatusTag } from '../components/primitives';
import { ScoreBreakdown } from '../components/ScoreBreakdown';

export function History(): JSX.Element {
  const { exams, settings, refresh } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const sorted = useMemo(
    () => [...exams].sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1)),
    [exams],
  );

  const suggestion = useMemo(
    () => suggestNextExamDate(exams.map((e) => e.date), settings.examIntervalDays),
    [exams, settings.examIntervalDays],
  );

  const remove = async (id: string): Promise<void> => {
    setError(null);
    try {
      await deleteExam(id);
      refresh();
      setMessage('Exam deleted. Remaining scores are unchanged — history never feeds the model.');
    } catch (e) {
      setError(describeStorageError(e));
    }
  };

  const toggleArchive = async (id: string, archived: boolean): Promise<void> => {
    setError(null);
    try {
      await setArchived(id, archived);
      refresh();
    } catch (e) {
      setError(describeStorageError(e));
    }
  };

  const reopen = async (id: string): Promise<void> => {
    setError(null);
    try {
      await reopenExam(id);
      refresh();
      setMessage('Reopened. The stored score was cleared and the revision recorded.');
    } catch (e) {
      setError(describeStorageError(e));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>History</h1>
        <p>
          Every exam stored on this device, newest first. Scores are frozen at completion; deleting
          or editing one never changes another.
        </p>
        <EstimationDisclaimer />
      </div>

      {error ? (
        <div style={{ marginBottom: 14 }}>
          <Note warn>
            <strong>Action failed.</strong> {error}
          </Note>
        </div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 14 }}>
          <Note>{message}</Note>
        </div>
      ) : null}

      {suggestion ? (
        <div className="row" style={{ marginBottom: 16 }}>
          <Chip tone="accent">
            Next exam suggested for {suggestion} ({settings.examIntervalDays} days after the most
            recent exam). Not created automatically.
          </Chip>
        </div>
      ) : null}

      {exams.length === 0 ? (
        <Empty title="No exams stored">
          Nothing has been entered yet. Use Apply Exam to create your first draft.
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {sorted.map((exam) => {
            const result = exam.result;
            const open = expanded === exam.id;
            return (
              <div className="card" key={exam.id} id={`exam-${exam.id}`}>
                <div className="row spread row-wrap" style={{ gap: 14 }}>
                  <div>
                    <div className="row row-wrap" style={{ gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 550 }}>
                        <DateText iso={exam.date} mode={settings.dateDisplay} />
                      </span>
                      <StatusTag status={exam.status} />
                      <Chip>{exam.provider}</Chip>
                      {exam.revision > 0 ? <Chip>revision {exam.revision}</Chip> : null}
                    </div>
                    <div className="tiny faint mono" style={{ marginTop: 4 }}>
                      {exam.id} · profile {exam.profileVersion} · engine {exam.engineVersion}
                    </div>
                    {exam.notes ? <div className="tiny muted" style={{ marginTop: 4 }}>{exam.notes}</div> : null}
                  </div>

                  <div className="row row-wrap" style={{ gap: 22 }}>
                    {result ? (
                      <>
                        <div>
                          <div className="metric" style={{ fontSize: 17 }}>
                            {formatPercent(result.raw.weightedRawScore)}
                          </div>
                          <div className="metric-label">Weighted raw</div>
                        </div>
                        <div>
                          <div className="metric" style={{ fontSize: 17 }}>
                            {formatIndex(result.adjusted.overallIndex)}
                          </div>
                          <div className="metric-label">Personal index</div>
                        </div>
                      </>
                    ) : (
                      <div>
                        <div className="metric" style={{ fontSize: 17 }}>
                          draft
                        </div>
                        <div className="metric-label">not scored</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="row row-wrap" style={{ gap: 8, marginTop: 14 }}>
                  <button
                    className="btn btn-sm btn-ghost"
                    type="button"
                    disabled={!result}
                    onClick={() => setExpanded(open ? null : exam.id)}
                  >
                    {open ? 'Hide breakdown' : 'Score breakdown'}
                  </button>
                  {exam.status === 'completed' ? (
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => void toggleArchive(exam.id, true)}>
                      Archive
                    </button>
                  ) : null}
                  {exam.status === 'archived' ? (
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => void toggleArchive(exam.id, false)}>
                      Unarchive
                    </button>
                  ) : null}
                  {exam.status !== 'draft' ? (
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => void reopen(exam.id)}>
                      Reopen
                    </button>
                  ) : null}
                  <div style={{ flex: 1 }} />
                  {confirmClear === exam.id ? (
                    <>
                      <span className="tiny faint">Type DELETE to confirm:</span>
                      <input
                        className="input"
                        style={{ maxWidth: 120 }}
                        aria-label={`Confirm delete ${exam.id}`}
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        autoFocus
                      />
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        disabled={confirmText !== 'DELETE'}
                        onClick={() => {
                          void remove(exam.id);
                          setConfirmText('');
                          setConfirmClear(null);
                        }}
                      >
                        Confirm delete
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        type="button"
                        onClick={() => {
                          setConfirmText('');
                          setConfirmClear(null);
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-sm btn-danger"
                      type="button"
                      onClick={() => setConfirmClear(exam.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>

                {open && result ? (
                  <div style={{ marginTop: 16 }}>
                    <ScoreBreakdown exam={exam} mode={settings.dateDisplay} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <section className="section">
        <div className="section-title">
          <h2>Structure</h2>
          <span>fixed</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Subject</th>
                <th className="n">Questions</th>
                <th className="n">Coefficient</th>
                <th className="n">Weight per question</th>
              </tr>
            </thead>
            <tbody>
              {SUBJECTS.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.nameEn} <span className="fa muted">{s.nameFa}</span>
                  </td>
                  <td className="n">{s.questionCount}</td>
                  <td className="n">{s.coefficient}×</td>
                  <td className="n">{((s.coefficient * 100) / s.questionCount / TOTAL_COEFFICIENT).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tiny faint" style={{ marginTop: 8 }}>
          Subject percentages are never averaged equally: each is weighted by its coefficient share of
          the {TOTAL_COEFFICIENT} total.
        </div>
      </section>
    </div>
  );
}

export function formatHistoryDate(iso: string, mode: 'gregorian' | 'jalali'): string {
  return formatDate(iso, mode);
}