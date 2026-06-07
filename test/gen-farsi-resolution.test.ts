// Adversarial coverage of the resolution cascade on Persian and English
// names: exact-stage normalization depth, entropy-gate boundaries, fuzzy
// typo families, ambiguity handling, the LSH cutover, and intra-batch
// judge economics. All names are invented.

import { describe, expect, it } from 'vitest';
import { resolveCandidates, type CatalogEntity } from '../src/resolve/cascade.js';
import { normalizeName } from '../src/resolve/normalize.js';
import { passesEntropyGate, shannonEntropy } from '../src/resolve/entropy.js';
import { jaccard, shingles } from '../src/resolve/minhash.js';

const CATALOG: CatalogEntity[] = [
  { id: 'p01', kind: 'person', label: 'نرگس کاشانی', aliases: ['Narges Kashani', 'نرگس'] },
  { id: 'p02', kind: 'person', label: 'بهرام تهرانی', aliases: ['Bahram Tehrani'] },
  { id: 'p03', kind: 'person', label: 'Shahrzad Bahrami', aliases: ['شهرزاد بهرامی'] },
  { id: 'p04', kind: 'person', label: 'علی‌رضا کریمی', aliases: ['Alireza Karimi'] },
  { id: 'p05', kind: 'person', label: 'Katayoun Mohebbi', aliases: ['کتایون محبی'] },
  { id: 'p06', kind: 'person', label: 'Ramin Golzar', aliases: ['رامین گلزار'] },
  { id: 'p07', kind: 'person', label: 'مینا فرهادی', aliases: ['Mina Farhadi'] },
  { id: 'p08', kind: 'person', label: 'Dariush Fanai', aliases: ['داریوش فنایی'] },
  { id: 'p09', kind: 'person', label: 'سیمین رهنما', aliases: ['Simin Rahnama'] },
  { id: 'p10', kind: 'person', label: 'Kianoush Saberi', aliases: ['کیانوش صابری'] },
  { id: 'p11', kind: 'person', label: 'گلناز شریفی', aliases: ['Golnaz Sharifi'] },
  { id: 'p12', kind: 'person', label: 'Sahand Moradi', aliases: ['سهند مرادی'] },
  { id: 'p13', kind: 'person', label: 'سامان رستگار', aliases: ['Saman Rastegar'] },
];

async function resolveOneLabel(
  label: string,
  catalog: CatalogEntity[] = CATALOG,
  opts: Parameters<typeof resolveCandidates>[2] = {},
) {
  const out = await resolveCandidates([{ ref: 'c1', kind: 'person', label }], catalog, opts);
  expect(out).toHaveLength(1);
  return out[0]!;
}

function toFullwidth(s: string): string {
  return [...s]
    .map((c) => {
      const code = c.codePointAt(0)!;
      if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
        return String.fromCodePoint(code + 0xfee0);
      }
      return c;
    })
    .join('');
}

describe('exact stage — script and keyboard variants must meet at exact, not fuzzy', () => {
  const exactCases: Array<[name: string, candidate: string, expected: string]> = [
    // NFKC: fullwidth Latin shows up via copy-paste from formatted sources.
    ['fullwidth Latin', toFullwidth('Katayoun Mohebbi'), 'p05'],
    // NFKC: Arabic presentation forms are what PDF copy-paste yields.
    ['Arabic presentation forms', 'ﺷﻬﺮﺯﺍﺩ بهرامی', 'p03'],
    // Arabic-keyboard yeh and kaf, and no ZWNJ, against a ZWNJ-joined label.
    ['Arabic yeh/kaf, ZWNJ dropped', 'عليرضا كريمي', 'p04'],
    ['diacritic-laden spelling', 'نَرگِس کاشانی', 'p01'],
    ['tatweel padding', 'بهـــرام تهرانی', 'p02'],
    ['ZWNJ-less variant of a ZWNJ label', 'علیرضا کریمی', 'p04'],
    ['guillemets plus diacritic', '«شَهرزاد بهرامی»', 'p03'],
    ['trailing comma, lower case', 'katayoun mohebbi,', 'p05'],
    ['upper-case Latin alias of a Persian label', 'NARGES KASHANI', 'p01'],
    ['Arabic-yeh Persian alias of a Latin label', 'سهند مرادي', 'p12'],
  ];

  for (const [name, candidate, expected] of exactCases) {
    it(name, async () => {
      const p = await resolveOneLabel(candidate);
      expect(p).toMatchObject({
        entity_id: expected,
        basis: 'exact',
        score: 1,
        requires_review: false,
      });
    });
  }
});

