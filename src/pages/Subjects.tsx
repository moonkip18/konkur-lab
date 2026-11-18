import { useMemo, useState } from 'react';
import {
  DIFFICULTY_ORDER,
  PROFILE_V1,
  SMALL_SAMPLE_THRESHOLD,
  SUBJECTS,
  formatIndex,
  formatPercent,
  formatPoints,
  type Difficulty,
  type SubjectId,
} from '../lib/scoring';
import { trendExams } from '../lib/db/examRepo';
import { buildPoints } from '../lib/chartData';
import { useApp } from '../state/AppContext';
import { DateText, Empty, EstimationDisclaimer, Note } from '../components/primitives';
import { INDEX_COLOR, SUBJECT_COLOR, TrendChart } from '../components/charts';
import { ScoreExplainer } from '../components/ScoreExplainer';

export function Subjects(): JSX.Element {
  const { exams, settings } = useApp();
  const [selected, setSelected] = useState<SubjectId>('math');
  const points = useMemo(
    () => buildPoints(exams, settings.dateDisplay),
    [exams, settings.dateDisplay],
  );
  const included = useMemo(() => {
    const ids = new Set(trendExams(exams, settings.includeArchivedInTrends).map((e) => e.id));
    return points.filter((p) => ids.has(p.examId));
  }, [points, exams, settings.includeArchivedInTrends]);

  if (included.length === 0) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Subjects</h1>
          <p>Per-subject history, broken down by the labels you entered.</p>
        </div>
        <Empty title="No completed exams yet">
          Subject pages fill in once an exam is completed.
        </Empty>
      </div>
    );
  }

  const profile = exams[0]?.profileSnapshot ?? PROFILE_V1;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Subjects</h1>
        <p>Each subject's raw net, difficulty-adjusted index, and question-level breakdown.</p>
        <EstimationDisclaimer />
      </div>

      <div className="row row-wrap" style={{ gap: 8, marginBottom: 20 }}>
        {SUBJECTS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`btn btn-sm${s.id === selected ? ' btn-primary' : ' btn-ghost'}`}
            onClick={() => setSelected(s.id)}
          >
            {s.nameEn} <span className="fa">{s.nameFa}</span> · {s.coefficient}×
          </button>
        ))}
      </div>

      <SubjectDetail subjectId={selected} />

      <section className="section">
        <div className="section-title">
          <h2>All subjects: index comparison</h2>
          <span>τ over time</span>
        </div>
        <TrendChart
          data={included.map((p) => ({
            date: p.label,
            math: p.subjects.math.index,
            physics: p.subjects.physics.index,
            chemistry: p.subjects.chemistry.index,
          }))}
          xKey="date"
          series={SUBJECTS.map((s) => ({
            key: s.id,
            label: `${s.nameEn} τ`,
            color: SUBJECT_COLOR[s.id],
            axis: 'right' as const,
          }))}
          leftSuffix=""
          rightSuffix=""
          height={250}
        />
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Assumptions behind the index</h2>
          <span>fixed model</span>
        </div>
        <ScoreExplainer profile={profile} />
      </section>
    </div>
  );
}

