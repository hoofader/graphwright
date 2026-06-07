// Property-style invariants over the normalization and similarity
// layers, hand-rolled with deterministic fixture loops instead of a
// property-testing dependency. Every fixture is built from parts, so
// the expected value exists by construction and a failure message
// carries the offending string. All names invented.

import { describe, expect, it } from 'vitest';
import {
  resolveCandidates,
  type CatalogEntity,
  type ResolutionCandidate,
} from '../src/resolve/cascade.js';
import { normalizeName } from '../src/resolve/normalize.js';
import { estimateJaccard, jaccard, minhashSignature, shingles } from '../src/resolve/minhash.js';

// ─── fixture corpora ─────────────────────────────────────────────────

const ZWNJ = '‌';
const FATHA = 'َ';
const TATWEEL = 'ـ';

const EN_FIRST = ['Katayoun', 'Ramin', 'Shahrzad', 'Dariush', 'Golnaz', 'Kianoush', 'Sahand', 'Simin'];
const EN_LAST = ['Mohebbi', 'Golzar', 'Bahrami', 'Fanai', 'Sharifi', 'Saberi'];
const FA_FIRST = ['نرگس', 'بهرام', 'شهرزاد', 'کتایون', 'رامین', 'مینا', 'داریوش', 'سیمین', 'ستاره'];
const FA_LAST = ['کاشانی', 'تهرانی', 'بهرامی', 'محبی', 'گلزار', 'فرهادی'];

const cross = (firsts: string[], lasts: string[]) =>
  firsts.flatMap((f) => lasts.map((l) => `${f} ${l}`));

const englishNames = cross(EN_FIRST, EN_LAST); // 48
const persianNames = cross(FA_FIRST, FA_LAST); // 54
const mixedScript = [
  ...cross(EN_FIRST, FA_LAST.slice(0, 3)), // 24
  ...cross(FA_FIRST.slice(0, 8), EN_LAST.slice(0, 3)), // 24
];

// Keyboard and typography variants of the Persian base: Arabic yeh,
// Arabic kaf, an inserted diacritic, tatweel padding, an inserted
// ZWNJ. Cycled so every transform hits multiple names.
const persianVariants = persianNames.map((name, i) => {
  switch (i % 5) {
    case 0:
      return name.replace(/ی/g, 'ي');
    case 1:
      return name.replace(/ک/g, 'ك');
    case 2:
      return name.slice(0, 2) + FATHA + name.slice(2);
    case 3:
      return name.slice(0, 1) + TATWEEL + name.slice(1);
    default:
      return name.slice(0, 2) + ZWNJ + name.slice(2);
  }
});

const WRAPS: ReadonlyArray<readonly [string, string]> = [
  ['«', '»'],
  ['"', '"'],
  ["'", "'"],
  ['(', ')'],
  ['', ','],
  ['', '.'],
  ['،', ''],
  ['“', '”'],
];
const wrapBase = [...englishNames.slice(0, 3), ...persianNames.slice(0, 3)];
const punctuationWrapped = wrapBase.flatMap((n) => WRAPS.map(([l, r]) => `${l}${n}${r}`)); // 48

const NOISERS: ReadonlyArray<(s: string) => string> = [
  (s) => `  ${s}`,
  (s) => `${s}  `,
  (s) => ` ${s} `,
  (s) => s.replace(' ', '   '),
  (s) => s.replace(' ', '\t'),
  (s) => s.replace(' ', ' \t '),
];
const noiseBase = [...englishNames.slice(0, 4), ...persianNames.slice(0, 4)];
const whitespaceNoised = noiseBase.flatMap((n) => NOISERS.map((f) => f(n))); // 48

const allCorpora = [
  ...englishNames,
  ...persianNames,
  ...persianVariants,
  ...mixedScript,
  ...punctuationWrapped,
  ...whitespaceNoised,
];

// ─── normalizeName invariants ────────────────────────────────────────

describe('normalizeName — idempotence', () => {
  it('every corpus is large enough to mean something', () => {
    for (const corpus of [englishNames, persianNames, persianVariants, mixedScript, punctuationWrapped, whitespaceNoised]) {
      expect(corpus.length).toBeGreaterThanOrEqual(40);
    }
  });

  it('normalize(normalize(x)) === normalize(x) for every fixture', () => {
    // A non-idempotent normalizer means a stored normalized alias and
    // a freshly normalized candidate can disagree about the same name.
    for (const x of allCorpora) {
      const once = normalizeName(x);
      expect(normalizeName(once), `fixture: ${JSON.stringify(x)}`).toBe(once);
    }
  });
});