describe('entropy gate boundaries', () => {
  it('3-char Persian name never fuzzy-matches, even with a near-zero threshold', async () => {
    // shingles("سام") is the whole string and sits inside "سامان
    // رستگار" at jaccard 1/11; without the gate a 0.05 threshold would
    // merge a three-letter name into a different person.
    const n = normalizeName('سام');
    expect(shannonEntropy(n)).toBeLessThan(2);
    expect(jaccard(shingles(n), shingles(normalizeName('سامان رستگار')))).toBeGreaterThan(0.05);
    const p = await resolveOneLabel('سام', CATALOG, { fuzzyThreshold: 0.05 });
    expect(p).toMatchObject({ entity_id: null, basis: 'none', requires_review: true });
  });

  it('5-char name with a repeated letter is still below the gate', async () => {
    // "سامان" has high lexical overlap with the catalog entry (3/11)
    // but its repeated alef keeps entropy under 2 bits; the gate must
    // block it even when the threshold alone would admit it.
    const n = normalizeName('سامان');
    expect(shannonEntropy(n)).toBeLessThan(2);
    expect(jaccard(shingles(n), shingles(normalizeName('سامان رستگار')))).toBeGreaterThan(0.2);
    const p = await resolveOneLabel('سامان', CATALOG, { fuzzyThreshold: 0.2 });
    expect(p).toMatchObject({ entity_id: null, basis: 'none', requires_review: true });
  });

  it('a name at exactly 2.0 bits passes the gate (>= semantics pinned)', async () => {
    // Four distinct characters once each is exactly 2 bits. If the gate
    // ever flips to strict greater-than, this name silently changes
    // category; pin it.
    const n = normalizeName('مینا');
    expect(shannonEntropy(n)).toBe(2);
    expect(passesEntropyGate(n)).toBe(true);
    // Admitted to fuzzy: matches when the threshold is low enough...
    const loose = await resolveOneLabel('مینا', CATALOG, { fuzzyThreshold: 0.2 });
    expect(loose).toMatchObject({ entity_id: 'p07', basis: 'fuzzy', requires_review: true });
    // ...and falls to create-new at the default threshold, because a
    // 4-char name shares only 2 of 9 shingles with the full name.
    const strict = await resolveOneLabel('مینا');
    expect(strict).toMatchObject({ entity_id: null, basis: 'none' });
  });
});

describe('fuzzy typo families on 12+ char names', () => {
  const J = (a: string, b: string) => jaccard(shingles(normalizeName(a)), shingles(normalizeName(b)));

  const typoCases: Array<[name: string, candidate: string, original: string, expected: string]> = [
    ['dropped letter (EN)', 'Shahrzad Bahrmi', 'Shahrzad Bahrami', 'p03'],
    ['doubled letter (EN)', 'Kianoussh Saberi', 'Kianoush Saberi', 'p10'],
    ['swapped adjacent letters (EN)', 'Katayuon Mohebbi', 'Katayoun Mohebbi', 'p05'],
    ['dropped letter (FA)', 'بهرام تهرنی', 'بهرام تهرانی', 'p02'],
  ];

  for (const [name, candidate, original, expected] of typoCases) {
    it(`${name} resolves fuzzy to the right entity`, async () => {
      // Sanity-pin the similarity first so a threshold tweak in the
      // test is never mistaken for a cascade regression.
      expect(J(candidate, original)).toBeGreaterThan(0.5);
      // The phonetic stage would intercept these fixtures; this test
      // pins the fuzzy lane in isolation.
      const p = await resolveOneLabel(candidate, CATALOG, {
        fuzzyThreshold: 0.5,
        phoneticSchemes: [],
      });
      expect(p).toMatchObject({ entity_id: expected, basis: 'fuzzy', requires_review: true });
      expect(p.score).toBeGreaterThan(0.5);
      expect(p.score).toBeLessThan(1);
    });
  }

  it('default threshold 0.82 rejects even a one-letter doubling at 0.8', async () => {
    // The doubled-letter family lands just under the default cut.
    // Pinned so a default change is visible: hosts relying on the
    // conservative default would start auto-surfacing these.
    expect(J('Kianoussh Saberi', 'Kianoush Saberi')).toBeCloseTo(0.8, 10);
    const p = await resolveOneLabel('Kianoussh Saberi');
    expect(p).toMatchObject({ entity_id: null, basis: 'none', requires_review: true });
  });

  it('sibling names one consonant apart must not match at any stage', async () => {
    // "نرجس" and "نرگس" are different real-world names. Normalization
    // must not fold jeem to gaf, and 3-gram overlap is zero, so the
    // cascade must propose create-new with review.
    expect(normalizeName('نرجس')).not.toBe(normalizeName('نرگس'));
    expect(J('نرجس', 'نرگس')).toBe(0);
    const p = await resolveOneLabel('نرجس');
    expect(p).toMatchObject({
      entity_id: null,
      basis: 'none',
      score: 0,
      requires_review: true,
    });
  });
});

