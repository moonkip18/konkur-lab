import { useState } from 'react';
import {
  SUBJECTS,
  TOTAL_QUESTION_COUNT,
  formatDate,
  formatIndex,
  formatPercent,
  formatPoints,
  type DateDisplayMode,
} from '../lib/scoring';
import { pointFor } from '../lib/chartData';
import type { ExamRecord } from '../lib/db/models';
import { Chip, KeyValue, Note } from './primitives';

/**
 * Expandable derivation for one completed exam: difficulty counts, the expected
 * net they produce, the raw net actually achieved, the deviation, and each
 * subject's contribution to the overall index. Every figure here is derivable
 * from the exported raw inputs.
 */
export function ScoreBreakdown({
  exam,
  mode,
}: {
  exam: ExamRecord;
  mode: DateDisplayMode;
}): JSX.Element {
  const [openSubject, setOpenSubject] = useState<string | null>('math');
  const point = pointFor(exam, mode);
  const profile = exam.profileSnapshot;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <Note>
        Expected nets below come from the difficulty labels entered for this exam, weighted by each
        subject's question count. No other exam is involved.
      </Note>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Subject</th>
              <th className="n">Questions</th>
              <th className="n">E</th>
              <th className="n">M</th>
              <th className="n">H</th>
              <th className="n">Expected net</th>
              <th className="n">Raw net</th>
              <th className="n">Deviation</th>
              <th className="n">τ</th>
              <th className="n">Coefficient</th>
              <th className="n">c·τ / 28</th>
            </tr>
          </thead>
          <tbody>
            {SUBJECTS.map((s) => {
              const sub = point.subjects[s.id];
              return (
                <tr key={s.id} onClick={() => setOpenSubject((cur) => (cur === s.id ? null : s.id))}>
                  <td>
                    {s.nameEn} <span className="fa muted">{s.nameFa}</span>
                  </td>
                  <td className="n">{s.questionCount}</td>
                  <td className="n">{sub.difficultyCounts.easy}</td>
                  <td className="n">{sub.difficultyCounts.medium}</td>
                  <td className="n">{sub.difficultyCounts.hard}</td>
                  <td className="n">{formatPercent(sub.expectedNet)}</td>
                  <td className="n">{formatPercent(sub.rawNet)}</td>
                  <td className={`n ${sub.performance > 0 ? 'pos' : sub.performance < 0 ? 'neg' : ''}`}>
                    {formatPoints(sub.performance)}
                  </td>
                  <td className="n">{formatIndex(sub.index)}</td>
                  <td className="n">{sub.coefficient}</td>
                  <td className="n">{((sub.coefficient * sub.index) / 28).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={8}>
                <strong>Overall personal index</strong>
              </td>
              <td className="n">
                <strong>{formatIndex(point.overallIndex)}</strong>
              </td>
              <td className="n">28</td>
              <td className="n">{point.overallIndex === null ? '' : point.overallIndex.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {SUBJECTS.filter((s) => openSubject === s.id).map((s) => {
        const sub = point.subjects[s.id];
        return (
          <details className="disclosure" key={s.id} open>
            <summary>
              {s.nameEn} <span className="fa muted">{s.nameFa}</span> derivation
            </summary>
            <div className="disclosure-body">
              <KeyValue
                items={[
                  [
                    'Expected net',
                    `100 × (${sub.difficultyCounts.easy}×μ_e + ${sub.difficultyCounts.medium}×μ_m + ${sub.difficultyCounts.hard}×μ_h) / ${s.questionCount}`,
                  ],
                  ['Result', formatPercent(sub.expectedNet)],
                  ['Raw net', `100 × (C ${sub.correct} − W ${sub.wrong}/3) / ${s.questionCount} = ${formatPercent(sub.rawNet)}`],
                  ['Performance', `${formatPercent(sub.rawNet)} − ${formatPercent(sub.expectedNet)} = ${formatPoints(sub.performance)}`],
                  ['τ', `${profile.A} + ${profile.B} × (${sub.performance.toFixed(4)} / ${profile.sigma}) = ${sub.index.toFixed(2)} → ${formatIndex(sub.index)}`],
                  ['Weighted raw contribution', `(${sub.coefficient} × ${formatPercent(sub.rawNet)}) / 28 = ${((sub.coefficient * sub.rawNet) / 28).toFixed(2)}`],
                  ['Index contribution', `(${sub.coefficient} × ${sub.index.toFixed(2)}) / 28 = ${((sub.coefficient * sub.index) / 28).toFixed(2)}`],
                ]}
              />
            </div>
          </details>
        );
      })}

      <div className="row row-wrap" style={{ gap: 8 }}>
        <Chip>profile {exam.profileVersion}</Chip>
        <Chip>engine {exam.engineVersion}</Chip>
        <Chip>{TOTAL_QUESTION_COUNT} questions</Chip>
        <span className="tiny faint mono">{formatDate(exam.date, mode)}</span>
      </div>
    </div>
  );
}