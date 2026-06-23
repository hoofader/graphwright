// graphwright/extract — rule-based date extraction.
//
// A deterministic, locale-aware lane that finds date expressions in
// free text and resolves them against a host-supplied reference date.
// No LLM, no dependency: regex rules plus calendar arithmetic. It runs
// the same way every time, which is what makes it the testable floor
// under the model-based extractor (the LLM is the upgrade, this is the
// fallback). English and Persian relative terms are covered; Gregorian
// absolute forms (ISO, month-name) are covered for both scripts, and
// Jalali (Persian-calendar) absolute forms resolve through `jalali.ts`.
//
// All arithmetic uses the UTC calendar components of `reference`, so a
// caller passes "today" already shifted into the user's timezone and
// gets stable yyyy-mm-dd back, free of host-timezone drift.

import { gregorianToJalali, jalaliMonthLength, jalaliToGregorian } from './jalali.js';

export type DateLanguage = 'en' | 'fa';
export type DateGrain = 'day' | 'week' | 'month' | 'year';

export interface DateMention {
  /** Exact matched substring. */
  surface_form: string;
  /** UTF-16 code-unit offsets; end exclusive. */
  span_start: number;
  span_end: number;
  /** Resolved calendar date as ISO yyyy-mm-dd. */
  date: string;
  grain: DateGrain;
  /** Rule confidence in [0, 1]. Explicit/absolute forms score highest;
   * a bare weekday lowest. Hosts can threshold on it. */
  confidence: number;
}

export interface ExtractDatesOptions {
  /** "Today" for relative expressions; its UTC date components are used. */
  reference: Date;
  /** Restrict to these languages. Default: both. */
  languages?: readonly DateLanguage[];
  /**
   * When true, a weekday only matches with a qualifier ("next Friday",
   * not a bare "Friday"). Cuts false positives from prose like
   * "Tuesday's coffee was great". Default false.
   */
  requireWeekdayQualifier?: boolean;
  /**
   * Reading order for slashed numeric dates (`1/2/2026`). Default `'MDY'`,
   * so `3/4/2026` reads as March 4. Set `'DMY'` for day-first locales. A
   * 2-digit year pivots at 50: `00`-`49` map to 2000-2049, `50`-`99` to
   * 1950-1999. Slashed dates carry low confidence (0.7) for this reason.
   */
  numericDateOrder?: 'MDY' | 'DMY';
}

// ─── calendar helpers ──────────────────────────────────────────────

function refMidnight(ref: Date): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
}
function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function isoFromParts(y: number, m: number, day: number): string {
  return iso(new Date(Date.UTC(y, m - 1, day)));
}
// A Gregorian day as an ISO string, or null if the day does not exist in
// that month. Date.UTC rolls "April 31" forward to May 1 instead of
// rejecting it, so a round-trip check is the gate (the Jalali lane already
// validates against month length; this does the same for Gregorian).
function gregorianDay(year: number, month0: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month0, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month0 || d.getUTCDate() !== day) {
    return null;
  }
  return iso(d);
}

// Persian (۰-۹) and Arabic-Indic (٠-٩) digits read as their ASCII value.
const DIGIT = '[0-9\\u06f0-\\u06f9\\u0660-\\u0669]';
function digitsToNumber(s: string): number {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x06f0 && c <= 0x06f9) out += String.fromCharCode(48 + c - 0x06f0);
    else if (c >= 0x0660 && c <= 0x0669) out += String.fromCharCode(48 + c - 0x0660);
    else out += ch;
  }
  return Number(out);
}

// A Jalali day, validated against its month length, as an ISO Gregorian
// day. Out-of-range day or month yields null so the rule skips it.
function jalaliDay(jy: number, jm: number, jd: number): { date: string; grain: DateGrain } | null {
  if (jm < 1 || jm > 12 || jd < 1 || jd > jalaliMonthLength(jy, jm)) return null;
  const g = jalaliToGregorian(jy, jm, jd);
  return { date: isoFromParts(g.gy, g.gm, g.gd), grain: 'day' };
}
function refJalaliYear(ref: Date): number {
  return gregorianToJalali(ref.getUTCFullYear(), ref.getUTCMonth() + 1, ref.getUTCDate()).jy;
}

type WeekdayDirection = 'next' | 'last' | 'upcoming';

