// Adversarial coverage of parseExtractionResponse across the text-length
// matrix (short / medium / long), Persian-specific script hazards, and
// hostile LLM outputs. All texts are built by concatenation so expected
// spans are recorded at construction time, never hand-counted.

import { describe, expect, it } from 'vitest';
import { parseExtractionResponse } from '../src/extract/parse.js';

const FLOOR = 0.7;

type Kind = 'person' | 'place' | 'concept';

interface BuiltMention {
  kind: Kind;
  surface: string;
  start: number;
  end: number;
}

// Concatenation builder: offsets are byproducts of construction, so a
// wrong expected span in a test can only come from a builder bug, not
// from miscounting multibyte characters by eye.
function build(parts: ReadonlyArray<string | readonly [Kind, string]>): {
  text: string;
  mentions: BuiltMention[];
} {
  let text = '';
  const mentions: BuiltMention[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      text += p;
    } else {
      const [kind, surface] = p;
      mentions.push({ kind, surface, start: text.length, end: text.length + surface.length });
      text += surface;
    }
  }
  return { text, mentions };
}

interface LlmMention {
  surface_form: string;
  span_start?: number;
  span_end?: number;
  candidate_label: string;
  candidate_id: string | null;
  confidence: number;
}

function llmMention(m: BuiltMention, spanOffset?: number): LlmMention {
  const out: LlmMention = {
    surface_form: m.surface,
    candidate_label: m.surface,
    candidate_id: null,
    confidence: 0.9,
  };
  if (spanOffset !== undefined) {
    out.span_start = m.start + spanOffset;
    out.span_end = m.end + spanOffset;
  }
  return out;
}

function resp(extraction: unknown): string {
  return JSON.stringify({ extraction });
}

function spansOf(ms: ReadonlyArray<{ surface_form: string; span_start: number; span_end: number }>) {
  return ms.map((m) => ({ surface: m.surface_form, start: m.span_start, end: m.span_end }));
}

function expectedSpans(ms: BuiltMention[], kind: Kind) {
  return ms.filter((m) => m.kind === kind).map((m) => ({ surface: m.surface, start: m.start, end: m.end }));
}

describe('short texts (under 40 chars)', () => {
  it('English: correct LLM spans are taken as-is', () => {
    const { text, mentions } = build(['Saw ', ['person', 'Bahar'], ' at noon.']);
    expect(text.length).toBeLessThan(40);
    const out = parseExtractionResponse(
      resp({ people: [llmMention(mentions[0]!, 0)], places: [], concepts: [] }),
      text,
      FLOOR,
    );
    expect(spansOf(out.people)).toEqual(expectedSpans(mentions, 'person'));
  });

  it('Farsi: a shifted span is repaired even in a tiny text', () => {
    const { text, mentions } = build(['با ', ['person', 'نرگس'], ' حرف زدم']);
    expect(text.length).toBeLessThan(40);
    const out = parseExtractionResponse(
      resp({ people: [llmMention(mentions[0]!, 2)], places: [], concepts: [] }),
      text,
      FLOOR,
    );
    expect(spansOf(out.people)).toEqual(expectedSpans(mentions, 'person'));
    expect(text.substring(out.people[0]!.span_start, out.people[0]!.span_end)).toBe('نرگس');
  });

  it('code-switched FA/EN: both scripts resolve in one line', () => {
    // RTL text with embedded LTR runs is where code-point vs code-unit
    // confusion bites hardest; spans must be plain UTF-16 offsets.
    const { text, mentions } = build([
      'امروز با ',
      ['person', 'Leila'],
      ' رفتیم ',
      ['place', 'cafe'],
    ]);
    expect(text.length).toBeLessThan(40);
    const out = parseExtractionResponse(
      resp({
        people: [llmMention(mentions[0]!, -4)],
        places: [llmMention(mentions[1]!)],
        concepts: [],
      }),
      text,
      FLOOR,
    );
    expect(spansOf(out.people)).toEqual(expectedSpans(mentions, 'person'));
    expect(spansOf(out.places)).toEqual(expectedSpans(mentions, 'place'));
  });
});

