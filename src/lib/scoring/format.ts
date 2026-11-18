/** Display rounding. Percentages keep two decimals; index values are whole. */

export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const factor = 10 ** decimals;
  // The epsilon nudge keeps values like 59.645 from rounding down on binary
  // representation alone.
  return Math.round((value + Number.EPSILON * Math.abs(value)) * factor) / factor;
}

export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  return `${round(value, decimals).toFixed(decimals)}%`;
}

/** Signed percentage points, for above/below-expectation deviations. */
export function formatPoints(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  const r = round(value, decimals);
  const sign = r > 0 ? '+' : '';
  return `${sign}${r.toFixed(decimals)} pp`;
}

export function formatSignedNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  const r = round(value, decimals);
  const sign = r > 0 ? '+' : '';
  return `${sign}${r.toFixed(decimals)}`;
}

export function formatIndex(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  return Math.round(value).toLocaleString('en-US');
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  return String(value);
}

/** Compact axis tick: 5400 -> "5.4k". */
export function formatAxisNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= 1000) {
    const k = value / 1000;
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatDelta(current: number, previous: number | null | undefined): string {
  if (previous === null || previous === undefined || !Number.isFinite(previous)) return '—';
  const d = current - previous;
  if (!Number.isFinite(d)) return '—';
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  return `${sign}${round(Math.abs(d), 2)}`;
}