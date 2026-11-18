import {
  PROFILE_V1,
  SUBJECTS,
  expectedNetPercentages,
  formatPercent,
  formatPoints,
  type ScoringProfile,
} from '../lib/scoring';
import { KeyValue, Note } from './primitives';

/**
 * A number people expect this index to hit. It is named here only so the UI can
 * say plainly that it is not a target.
 */
const PERFECT_EXAM_MISCONCEPTION = 13000;

/**
 * The plain-language explanation of the index, shown wherever an adjusted score
 * appears. It exists because an index without its baseline is meaningless: a
 * number like 7400 only means something next to "5000 means exactly what the
 * model expected for this exam's difficulty labels".
 */
export function ScoreExplainer({ profile }: { profile: ScoringProfile }): JSX.Element {
  const mu = expectedNetPercentages(profile);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card-quiet stack" style={{ gap: 10 }}>
        <div className="eyebrow">How the personal difficulty index works</div>
        <ol className="stack-sm small muted" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            <strong className="mono">Raw net</strong> is what you actually scored under the answer
            rule: correct +1, wrong −1/3, blank 0.
          </li>
          <li>
            <strong className="mono">Expected net</strong> is the fixed model's estimate for{' '}
            <em>this exam's own difficulty labels</em>, including the questions you left blank.
            A subject with more Hard questions gets a lower expected net.
          </li>
          <li>
            <strong className="mono">Performance</strong> = raw net − expected net, in percentage
            points.
          </li>
          <li>
            <strong className="mono">τ</strong> = {profile.A.toLocaleString('en-US')} +{' '}
            {profile.B.toLocaleString('en-US')} × (performance ÷ {profile.sigma}).
          </li>
          <li>
            <strong className="mono">Overall T</strong> = (12τ<sub>math</sub> + 9τ<sub>physics</sub> +{' '}
            7τ<sub>chemistry</sub>) / 28.
          </li>
        </ol>
        <KeyValue
          items={[
            [
              'Expected net per question',
              `E ${formatPercent(mu.easy)} · M ${formatPercent(mu.medium)} · H ${formatPercent(mu.hard)}`,
            ],
            ['Scale', `A = ${profile.A.toLocaleString('en-US')}, B = ${profile.B.toLocaleString('en-US')}, σ = ${profile.sigma} pp`],
            [
              'Hard expected net of 0%',
              'A consequence of a = 0.60 under +1/−1/3 scoring, not a claim that Hard questions are worth zero.',
            ],
          ]}
        />
      </div>

      <Note warn>
        <strong>These are assumptions, not measurements.</strong> The p (share correct) and a (attempt
        rate) values below were chosen as plausible modelling assumptions for this app. They are not
        verified Maz or Sanjesh statistics, and the difficulty labels they are applied to are your own
        reading of the answer key. Treat the index as a consistent ruler for tracking your own
        exams, not as a measurement of anything outside them.
      </Note>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Difficulty</th>
              <th className="n">p (correct when attempted)</th>
              <th className="n">a (attempt rate)</th>
              <th className="n">Expected net per question</th>
            </tr>
          </thead>
          <tbody>
            {(['easy', 'medium', 'hard'] as const).map((d) => (
              <tr key={d}>
                <td style={{ textTransform: 'capitalize' }}>{d}</td>
                <td className="n">{profile.difficulty[d].p}</td>
                <td className="n">{profile.difficulty[d].a}</td>
                <td className="n">{formatPercent(mu[d])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-quiet stack" style={{ gap: 8 }}>
        <div className="eyebrow">What the number does and does not mean</div>
        <ul className="stack-sm small muted" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            A higher adjusted score than the previous exam does not by itself prove your ability
            increased — the two exams may simply have had different difficulty mixes.
          </li>
          <li>A lower adjusted score does not prove you performed worse in absolute terms.</li>
          <li>
            There is no cap, floor, or target. The index is not clamped, and{' '}
            {PERFECT_EXAM_MISCONCEPTION.toLocaleString('en-US')} is not a perfect-exam goal.
          </li>
          <li>
            Every exam is scored with the same fixed profile unless you deliberately create a new
            profile version. Your history never changes the model.
          </li>
          <li>This is not an official تراز, percentile, rank, or national-standing estimate.</li>
        </ul>
      </div>

      <div className="tiny faint">
        Profile {profile.version} · coefficients{' '}
        {SUBJECTS.map((s) => `${s.coefficient}× ${s.nameEn}`).join(' · ')} (total 28)
        {profile.note ? <div style={{ marginTop: 6 }}>{profile.note}</div> : null}
      </div>
    </div>
  );
}

/** One-line reminder used under index figures in tables. */
export function IndexFootnote({ profile = PROFILE_V1 }: { profile?: ScoringProfile }): JSX.Element {
  return (
    <div className="tiny faint">
      Index anchored at {profile.A.toLocaleString('en-US')}, which is exactly the model's expected
      score for that exam's own difficulty labels. σ = {profile.sigma} pp, B ={' '}
      {profile.B.toLocaleString('en-US')}.
    </div>
  );
}

export function PerformanceCell({ value }: { value: number }): JSX.Element {
  return (
    <span className={value > 0 ? 'pos' : value < 0 ? 'neg' : ''}>{formatPoints(value)}</span>
  );
}