describe('ambiguity — two close catalog hits suppress the judge', () => {
  // Duplicate catalog rows (same person entered twice) are the data
  // problem the cascade refuses to auto-resolve: identical labels give
  // identical scores, and the doc contract says an ambiguous result
  // goes to review regardless of the judge's answer.
  const dupCatalog: CatalogEntity[] = [
    { id: 'dupA', kind: 'person', label: 'Shahrokh Malekzadeh', aliases: [] },
    { id: 'dupB', kind: 'person', label: 'Shahrokh Malekzadeh', aliases: [] },
  ];

  it('judge is not consulted and the proposal stays review-only', async () => {
    let judgeCalls = 0;
    const p = await resolveOneLabel('Shahrokh Malekzade', dupCatalog, {
      phoneticSchemes: [],
      judge: async () => {
        judgeCalls++;
        return { same: true, confidence: 0.99 };
      },
    });
    expect(judgeCalls).toBe(0);
    expect(p.basis).toBe('fuzzy');
    expect(p.requires_review).toBe(true);
    expect(['dupA', 'dupB']).toContain(p.entity_id);
  });

  it('control: with the duplicate removed the judge runs', async () => {
    // Proves the previous test exercised the ambiguity rule and not a
    // missing fuzzy hit or an exhausted budget.
    let judgeCalls = 0;
    const p = await resolveOneLabel('Shahrokh Malekzade', [dupCatalog[0]!], {
      phoneticSchemes: [],
      judge: async () => {
        judgeCalls++;
        return { same: true, confidence: 0.9 };
      },
    });
    expect(judgeCalls).toBe(1);
    expect(p).toMatchObject({ entity_id: 'dupA', basis: 'judge', requires_review: true });
  });
});

describe('LSH cutover (catalog > 500)', () => {
  // Deterministic filler in Latin script: zero shingle overlap with the
  // Persian targets, so any false hit comes from the LSH path itself.
  const syll = [
    'bar', 'den', 'fol', 'gim', 'hap', 'jul', 'kor', 'lem',
    'nim', 'pol', 'qur', 'set', 'tav', 'vex', 'wul', 'yor',
  ];
  const bigCatalog: CatalogEntity[] = [];
  for (let i = 0; i < 640; i++) {
    bigCatalog.push({
      id: `filler${i}`,
      kind: 'person',
      label: `${syll[i % 16]}${syll[(i * 3) % 16]} ${syll[(i * 5) % 16]}${syll[(i * 7) % 16]} ${i}`,
      aliases: [],
    });
  }
  bigCatalog.push({ id: 'tgt', kind: 'person', label: 'شهربانو گلپایگانی', aliases: [] });
  bigCatalog.push({
    id: 'ext',
    kind: 'person',
    label: 'گلنوش پارسانیا',
    aliases: ['Golnoush Parsania'],
  });

  it('the catalog actually crosses the default cutover', () => {
    expect(bigCatalog.length).toBeGreaterThan(500);
  });

  it('exact matches still resolve past the cutover', async () => {
    const p = await resolveOneLabel('golnoush parsania', bigCatalog);
    expect(p).toMatchObject({ entity_id: 'ext', basis: 'exact', requires_review: false });
  });

  it('LSH pruning does not lose a 0.9-jaccard fuzzy candidate', async () => {
    const candidate = 'شهربانو گلپایگان';
    const sim = jaccard(
      shingles(normalizeName(candidate)),
      shingles(normalizeName('شهربانو گلپایگانی')),
    );
    expect(sim).toBeGreaterThanOrEqual(0.9);
    // The phonetic stage would intercept this fixture; this test pins
    // the LSH-pruned fuzzy lane in isolation.
    const p = await resolveOneLabel(candidate, bigCatalog, { phoneticSchemes: [] });
    expect(p).toMatchObject({ entity_id: 'tgt', basis: 'fuzzy', requires_review: true });
    expect(p.score).toBeCloseTo(sim, 10);
  });

  it('LSH path and all-pairs path agree on the same input', async () => {
    // LSH is an optimization; if pruning changes the proposal, recall
    // has silently regressed. Phonetic is off so the comparison stays
    // about the fuzzy lane and is not satisfied upstream of it.
    const candidate = 'شهربانو گلپایگان';
    const viaLsh = await resolveOneLabel(candidate, bigCatalog, { phoneticSchemes: [] });
    const viaAllPairs = await resolveOneLabel(candidate, bigCatalog, {
      lshCutover: 1_000_000,
      phoneticSchemes: [],
    });
    expect(viaLsh).toEqual(viaAllPairs);
  });
});

