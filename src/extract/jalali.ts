// graphwright/extract — Jalali (Solar Hijri) calendar conversion.
//
// Pure integer arithmetic, no dependency. The date lane needs to turn a
// Persian-calendar date ("۲۹ خرداد ۱۴۰۵") into the ISO Gregorian day the
// rest of graphwright speaks, and to know "which Jalali year is it now"
// when a Persian date omits its year. Calendar conversion is its own
// concern, so it lives here rather than inside the regex rules.
//
// The algorithm is Borkowski's (the one jalaali-js implements): the
// `BREAKS` array marks the years where the 2820-year leap pattern shifts,
// which is why a closed-form leap rule does not exist and the math walks
// the breakpoints. The values are not derivable from the code; they are
// the constants of the calendar itself.

function div(a: number, b: number): number {
  return Math.floor(a / b);
}
function mod(a: number, b: number): number {
  return a - Math.floor(a / b) * b;
}

// Leap-cycle breakpoints. Valid Jalali years are [BREAKS[0], last).
const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2326, 2394,
  2456, 3178,
];

interface JalCal {
  /** 0 on a leap year (the convention Borkowski's math uses). */
  leap: number;
  /** Gregorian year of this Jalali year's 1 Farvardin. */
  gy: number;
  /** Gregorian day-of-March on which 1 Farvardin falls. */
  march: number;
}

function jalCal(jy: number): JalCal {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0]!;

  if (jy < jp || jy >= BREAKS[bl - 1]!) {
    throw new RangeError(`Jalali year out of range: ${jy}`);
  }

  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i]!;
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

// Gregorian (proleptic) to Julian Day Number (Fliegel/Van Flandern).
function g2d(gy: number, gm: number, gd: number): number {
  const a = div(14 - gm, 12);
  const y = gy + 4800 - a;
  const m = gm + 12 * a - 3;
  return gd + div(153 * m + 2, 5) + 365 * y + div(y, 4) - div(y, 100) + div(y, 400) - 32045;
}

// Julian Day Number to Gregorian.
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  const a = jdn + 32044;
  const b = div(4 * a + 3, 146097);
  const c = a - div(146097 * b, 4);
  const d = div(4 * c + 3, 1461);
  const e = c - div(1461 * d, 4);
  const m = div(5 * e + 2, 153);
  const gd = e - div(153 * m + 2, 5) + 1;
  const gm = m + 3 - 12 * div(m, 10);
  const gy = 100 * b + d - 4800 + div(m, 10);
  return { gy, gm, gd };
}

// Jalali to Julian Day Number.
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

// Julian Day Number to Jalali.
function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);

  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      const jm = 1 + div(k, 31);
      const jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  const jm = 7 + div(k, 30);
  const jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export function jalaliToGregorian(
  jy: number,
  jm: number,
  jd: number,
): { gy: number; gm: number; gd: number } {
  return d2g(j2d(jy, jm, jd));
}

export function gregorianToJalali(
  gy: number,
  gm: number,
  gd: number,
): { jy: number; jm: number; jd: number } {
  return d2j(g2d(gy, gm, gd));
}

export function isLeapJalaliYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

// First six months have 31 days, next five 30, Esfand 29 (30 in a leap year).
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}
