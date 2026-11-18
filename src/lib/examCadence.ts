/** 14-day cadence between mock exams; used only to suggest a date. */
export const DEFAULT_EXAM_INTERVAL_DAYS = 14;

/**
 * Next-exam suggestion = most recent exam date + interval. Never creates an
 * exam; missed exams simply stay absent.
 */
export function suggestNextExamDate(
  dates: readonly string[],
  intervalDays: number = DEFAULT_EXAM_INTERVAL_DAYS,
): string | null {
  if (dates.length === 0) return null;
  const latest = [...dates].sort()[dates.length - 1];
  if (!latest) return null;
  const d = new Date(`${latest}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + intervalDays);
  return d.toISOString().slice(0, 10);
}

export function daysSince(iso: string, todayIso: string): number {
  const a = new Date(`${iso}T00:00:00Z`).getTime();
  const b = new Date(`${todayIso}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}