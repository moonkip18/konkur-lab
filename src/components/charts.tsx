/**
 * Chart palette and wrappers.
 *
 * Raw percentages and index scores never share an axis in these charts: a raw
 * 60% and an index of 6000 are different quantities, so each gets its own
 * y-axis and its own colour.
 */
import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
  ReferenceLine,
  type TooltipProps,
} from 'recharts';
import { formatAxisNumber, type Difficulty, type SubjectId } from '../lib/scoring';

export const SUBJECT_COLOR: Record<SubjectId, string> = {
  math: '#8ab4f8',
  physics: '#9ece6a',
  chemistry: '#e0af68',
};

export const RAW_COLOR = '#e9eaec';
export const INDEX_COLOR = '#c8433c';
export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  easy: '#7fb069',
  medium: '#d9a441',
  hard: '#c8433c',
};

const AXIS = { stroke: '#565a61', fontSize: 10, fontFamily: 'ui-monospace, monospace' };

export interface Series {
  key: string;
  label: string;
  color: string;
  axis: 'left' | 'right';
  dashed?: boolean;
  /** Rendered as a light band, for rolling averages. */
  faint?: boolean;
}

interface BaseProps {
  data: Record<string, unknown>[];
  series: Series[];
  xKey: string;
  height?: number;
  /** Left-axis label suffix, e.g. "%". */
  leftSuffix?: string;
  rightSuffix?: string;
  /** Force a left-axis domain, e.g. [-100, 100] for percentages. */
  leftDomain?: [number, number];
  /** Approximate number of left-axis ticks. */
  leftTicks?: number;
  tooltipLabel?: (row: Record<string, unknown>) => string;
}

function DefaultTooltip({
  active,
  payload,
  label,
  suffixMap,
}: TooltipProps<number, string> & {
  suffixMap: Record<string, string>;
}): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: '#0d0f13',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 8,
        padding: '8px 10px',
        fontSize: 11,
        maxWidth: 260,
      }}
    >
      <div style={{ color: '#969ba3', marginBottom: 4 }}>{String(label)}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="row spread" style={{ gap: 12 }}>
          <span>
            <i
              style={{
                display: 'inline-block',
                width: 8,
                height: 2,
                background: p.color,
                marginRight: 6,
                verticalAlign: 'middle',
              }}
            />
            {p.name}
          </span>
          <span className="mono">
            {typeof p.value === 'number' ? p.value.toFixed(2) : String(p.value ?? '')}
            {suffixMap[String(p.dataKey)] ?? ''}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Multi-axis line chart for raw-vs-index comparisons over time. */
export function TrendChart({
  data,
  series,
  xKey,
  height = 260,
  leftSuffix = '%',
  rightSuffix = '',
  leftDomain,
  leftTicks = 5,
  tooltipLabel,
}: BaseProps): JSX.Element {
  const suffixMap: Record<string, string> = {};
  for (const s of series) suffixMap[s.key] = s.axis === 'left' ? leftSuffix : rightSuffix;

  // Tick values for the left axis. The previous implementation produced
  // [0,1,2,3,4] regardless of domain, which recharts clamps to a single
  // colliding tick. Spread leftTicks values evenly across the actual domain;
  // for an auto domain, fall back to recharts' own nice ticks.
  const leftTickValues = useMemo(() => {
    if (!leftDomain) return undefined;
    const [lo, hi] = leftDomain;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return undefined;
    const n = Math.max(2, Math.trunc(leftTicks));
    return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  }, [leftDomain, leftTicks]);

  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} minTickGap={24} />
          <YAxis
            yAxisId="left"
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={44}
            domain={leftDomain ?? (['auto', 'auto'] as [string | number, string | number])}
            ticks={leftTickValues}
            tickFormatter={(v: number) => `${formatAxisNumber(v)}${leftSuffix}`}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => `${formatAxisNumber(v)}${rightSuffix}`}
          />
          <Tooltip
            content={
              <DefaultTooltip
                suffixMap={suffixMap}
                {...({} as TooltipProps<number, string>)}
              />
            }
            labelFormatter={(label) =>
              tooltipLabel ? tooltipLabel(data.find((d) => d[xKey] === label) ?? {}) : String(label)
            }
          />
          {series.map((s) => (
            <Line
              key={s.key}
              yAxisId={s.axis}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={s.faint ? 1.25 : 1.75}
              strokeDasharray={s.dashed ? '4 3' : undefined}
              strokeOpacity={s.faint ? 0.65 : 1}
              dot={{ r: 2.25, fill: s.color, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              // connectNulls=false keeps missed exams as real gaps in the line.
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stacked or grouped bars, used for difficulty mix and count charts. */
export function CountChart({
  data,
  bars,
  xKey,
  height = 260,
  yLabel = '',
  stacked = false,
}: {
  data: Record<string, unknown>[];
  bars: { key: string; label: string; color: string }[];
  xKey: string;
  height?: number;
  yLabel?: string;
  stacked?: boolean;
}): JSX.Element {
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} minTickGap={16} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${v}${yLabel}`} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={
              <DefaultTooltip
                suffixMap={Object.fromEntries(bars.map((b) => [b.key, yLabel]))}
                {...({} as TooltipProps<number, string>)}
              />
            }
          />
          {bars.map((b) => (
            <Bar
              key={b.key}
              dataKey={b.key}
              name={b.label}
              fill={b.color}
              stackId={stacked ? 'a' : undefined}
              radius={stacked ? 0 : 2}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A lone reference line, for the expected-score baseline on raw charts. */
export function BaselineChart({
  data,
  series,
  xKey,
  baseline,
  baselineLabel,
  height = 260,
}: {
  data: Record<string, unknown>[];
  series: Omit<Series, 'axis'>[];
  xKey: string;
  baseline: (row: Record<string, unknown>) => number | undefined;
  baselineLabel: string;
  height?: number;
}): JSX.Element {
  const withBaseline = data.map((row) => ({ ...row, __baseline: baseline(row) }));
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={withBaseline} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} minTickGap={24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${formatAxisNumber(v)}%`} />
          <Tooltip
            content={<DefaultTooltip suffixMap={{}} {...({} as TooltipProps<number, string>)} />}
          />
          <ReferenceLine
            yAxisId={0}
            stroke="rgba(255,255,255,0.28)"
            strokeDasharray="3 3"
            label={{ value: baselineLabel, fill: '#8b8f97', fontSize: 10, position: 'insideTopRight' }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={1.75}
              dot={{ r: 2.25, fill: s.color, strokeWidth: 0 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}