function SubjectDetail({ subjectId }: { subjectId: SubjectId }): JSX.Element {
  const { exams, settings } = useApp();
  const subject = SUBJECTS.find((s) => s.id === subjectId)!;
  const included = useMemo(() => {
    const ids = new Set(trendExams(exams, settings.includeArchivedInTrends).map((e) => e.id));
    return buildPoints(exams, settings.dateDisplay).filter((p) => ids.has(p.examId));
  }, [exams, settings]);

  const rows = included.map((p) => ({ date: p.label, ...p.subjects[subjectId] }));
  const latestSub = included.length > 0 ? included[included.length - 1]!.subjects[subjectId] : null;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <div className="grid-cell">
          <div className="metric">{formatPercent(latestSub?.rawNet)}</div>
          <div className="metric-label">Latest raw net</div>
        </div>
        <div className="grid-cell">
          <div className="metric">{formatIndex(latestSub?.index)}</div>
          <div className="metric-label">Latest τ</div>
        </div>
        <div className="grid-cell">
          <div className="metric">{formatPercent(latestSub?.expectedNet)}</div>
          <div className="metric-label">Latest expected net</div>
        </div>
        <div className="grid-cell">
          <div
            className={`metric ${
              latestSub && latestSub.performance > 0
                ? 'pos'
                : latestSub && latestSub.performance < 0
                  ? 'neg'
                  : ''
            }`}
          >
            {formatPoints(latestSub?.performance ?? null)}
          </div>
          <div className="metric-label">Latest deviation</div>
        </div>
        <div className="grid-cell">
          <div className="metric">
            {latestSub
              ? `${latestSub.difficultyCounts.easy}/${latestSub.difficultyCounts.medium}/${latestSub.difficultyCounts.hard}`
              : '—'}
          </div>
          <div className="metric-label">E / M / H labels</div>
          <div className="metric-sub">of {subject.questionCount} questions</div>
        </div>
        <div className="grid-cell">
          <div className="metric">
            {latestSub ? ((latestSub.coefficient * latestSub.rawNet) / 28).toFixed(2) : '—'}
          </div>
          <div className="metric-label">Contribution to weighted raw</div>
          <div className="metric-sub">({subject.coefficient} × raw) / 28</div>
        </div>
      </div>

      <Note>
        <strong>{subject.nameEn} coefficient {subject.coefficient}.</strong> The subject index answers
        "how far did {subject.nameEn} land above or below the model's expected score for this exam's
        own {subject.questionCount}-question difficulty mix?" It is not a standalone grade.
      </Note>

      <div>
        <div className="section-title">
          <h2>Raw net and τ over time</h2>
          <span>two axes</span>
        </div>
        <TrendChart
          data={rows}
          xKey="date"
          series={[
            { key: 'rawNet', label: 'Raw net %', color: SUBJECT_COLOR[subjectId], axis: 'left' },
            { key: 'expectedNet', label: 'Expected net %', color: SUBJECT_COLOR[subjectId], axis: 'left', dashed: true, faint: true },
            { key: 'index', label: 'τ', color: INDEX_COLOR, axis: 'right' },
          ]}
          leftDomain={[-40, 100]}
          height={250}
        />
      </div>

      <div>
        <div className="section-title">
          <h2>Deviation from expectation</h2>
          <span>percentage points</span>
        </div>
        <TrendChart
          data={rows}
          xKey="date"
          series={[{ key: 'performance', label: 'Raw − expected (pp)', color: INDEX_COLOR, axis: 'left' }]}
          leftDomain={[-60, 60]}
          height={220}
        />
      </div>

      <div>
        <div className="section-title">
          <h2>Correct / wrong / blank</h2>
          <span>{subject.questionCount} questions per exam</span>
        </div>
        <TrendChart
          data={rows}
          xKey="date"
          series={[
            { key: 'correct', label: 'Correct', color: '#7fb069', axis: 'left' },
            { key: 'wrong', label: 'Wrong', color: '#c8433c', axis: 'left' },
            { key: 'blank', label: 'Blank', color: '#565a61', axis: 'left' },
          ]}
          leftDomain={[0, subject.questionCount]}
          leftTicks={6}
          height={220}
        />
      </div>

      <div>
        <div className="section-title">
          <h2>By difficulty band</h2>
          <span>net %, accuracy, attempt rate</span>
        </div>
        <TrendChart
          data={included.map((p) => {
            const row: Record<string, unknown> = { date: p.label };
            for (const d of DIFFICULTY_ORDER) {
              row[`${d}_net`] = p.difficultyNet[subjectId][d];
            }
            return row;
          })}
          xKey="date"
          series={DIFFICULTY_ORDER.map((d) => ({
            key: `${d}_net`,
            label: `${d} net %`,
            color: d === 'easy' ? '#7fb069' : d === 'medium' ? '#d9a441' : '#c8433c',
            axis: 'left' as const,
          }))}
          leftDomain={[-40, 100]}
          height={230}
        />
        <div style={{ height: 14 }} />
        <TrendChart
          data={included.map((p) => {
            const row: Record<string, unknown> = { date: p.label };
            for (const d of DIFFICULTY_ORDER) {
              row[`${d}_acc`] = p.accuracyBySubjectDifficulty[subjectId][d];
            }
            return row;
          })}
          xKey="date"
          series={DIFFICULTY_ORDER.map((d) => ({
            key: `${d}_acc`,
            label: `${d} accuracy %`,
            color: d === 'easy' ? '#7fb069' : d === 'medium' ? '#d9a441' : '#c8433c',
            axis: 'left' as const,
          }))}
          leftDomain={[0, 100]}
          height={220}
        />
        <div style={{ height: 14 }} />
        <TrendChart
          data={included.map((p) => {
            const row: Record<string, unknown> = { date: p.label };
            for (const d of DIFFICULTY_ORDER) {
              row[`${d}_att`] = p.attemptRateBySubjectDifficulty[subjectId][d];
            }
            return row;
          })}
          xKey="date"
          series={DIFFICULTY_ORDER.map((d) => ({
            key: `${d}_att`,
            label: `${d} attempt rate %`,
            color: d === 'easy' ? '#7fb069' : d === 'medium' ? '#d9a441' : '#c8433c',
            axis: 'left' as const,
          }))}
          leftDomain={[0, 100]}
          height={220}
        />
        <div className="legend">
          {DIFFICULTY_ORDER.map((d) => (
            <span key={d}>
              <i
                style={{
                  background: d === 'easy' ? '#7fb069' : d === 'medium' ? '#d9a441' : '#c8433c',
                }}
              />
              {d} — net %, then accuracy, then attempt rate
            </span>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th className="n">E</th>
              <th className="n">M</th>
              <th className="n">H</th>
              <th className="n">Expected</th>
              <th className="n">Raw</th>
              <th className="n">Deviation</th>
              <th className="n">τ</th>
              <th className="n">Weighted contribution</th>
            </tr>
          </thead>
          <tbody>
            {included.map((p) => {
              const sub = p.subjects[subjectId];
              return (
                <tr key={p.examId}>
                  <td>
                    <DateText iso={p.date} mode={settings.dateDisplay} />
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
                  <td className="n">{((sub.coefficient * sub.rawNet) / 28).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="tiny faint">
        Bands with fewer than {SMALL_SAMPLE_THRESHOLD} questions are unreliable and appear as gaps on
        the difficulty charts rather than as misleading percentages.
      </div>
    </div>
  );
}

export type { Difficulty };