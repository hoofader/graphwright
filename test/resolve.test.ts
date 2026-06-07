import { describe, expect, it } from 'vitest';
import { resolveCandidates, type CatalogEntity } from '../src/resolve/cascade.js';
import { normalizeName } from '../src/resolve/normalize.js';
import { passesEntropyGate, shannonEntropy } from '../src/resolve/entropy.js';
import { jaccard, shingles, minhashSignature, estimateJaccard } from '../src/resolve/minhash.js';

describe('normalizeName', () => {
  it('case-folds and trims punctuation', () => {
    expect(normalizeName('Sara,')).toBe('sara');
    expect(normalizeName('«سارا»')).toBe('سارا');
  });

  it('folds Arabic yeh/kaf to Persian', () => {
    // Arabic-keyboard spelling vs Persian-keyboard spelling of the
    // same name must normalize identically.
    expect(normalizeName('علي')).toBe(normalizeName('علی'));
    expect(normalizeName('كيان')).toBe(normalizeName('کیان'));
  });

  it('strips ZWNJ so half-space variants match', () => {
    expect(normalizeName('می‌روم')).toBe(normalizeName('میروم'));
  });

  it('strips diacritics and tatweel', () => {
    expect(normalizeName('مُحَمَّد')).toBe(normalizeName('محمد'));
    expect(normalizeName('محـــمد')).toBe(normalizeName('محمد'));
  });

  it('collapses whitespace', () => {
    expect(normalizeName('Parisa   Rostami ')).toBe('parisa rostami');
  });
});

describe('entropy gate', () => {
  it('blocks short names', () => {
    expect(passesEntropyGate(normalizeName('Ali'))).toBe(false);
    expect(passesEntropyGate(normalizeName('علی'))).toBe(false);
    expect(passesEntropyGate(normalizeName('Bob'))).toBe(false);
  });

  it('passes full names', () => {
    expect(passesEntropyGate(normalizeName('Parisa Rostami'))).toBe(true);
    expect(passesEntropyGate(normalizeName('Shahrzad Bahrami'))).toBe(true);
  });

  it('entropy is zero for empty and single-char strings', () => {
    expect(shannonEntropy('')).toBe(0);
    expect(shannonEntropy('aaaa')).toBe(0);
  });
});

describe('shingle similarity', () => {
  it('identical strings have jaccard 1', () => {
    expect(jaccard(shingles('parisa rostami'), shingles('parisa rostami'))).toBe(1);
  });

  it('typo variants stay above 0.5, unrelated names below', () => {
    const a = shingles('parisa rostami');
    expect(jaccard(a, shingles('parisah rostami'))).toBeGreaterThan(0.5);
    expect(jaccard(a, shingles('daniel rivera'))).toBeLessThan(0.1);
  });

  it('minhash estimates true jaccard within tolerance', () => {
    const a = shingles('shahrzad bahrami');
    const b = shingles('shahrzad bahram');
    const truth = jaccard(a, b);
    const est = estimateJaccard(minhashSignature(a), minhashSignature(b));
    expect(Math.abs(est - truth)).toBeLessThan(0.2);
  });
});

describe('resolveCandidates — cascade', () => {
  const catalog: CatalogEntity[] = [
    {
      id: 'p1',
      kind: 'person',
      label: 'Parisa Rostami',
      aliases: ['پریسا', 'Parisa'],
    },
    { id: 'p2', kind: 'person', label: 'Daniel Rivera', aliases: [] },
    { id: 'pl1', kind: 'place', label: 'Tehran', aliases: ['تهران'] },
  ];

  it('exact alias match, cross-script, auto-acceptable', async () => {
    const out = await resolveCandidates(
      [{ ref: 'm1', kind: 'person', label: 'پریسا' }],
      catalog,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      ref: 'm1',
      entity_id: 'p1',
      basis: 'exact',
      requires_review: false,
    });
  });

  it('exact match is kind-scoped', async () => {
    const out = await resolveCandidates(
      [{ ref: 'm1', kind: 'person', label: 'Tehran' }],
      catalog,
    );
    expect(out[0]!.entity_id).toBeNull();
  });

  it('fuzzy match requires review', async () => {
    const out = await resolveCandidates(
      [{ ref: 'm1', kind: 'person', label: 'Parisah Rostami' }],
      catalog,
      { fuzzyThreshold: 0.5 },
    );
    expect(out[0]).toMatchObject({ entity_id: 'p1', basis: 'fuzzy', requires_review: true });
  });

  it('low-entropy unknown name falls through to create-new, no fuzzy', async () => {
    // "Dan" overlaps "Daniel Rivera" lexically but is too short to
    // trust; must NOT fuzzy-match.
    const out = await resolveCandidates(
      [{ ref: 'm1', kind: 'person', label: 'Dan' }],
      catalog,
      { fuzzyThreshold: 0.1 },
    );
    expect(out[0]).toMatchObject({ entity_id: null, basis: 'none', requires_review: true });
  });

  it('unknown high-entropy name proposes create-new', async () => {
    const out = await resolveCandidates(
      [{ ref: 'm1', kind: 'person', label: 'Benyamin Khosravi' }],
      catalog,
    );
    expect(out[0]).toMatchObject({ entity_id: null, basis: 'none' });
  });

  it('identical candidates in one batch share the outcome', async () => {
    const out = await resolveCandidates(
      [
        { ref: 'm1', kind: 'person', label: 'Parisa' },
        { ref: 'm2', kind: 'person', label: 'parisa' },
      ],
      catalog,
    );
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.entity_id === 'p1' && p.basis === 'exact')).toBe(true);
  });

  it('judge confirms a fuzzy hit', async () => {
    const out = await resolveCandidates(
      [{ ref: 'm1', kind: 'person', label: 'Parisah Rostami' }],
      catalog,
      {
        fuzzyThreshold: 0.5,
        judge: async () => ({ same: true, confidence: 0.93 }),
      },
    );
    expect(out[0]).toMatchObject({
      entity_id: 'p1',
      basis: 'judge',
      score: 0.93,
      requires_review: true,
    });
  });

  it('judge rejection downgrades to create-new with the fuzzy score kept', async () => {
    const out = await resolveCandidates(
      [{ ref: 'm1', kind: 'person', label: 'Parisah Rostamian' }],
      catalog,
      {
        fuzzyThreshold: 0.4,
        judge: async () => ({ same: false, confidence: 0.9 }),
      },
    );
    expect(out[0]!.entity_id).toBeNull();
    expect(out[0]!.basis).toBe('none');
    expect(out[0]!.score).toBeGreaterThan(0);
  });

  it('judge failure degrades to the deterministic fuzzy answer', async () => {
    const out = await resolveCandidates(
      [{ ref: 'm1', kind: 'person', label: 'Parisah Rostami' }],
      catalog,
      {
        fuzzyThreshold: 0.5,
        judge: async () => {
          throw new Error('gateway down');
        },
      },
    );
    expect(out[0]).toMatchObject({ entity_id: 'p1', basis: 'fuzzy', requires_review: true });
  });

  it('judge budget caps LLM calls', async () => {
    let calls = 0;
    await resolveCandidates(
      [
        { ref: 'm1', kind: 'person', label: 'Parisah Rostami' },
        { ref: 'm2', kind: 'person', label: 'Danial Rivera' },
      ],
      catalog,
      {
        fuzzyThreshold: 0.5,
        judgeBudget: 1,
        judge: async () => {
          calls++;
          return { same: true, confidence: 0.9 };
        },
      },
    );
    expect(calls).toBe(1);
  });
});
