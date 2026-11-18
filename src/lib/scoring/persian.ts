/**
 * Jalali (Solar Hijri) <-> Gregorian conversion.
 *
 * Implements the Birashk-corrected algorithm from Kazimierz M. Borkowski,
 * "The Persian calendar for 3000 years" (Earth, Moon & Planets, 1996). It is a
 * pure integer algorithm, so it behaves identically in the browser and in tests.
 *
 * Storage is always ISO Gregorian; conversion happens only for display.
 */

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

const BREAKS: readonly number[] = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192,
  2262, 2324, 2394, 2456, 3178,
];

const div = (a: number, b: number): number => ~~(a / b);
const mod = (a: number, b: number): number => a - ~~(a / b) * b;

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0] as number;

  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i] as number;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;

  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export function isLeapJalaliYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export function jalaliToJdn(jy: number, jm: number, jd: number): number {
  return j2d(jy, jm, jd);
}

/** Julian Day Number for a Gregorian date. */
export function gregorianToJdn(gy: number, gm: number, gd: number): number {
  return g2d(gy, gm, gd);
}

export function jdnToJalali(jdn: number): JalaliDate {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export const JALALI_MONTHS_FA = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

export const GREGORIAN_MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function parseIso(iso: string): { gy: number; gm: number; gd: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const gy = Number(m[1]);
  const gm = Number(m[2]);
  const gd = Number(m[3]);
  if (gm < 1 || gm > 12 || gd < 1 || gd > 31) return null;
  const probe = new Date(Date.UTC(gy, gm - 1, gd));
  if (probe.getUTCFullYear() !== gy || probe.getUTCMonth() !== gm - 1 || probe.getUTCDate() !== gd) {
    return null;
  }
  return { gy, gm, gd };
}

export type DateDisplayMode = 'gregorian' | 'jalali';

export function isValidIsoDate(iso: string): boolean {
  return parseIso(iso) !== null;
}

/** "1403/07/16" style, zero-padded. */
export function toJalaliIso(iso: string): string | null {
  const p = parseIso(iso);
  if (!p) return null;
  const j = jdnToJalali(g2d(p.gy, p.gm, p.gd));
  return `${String(j.jy).padStart(4, '0')}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
}

/** "16 Jul 2026" style. */
export function toGregorianDisplay(iso: string): string | null {
  const p = parseIso(iso);
  if (!p) return null;
  return `${String(p.gd).padStart(2, '0')} ${GREGORIAN_MONTHS_EN[p.gm - 1]} ${p.gy}`;
}

export function toJalaliDisplay(iso: string): string | null {
  const p = parseIso(iso);
  if (!p) return null;
  const j = jdnToJalali(g2d(p.gy, p.gm, p.gd));
  return `${j.jd} ${JALALI_MONTHS_FA[j.jm - 1]} ${j.jy}`;
}

/** Format per the user's chosen display mode. Always returns the raw ISO on bad input. */
export function formatDate(iso: string, mode: DateDisplayMode): string {
  if (mode === 'jalali') return toJalaliDisplay(iso) ?? iso;
  return toGregorianDisplay(iso) ?? iso;
}

export function formatDateIso(iso: string): string {
  return toJalaliIso(iso) ?? iso;
}

/** Adds whole days to an ISO date, staying in Gregorian space. */
export function addDaysIso(iso: string, days: number): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const d = new Date(Date.UTC(p.gy, p.gm - 1, p.gd));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenIso(fromIso: string, toIso: string): number | null {
  const a = parseIso(fromIso);
  const b = parseIso(toIso);
  if (!a || !b) return null;
  const da = g2d(a.gy, a.gm, a.gd);
  const db = g2d(b.gy, b.gm, b.gd);
  return db - da;
}