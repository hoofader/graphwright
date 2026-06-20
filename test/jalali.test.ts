import { describe, expect, it } from 'vitest';
import {
  gregorianToJalali,
  isLeapJalaliYear,
  jalaliMonthLength,
  jalaliToGregorian,
} from '../src/extract/jalali.js';

// Anchors are textbook conversions, cross-checked against ICU's persian
// calendar over 1900..2100 during development.
const ANCHORS: Array<[[number, number, number], [number, number, number]]> = [
  [[1357, 11, 22], [1979, 2, 11]], // 22 Bahman 1357 — the revolution
  [[1368, 3, 14], [1989, 6, 4]],
  [[1399, 1, 1], [2020, 3, 20]], // Nowruz 1399
  [[1402, 12, 29], [2024, 3, 19]], // last day of a common year
  [[1403, 1, 1], [2024, 3, 20]],
  [[1403, 12, 30], [2025, 3, 20]], // Esfand 30 — only a leap year has it
  [[1405, 3, 30], [2026, 6, 20]],
];

describe('jalali <-> gregorian', () => {
  it('converts anchors both directions', () => {
    for (const [[jy, jm, jd], [gy, gm, gd]] of ANCHORS) {
      expect(jalaliToGregorian(jy, jm, jd)).toEqual({ gy, gm, gd });
      expect(gregorianToJalali(gy, gm, gd)).toEqual({ jy, jm, jd });
    }
  });

  it('round-trips every month across a leap and common year', () => {
    for (const jy of [1402, 1403]) {
      for (let jm = 1; jm <= 12; jm++) {
        for (const jd of [1, 15, jalaliMonthLength(jy, jm)]) {
          const g = jalaliToGregorian(jy, jm, jd);
          expect(gregorianToJalali(g.gy, g.gm, g.gd)).toEqual({ jy, jm, jd });
        }
      }
    }
  });
});

describe('jalali leap years and month lengths', () => {
  it('flags 1403 leap, 1402 common', () => {
    expect(isLeapJalaliYear(1403)).toBe(true);
    expect(isLeapJalaliYear(1402)).toBe(false);
  });

  it('first six months are 31 days, next five 30, Esfand 29/30', () => {
    expect(jalaliMonthLength(1404, 1)).toBe(31);
    expect(jalaliMonthLength(1404, 7)).toBe(30);
    expect(jalaliMonthLength(1402, 12)).toBe(29);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
  });
});