// dow is Sunday-based 0..6, matching Date.getUTCDay().
function resolveWeekday(ref: Date, dow: number, direction: WeekdayDirection): Date {
  const today = refMidnight(ref);
  const cur = today.getUTCDay();
  if (direction === 'last') {
    let back = (cur - dow + 7) % 7;
    if (back === 0) back = 7;
    return addDays(today, -back);
  }
  let fwd = (dow - cur + 7) % 7;
  if (direction === 'next' && fwd === 0) fwd = 7; // "next Fri" on a Fri = +7
  return addDays(today, fwd); // 'upcoming' keeps fwd===0 = today
}

// ─── vocab ─────────────────────────────────────────────────────────

const EN_WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};
const EN_MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};
// شنبه=Sat, یکشنبه=Sun, … جمعه=Fri. Listed longest-first so the
// alternation prefers سه‌شنبه over a bare شنبه substring.
const FA_WEEKDAYS: Array<[string, number]> = [
  ['پنج‌شنبه', 4],
  ['پنجشنبه', 4],
  ['سه‌شنبه', 2],
  ['سه شنبه', 2],
  ['یکشنبه', 0],
  ['دوشنبه', 1],
  ['چهارشنبه', 3],
  ['جمعه', 5],
  ['شنبه', 6],
];
// Solar Hijri months. No name is a prefix of another, so alternation
// order is free; مرداد has the امرداد variant, both map to 5.
const FA_MONTHS: Array<[string, number]> = [
  ['فروردین', 1],
  ['اردیبهشت', 2],
  ['خرداد', 3],
  ['تیر', 4],
  ['امرداد', 5],
  ['مرداد', 5],
  ['شهریور', 6],
  ['مهر', 7],
  ['آبان', 8],
  ['آذر', 9],
  ['دی', 10],
  ['بهمن', 11],
  ['اسفند', 12],
];
const FA_MONTH_ALT = FA_MONTHS.map(([w]) => w).join('|');
const SEP = '[\\u200c\\s]+'; // ZWNJ or whitespace between date tokens

interface Rule {
  lang: DateLanguage;
  re: RegExp;
  /** Base confidence; a resolve() may override per match. */
  confidence: number;
  /** Bare weekday — suppressed when opts.requireWeekdayQualifier. */
  bareWeekday?: boolean;
  resolve: (
    m: RegExpExecArray,
    ref: Date,
    opts: ExtractDatesOptions,
  ) => { date: string; grain: DateGrain; confidence?: number } | null;
}

