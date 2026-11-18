import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PROFILE_V1,
  SCORING_ENGINE_VERSION,
  SUBJECTS,
  TOTAL_COEFFICIENT,
  TOTAL_QUESTION_COUNT,
  expectedNetPercentages,
  formatPercent,
} from '../lib/scoring';
import { db, getLastBackupAt, setLastBackupAt } from '../lib/db/db';
import { SCHEMA_VERSION } from '../lib/db/models';
import { buildBackup, parseBackup, serialiseBackup, validateBackup } from '../lib/db/backup';
import { examsCsv, questionsCsv } from '../lib/db/csv';
import { describeStorageError } from '../lib/db/examRepo';
import { downloadFile, readFileAsText } from '../lib/storage';
import { daysSince } from '../lib/examCadence';
import { useApp } from '../state/AppContext';
import { Chip, KeyValue, Note } from '../components/primitives';
import { ScoreExplainer } from '../components/ScoreExplainer';

const CLEAR_PHRASE = 'DELETE ALL EXAMS';

export function Settings(): JSX.Element {
  const { exams, settings, setSettings, refresh } = useApp();
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [storageState, setStorageState] = useState<string>('checking…');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof validateBackup> | null>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [clearText, setClearText] = useState('');
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    void (async () => {
      setLastBackup(await getLastBackupAt());
      if (typeof navigator === 'undefined' || !navigator.storage?.persisted) {
        setStorageState('unsupported');
        return;
      }
      try {
        const persisted = await navigator.storage.persisted();
        setStorageState(persisted ? 'granted' : 'not granted');
      } catch {
        setStorageState('unknown');
      }
    })();
  }, []);

  const backupAge = useMemo(() => {
    if (!lastBackup) return null;
    return daysSince(lastBackup.slice(0, 10), new Date().toISOString().slice(0, 10));
  }, [lastBackup]);

  const overdue = backupAge !== null && backupAge > settings.backupReminderDays;

  const exportJson = useCallback(async () => {
    setError(null);
    try {
      const all = await db.exams.toArray();
      const backup = buildBackup(all, {
        settings,
        profiles: [PROFILE_V1],
        now: new Date(),
      });
      downloadFile(`konkur-backup-${new Date().toISOString().slice(0, 10)}.json`, serialiseBackup(backup), 'application/json');
      const now = new Date().toISOString();
      await setLastBackupAt(now);
      setLastBackup(now);
      setMessage(`Exported ${all.length} exam${all.length === 1 ? '' : 's'} to a JSON backup file.`);
    } catch (e) {
      setError(describeStorageError(e));
    }
  }, [settings]);

  const exportQuestions = useCallback(async () => {
    const all = await db.exams.toArray();
    downloadFile(
      `konkur-questions-${new Date().toISOString().slice(0, 10)}.csv`,
      questionsCsv(all),
      'text/csv',
    );
  }, []);

  const exportExams = useCallback(async () => {
    const all = await db.exams.toArray();
    downloadFile(`konkur-exams-${new Date().toISOString().slice(0, 10)}.csv`, examsCsv(all), 'text/csv');
  }, []);

  const onFile = useCallback(async (file: File) => {
    setError(null);
    setMessage(null);
    setPreview(null);
    setPendingImport(null);
    try {
      const text = await readFileAsText(file);
      const { file: parsed, errors } = parseBackup(text);
      if (!parsed) {
        // Not parseable as JSON at all: report it as an error, not a preview.
        const unparsable = errors[0]?.message.includes('not valid JSON') ?? false;
        if (unparsable) {
          setError(errors[0]!.message);
          return;
        }
        // Parseable but invalid: show the full validation report instead.
        setPreview(validateBackup(JSON.parse(text)));
        return;
      }
      setPreview(validateBackup(parsed));
      setPendingImport(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    }
  }, []);

  const commitImport = useCallback(async () => {
    if (!pendingImport) return;
    setError(null);
    try {
      const { file } = parseBackup(pendingImport);
      if (!file) {
        setError('The file failed validation and was not imported.');
        return;
      }
      // Validation passed, so the whole write runs in one transaction: either
      // every exam lands or the database is left exactly as it was.
      await db.transaction('rw', db.exams, async () => {
        await db.exams.clear();
        await db.exams.bulkPut(file.exams);
      });
      if (file.settings) await setSettings(file.settings as typeof settings);
      const now = new Date().toISOString();
      await setLastBackupAt(now);
      setLastBackup(now);
      setPreview(null);
      setPendingImport(null);
      refresh();
      setMessage(`Imported ${file.exams.length} exam${file.exams.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(
        `${describeStorageError(e)} The database was not modified because the import did not complete.`,
      );
    }
  }, [pendingImport, settings, setSettings, refresh]);

  const requestPersistence = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
      setStorageState('unsupported');
      return;
    }
    try {
      const granted = await navigator.storage.persist();
      setStorageState(granted ? 'granted' : 'not granted');
      setMessage(
        granted
          ? 'The browser will try to keep this data through storage pressure.'
          : 'The browser declined persistent storage. Data still works, but may be evicted under pressure — export backups.',
      );
    } catch {
      setStorageState('unknown');
    }
  }, []);

  const clearAll = useCallback(async () => {
    setError(null);
    try {
      await db.exams.clear();
      setClearText('');
      refresh();
      setMessage('All exam data was deleted from this device.');
    } catch (e) {
      setError(describeStorageError(e));
    }
  }, [refresh]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
        <p>Display, storage, backups, and the fixed scoring model. Nothing here changes past scores.</p>
      </div>

      {error ? (
        <div style={{ marginBottom: 14 }}>
          <Note warn>
            <strong>Something went wrong.</strong> {error}
          </Note>
        </div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 14 }}>
          <Note>{message}</Note>
        </div>
      ) : null}

      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-title">
          <h2>Display</h2>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <div className="grid-cell">
            <div className="field">
              <label htmlFor="date-display">Date format</label>
              <select
                id="date-display"
                className="select"
                value={settings.dateDisplay}
                onChange={(e) => void setSettings({ dateDisplay: e.target.value as 'gregorian' | 'jalali' })}
              >
                <option value="gregorian">Gregorian (ISO)</option>
                <option value="jalali">Jalali (شمسی)</option>
              </select>
              <span className="hint">Storage always stays ISO Gregorian; only display changes.</span>
            </div>
          </div>
          <div className="grid-cell">
            <div className="field">
              <label htmlFor="exam-interval">Exam interval (days)</label>
              <input
                id="exam-interval"
                className="input"
                type="number"
                min={1}
                max={120}
                value={settings.examIntervalDays}
                onChange={(e) => void setSettings({ examIntervalDays: Math.max(1, Number(e.target.value) || 14) })}
              />
              <span className="hint">
                Used only to suggest the next date. The default is 14 days. No exam is created
                automatically.
              </span>
            </div>
          </div>
          <div className="grid-cell">
            <div className="field">
              <label htmlFor="provider">Default provider</label>
              <input
                id="provider"
                className="input"
                value={settings.defaultProvider}
                onChange={(e) => void setSettings({ defaultProvider: e.target.value })}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Exam structure</h2>
          <span>fixed defaults</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Subject</th>
                <th className="n">Questions</th>
                <th className="n">Range</th>
                <th className="n">Coefficient</th>
              </tr>
            </thead>
            <tbody>
              {SUBJECTS.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.nameEn} <span className="fa muted">{s.nameFa}</span>
                  </td>
                  <td className="n">{s.questionCount}</td>
                  <td className="n">
                    {s.startQuestion}–{s.endQuestion}
                  </td>
                  <td className="n">{s.coefficient}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row row-wrap" style={{ gap: 8, marginTop: 10 }}>
          <Chip>{TOTAL_QUESTION_COUNT} questions</Chip>
          <Chip>coefficient total {TOTAL_COEFFICIENT}</Chip>
        </div>
        <Note>
          <strong>Why you cannot edit these here.</strong> Changing a coefficient or question range
          would retroactively change the meaning of already-stored scores. Create a new scoring
          profile instead; old exams keep the profile they were scored with.
        </Note>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Scoring profile</h2>
          <span>{PROFILE_V1.version}</span>
        </div>
        <KeyValue
          items={[
            ['Version', PROFILE_V1.version],
            ['Label', PROFILE_V1.label],
            ['Scoring engine', SCORING_ENGINE_VERSION],
            ['Index constants', `A = ${PROFILE_V1.A}, B = ${PROFILE_V1.B}, σ = ${PROFILE_V1.sigma} pp`],
            [
              'Expected net per question',
              `Easy ${formatPercent(expectedNetPercentages(PROFILE_V1).easy)} · Medium ${formatPercent(expectedNetPercentages(PROFILE_V1).medium)} · Hard ${formatPercent(expectedNetPercentages(PROFILE_V1).hard)}`,
            ],
            ['Derived from', 'p and a below, computed — never typed in separately'],
            [
              'Applied to',
              'Every exam identically; your history never changes these numbers',
            ],
          ]}
        />
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => setShowProfile((v) => !v)}>
            {showProfile ? 'Hide full explanation' : 'Show full explanation and limitations'}
          </button>
        </div>
        {showProfile ? (
          <div style={{ marginTop: 12 }}>
            <ScoreExplainer profile={PROFILE_V1} />
          </div>
        ) : null}
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Storage</h2>
          <span>this device only</span>
        </div>
        <KeyValue
          items={[
            ['Location', 'Browser IndexedDB on this device'],
            ['Persistent storage', storageState],
            ['Exams stored', String(exams.length)],
            ['Cloud sync', 'None — there is no server'],
          ]}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-sm" type="button" onClick={() => void requestPersistence()}>
            Request persistent storage
          </button>
        </div>
        <Note warn>
          <strong>A local save is not a backup.</strong> Data exists only in this browser profile.
          Clearing site data, a private window, or a different device means a different (empty)
          database. Export a JSON backup regularly.
        </Note>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Backup</h2>
          <span>reminder every {settings.backupReminderDays} days</span>
        </div>
        <KeyValue
          items={[
            [
              'Last successful backup',
              lastBackup ? `${lastBackup.slice(0, 10)} (${backupAge} day${backupAge === 1 ? '' : 's'} ago)` : 'Never',
            ],
            ['Status', overdue ? 'Overdue' : backupAge === null ? 'No backup yet' : 'Up to date'],
          ]}
        />
        {overdue ? (
          <div style={{ marginTop: 10 }}>
            <Note warn>
              <strong>Backup overdue.</strong> It has been {backupAge} days since your last export.
            </Note>
          </div>
        ) : null}
        <div className="field" style={{ maxWidth: 220, marginTop: 12 }}>
          <label htmlFor="reminder-days">Remind me after (days)</label>
          <input
            id="reminder-days"
            className="input"
            type="number"
            min={1}
            max={365}
            value={settings.backupReminderDays}
            onChange={(e) => void setSettings({ backupReminderDays: Math.max(1, Number(e.target.value) || 14) })}
          />
        </div>
        <div className="row row-wrap" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => void exportJson()}>
            Export JSON backup
          </button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => void exportQuestions()}>
            Export question-level CSV
          </button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => void exportExams()}>
            Export exam-level CSV
          </button>
        </div>
        <div className="tiny faint" style={{ marginTop: 8 }}>
          The question-level CSV has one row per question. The exam-level CSV carries every stored
          result plus the scoring parameters, so both can reproduce the dashboard.
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Restore from JSON</h2>
          <span>preview before writing</span>
        </div>
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="import-file">Backup file</label>
          <input
            id="import-file"
            className="input"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = '';
            }}
          />
          <span className="hint">
            The file is fully validated first. Nothing is written until you confirm, and the write
            happens in one transaction.
          </span>
        </div>

        {preview ? (
          <div style={{ marginTop: 14 }}>
            {preview.ok ? (
              <Note>
                <strong>Preview:</strong> {preview.examCount} exam{preview.examCount === 1 ? '' : 's'},{' '}
                {preview.questionRecords} question records.
                {preview.duplicateDates.length > 0
                  ? ` ${preview.duplicateDates.length} same date+provider conflict${
                      preview.duplicateDates.length === 1 ? '' : 's'
                    } inside the file.`
                  : ' No duplicate date+provider pairs.'}
              </Note>
            ) : (
              <Note warn>
                <strong>This file will not be imported.</strong> {preview.errors.length} validation
                error{preview.errors.length === 1 ? '' : 's'} found. Your existing data is untouched.
              </Note>
            )}
            {preview.errors.length > 0 ? (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Exam</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.slice(0, 40).map((e, i) => (
                      <tr key={i}>
                        <td className="mono tiny">{e.examId ?? `#${String(e.examIndex ?? '?')}`}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {preview.warnings.length > 0 ? (
              <div className="stack-sm tiny faint" style={{ marginTop: 10 }}>
                {preview.warnings.map((w, i) => (
                  <div key={i}>⚠ {w.message}</div>
                ))}
              </div>
            ) : null}
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn btn-sm btn-primary"
                type="button"
                disabled={!preview.ok || !pendingImport}
                onClick={() => void commitImport()}
              >
                Replace all exams with this backup
              </button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => setPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="section">
        <div className="section-title">
          <h2 style={{ color: 'var(--accent)' }}>Clear all data</h2>
          <span>irreversible without a backup</span>
        </div>
        <Note warn>
          <strong>This deletes every exam on this device.</strong> Answers, difficulty labels, and
          stored scores cannot be recovered unless you have exported a backup first. There is no
          server copy.
        </Note>
        <div className="row row-wrap" style={{ gap: 8, marginTop: 12 }}>
          <input
            className="input"
            style={{ maxWidth: 220 }}
            placeholder={CLEAR_PHRASE}
            aria-label={`Type ${CLEAR_PHRASE} to confirm`}
            value={clearText}
            onChange={(e) => setClearText(e.target.value)}
          />
          <button
            className="btn btn-sm btn-danger"
            type="button"
            disabled={clearText !== CLEAR_PHRASE}
            onClick={() => void clearAll()}
          >
            Delete all exam data
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>About the model</h2>
        </div>
        <div className="card-quiet stack-sm small muted" style={{ lineHeight: 1.75 }}>
          <div>
            Raw percentages use the Iranian marking rule: correct +1, wrong −1/3, blank 0. Weighted
            scores apply coefficients {SUBJECTS.map((s) => `${s.nameEn} ${s.coefficient}`).join(', ')}{' '}
            over a total of {TOTAL_COEFFICIENT}.
          </div>
          <div>
            The difficulty-adjusted index (<span className="fa">تراز شخصی تخمینی</span>) is a{' '}
            <strong>personal tracking index</strong>, not an official تراز, percentile, or rank, and
            not an estimate of national standing. It uses no participant data and no statistics from
            other students.
          </div>
          <div>
            The expected-performance parameters (p and a) are fixed modelling assumptions chosen by
            this app. They are not verified Maz or Sanjesh statistics.
          </div>
          <div>
            Dates are stored as ISO Gregorian. Jalali dates are computed for display only.
          </div>
          <div className="tiny faint">
            Scoring engine {SCORING_ENGINE_VERSION} · data schema v{SCHEMA_VERSION}
          </div>
        </div>
      </section>
    </div>
  );
}

export { SETTINGS_KEY } from '../lib/db/models';