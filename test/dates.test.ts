import { describe, expect, it } from 'vitest';
import { extractDates } from '../src/extract/dates.js';

// Wednesday, 2026-05-20.
const REF = new Date(Date.UTC(2026, 4, 20));
const at = (text: string) => extractDates(text, { reference: REF });
const dates = (text: string) => at(text).map((m) => m.date);

describe('English relative dates', () => {
  it('today / tomorrow / yesterday', () => {
    expect(dates('see you today')).toEqual(['2026-05-20']);
    expect(dates('see you tomorrow')).toEqual(['2026-05-21']);
    expect(dates('we talked yesterday')).toEqual(['2026-05-19']);
  });

  it('the longer phrase wins over the word inside it', () => {
    const out = at('the day after tomorrow');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: '2026-05-22', surface_form: 'the day after tomorrow' });
    expect(dates('the day before yesterday')).toEqual(['2026-05-18']);
  });

  it('in N days / weeks', () => {
    expect(dates('in 3 days')).toEqual(['2026-05-23']);
    expect(dates('in 2 weeks')).toEqual(['2026-06-03']);
  });

  it('next / last / this weekday', () => {
    expect(dates('next Friday')).toEqual(['2026-05-22']);
    expect(dates('this Monday')).toEqual(['2026-05-25']);
    expect(dates('last Monday')).toEqual(['2026-05-18']);
  });

  it('a bare weekday resolves to the upcoming one', () => {
    expect(dates('lunch on Monday')).toEqual(['2026-05-25']);
  });

  it('next / last week', () => {
    expect(dates('next week')).toEqual(['2026-05-27']);
    expect(dates('last week')).toEqual(['2026-05-13']);
  });

  it('does not double-match "next Friday" as a bare Friday too', () => {
    const out = at('coffee next Friday afternoon');
    expect(out).toHaveLength(1);
    expect(out[0]!.surface_form).toBe('next Friday');
  });
});

describe('absolute dates', () => {
  it('ISO', () => {
    expect(dates('on 2026-05-24')).toEqual(['2026-05-24']);
  });
  it('month-name forms, with and without year', () => {
    expect(dates('her birthday is May 24')).toEqual(['2026-05-24']);
    expect(dates('born 24 May 2025')).toEqual(['2025-05-24']);
    expect(dates('December 1, 2026 deadline')).toEqual(['2026-12-01']);
  });
});

describe('Persian relative dates', () => {
  it('امروز / فردا / دیروز', () => {
    expect(dates('امروز رفتیم')).toEqual(['2026-05-20']);
    expect(dates('فردا می‌بینمت')).toEqual(['2026-05-21']);
    expect(dates('دیروز اومد')).toEqual(['2026-05-19']);
  });
  it('پس‌فردا / پریروز (with and without ZWNJ)', () => {
    expect(dates('پس‌فردا')).toEqual(['2026-05-22']);
    expect(dates('پسفردا')).toEqual(['2026-05-22']);
    expect(dates('پریروز')).toEqual(['2026-05-18']);
  });
  it('هفته بعد / هفته پیش', () => {
    expect(dates('هفته بعد قرار داریم')).toEqual(['2026-05-27']);
    expect(dates('هفته پیش بود')).toEqual(['2026-05-13']);
  });
  it('weekday: جمعه upcoming, دوشنبه upcoming', () => {
    expect(dates('جمعه می‌رویم')).toEqual(['2026-05-22']);
    expect(dates('دوشنبه کلاس دارم')).toEqual(['2026-05-25']);
  });
});

describe('mechanics', () => {
  it('returns multiple dates sorted by position with correct spans', () => {
    const text = 'met yesterday, meeting next Friday';
    const out = at(text);
    expect(out.map((m) => m.date)).toEqual(['2026-05-19', '2026-05-22']);
    for (const m of out) expect(text.slice(m.span_start, m.span_end)).toBe(m.surface_form);
  });

  it('the language filter excludes the other script', () => {
    const text = 'tomorrow فردا';
    expect(extractDates(text, { reference: REF, languages: ['en'] }).map((m) => m.date)).toEqual([
      '2026-05-21',
    ]);
    expect(extractDates(text, { reference: REF, languages: ['fa'] }).map((m) => m.date)).toEqual([
      '2026-05-21',
    ]);
  });

  it('plain text yields nothing', () => {
    expect(at('just a quiet evening at home')).toEqual([]);
  });
});

describe('confidence', () => {
  it('absolute forms score higher than a bare weekday', () => {
    expect(at('2026-05-24')[0]!.confidence).toBeGreaterThan(0.9);
    expect(at('see you tomorrow')[0]!.confidence).toBeGreaterThan(0.9);
    expect(at('grabbing lunch Monday')[0]!.confidence).toBeLessThan(0.7);
    // month-name without a year is less certain than with one.
    expect(at('May 24')[0]!.confidence).toBeLessThan(at('May 24, 2025')[0]!.confidence);
  });
});