describe('normalizeName — case and punctuation insensitivity', () => {
  it('uppercasing never changes the result', () => {
    for (const x of [...englishNames, ...mixedScript, ...punctuationWrapped]) {
      expect(normalizeName(x.toUpperCase()), `fixture: ${JSON.stringify(x)}`).toBe(
        normalizeName(x),
      );
    }
  });

  it('wrapping in guillemets, quotes, parens, or commas never changes the result', () => {
    const names = [
      ...englishNames.slice(0, 10),
      ...persianNames.slice(0, 10),
      ...mixedScript.slice(0, 10),
    ];
    for (const n of names) {
      const want = normalizeName(n);
      for (const [l, r] of WRAPS) {
        const wrapped = `${l}${n}${r}`;
        expect(normalizeName(wrapped), `fixture: ${JSON.stringify(wrapped)}`).toBe(want);
      }
    }
  });

  it('whitespace noise never changes the result', () => {
    for (const n of noiseBase) {
      const want = normalizeName(n);
      for (const noise of NOISERS) {
        const noisy = noise(n);
        expect(normalizeName(noisy), `fixture: ${JSON.stringify(noisy)}`).toBe(want);
      }
    }
  });

  it('whitespace outside wrapping punctuation still reaches the bare name', () => {
    // INTENT: normalize.ts says it strips "leading/trailing
    // punctuation the extractor sometimes keeps", and the README calls
    // trailing punctuation and whitespace noise expected input, not
    // exceptional. But the punctuation strip runs before the
    // whitespace collapse/trim, so any whitespace outside the
    // punctuation shields it: ' «Sara» ' normalizes to '«sara»' and
    // 'Sara, ' to 'sara,'. Such a candidate misses the exact stage for
    // an entity it names verbatim (and the function is not idempotent
    // on these inputs). Trimming before the punctuation strip, or
    // repeating strip+trim to a fixed point, fixes it.
    for (const n of wrapBase) {
      const want = normalizeName(n);
      for (const noisy of [` «${n}» `, `${n}, `, ` "${n}" `, `\t(${n})\t`]) {
        expect(normalizeName(noisy), `fixture: ${JSON.stringify(noisy)}`).toBe(want);
      }
    }
  });
});

// ─── Arabic/Persian fold equivalence classes ─────────────────────────

const FOLDS: ReadonlyArray<readonly [canon: string, alt: string, why: string]> = [
  ['ی', 'ي', 'Arabic yeh'],
  ['ک', 'ك', 'Arabic kaf'],
  ['ا', 'آ', 'alef madda'],
  ['ا', 'أ', 'alef hamza above'],
  ['ا', 'إ', 'alef hamza below'],
  ['ه', 'ة', 'teh marbuta'],
];

interface EquivPair {
  base: string;
  variant: string;
  why: string;
}

// Substitute each fold's Arabic variant at every position where the
// Persian form occurs, one position at a time plus all at once, so a
// fold that only handles the first or last occurrence still fails.
function foldPairs(): EquivPair[] {
  const out: EquivPair[] = [];
  for (const name of persianNames) {
    for (const [canon, alt, why] of FOLDS) {
      const positions: number[] = [];
      for (let i = 0; i < name.length; i++) {
        if (name[i] === canon) positions.push(i);
      }
      for (const i of positions) {
        out.push({
          base: name,
          variant: name.slice(0, i) + alt + name.slice(i + 1),
          why: `${why} at ${i}`,
        });
      }
      if (positions.length > 1) {
        out.push({ base: name, variant: name.split(canon).join(alt), why: `${why} everywhere` });
      }
    }
  }
  return out;
}

describe('normalizeName — fold equivalence classes', () => {
  it('substituting an Arabic variant anywhere yields the identical normalization', () => {
    const pairs = foldPairs();
    // Every class must actually be exercised by the corpus.
    for (const [, , why] of FOLDS) {
      expect(pairs.some((p) => p.why.startsWith(why))).toBe(true);
    }
    expect(pairs.length).toBeGreaterThan(100);
    for (const { base, variant, why } of pairs) {
      expect(normalizeName(variant), `${why} in ${JSON.stringify(base)}`).toBe(
        normalizeName(base),
      );
    }
  });
});