describe('medium paragraph (200-500 chars)', () => {
  const { text, mentions } = build([
    ['person', 'Katayoun'],
    ' picked me up early and we drove across town while the radio played quietly the whole way. ',
    ['person', 'Leila'],
    "'s brother met us by the gate with snacks and water bottles for everyone in the group. Later «",
    ['person', 'نرگس'],
    '» joined us near ',
    ['place', 'Lakeshore Park'],
    ' and we walked for an hour talking about work and the summer plans. On the way back ',
    ['person', 'Leila'],
    ' suggested dinner, and the evening ended with a long call from ',
    ['person', 'Bahram'],
  ]);

  it('the matrix dimension holds', () => {
    expect(text.length).toBeGreaterThanOrEqual(200);
    expect(text.length).toBeLessThanOrEqual(500);
  });

  it('mention at position 0, possessive, guillemets, repeats, and a mention flush at the end', () => {
    const people = mentions.filter((m) => m.kind === 'person');
    const [katayoun, leila1, narges, leila2, bahram] = people as [
      BuiltMention,
      BuiltMention,
      BuiltMention,
      BuiltMention,
      BuiltMention,
    ];
    const place = mentions.find((m) => m.kind === 'place')!;
    // Adversarial span choices:
    //  - Katayoun: shifted +3 (must repair back to 0).
    //  - Both Leila mentions claim the FIRST occurrence's exact span;
    //    the consumed-position registry must push the second one to the
    //    second occurrence instead of silently dropping or duplicating.
    //  - Bahram: claimed end runs past the end of the text.
    const out = parseExtractionResponse(
      resp({
        people: [
          llmMention(katayoun, 3),
          llmMention(leila1, 0),
          { ...llmMention(leila2), span_start: leila1.start, span_end: leila1.end },
          llmMention(narges, 1),
          { ...llmMention(bahram), span_start: bahram.start, span_end: bahram.end + 10 },
        ],
        places: [llmMention(place)],
        concepts: [],
      }),
      text,
      FLOOR,
    );
    expect(spansOf(out.people)).toEqual([
      { surface: 'Katayoun', start: katayoun.start, end: katayoun.end },
      { surface: 'Leila', start: leila1.start, end: leila1.end },
      { surface: 'Leila', start: leila2.start, end: leila2.end },
      { surface: 'نرگس', start: narges.start, end: narges.end },
      { surface: 'Bahram', start: bahram.start, end: bahram.end },
    ]);
    expect(spansOf(out.places)).toEqual(expectedSpans(mentions, 'place'));
    // The text ends exactly at a mention boundary; off-by-one clamping
    // bugs show up here first.
    expect(out.people[4]!.span_end).toBe(text.length);
    expect(out.people[0]!.span_start).toBe(0);
  });
});