const RULES: Rule[] = [
  // ── absolute (script-neutral, listed first so they win ties) ──
  {
    lang: 'en',
    confidence: 0.95,
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    resolve: (m) => {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const date = gregorianDay(y, mo - 1, d);
      return date ? { date, grain: 'day' } : null;
    },
  },
  {
    lang: 'en',
    confidence: 0.85,
    re: new RegExp(
      `\\b(${Object.keys(EN_MONTHS).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
      'gi',
    ),
    resolve: (m, ref) => {
      const month = EN_MONTHS[m[1]!.toLowerCase()];
      if (month === undefined) return null;
      const day = Number(m[2]);
      if (day < 1 || day > 31) return null;
      const year = m[3] ? Number(m[3]) : ref.getUTCFullYear();
      const date = gregorianDay(year, month, day);
      return date ? { date, grain: 'day', confidence: m[3] ? 0.95 : 0.85 } : null;
    },
  },
  {
    lang: 'en',
    confidence: 0.85,
    re: new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${Object.keys(EN_MONTHS).join('|')})\\.?(?:\\s+(\\d{4}))?\\b`,
      'gi',
    ),
    resolve: (m, ref) => {
      const month = EN_MONTHS[m[2]!.toLowerCase()];
      if (month === undefined) return null;
      const day = Number(m[1]);
      if (day < 1 || day > 31) return null;
      const year = m[3] ? Number(m[3]) : ref.getUTCFullYear();
      const date = gregorianDay(year, month, day);
      return date ? { date, grain: 'day', confidence: m[3] ? 0.95 : 0.85 } : null;
    },
  },
  {
    // Slashed numeric, reading order from opts.numericDateOrder.
    lang: 'en',
    confidence: 0.7,
    re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g,
    resolve: (m, ref, opts) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const monthFirst = (opts.numericDateOrder ?? 'MDY') === 'MDY';
      const month = monthFirst ? a : b;
      const day = monthFirst ? b : a;
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      let year = ref.getUTCFullYear();
      if (m[3]) {
        const n = Number(m[3]);
        year = m[3].length === 2 ? (n < 50 ? 2000 + n : 1900 + n) : n;
      }
      const date = gregorianDay(year, month - 1, day);
      return date ? { date, grain: 'day', confidence: m[3] ? 0.85 : 0.7 } : null;
    },
  },
  // ── English relative ──
  { lang: 'en', confidence: 0.95, re: /\b(today|tonight)\b/gi, resolve: (_m, ref) => ({ date: iso(refMidnight(ref)), grain: 'day' }) },
  { lang: 'en', confidence: 0.9, re: /\bthe day after tomorrow\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 2)), grain: 'day' }) },
  { lang: 'en', confidence: 0.9, re: /\bthe day before yesterday\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -2)), grain: 'day' }) },
  { lang: 'en', confidence: 0.95, re: /\btomorrow\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 1)), grain: 'day' }) },
  { lang: 'en', confidence: 0.95, re: /\byesterday\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -1)), grain: 'day' }) },
  { lang: 'en', confidence: 0.9, re: /\bin\s+(\d{1,3})\s+days?\b/gi, resolve: (m, ref) => ({ date: iso(addDays(refMidnight(ref), Number(m[1]))), grain: 'day' }) },
  { lang: 'en', confidence: 0.9, re: /\bin\s+(\d{1,3})\s+weeks?\b/gi, resolve: (m, ref) => ({ date: iso(addDays(refMidnight(ref), Number(m[1]) * 7)), grain: 'week' }) },
  { lang: 'en', confidence: 0.85, re: /\bnext\s+week\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 7)), grain: 'week' }) },
  { lang: 'en', confidence: 0.85, re: /\blast\s+week\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -7)), grain: 'week' }) },
  {
    lang: 'en',
    confidence: 0.8,
    re: new RegExp(`\\b(next|last|this|on)\\s+(${Object.keys(EN_WEEKDAYS).join('|')})\\b`, 'gi'),
    resolve: (m, ref) => {
      const dow = EN_WEEKDAYS[m[2]!.toLowerCase()];
      if (dow === undefined) return null;
      // 'on'/'this' resolve to the upcoming occurrence (today if it matches).
      const dir = m[1]!.toLowerCase() === 'last' ? 'last' : m[1]!.toLowerCase() === 'next' ? 'next' : 'upcoming';
      return { date: iso(resolveWeekday(ref, dow, dir)), grain: 'day' };
    },
  },
  {
    lang: 'en',
    confidence: 0.6,
    bareWeekday: true,
    re: new RegExp(`\\b(${Object.keys(EN_WEEKDAYS).join('|')})\\b`, 'gi'),
    resolve: (m, ref) => {
      const dow = EN_WEEKDAYS[m[1]!.toLowerCase()];
      if (dow === undefined) return null;
      return { date: iso(resolveWeekday(ref, dow, 'upcoming')), grain: 'day' };
    },
  },
  // ── Persian relative ──
  { lang: 'fa', confidence: 0.95, re: /امروز/g, resolve: (_m, ref) => ({ date: iso(refMidnight(ref)), grain: 'day' }) },
  { lang: 'fa', confidence: 0.9, re: /پس‌?فردا/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 2)), grain: 'day' }) },
  { lang: 'fa', confidence: 0.9, re: /پریروز/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -2)), grain: 'day' }) },
  { lang: 'fa', confidence: 0.95, re: /فردا/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 1)), grain: 'day' }) },
  { lang: 'fa', confidence: 0.95, re: /دیروز/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -1)), grain: 'day' }) },
  { lang: 'fa', confidence: 0.85, re: /هفته[‌\s]?(?:ی[‌\s]?)?(?:بعد|آینده)/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 7)), grain: 'week' }) },
  { lang: 'fa', confidence: 0.85, re: /هفته[‌\s]?(?:ی[‌\s]?)?(?:پیش|گذشته|قبل)/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -7)), grain: 'week' }) },
  {
    // One regex matches bare and qualified; the qualifier gate lives in
    // resolve so qualified Persian weekdays survive requireWeekdayQualifier.
    lang: 'fa',
    confidence: 0.6,
    re: new RegExp(`(${FA_WEEKDAYS.map(([w]) => w).join('|')})(?:[\\u200c\\s]?(?:بعد|آینده|پیش|گذشته))?`, 'g'),
    resolve: (m, ref, opts) => {
      const found = FA_WEEKDAYS.find(([w]) => m[1] === w);
      if (!found) return null;
      const tail = m[0].slice(m[1]!.length);
      const qualified = /پیش|گذشته|بعد|آینده/.test(tail);
      if (!qualified && opts.requireWeekdayQualifier) return null;
      const dir: WeekdayDirection = /پیش|گذشته/.test(tail) ? 'last' : /بعد|آینده/.test(tail) ? 'next' : 'upcoming';
      return { date: iso(resolveWeekday(ref, found[1], dir)), grain: 'day', confidence: qualified ? 0.8 : 0.6 };
    },
  },
  // ── Persian (Jalali) absolute ──
  {
    // "۲۹ خرداد ۱۴۰۵" / "۲۹ خرداد" — day, month name, optional year.
    // A day number is required, which keeps month words that double as
    // common prose (مهر, دی, تیر) from matching on their own.
    lang: 'fa',
    confidence: 0.85,
    re: new RegExp(`(?<!${DIGIT})(${DIGIT}{1,2})${SEP}(${FA_MONTH_ALT})(?:${SEP}(${DIGIT}{3,4})(?!${DIGIT}))?`, 'g'),
    resolve: (m, ref) => {
      const month = FA_MONTHS.find(([w]) => w === m[2])?.[1];
      if (month === undefined) return null;
      const jy = m[3] ? digitsToNumber(m[3]) : refJalaliYear(ref);
      const day = jalaliDay(jy, month, digitsToNumber(m[1]!));
      return day && { ...day, confidence: m[3] ? 0.95 : 0.85 };
    },
  },
  {
    // "خرداد ۱۴۰۵" — month name + year, no day. Month grain.
    lang: 'fa',
    confidence: 0.9,
    re: new RegExp(`(${FA_MONTH_ALT})${SEP}(${DIGIT}{4})(?!${DIGIT})`, 'g'),
    resolve: (m) => {
      const month = FA_MONTHS.find(([w]) => w === m[1])?.[1];
      if (month === undefined) return null;
      const first = jalaliDay(digitsToNumber(m[2]!), month, 1);
      return first && { date: first.date, grain: 'month' };
    },
  },
  {
    // "۱۴۰۵/۳/۲۹" — Jalali numeric, year first. The year band keeps a
    // Gregorian "2026/3/29" (year out of the Jalali range) out of this lane.
    lang: 'fa',
    confidence: 0.9,
    re: new RegExp(`(?<!${DIGIT})(${DIGIT}{4})/(${DIGIT}{1,2})/(${DIGIT}{1,2})(?!${DIGIT})`, 'g'),
    resolve: (m) => {
      const jy = digitsToNumber(m[1]!);
      if (jy < 1000 || jy > 1700) return null;
      return jalaliDay(jy, digitsToNumber(m[2]!), digitsToNumber(m[3]!));
    },
  },
];