describe('requireWeekdayQualifier', () => {
  const strict = (text: string) =>
    extractDates(text, { reference: REF, requireWeekdayQualifier: true }).map((m) => m.surface_form);

  it('drops a bare weekday but keeps a qualified one (English)', () => {
    expect(strict('grabbing lunch Monday')).toEqual([]);
    expect(strict('coffee next Friday')).toEqual(['next Friday']);
    // "on Monday" is a qualifier, so it survives the strict gate.
    expect(extractDates('lunch on Monday', { reference: REF, requireWeekdayQualifier: true }).map((m) => m.date)).toEqual([
      '2026-05-25',
    ]);
  });

  it('drops a bare weekday but keeps a qualified one (Persian)', () => {
    expect(strict('جمعه می‌رویم')).toEqual([]);
    expect(extractDates('جمعه بعد می‌رویم', { reference: REF, requireWeekdayQualifier: true }).map((m) => m.date)).toEqual([
      '2026-05-22',
    ]);
  });
});

describe('Persian (Jalali) absolute dates', () => {
  it('day month year', () => {
    expect(dates('۲۹ خرداد ۱۴۰۵ رفتیم')).toEqual(['2026-06-19']);
    expect(dates('۲۲ بهمن ۱۳۵۷')).toEqual(['1979-02-11']); // the revolution
  });

  it('day month without a year resolves against the reference year', () => {
    // REF is 30 Ordibehesht 1405, so a bare "۲۹ خرداد" means 1405.
    const out = at('قرار ۲۹ خرداد داریم');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: '2026-06-19', grain: 'day' });
  });

  it('month + year is a month grain', () => {
    const out = at('خرداد ۱۴۰۵');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: '2026-05-22', grain: 'month' });
  });

  it('numeric year/month/day in Persian, Latin, and Arabic-Indic digits', () => {
    expect(dates('۱۴۰۵/۳/۲۹')).toEqual(['2026-06-19']);
    expect(dates('1405/3/29')).toEqual(['2026-06-19']);
    expect(dates('١٤٠٥/٣/٢٩')).toEqual(['2026-06-19']);
  });

  it('Esfand 30 resolves in a leap year, degrades to the month otherwise', () => {
    expect(dates('۳۰ اسفند ۱۴۰۳')).toEqual(['2025-03-20']); // 1403 leap: a real 30th
    // 1402 is common (no 30 Esfand); the day drops, the month still resolves.
    const common = at('۳۰ اسفند ۱۴۰۲');
    expect(common).toHaveLength(1);
    expect(common[0]).toMatchObject({ date: '2024-02-20', grain: 'month', surface_form: 'اسفند ۱۴۰۲' });
  });

  it('the day-with-year form wins over the month+year inside it', () => {
    const out = at('۲۹ خرداد ۱۴۰۵');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ surface_form: '۲۹ خرداد ۱۴۰۵', grain: 'day' });
  });

  it('a four-digit Gregorian-range year stays out of the Jalali lane', () => {
    // 2026 is outside the Jalali band, so this is not read as 1405-era.
    expect(dates('2026/3/29')).not.toContain('2026-06-19');
  });

  it('a month word in prose without a number is not a date', () => {
    expect(at('دیروز مهربون بود')).toHaveLength(1); // only دیروز (yesterday)
    expect(at('دیروز مهربون بود')[0]!.date).toBe('2026-05-19');
  });

  it('confidence: with-year numeric/explicit beats a bare day-month', () => {
    expect(at('۱۴۰۵/۳/۲۹')[0]!.confidence).toBeGreaterThan(0.85);
    expect(at('۲۹ خرداد ۱۴۰۵')[0]!.confidence).toBeGreaterThan(at('۲۹ خرداد')[0]!.confidence);
  });
});

describe('slashed numeric dates', () => {
  it('M/D and M/D/YYYY (default MDY)', () => {
    expect(dates('on 5/24')).toEqual(['2026-05-24']);
    expect(dates('on 5/24/2025')).toEqual(['2025-05-24']);
  });
  it('two-digit year window', () => {
    expect(dates('1/2/30')).toEqual(['2030-01-02']);
    expect(dates('1/2/85')).toEqual(['1985-01-02']);
  });
  it('DMY reading order', () => {
    expect(
      extractDates('24/5/2025', { reference: REF, numericDateOrder: 'DMY' }).map((m) => m.date),
    ).toEqual(['2025-05-24']);
  });
  it('rejects an impossible month', () => {
    expect(dates('13/24')).toEqual([]);
  });
});