describe('long text (2000+ chars), every span wrong by 1..50', () => {
  const names: ReadonlyArray<readonly [Kind, string]> = [
    ['person', 'Katayoun Mohebbi'],
    ['person', 'نرگس کاشانی'],
    ['person', 'Ramin Golzar'],
    ['person', 'بهرام تهرانی'],
    ['person', 'Dariush Fanai'],
    ['person', 'شهرزاد بهرامی'],
    ['person', 'Kianoush Saberi'],
    ['person', 'علی‌رضا کریمی'],
    ['person', 'Sahand Moradi'],
    ['person', 'مینا فرهادی'],
    ['person', 'Shirin Tavakoli'],
    ['person', 'سیمین رهنما'],
    ['person', 'Behnam Rastegar'],
    ['person', 'Golnaz Sharifi'],
    ['place', 'Lakeshore Park'],
    ['place', 'کافه سرمه'],
  ];

  const parts: Array<string | readonly [Kind, string]> = [];
  names.forEach((n, i) => {
    parts.push(
      `Paragraph ${i}. The day went on with errands and small chores around the house, nothing remarkable. `,
    );
    parts.push(n);
    parts.push(
      ' came up in conversation later that evening, which was a pleasant surprise after such a quiet week. More notes were written down before bed.\n\n',
    );
  });
  const { text, mentions } = build(parts);

  it('the matrix dimension holds', () => {
    expect(text.length).toBeGreaterThan(2000);
    expect(mentions.length).toBeGreaterThanOrEqual(15);
  });

  it('all 16 mentions are repaired to extract exactly their surface', () => {
    // Deterministic but varied offsets covering the whole 1..50 band;
    // a parser that trusts model offsets past some text length would
    // drop or misplace mentions deep in the document.
    const offsets = mentions.map((_, i) => ((i * 7) % 50) + 1);
    const out = parseExtractionResponse(
      resp({
        people: mentions
          .map((m, i) => ({ m, i }))
          .filter(({ m }) => m.kind === 'person')
          .map(({ m, i }) => llmMention(m, offsets[i]!)),
        places: mentions
          .map((m, i) => ({ m, i }))
          .filter(({ m }) => m.kind === 'place')
          .map(({ m, i }) => llmMention(m, offsets[i]!)),
        concepts: [],
      }),
      text,
      FLOOR,
    );
    expect(spansOf(out.people)).toEqual(expectedSpans(mentions, 'person'));
    expect(spansOf(out.places)).toEqual(expectedSpans(mentions, 'place'));
    for (const m of [...out.people, ...out.places]) {
      expect(text.substring(m.span_start, m.span_end)).toBe(m.surface_form);
    }
  });
});

describe('Farsi script specifics', () => {
  it('ZWNJ inside a surface survives extraction byte-for-byte', () => {
    // The half-space is part of the name; losing it changes the string
    // the resolution layer later normalizes, and the span width.
    const surface = 'علی‌رضا';
    const { text, mentions } = build(['دیروز ', ['person', surface], ' را دیدم']);
    const out = parseExtractionResponse(
      resp({ people: [llmMention(mentions[0]!, 5)], places: [], concepts: [] }),
      text,
      FLOOR,
    );
    expect(spansOf(out.people)).toEqual(expectedSpans(mentions, 'person'));
    const got = text.substring(out.people[0]!.span_start, out.people[0]!.span_end);
    expect(got).toBe(surface);
    expect(got.includes('‌')).toBe(true);
  });

  it('a ZWNJ-less surface for a ZWNJ-joined name is dropped, not fuzzy-found', () => {
    // Pinned per the parse contract: extraction is exact-substring
    // matching, and variant folding belongs to resolution. A parser
    // that starts fuzzy-finding here would return spans that do not
    // extract the surface, breaking the span invariant downstream.
    const { text } = build(['دیروز ', ['person', 'علی‌رضا'], ' را دیدم']);
    const out = parseExtractionResponse(
      resp({
        people: [
          {
            surface_form: 'علیرضا',
            candidate_label: 'علیرضا',
            candidate_id: null,
            confidence: 0.9,
          },
        ],
        places: [],
        concepts: [],
      }),
      text,
      FLOOR,
    );
    expect(out.people).toHaveLength(0);
  });

  it('emoji before a mention: code-point-counted spans are repaired to code units', () => {
    // Each emoji is one code point but two UTF-16 code units. A model
    // counting code points reports spans short by one per preceding
    // astral character; the classic silent-drop bug.
    const { text, mentions } = build(['\u{1F389}\u{1F389} با ', ['person', 'مینا'], ' جشن گرفتیم']);
    const m = mentions[0]!;
    const out = parseExtractionResponse(
      resp({
        people: [{ ...llmMention(m), span_start: m.start - 2, span_end: m.end - 2 }],
        places: [],
        concepts: [],
      }),
      text,
      FLOOR,
    );
    expect(spansOf(out.people)).toEqual(expectedSpans(mentions, 'person'));
    expect(text.substring(out.people[0]!.span_start, out.people[0]!.span_end)).toBe('مینا');
  });

  it('mixed RTL/LTR lines resolve independently', () => {
    const { text, mentions } = build([
      ['person', 'Shirin Tavakoli'],
      ' wrote from Berlin.\n',
      'پاسخ را ',
      ['person', 'مینا فرهادی'],
      ' نوشت',
    ]);
    const out = parseExtractionResponse(
      resp({
        people: [llmMention(mentions[0]!, 7), llmMention(mentions[1]!, -7)],
        places: [],
        concepts: [],
      }),
      text,
      FLOOR,
    );
    expect(spansOf(out.people)).toEqual(expectedSpans(mentions, 'person'));
  });
});

