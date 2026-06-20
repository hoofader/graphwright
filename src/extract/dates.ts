// graphwright/extract — rule-based date extraction.
//
// A deterministic, locale-aware lane that finds date expressions in
// free text and resolves them against a host-supplied reference date.
// No LLM, no dependency: regex rules plus calendar arithmetic. It runs
// the same way every time, which is what makes it the testable floor
// under the model-based extractor (the LLM is the upgrade, this is the
// fallback). English and Persian relative terms are covered; Gregorian
// absolute forms (ISO, month-name) are covered for both scripts. Jalali
// absolute month names are intentionally out of scope for now (calendar
// conversion is a separate, larger lane).
//
// All arithmetic uses the UTC calendar components of `reference`, so a
// caller passes "today" already shifted into the user's timezone and
// gets stable yyyy-mm-dd back, free of host-timezone drift.

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
}

export interface ExtractDatesOptions {
  /** "Today" for relative expressions; its UTC date components are used. */
  reference: Date;
  /** Restrict to these languages. Default: both. */
  languages?: readonly DateLanguage[];
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

interface Rule {
  lang: DateLanguage;
  re: RegExp;
  resolve: (m: RegExpExecArray, ref: Date) => { date: string; grain: DateGrain } | null;
}

const RULES: Rule[] = [
  // ── absolute (script-neutral, listed first so they win ties) ──
  {
    lang: 'en',
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    resolve: (m) => {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return { date: iso(new Date(Date.UTC(y, mo - 1, d))), grain: 'day' };
    },
  },
  {
    lang: 'en',
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
      return { date: iso(new Date(Date.UTC(year, month, day))), grain: 'day' };
    },
  },
  {
    lang: 'en',
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
      return { date: iso(new Date(Date.UTC(year, month, day))), grain: 'day' };
    },
  },
  // ── English relative ──
  { lang: 'en', re: /\b(today|tonight)\b/gi, resolve: (_m, ref) => ({ date: iso(refMidnight(ref)), grain: 'day' }) },
  { lang: 'en', re: /\bthe day after tomorrow\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 2)), grain: 'day' }) },
  { lang: 'en', re: /\bthe day before yesterday\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -2)), grain: 'day' }) },
  { lang: 'en', re: /\btomorrow\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 1)), grain: 'day' }) },
  { lang: 'en', re: /\byesterday\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -1)), grain: 'day' }) },
  { lang: 'en', re: /\bin\s+(\d{1,3})\s+days?\b/gi, resolve: (m, ref) => ({ date: iso(addDays(refMidnight(ref), Number(m[1]))), grain: 'day' }) },
  { lang: 'en', re: /\bin\s+(\d{1,3})\s+weeks?\b/gi, resolve: (m, ref) => ({ date: iso(addDays(refMidnight(ref), Number(m[1]) * 7)), grain: 'week' }) },
  { lang: 'en', re: /\bnext\s+week\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 7)), grain: 'week' }) },
  { lang: 'en', re: /\blast\s+week\b/gi, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -7)), grain: 'week' }) },
  {
    lang: 'en',
    re: new RegExp(`\\b(next|last|this)\\s+(${Object.keys(EN_WEEKDAYS).join('|')})\\b`, 'gi'),
    resolve: (m, ref) => {
      const dow = EN_WEEKDAYS[m[2]!.toLowerCase()];
      if (dow === undefined) return null;
      const dir = m[1]!.toLowerCase() === 'last' ? 'last' : m[1]!.toLowerCase() === 'next' ? 'next' : 'upcoming';
      return { date: iso(resolveWeekday(ref, dow, dir)), grain: 'day' };
    },
  },
  {
    lang: 'en',
    re: new RegExp(`\\b(${Object.keys(EN_WEEKDAYS).join('|')})\\b`, 'gi'),
    resolve: (m, ref) => {
      const dow = EN_WEEKDAYS[m[1]!.toLowerCase()];
      if (dow === undefined) return null;
      return { date: iso(resolveWeekday(ref, dow, 'upcoming')), grain: 'day' };
    },
  },
  // ── Persian relative ──
  { lang: 'fa', re: /امروز/g, resolve: (_m, ref) => ({ date: iso(refMidnight(ref)), grain: 'day' }) },
  { lang: 'fa', re: /پس‌?فردا/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 2)), grain: 'day' }) },
  { lang: 'fa', re: /پریروز/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -2)), grain: 'day' }) },
  { lang: 'fa', re: /فردا/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 1)), grain: 'day' }) },
  { lang: 'fa', re: /دیروز/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -1)), grain: 'day' }) },
  { lang: 'fa', re: /هفته[‌\s]?(?:ی[‌\s]?)?(?:بعد|آینده)/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), 7)), grain: 'week' }) },
  { lang: 'fa', re: /هفته[‌\s]?(?:ی[‌\s]?)?(?:پیش|گذشته|قبل)/g, resolve: (_m, ref) => ({ date: iso(addDays(refMidnight(ref), -7)), grain: 'week' }) },
  {
    lang: 'fa',
    re: new RegExp(`(${FA_WEEKDAYS.map(([w]) => w).join('|')})(?:[\\u200c\\s]?(?:بعد|آینده|پیش|گذشته))?`, 'g'),
    resolve: (m, ref) => {
      const found = FA_WEEKDAYS.find(([w]) => m[1] === w);
      if (!found) return null;
      const tail = m[0].slice(m[1]!.length);
      const dir: WeekdayDirection = /پیش|گذشته/.test(tail) ? 'last' : /بعد|آینده/.test(tail) ? 'next' : 'upcoming';
      return { date: iso(resolveWeekday(ref, found[1], dir)), grain: 'day' };
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
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      const resolved = rule.resolve(m, opts.reference);
      if (resolved) {
        found.push({
          surface_form: m[0],
          span_start: m.index,
          span_end: m.index + m[0].length,
          date: resolved.date,
          grain: resolved.grain,
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
