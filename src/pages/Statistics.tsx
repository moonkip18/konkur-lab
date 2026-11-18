import { useMemo, useState } from 'react';
import {
  DIFFICULTY_ORDER,
  SMALL_SAMPLE_THRESHOLD,
  SUBJECTS,
  difficultySlice,
  formatPercent,
  formatPoints,
  rollingAverage,
  type Difficulty,
  type SubjectId,
} from '../lib/scoring';
import { trendExams } from '../lib/db/examRepo';
import { buildPoints } from '../lib/chartData';
import { useApp } from '../state/AppContext';
import { DateText, Empty, EstimationDisclaimer, Legend, Note } from '../components/primitives';
import {
  CountChart,
  DIFFICULTY_COLOR,
  INDEX_COLOR,
  RAW_COLOR,
  SUBJECT_COLOR,
  TrendChart,
} from '../components/charts';

const ROLLING_WINDOW = 3;

export function Statistics(): JSX.Element {
  const { exams, settings, setSettings } = useApp();
  const [showRolling, setShowRolling] = useState(true);

  const points = useMemo(() => buildPoints(exams, settings.dateDisplay), [exams, settings.dateDisplay]);
  const visible = useMemo(() => {
    if (settings.includeArchivedInTrends) return points;
    const included = new Set(trendExams(exams, false).map((e) => e.id));
    return points.filter((p) => included.has(p.examId));
  }, [points, exams, settings.includeArchivedInTrends]);

  // All hooks run before any early return, so the hook order never changes
  // between an empty database and a populated one.
  const weightedRolling = useMemo(
    () => rollingAverage(visible.map((x) => x.rawWeighted), ROLLING_WINDOW),
    [visible],
  );
  const indexRolling = useMemo(
    () => rollingAverage(visible.map((x) => x.overallIndex), ROLLING_WINDOW),
    [visible],
  );

  if (visible.length === 0) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>
            Statistics <span className="fa muted">آمار</span>
          </h1>
          <p>Trends across completed exams. Drafts are never included.</p>
        </div>
        <Empty title="Nothing to chart yet">
          Statistics appear once you have at least one completed exam. Single points are plotted as
          points; trend lines need two or more.
        </Empty>
      </div>
    );
  }

  const weightedRows = visible.map((p, i) => ({
    date: p.label,
    weighted: p.rawWeighted,
    rolling: showRolling ? weightedRolling[i]?.value ?? null : null,
    windowSize: weightedRolling[i]?.windowSize ?? 0,
  }));

  const indexRows = visible.map((p, i) => ({
    date: p.label,
    index: p.overallIndex,
    rolling: showRolling ? indexRolling[i]?.value ?? null : null,
    windowSize: indexRolling[i]?.windowSize ?? 0,
  }));

  const subjectRows = (subjectId: SubjectId): Record<string, unknown>[] =>
    visible.map((p) => ({
      date: p.label,
      raw: p.subjects[subjectId].rawNet,
      index: p.subjects[subjectId].index,
      expected: p.subjects[subjectId].expectedNet,
      performance: p.subjects[subjectId].performance,
    }));

  const diffNetRows = visible.map((p) => {
    const row: Record<string, unknown> = { date: p.label };
    for (const s of SUBJECTS) {
      row[`${s.id}_easy`] = p.difficultyNet[s.id].easy;
      row[`${s.id}_medium`] = p.difficultyNet[s.id].medium;
      row[`${s.id}_hard`] = p.difficultyNet[s.id].hard;
    }
    return row;
  });

  const diffAccRows = visible.map((p) => {
    const row: Record<string, unknown> = { date: p.label };
    for (const s of SUBJECTS) {
      row[`${s.id}_easy`] = p.accuracyBySubjectDifficulty[s.id].easy;
      row[`${s.id}_medium`] = p.accuracyBySubjectDifficulty[s.id].medium;
      row[`${s.id}_hard`] = p.accuracyBySubjectDifficulty[s.id].hard;
    }
    return row;
  });

  const diffAttemptRows = visible.map((p) => {
    const row: Record<string, unknown> = { date: p.label };
    for (const s of SUBJECTS) {
      row[`${s.id}_easy`] = p.attemptRateBySubjectDifficulty[s.id].easy;
      row[`${s.id}_medium`] = p.attemptRateBySubjectDifficulty[s.id].medium;
      row[`${s.id}_hard`] = p.attemptRateBySubjectDifficulty[s.id].hard;
    }
    return row;
  });

  const countRows = visible.map((p) => ({
    date: p.label,
    correct: p.correct,
    wrong: p.wrong,
    blank: p.blank,
  }));

  const mixRows = visible.map((p) => ({
    date: p.label,
    easy: p.difficultyMix.easy,
    medium: p.difficultyMix.medium,
    hard: p.difficultyMix.hard,
  }));

  const mixProportionRows = visible.map((p) => ({
    date: p.label,
    easyPct: (100 * p.difficultyMix.easy) / 95,
    mediumPct: (100 * p.difficultyMix.medium) / 95,
    hardPct: (100 * p.difficultyMix.hard) / 95,
  }));

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Statistics <span className="fa muted">آمار</span>
        </h1>
        <p>
          {visible.length} completed exam{visible.length === 1 ? '' : 's'}. Every point is one stored
          exam; gaps between exams stay gaps and no zero is inserted for a missed exam.
        </p>
        <EstimationDisclaimer />
      </div>

      <div className="row row-wrap" style={{ gap: 10, marginBottom: 20 }}>
        <label className="row tiny" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={showRolling}
            onChange={(e) => setShowRolling(e.target.checked)}
          />
          <span>Show {ROLLING_WINDOW}-exam rolling average</span>
        </label>
        <label className="row tiny" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={settings.includeArchivedInTrends}
            onChange={(e) => void setSettings({ includeArchivedInTrends: e.target.checked })}
          />
          <span>Include archived exams</span>
        </label>
        <span className="tiny faint">Rolling averages are supplementary and never alter a stored score.</span>
      </div>

      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-title">
          <h2 data-testid="chart-weighted">1. Weighted raw score over time</h2>
          <span>percentage points</span>
        </div>
        <TrendChart
          data={weightedRows}
          xKey="date"
          series={[
            { key: 'weighted', label: 'Weighted raw', color: RAW_COLOR, axis: 'left' },
            ...(showRolling
              ? [{ key: 'rolling', label: `${ROLLING_WINDOW}-exam average`, color: RAW_COLOR, axis: 'left' as const, dashed: true, faint: true }]
              : []),
          ]}
          leftDomain={[-40, 100]}
          height={240}
        />
        <div className="tiny faint" style={{ marginTop: 6 }}>
          Coefficient-weighted raw score: (12·Math + 9·Physics + 7·Chemistry) / 28.
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2 data-testid="chart-overall-index">2. Overall personal difficulty index</h2>
          <span>تراز شخصی تخمینی</span>
        </div>
        <TrendChart
          data={indexRows}
          xKey="date"
          series={[
            { key: 'index', label: 'Overall index', color: INDEX_COLOR, axis: 'right' },
            ...(showRolling
              ? [{ key: 'rolling', label: `${ROLLING_WINDOW}-exam average`, color: INDEX_COLOR, axis: 'right' as const, dashed: true, faint: true }]
              : []),
          ]}
          leftSuffix=""
          rightSuffix=""
          height={240}
        />
        <div className="tiny faint" style={{ marginTop: 6 }}>
          {exams[0]?.profileSnapshot.label ?? 'Profile v1'} · 5000 means exactly the model's
          expected score for that exam's difficulty labels. Not an official تراز.
        </div>
      </section>

      {SUBJECTS.map((s, i) => (
        <section className="section" key={s.id}>
          <div className="section-title">
            <h2 data-testid={`chart-subject-${s.id}`}>
              {3 + i}. {s.nameEn} <span className="fa muted">{s.nameFa}</span> — raw % vs index
            </h2>
            <span>two axes</span>
          </div>
          <TrendChart
            data={subjectRows(s.id)}
            xKey="date"
            series={[
              { key: 'raw', label: `${s.nameEn} raw %`, color: SUBJECT_COLOR[s.id], axis: 'left' },
              { key: 'index', label: `${s.nameEn} τ`, color: INDEX_COLOR, axis: 'right' },
            ]}
            leftDomain={[-40, 100]}
            height={250}
          />
        </section>
      ))}

      {SUBJECTS.map((s) => (
        <section className="section" key={`${s.id}-expect`}>
          <div className="section-title">
            <h2>
              {s.nameEn} expected net vs actual
            </h2>
            <span>deviation in percentage points</span>
          </div>
          <TrendChart
            data={subjectRows(s.id)}
            xKey="date"
            series={[
              { key: 'raw', label: 'Raw net %', color: RAW_COLOR, axis: 'left' },
              { key: 'expected', label: 'Expected net %', color: SUBJECT_COLOR[s.id], axis: 'left', dashed: true },
              { key: 'performance', label: 'Deviation (pp)', color: INDEX_COLOR, axis: 'right' },
            ]}
            height={250}
          />
        </section>
      ))}

      <section className="section">
        <div className="section-title">
          <h2 data-testid="chart-net-by-difficulty">7. Net percentage by difficulty and subject</h2>
          <span>percentage points</span>
        </div>
        <TrendChart
          data={diffNetRows}
          xKey="date"
          series={SUBJECTS.flatMap((s) =>
            DIFFICULTY_ORDER.map((d) => ({
              key: `${s.id}_${d}`,
              label: `${s.nameEn} ${d}`,
              color: SUBJECT_COLOR[s.id],
              axis: 'left' as const,
              dashed: d !== 'easy',
            })),
          )}
          leftDomain={[-40, 100]}
          height={260}
        />
        <Legend
          items={SUBJECTS.map((s) => ({
            color: SUBJECT_COLOR[s.id],
            label: `${s.nameEn} (solid = Easy, dashed = Medium, dotted = Hard)`,
          }))}
        />
        <div className="tiny faint" style={{ marginTop: 6 }}>
          Cells with zero questions in a band are plotted as gaps, not as 0%.
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2 data-testid="chart-accuracy-by-difficulty">8. Accuracy by difficulty and subject</h2>
          <span>percent of attempted questions</span>
        </div>
        <TrendChart
          data={diffAccRows}
          xKey="date"
          series={SUBJECTS.flatMap((s) =>
            DIFFICULTY_ORDER.map((d) => ({
              key: `${s.id}_${d}`,
              label: `${s.nameEn} ${d}`,
              color: DIFFICULTY_COLOR[d],
              axis: 'left' as const,
              dashed: s.id !== 'math',
            })),
          )}
          leftDomain={[0, 100]}
          height={260}
        />
        <Legend
          items={SUBJECTS.map((s) => ({ color: SUBJECT_COLOR[s.id], label: s.nameEn }))}
        />
      </section>

      <section className="section">
        <div className="section-title">
          <h2 data-testid="chart-attempt-by-difficulty">9. Attempt rate by difficulty and subject</h2>
          <span>percent of questions attempted</span>
        </div>
        <TrendChart
          data={diffAttemptRows}
          xKey="date"
          series={SUBJECTS.flatMap((s) =>
            DIFFICULTY_ORDER.map((d) => ({
              key: `${s.id}_${d}`,
              label: `${s.nameEn} ${d}`,
              color: DIFFICULTY_COLOR[d],
              axis: 'left' as const,
              dashed: s.id !== 'math',
            })),
          )}
          leftDomain={[0, 100]}
          height={260}
        />
        <Legend items={DIFFICULTY_ORDER.map((d) => ({ color: DIFFICULTY_COLOR[d], label: d }))} />
      </section>

      <section className="section">
        <div className="section-title">
          <h2 data-testid="chart-counts">10a. Correct / wrong / blank counts</h2>
          <span>per exam</span>
        </div>
        <CountChart
          data={countRows}
          xKey="date"
          bars={[
            { key: 'correct', label: 'Correct', color: DIFFICULTY_COLOR.easy },
            { key: 'wrong', label: 'Wrong', color: DIFFICULTY_COLOR.hard },
            { key: 'blank', label: 'Blank', color: '#565a61' },
          ]}
          stacked
          yLabel=""
          height={240}
        />
      </section>

      <section className="section">
        <div className="section-title">
          <h2 data-testid="chart-mix">10b. Difficulty mix per exam</h2>
          <span>counts and proportions</span>
        </div>
        <CountChart
          data={mixRows}
          xKey="date"
          bars={[
            { key: 'easy', label: 'Easy', color: DIFFICULTY_COLOR.easy },
            { key: 'medium', label: 'Medium', color: DIFFICULTY_COLOR.medium },
            { key: 'hard', label: 'Hard', color: DIFFICULTY_COLOR.hard },
          ]}
          stacked
          height={240}
        />
        <div style={{ height: 12 }} />
        <CountChart
          data={mixProportionRows}
          xKey="date"
          bars={[
            { key: 'easyPct', label: 'Easy %', color: DIFFICULTY_COLOR.easy },
            { key: 'mediumPct', label: 'Medium %', color: DIFFICULTY_COLOR.medium },
            { key: 'hardPct', label: 'Hard %', color: DIFFICULTY_COLOR.hard },
          ]}
          stacked
          yLabel="%"
          height={240}
        />
        <div className="tiny faint" style={{ marginTop: 6 }}>
          The 30 / 55 / 15 split is a typical structure, not a target. Your actual labels are used
          as entered and are never rearranged to match it.
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Per-question difficulty breakdown</h2>
          <span>latest completed exam</span>
        </div>
        <DifficultyBreakdown examId={visible[visible.length - 1]!.examId} />
      </section>
    </div>
  );
}