// ─── shingles / jaccard / minhash sanity ─────────────────────────────

const simCorpus = [
  ...englishNames.slice(0, 5),
  ...persianNames.slice(0, 5),
  ...mixedScript.slice(0, 5),
].map(normalizeName); // 15 names

describe('shingle similarity — metric sanity', () => {
  it('jaccard: identity, symmetry, and [0,1] range over all corpus pairs', () => {
    const sets = simCorpus.map((n) => shingles(n));
    for (let i = 0; i < sets.length; i++) {
      expect(jaccard(sets[i]!, sets[i]!), `identity: ${simCorpus[i]}`).toBe(1);
      for (let j = i + 1; j < sets.length; j++) {
        const ab = jaccard(sets[i]!, sets[j]!);
        const ba = jaccard(sets[j]!, sets[i]!);
        // The size-based small/large swap inside jaccard must not
        // change the value.
        expect(ab, `symmetry: ${simCorpus[i]} / ${simCorpus[j]}`).toBe(ba);
        expect(ab).toBeGreaterThanOrEqual(0);
        expect(ab).toBeLessThanOrEqual(1);
      }
    }
  });

  it('minhashSignature is deterministic for repeated builds of the same input', () => {
    // The signature is the LSH bucketing key; any nondeterminism here
    // makes candidate pruning flaky.
    for (let i = 0; i < 10; i++) {
      const name = simCorpus[i]!;
      const a = minhashSignature(shingles(name));
      const b = minhashSignature(shingles(name)); // fresh Set, same contents
      expect([...a], `signature determinism: ${name}`).toEqual([...b]);
    }
  });

  it('estimateJaccard is symmetric on 10 name pairs', () => {
    for (let i = 0; i < 10; i++) {
      const a = minhashSignature(shingles(simCorpus[i]!));
      const b = minhashSignature(shingles(simCorpus[(i + 7) % simCorpus.length]!));
      expect(estimateJaccard(a, b)).toBe(estimateJaccard(b, a));
    }
  });
});

// ─── resolveCandidates determinism ───────────────────────────────────

const dropCharAt = (s: string, i: number) => s.slice(0, i) + s.slice(i + 1);

// Builders return fresh objects each call so the second run cannot
// ride on object identity (memo caches, in-place sorts).
function smallCatalog(): CatalogEntity[] {
  return persianNames.slice(0, 10).map((label, i) => ({
    id: `fa${i}`,
    kind: 'person',
    label,
    aliases: [englishNames[i]!],
  }));
}

function smallBatch(): ResolutionCandidate[] {
  return [
    { ref: 'r1', kind: 'person', label: persianNames[0]! }, // exact via label
    { ref: 'r2', kind: 'person', label: englishNames[3]! }, // exact via alias
    { ref: 'r3', kind: 'person', label: dropCharAt(englishNames[5]!, 3) }, // fuzzy typo
    { ref: 'r4', kind: 'person', label: 'Benafsheh Tavangar' }, // novel
    { ref: 'r5', kind: 'person', label: 'Dan' }, // entropy-gated
    { ref: 'r6', kind: 'person', label: `«${persianNames[0]!}»` }, // groups with r1
    { ref: 'r7', kind: 'person', label: 'Totally Unrelated', aliases: [persianNames[2]!] }, // exact via candidate alias
  ];
}