/**
 * Extract date expressions and resolve them against `reference`.
 * Overlapping matches are resolved longest-first, so "next Friday" wins
 * over a bare "Friday" inside it. Results are sorted by position.
 */
export function extractDates(text: string, opts: ExtractDatesOptions): DateMention[] {
  const langs = opts.languages;
  const found: DateMention[] = [];
  for (const rule of RULES) {
    if (langs && !langs.includes(rule.lang)) continue;
    if (rule.bareWeekday && opts.requireWeekdayQualifier) continue;
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      const resolved = rule.resolve(m, opts.reference, opts);
      if (resolved) {
        found.push({
          surface_form: m[0],
          span_start: m.index,
          span_end: m.index + m[0].length,
          date: resolved.date,
          grain: resolved.grain,
          confidence: resolved.confidence ?? rule.confidence,
        });
      }
    }
  }
  // Greedy non-overlapping selection: longest match first, then earliest.
  found.sort((a, b) => b.surface_form.length - a.surface_form.length || a.span_start - b.span_start);
  const taken: DateMention[] = [];
  for (const cand of found) {
    if (taken.some((t) => cand.span_start < t.span_end && cand.span_end > t.span_start)) continue;
    taken.push(cand);
  }
  taken.sort((a, b) => a.span_start - b.span_start);
  return taken;
}