function DifficultyBreakdown({ examId }: { examId: string }): JSX.Element {
  const { exams, settings } = useApp();
  const exam = exams.find((e) => e.id === examId);

  if (!exam) {
    return <Note>No completed exam selected.</Note>;
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row row-wrap" style={{ gap: 8 }}>
        <span className="tiny faint">
          <DateText iso={exam.date} mode={settings.dateDisplay} /> · {exam.provider}
        </span>
      </div>
      {SUBJECTS.map((s) => (
        <div key={s.id} className="card-quiet">
          <div className="row spread" style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 550 }}>
              {s.nameEn} <span className="fa muted">{s.nameFa}</span>
            </span>
            <span className="tiny faint">
              {s.questionCount} questions ·{' '}
              {Object.values(exam.answers).filter((e) => e?.difficulty).length} labelled overall
            </span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Difficulty</th>
                  <th className="n">Questions</th>
                  <th className="n">Correct</th>
                  <th className="n">Wrong</th>
                  <th className="n">Blank</th>
                  <th className="n">Net %</th>
                  <th className="n">Accuracy</th>
                  <th className="n">Attempt</th>
                </tr>
              </thead>
              <tbody>
                {DIFFICULTY_ORDER.map((d) => {
                  const slice = difficultySlice(exam.answers, s.id, d);
                  return (
                    <tr key={d}>
                      <td style={{ textTransform: 'capitalize' }}>
                        {d}{' '}
                        {slice.smallSample ? (
                          <span className="tag tag-none">small sample</span>
                        ) : null}
                      </td>
                      <td className="n">{slice.questionCount}</td>
                      <td className="n">{slice.correct}</td>
                      <td className="n">{slice.wrong}</td>
                      <td className="n">{slice.blank}</td>
                      <td className="n">{formatPercent(slice.netPercent)}</td>
                      <td className="n">{formatPercent(slice.accuracyPercent)}</td>
                      <td className="n">{formatPercent(slice.attemptRatePercent)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="tiny faint" style={{ marginTop: 6 }}>
            Percentages use only {s.nameEn} questions. Cells under {SMALL_SAMPLE_THRESHOLD} questions
            are marked — do not overinterpret them.
          </div>
        </div>
      ))}
      <div className="tiny faint">
        Overall raw net {formatPercent(exam.result?.raw.netPercent ?? Number.NaN)} · weighted{' '}
        {formatPercent(exam.result?.raw.weightedRawScore ?? Number.NaN)} · expected deviation{' '}
        {formatPoints(exam.result?.adjusted.subjects.math.performancePoints ?? Number.NaN)} for Math.
      </div>
    </div>
  );
}

export type { Difficulty };