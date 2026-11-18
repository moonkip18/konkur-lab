import type { ReactNode } from 'react';
import {
  ANSWER_LABELS,
  DIFFICULTY_LABELS,
  formatDate,
  type AnswerState,
  type DateDisplayMode,
  type Difficulty,
  type ExamStatus,
} from '../lib/scoring';

export function Metric({
  label,
  value,
  sub,
  tone,
  large,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'accent' | 'pos' | 'neg';
  large?: boolean;
}): JSX.Element {
  const toneClass =
    tone === 'accent' ? ' metric-accent' : tone === 'pos' ? ' pos' : tone === 'neg' ? ' neg' : '';
  return (
    <div className="grid-cell">
      <div className={`metric${large ? ' metric-lg' : ''}${toneClass}`}>{value}</div>
      <div className="metric-label">{label}</div>
      {sub ? <div className="metric-sub">{sub}</div> : null}
    </div>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {action ? <div style={{ marginTop: 18 }}>{action}</div> : null}
    </div>
  );
}

export function Note({
  children,
  warn,
}: {
  children: ReactNode;
  warn?: boolean;
}): JSX.Element {
  return <div className={`note${warn ? ' note-warn' : ''}`}>{children}</div>;
}

/**
 * The estimation disclaimer required on every screen that shows a derived
 * number. One component so the wording stays identical everywhere it appears;
 * `compact` fits it into dense areas like the entry form header.
 */
export function EstimationDisclaimer({ compact = false }: { compact?: boolean }): JSX.Element {
  if (compact) {
    return (
      <div className="tiny faint" data-testid="estimation-disclaimer">
        Estimation, not real data — see How this is calculated.
      </div>
    );
  }
  return (
    <div className="tiny faint" data-testid="estimation-disclaimer" style={{ lineHeight: 1.6 }}>
      Everything derived on this page — expected nets, performance, τ, the difficulty-adjusted
      index — is an <strong>estimation from a fixed toy model</strong>, not real or verified data.
      The model's p/a values are plausible assumptions, the difficulty labels are one person's
      reading of the answer key, and no official statistic backs any number here. Real exams, real
      quotas, and real rankings are computed by the organizations that run them.
    </div>
  );
}

export function Chip({ children, tone }: { children: ReactNode; tone?: 'accent' | 'ok' }): JSX.Element {
  return <span className={`chip${tone ? ` chip-${tone}` : ''}`}>{children}</span>;
}

export function CoverageBar({
  value,
  complete,
  label,
}: {
  value: number;
  complete: boolean;
  label: string;
}): JSX.Element {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="stack-sm" style={{ minWidth: 150 }}>
      <div className="row spread tiny">
        <span className="faint">{label}</span>
        <span className="mono">{Math.round(pct * 100)}%</span>
      </div>
      <div className={`progress${complete ? ' progress-ok' : ''}`}>
        <i style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

export function AnswerTag({ value }: { value: AnswerState | null | undefined }): JSX.Element {
  if (!value) return <span className="tag tag-none">unset</span>;
  return <span className={`tag tag-${value}`}>{ANSWER_LABELS[value].en}</span>;
}

export function DifficultyTag({ value }: { value: Difficulty | null | undefined }): JSX.Element {
  if (!value) return <span className="tag tag-none">unlabeled</span>;
  return <span className={`tag tag-${value}`}>{DIFFICULTY_LABELS[value].en}</span>;
}

export function StatusTag({ status }: { status: ExamStatus }): JSX.Element {
  return <span className={`chip${status === 'completed' ? ' chip-ok' : ''}`}>{status}</span>;
}

export function DateText({ iso, mode }: { iso: string; mode: DateDisplayMode }): JSX.Element {
  return <span className="mono">{formatDate(iso, mode)}</span>;
}

export function KeyValue({ items }: { items: [string, ReactNode][] }): JSX.Element {
  return (
    <dl style={{ margin: 0 }}>
      {items.map(([k, v]) => (
        <div className="kv" key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }): JSX.Element {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}