describe('resolveCandidates — determinism (no judge)', () => {
  it('two runs over fresh copies of the same inputs are deeply equal', async () => {
    const a = await resolveCandidates(smallBatch(), smallCatalog(), { fuzzyThreshold: 0.55 });
    const b = await resolveCandidates(smallBatch(), smallCatalog(), { fuzzyThreshold: 0.55 });
    expect(a).toEqual(b);
    // Anchors so equality is not vacuous over all-'none' output.
    expect(a.find((p) => p.ref === 'r1')).toMatchObject({ entity_id: 'fa0', basis: 'exact' });
    expect(a.find((p) => p.ref === 'r3')).toMatchObject({ entity_id: 'fa5', basis: 'fuzzy' });
    expect(a.find((p) => p.ref === 'r5')).toMatchObject({ entity_id: null, basis: 'none' });
    expect(a.find((p) => p.ref === 'r6')).toMatchObject({ entity_id: 'fa0', basis: 'exact' });
    expect(a.find((p) => p.ref === 'r7')).toMatchObject({ entity_id: 'fa2', basis: 'exact' });
  });

  it('the LSH path over a 600-entity catalog is equally deterministic', async () => {
    const SYLL = [
      'bar', 'den', 'fol', 'gim', 'hap', 'jul', 'kor', 'lem',
      'nim', 'pol', 'qur', 'set', 'tav', 'vex', 'wul', 'yor',
    ];
    function bigCatalog(): CatalogEntity[] {
      const out: CatalogEntity[] = [];
      for (let i = 0; i < 600; i++) {
        out.push({
          id: `f${i}`,
          kind: 'person',
          label: `${SYLL[i % 16]}${SYLL[(i * 3) % 16]} ${SYLL[(i * 5) % 16]}${SYLL[(i * 7) % 16]} ${i}`,
          aliases: [],
        });
      }
      out.push({ id: 'tgt-fa', kind: 'person', label: 'مهرنوش خاورانی', aliases: [] });
      out.push({
        id: 'tgt-en',
        kind: 'person',
        label: 'Behrooz Mirzakhani',
        aliases: ['بهروز میرزاخانی'],
      });
      return out;
    }
    function batch(): ResolutionCandidate[] {
      return [
        { ref: 'q1', kind: 'person', label: 'مهرنوش خاوران' }, // one-letter drop, ~0.92 jaccard
        { ref: 'q2', kind: 'person', label: 'بهروز میرزاخانی' }, // exact via alias
        { ref: 'q3', kind: 'person', label: 'Tahmineh Golabdar' }, // novel
        { ref: 'q4', kind: 'person', label: `BARBAR BARBAR 0` }, // exact filler, case-folded
      ];
    }
    const catalog = bigCatalog();
    expect(catalog.length).toBeGreaterThan(500); // really on the LSH path

    const a = await resolveCandidates(batch(), bigCatalog());
    const b = await resolveCandidates(batch(), bigCatalog());
    expect(a).toEqual(b);
    // Anchor: the fuzzy hit survived LSH pruning, so the equality
    // above covers the pruned path, not an early bail-out.
    expect(a.find((p) => p.ref === 'q1')).toMatchObject({
      entity_id: 'tgt-fa',
      basis: 'fuzzy',
      requires_review: true,
    });
    expect(a.find((p) => p.ref === 'q2')).toMatchObject({ entity_id: 'tgt-en', basis: 'exact' });
    expect(a.find((p) => p.ref === 'q4')).toMatchObject({ entity_id: 'f0', basis: 'exact' });
  });
});

// ─── cascade respects normalization classes end-to-end ───────────────

describe('cascade — normalization equivalence classes meet at exact', () => {
  // Presentation variants on top of the fold pairs: these are the
  // surfaces extraction actually hands over.
  function presentationPairs(): EquivPair[] {
    return wrapBase.flatMap((n) => [
      { base: n, variant: `«${n}»`, why: 'guillemets' },
      { base: n, variant: `${n},`, why: 'trailing comma' },
      { base: n, variant: n.replace(' ', '  '), why: 'doubled space' },
    ]);
  }

  function keyboardPairs(): EquivPair[] {
    return persianNames
      .map((base, i) => ({ base, variant: persianVariants[i]!, why: 'keyboard/typography variant' }))
      .filter((p) => p.variant !== p.base);
  }

  it('an entity labeled with one form is exact-matched by a candidate using the other', async () => {
    const pairs = [...foldPairs(), ...presentationPairs(), ...keyboardPairs()];
    expect(pairs.length).toBeGreaterThan(100);
    for (const { base, variant, why } of pairs) {
      // Both directions: the catalog side and the candidate side run
      // through the same normalizer, and an asymmetry between them
      // would split one person into two entities.
      for (const [label, cand] of [
        [base, variant],
        [variant, base],
      ] as const) {
        const out = await resolveCandidates(
          [{ ref: 'c', kind: 'person', label: cand }],
          [{ id: 'target', kind: 'person', label, aliases: [] }],
        );
        expect(
          out[0],
          `${why}: candidate ${JSON.stringify(cand)} vs label ${JSON.stringify(label)}`,
        ).toMatchObject({ entity_id: 'target', basis: 'exact', score: 1, requires_review: false });
      }
    }
  });
});