describe('hostile LLM outputs', () => {
  it('duplicate identical mentions beyond the occurrence count are dropped', () => {
    const { text, mentions } = build([['person', 'Bahar'], ' called twice today.']);
    const m = llmMention(mentions[0]!, 0);
    const out = parseExtractionResponse(
      resp({ people: [m, m, m], places: [], concepts: [] }),
      text,
      FLOOR,
    );
    // One occurrence in the text means one mention, no matter how many
    // times the model repeats itself.
    expect(out.people).toHaveLength(1);
    expect(spansOf(out.people)).toEqual(expectedSpans(mentions, 'person'));
  });

  it('a surface that is a substring of another mention claims the first lexical occurrence', () => {
    // The registry consumes exact (start,end) pairs, so "Leila" is not
    // blocked by the consumed "Leila Karimi" span and lands on the
    // prefix of the longer mention, not the later standalone "Leila".
    // Pinned so a future change to occurrence accounting is a
    // conscious decision, not an accident.
    const { text, mentions } = build([
      ['person', 'Leila Karimi'],
      ' waved. Later ',
      ['person', 'Leila'],
      ' left alone.',
    ]);
    const long = mentions[0]!;
    const out = parseExtractionResponse(
      resp({
        people: [
          llmMention(long, 0),
          { surface_form: 'Leila', candidate_label: 'Leila', candidate_id: null, confidence: 0.9 },
        ],
        places: [],
        concepts: [],
      }),
      text,
      FLOOR,
    );
    expect(out.people).toHaveLength(2);
    expect(out.people[0]).toMatchObject({ span_start: long.start, span_end: long.end });
    expect(out.people[1]).toMatchObject({ span_start: long.start, span_end: long.start + 5 });
  });

  it('empty arrays produce the empty extraction', () => {
    const out = parseExtractionResponse(
      resp({ people: [], places: [], concepts: [] }),
      'some text',
      FLOOR,
    );
    expect(out).toEqual({ people: [], places: [], concepts: [] });
  });

  it('extraction key present but per-kind values are not arrays', () => {
    const valid = {
      surface_form: 'park',
      candidate_label: 'park',
      candidate_id: null,
      confidence: 0.9,
    };
    const out = parseExtractionResponse(
      resp({ people: {}, places: { 0: valid }, concepts: 'therapy' }),
      'walked in the park',
      FLOOR,
    );
    expect(out).toEqual({ people: [], places: [], concepts: [] });
  });

  it('extraction itself an array, top-level array, and extraction null all yield empty', () => {
    expect(parseExtractionResponse(resp([]), 'text', FLOOR)).toEqual({
      people: [],
      places: [],
      concepts: [],
    });
    expect(parseExtractionResponse('[1,2]', 'text', FLOOR)).toEqual({
      people: [],
      places: [],
      concepts: [],
    });
    expect(parseExtractionResponse(resp(null), 'text', FLOOR)).toEqual({
      people: [],
      places: [],
      concepts: [],
    });
  });

  it('garbage entries inside a valid array are dropped, valid siblings survive', () => {
    const { text, mentions } = build(['Met ', ['person', 'Golnaz'], ' today.']);
    const out = parseExtractionResponse(
      resp({
        people: ['junk', 42, null, llmMention(mentions[0]!, 0)],
        places: [],
        concepts: [],
      }),
      text,
      FLOOR,
    );
    expect(out.people).toHaveLength(1);
    expect(out.people[0]!.surface_form).toBe('Golnaz');
  });

  it('string confidence falls back to the 0.7 default, applied before the concept floor', () => {
    const { text, mentions } = build(['thinking about ', ['concept', 'gardening']]);
    const m = {
      surface_form: mentions[0]!.surface,
      candidate_label: mentions[0]!.surface,
      candidate_id: null,
      confidence: '0.95',
    };
    const at = (floor: number) =>
      parseExtractionResponse(resp({ people: [], places: [], concepts: [m] }), text, floor);
    // Defaulted 0.7 meets a 0.7 floor but not a 0.75 one; a parser that
    // coerced the string to 0.95 would pass both.
    expect(at(0.7).concepts).toHaveLength(1);
    expect(at(0.7).concepts[0]!.confidence).toBe(0.7);
    expect(at(0.75).concepts).toHaveLength(0);
  });

  it('surface length cap: 200 kept, 201 dropped even when present in the text', () => {
    const okSurface = 'k'.repeat(200);
    const okText = `start ${okSurface} end`;
    const okOut = parseExtractionResponse(
      resp({
        people: [
          { surface_form: okSurface, candidate_label: 'x', candidate_id: null, confidence: 0.9 },
        ],
        places: [],
        concepts: [],
      }),
      okText,
      FLOOR,
    );
    expect(okOut.people).toHaveLength(1);

    const bigSurface = 'q'.repeat(201);
    const bigText = `start ${bigSurface} end`;
    const bigOut = parseExtractionResponse(
      resp({
        people: [
          { surface_form: bigSurface, candidate_label: 'x', candidate_id: null, confidence: 0.9 },
        ],
        places: [],
        concepts: [],
      }),
      bigText,
      FLOOR,
    );
    // Findable but over the cap: the cap must win, or a hostile model
    // can turn whole paragraphs into "mentions".
    expect(bigOut.people).toHaveLength(0);
  });

  it('non-numeric claimed spans fall back to surface search (INTENT)', () => {
    // INTENT: the parse header says model spans are accepted only when
    // they extract the surface exactly, "otherwise the parser searches
    // for the surface in the text", and the README says the model
    // answers WHAT, the library computes WHERE. The implementation
    // instead drops the whole mention when span fields exist with the
    // wrong type (resolveSpan returns null before reaching the search),
    // which is exactly the silent-drop failure the doc warns about.
    const { text, mentions } = build(['Met ', ['person', 'Golnaz'], ' at the library.']);
    const m = mentions[0]!;
    const withSpans = (span_start: unknown, span_end: unknown) =>
      resp({
        people: [
          {
            surface_form: m.surface,
            span_start,
            span_end,
            candidate_label: m.surface,
            candidate_id: null,
            confidence: 0.9,
          },
        ],
        places: [],
        concepts: [],
      });
    expect(parseExtractionResponse(withSpans('4', '10'), text, FLOOR).people).toHaveLength(1);
    expect(parseExtractionResponse(withSpans(4.5, 10.5), text, FLOOR).people).toHaveLength(1);
  });

  it('one-sided claimed span falls back to surface search (INTENT)', () => {
    // INTENT: same contract as above; a missing span_end is a malformed
    // claim, not a reason to lose a findable mention.
    const { text, mentions } = build(['Met ', ['person', 'Golnaz'], ' at the library.']);
    const m = mentions[0]!;
    const out = parseExtractionResponse(
      resp({
        people: [
          {
            surface_form: m.surface,
            span_start: m.start,
            candidate_label: m.surface,
            candidate_id: null,
            confidence: 0.9,
          },
        ],
        places: [],
        concepts: [],
      }),
      text,
      FLOOR,
    );
    expect(out.people).toHaveLength(1);
  });
});