describe('batch consistency and judge economics', () => {
  // 30 candidates: 12 surface variants of one typo, 8 of another, 10
  // novel names. Variants of the same typo normalize identically, so
  // the cascade must resolve each typo once and fan the result out.
  const typoA = [
    'Katayoun Mohebi',
    'katayoun mohebi',
    '«Katayoun Mohebi»',
    'Katayoun   Mohebi',
    'KATAYOUN MOHEBI',
    'Katayoun Mohebi,',
  ];
  const typoB = ['Ramin Golzaar', 'ramin golzaar', 'Ramin   Golzaar', '«Ramin Golzaar»'];
  const novel = Array.from({ length: 10 }, (_, i) => `Novel Stranger ${i} Farfield`);

  function batch() {
    const candidates: Array<{ ref: string; kind: string; label: string }> = [];
    for (let i = 0; i < 12; i++) candidates.push({ ref: `a${i}`, kind: 'person', label: typoA[i % typoA.length]! });
    for (let i = 0; i < 8; i++) candidates.push({ ref: `b${i}`, kind: 'person', label: typoB[i % typoB.length]! });
    novel.forEach((label, i) => candidates.push({ ref: `n${i}`, kind: 'person', label }));
    return candidates;
  }

  it('judge calls stay at the number of distinct fuzzy groups, not the batch size', async () => {
    let judgeCalls = 0;
    // The phonetic stage would intercept the typo groups before the
    // judge; this test pins judge economics on the fuzzy lane.
    const out = await resolveCandidates(batch(), CATALOG, {
      fuzzyThreshold: 0.6,
      phoneticSchemes: [],
      judge: async () => {
        judgeCalls++;
        return { same: true, confidence: 0.9 };
      },
    });
    expect(out).toHaveLength(30);
    // Two typo groups hit fuzzy; novel names never reach the judge.
    expect(judgeCalls).toBe(2);
    for (const p of out.filter((p) => p.ref.startsWith('a'))) {
      expect(p).toMatchObject({ entity_id: 'p05', basis: 'judge', requires_review: true });
    }
    for (const p of out.filter((p) => p.ref.startsWith('b'))) {
      expect(p).toMatchObject({ entity_id: 'p06', basis: 'judge', requires_review: true });
    }
    for (const p of out.filter((p) => p.ref.startsWith('n'))) {
      expect(p).toMatchObject({ entity_id: null, basis: 'none', requires_review: true });
    }
  });

  it('budget cap degrades later groups to the deterministic fuzzy answer', async () => {
    let judgeCalls = 0;
    // The phonetic stage would intercept the typo groups before the
    // judge; this test pins the budget cap on the fuzzy lane.
    const out = await resolveCandidates(batch(), CATALOG, {
      fuzzyThreshold: 0.6,
      judgeBudget: 1,
      phoneticSchemes: [],
      judge: async () => {
        judgeCalls++;
        return { same: true, confidence: 0.9 };
      },
    });
    expect(judgeCalls).toBe(1);
    // First-seen group consumed the budget; the second group must keep
    // its fuzzy proposal instead of being silently dropped or judged.
    for (const p of out.filter((p) => p.ref.startsWith('a'))) {
      expect(p.basis).toBe('judge');
    }
    for (const p of out.filter((p) => p.ref.startsWith('b'))) {
      expect(p).toMatchObject({ entity_id: 'p06', basis: 'fuzzy', requires_review: true });
    }
  });
});
