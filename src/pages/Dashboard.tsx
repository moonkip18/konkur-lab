import { useMemo, useState } from 'react';
import {
  SUBJECTS,
  formatDate,
  formatIndex,
  formatPercent,
  formatPoints,
} from '../lib/scoring';
import { PROFILE_V1 } from '../lib/scoring';
import { trendExams } from '../lib/db/examRepo';
import { pointFor, withRolling } from '../lib/chartData';
import { useApp } from '../state/AppContext';
import { Chip, DateText, Empty, EstimationDisclaimer, KeyValue, Note } from '../components/primitives';
import { ScoreBreakdown } from '../components/ScoreBreakdown';
import { TrendChart, RAW_COLOR, INDEX_COLOR, SUBJECT_COLOR } from '../components/charts';
import { ScoreExplainer } from '../components/ScoreExplainer';
import { ShareCard } from '../components/ShareCard';

export function Dashboard(): JSX.Element {
  const { exams, settings } = useApp();
  const done = useMemo(() => trendExams(exams, false), [exams]);
  const [showExplainer, setShowExplainer] = useState(false);

  // Hooks run before the empty-state return so hook order never changes.
  const weightedTrend = useMemo(
    () => done.map((e) => pointFor(e, settings.dateDisplay)),
    [done, settings.dateDisplay],
  );
  const rolling = useMemo(
    () => withRolling(weightedTrend, (row) => row.overallIndex, 3),
    [weightedTrend],
  );
  const indexSeries = useMemo(
    () =>
      weightedTrend.map((row, i) => ({
        date: row.label,
        overallIndex: row.overallIndex,
        rolling3: rolling[i]?.value ?? null,
      })),
    [weightedTrend, rolling],
  );

  if (done.length === 0) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Dashboard</h1>
          <p>Raw and difficulty-adjusted results for your completed exams.</p>
        </div>
        <Empty title="No completed exams yet">
          This dashboard stays empty until you enter an exam. Open Apply Exam, create a draft,
          record all 95 answers with their Maz difficulty labels, then complete it. Nothing is
          pre-filled and no sample results are shown.
        </Empty>
      </div>
    );
  }

  const latest = done[done.length - 1]!;
  const previous = done.length >= 2 ? done[done.length - 2]! : null;
  const p = pointFor(latest, settings.dateDisplay);
  const prevPoint = previous ? pointFor(previous, settings.dateDisplay) : null;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <p>
          Latest completed exam: <DateText iso={latest.date} mode={settings.dateDisplay} />
          {previous ? (
            <>
              {' · previous '}
              <DateText iso={previous.date} mode={settings.dateDisplay} />
            </>
          ) : (
            ' · first completed exam'
          )}
        </p>
        <EstimationDisclaimer />
      </div>

      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-title">
          <h2 data-testid="raw-performance">Raw performance</h2>
          <span>what you actually scored</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {SUBJECTS.map((s) => {
            const sub = p.subjects[s.id];
            const before = prevPoint?.subjects[s.id];
            const delta = before ? sub.rawNet - before.rawNet : null;
            return (
              <div className="grid-cell" key={s.id}>
                <div className="metric">{formatPercent(sub.rawNet)}</div>
                <div className="metric-label">
                  {s.nameEn} <span className="fa">{s.nameFa}</span>
                </div>
                <div className="metric-sub">
                  C{sub.correct} W{sub.wrong} B{sub.blank} · Δ{' '}
                  {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`}
                </div>
              </div>
            );
          })}
          <div className="grid-cell">
            <div className="metric">{formatPercent(p.rawWeighted)}</div>
            <div className="metric-label">Weighted raw (12/9/7)</div>
            <div className="metric-sub">all 95, coefficient-weighted</div>
          </div>
          <div className="grid-cell">
            <div className="metric">{formatPercent(p.accuracy, 1)}</div>
            <div className="metric-label">Accuracy when attempted</div>
            <div className="metric-sub">{p.attempted} of 95 attempted</div>
          </div>
          <div className="grid-cell">
            <div className="metric">{formatPercent(p.attemptRate, 1)}</div>
            <div className="metric-label">Attempt rate</div>
            <div className="metric-sub">{p.correct} correct · {p.wrong} wrong · {p.blank} blank</div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2 data-testid="adjusted-index">
            Difficulty-adjusted · <span className="fa">تراز شخصی تخمینی</span>
          </h2>
          <span>relative to this exam's own difficulty mix</span>
        </div>
        <Note>
          <strong>Not an official تراز.</strong> These indices measure how far each subject landed
          above or below a fixed model's expected score <em>for this exam's difficulty labels</em>.
          They are not a percentile, a rank, or an estimate of national standing.{' '}
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            style={{ marginLeft: 6 }}
            onClick={() => setShowExplainer((v) => !v)}
          >
            {showExplainer ? 'Hide explanation' : 'How this is calculated'}
          </button>
        </Note>
        {showExplainer ? (
          <div style={{ marginTop: 12 }}>
            <ScoreExplainer profile={PROFILE_V1} />
          </div>
        ) : null}

        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 12 }}
        >
          {SUBJECTS.map((s) => {
            const sub = p.subjects[s.id];
            return (
              <div className="grid-cell" key={s.id}>
                <div className="metric">{formatIndex(sub.index)}</div>
                <div className="metric-label">
                  {s.nameEn} <span className="fa">{s.nameFa}</span> τ
                </div>
                <div className="metric-sub">
                  raw {formatPercent(sub.rawNet, 1)} · expected {formatPercent(sub.expectedNet, 1)}
                </div>
                <div className={`metric-sub ${sub.performance > 0 ? 'pos' : sub.performance < 0 ? 'neg' : ''}`}>
                  {formatPoints(sub.performance)} vs expectation
                </div>
              </div>
            );
          })}
          <div className="grid-cell" data-testid="overall-index-card" style={{ background: 'rgba(200,67,59,0.05)' }}>
            <div className="metric metric-accent metric-lg">{formatIndex(p.overallIndex)}</div>
            <div className="metric-label">Overall personal index</div>
            <div className="metric-sub">
              T = (12τm + 9τp + 7τc) / 28 · A = {PROFILE_V1.A.toLocaleString('en-US')} at expectation
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Difficulty mix and expectations</h2>
          <span>from the labels entered for this exam</span>
        </div>
        <div className="table-wrap">
          <table className="data" data-testid="difficulty-mix-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th className="n">Easy</th>
                <th className="n">Medium</th>
                <th className="n">Hard</th>
                <th className="n">Expected net</th>
                <th className="n">Raw net</th>
                <th className="n">vs expectation</th>
                <th className="n">τ</th>
              </tr>
            </thead>
            <tbody>
              {SUBJECTS.map((s) => {
                const sub = p.subjects[s.id];
                return (
                  <tr key={s.id}>
                    <td>
                      {s.nameEn} <span className="fa muted">{s.nameFa}</span>
                    </td>
                    <td className="n">{sub.difficultyCounts.easy}</td>
                    <td className="n">{sub.difficultyCounts.medium}</td>
                    <td className="n">{sub.difficultyCounts.hard}</td>
                    <td className="n">{formatPercent(sub.expectedNet)}</td>
                    <td className="n">{formatPercent(sub.rawNet)}</td>
                    <td className={`n ${sub.performance > 0 ? 'pos' : sub.performance < 0 ? 'neg' : ''}`}>
                      {formatPoints(sub.performance)}
                    </td>
                    <td className="n">{formatIndex(sub.index)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>How this exam came apart</h2>
          <span>full derivation</span>
        </div>
        <ScoreBreakdown exam={latest} mode={settings.dateDisplay} />
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Recent trend</h2>
          <span>{done.length} completed exam{done.length === 1 ? '' : 's'}</span>
        </div>
        {done.length < 2 ? (
          <Note>Two or more completed exams are needed for a trend. Gaps stay gaps — no zero is inserted.</Note>
        ) : (
          <>
            <TrendChart
              data={indexSeries}
              xKey="date"
              series={[
                { key: 'overallIndex', label: 'Overall personal index', color: INDEX_COLOR, axis: 'right' },
                { key: 'rolling3', label: '3-exam rolling average', color: INDEX_COLOR, axis: 'right', dashed: true, faint: true },
              ]}
              leftSuffix=""
              rightSuffix=""
              height={240}
            />
            <div className="tiny faint" style={{ marginTop: 6 }}>
              Rolling average uses the most recent {rolling[rolling.length - 1]?.windowSize ?? 0} exam
              {rolling[rolling.length - 1]?.windowSize === 1 ? '' : 's'}. It never changes a stored
              score.
            </div>
          </>
        )}
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Raw vs adjusted, side by side</h2>
          <span>separate axes</span>
        </div>
        <TrendChart
          data={weightedTrend.map((row) => ({
            date: row.label,
            weighted: row.rawWeighted,
            overall: row.rawNetOverall,
          }))}
          xKey="date"
          series={[
            { key: 'weighted', label: 'Weighted raw (%)', color: RAW_COLOR, axis: 'left' },
            { key: 'overall', label: 'Raw net all 95 (%)', color: SUBJECT_COLOR.physics, axis: 'left', dashed: true },
          ]}
          leftDomain={[-40, 100]}
          height={240}
        />
        <div className="tiny faint" style={{ marginTop: 6 }}>
          Raw percentages only. The difficulty-adjusted index is on its own scale — see Statistics.
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Exam record</h2>
          <span>what produced these numbers</span>
        </div>
        <KeyValue
          items={[
            ['Exam id', latest.id],
            ['Date', formatDate(latest.date, settings.dateDisplay)],
            ['Provider', latest.provider],
            ['Profile', `${latest.profileSnapshot.label} (${latest.profileVersion})`],
            ['Scoring engine', latest.engineVersion],
            ['Revision', String(latest.revision)],
            ['Completed at', latest.completedAt ?? '—'],
          ]}
        />
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <Chip tone="ok">completed</Chip>
          <span className="tiny faint">Scores are frozen at completion. Editing requires an explicit reopen.</span>
        </div>
        <div style={{ marginTop: 14 }}>
          <ShareCard exam={latest} point={p} mode={settings.dateDisplay} />
        </div>
      </section>
    </div>
  );
}