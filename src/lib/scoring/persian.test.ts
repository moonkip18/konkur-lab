import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  daysBetweenIso,
  formatDate,
  gregorianToJdn,
  isValidIsoDate,
  jalaliToJdn,
  jdnToJalali,
  toGregorianDisplay,
  toJalaliDisplay,
  toJalaliIso,
} from './persian';

describe('Gregorian / Jalali conversion', () => {
  it('converts the Nowruz boundary correctly', () => {
    expect(toJalaliIso('2026-03-21')).toBe('1405/01/01'); // 1 Farvardin 1405
    expect(toJalaliIso('2026-03-20')).toBe('1404/12/29'); // last day of 1404
    expect(toJalaliIso('2026-03-22')).toBe('1405/01/02');
    expect(toJalaliIso('2025-03-21')).toBe('1404/01/01');
    expect(toJalaliIso('2024-03-20')).toBe('1403/01/01');
  });

  it('round-trips Gregorian -> Jalali -> JDN -> Jalali across four years', () => {
    for (let d = 0; d < 1500; d += 11) {
      const iso = new Date(Date.UTC(2024, 0, 1 + d)).toISOString().slice(0, 10);
      const [gy, gm, gd] = iso.split('-').map(Number) as [number, number, number];
      // Gregorian -> JDN -> Jalali, then back through the Jalali JDN path.
      const jalali = jdnToJalali(gregorianToJdn(gy, gm, gd));
      const backToJdn = jalaliToJdn(jalali.jy, jalali.jm, jalali.jd);
      const back = jdnToJalali(backToJdn);
      expect(back).toEqual(jalali);
      expect(toJalaliIso(iso)).toBe(
        `${String(jalali.jy).padStart(4, '0')}/${String(jalali.jm).padStart(2, '0')}/${String(jalali.jd).padStart(2, '0')}`,
      );
    }
  });

  it('agrees with known Jalali dates', () => {
    const cases: [string, string][] = [
      ['2026-07-16', '1405/04/25'],
      ['2026-01-01', '1404/10/11'],
      ['2025-03-21', '1404/01/01'],
      ['2024-03-20', '1403/01/01'],
      ['2026-03-11', '1404/12/20'],
      ['2024-03-19', '1402/12/29'],
      ['2027-03-21', '1406/01/01'],
    ];
    for (const [iso, expected] of cases) {
      expect(toJalaliIso(iso), iso).toBe(expected);
    }
  });

  it('formats each calendar for display', () => {
    expect(toGregorianDisplay('2026-07-16')).toBe('16 Jul 2026');
    expect(toJalaliDisplay('2026-07-16')).toBe('25 تیر 1405');
    expect(formatDate('2026-07-16', 'gregorian')).toBe('16 Jul 2026');
    expect(formatDate('2026-07-16', 'jalali')).toBe('25 تیر 1405');
  });

  it('returns the raw string for an unparseable date instead of throwing', () => {
    expect(toJalaliIso('nope')).toBeNull();
    expect(formatDate('nope', 'jalali')).toBe('nope');
  });

  it('validates ISO dates, rejecting rolled-over days', () => {
    expect(isValidIsoDate('2026-07-16')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true); // leap year
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-7-1')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
  });

  it('adds days across month and year ends', () => {
    expect(addDaysIso('2026-07-16', 14)).toBe('2026-07-30');
    expect(addDaysIso('2026-12-25', 14)).toBe('2027-01-08');
    expect(addDaysIso('2024-02-25', 7)).toBe('2024-03-03');
    expect(addDaysIso('2026-03-05', -5)).toBe('2026-02-28');
  });

  it('measures day gaps', () => {
    expect(daysBetweenIso('2026-07-02', '2026-07-16')).toBe(14);
    expect(daysBetweenIso('2026-07-16', '2026-07-02')).toBe(-14);
    expect(daysBetweenIso('2026-07-16', 'bad')).toBeNull();
  });
});