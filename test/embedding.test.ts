import { describe, expect, it } from 'vitest';
import { resolveCandidates, type CatalogEntity } from '../src/resolve/cascade.js';
import type { Embedder, PairJudge } from '../src/llm.js';
import { InMemoryDecisionMemory } from '../src/resolve/memory.js';

// A deterministic fake embedder: each label maps to a fixed unit vector,
// so cosine is exactly predictable. Unknown labels get an orthogonal one.
function fakeEmbedder(map: Record<string, number[]>): Embedder {
  return async (texts) => texts.map((t) => map[t] ?? [0, 0, 0, 1]);
}

const PLACES: CatalogEntity[] = [{ id: 'p1', kind: 'place', label: 'Big Apple', aliases: [] }];

describe('embedding nomination', () => {
  it('nominates a name that shares no n-grams, as a reviewable proposal', async () => {
    const embedder = fakeEmbedder({ 'Big Apple': [1, 0, 0, 0], NYC: [1, 0, 0, 0] });
    const out = await resolveCandidates([{ ref: 'm0', kind: 'place', label: 'NYC' }], PLACES, {
      embedder,
    });
    expect(out[0]).toMatchObject({ entity_id: 'p1', basis: 'embedding', requires_review: true });
    expect(out[0]!.score).toBeGreaterThan(0.99);
  });

  it('does not nominate below the cosine threshold', async () => {
    const embedder = fakeEmbedder({ 'Big Apple': [1, 0, 0, 0], Paris: [0, 1, 0, 0] });
    const out = await resolveCandidates([{ ref: 'm0', kind: 'place', label: 'Paris' }], PLACES, {
      embedder,
    });
    expect(out[0]!.entity_id).toBeNull();
    expect(out[0]!.basis).toBe('none');
  });

  it('lets a judge confirm the nomination (basis becomes judge)', async () => {
    const embedder = fakeEmbedder({ 'Big Apple': [1, 0, 0, 0], NYC: [1, 0, 0, 0] });
    const judge: PairJudge = async () => ({ same: true, confidence: 0.95 });
    const out = await resolveCandidates([{ ref: 'm0', kind: 'place', label: 'NYC' }], PLACES, {
      embedder,
      judge,
    });
    expect(out[0]).toMatchObject({ entity_id: 'p1', basis: 'judge' });
    expect(out[0]!.score).toBeCloseTo(0.95, 5);
  });

  it('a judge rejecting the nomination falls back to create-new', async () => {
    const embedder = fakeEmbedder({ 'Big Apple': [1, 0, 0, 0], NYC: [1, 0, 0, 0] });
    const judge: PairJudge = async () => ({ same: false, confidence: 0.9 });
    const out = await resolveCandidates([{ ref: 'm0', kind: 'place', label: 'NYC' }], PLACES, {
      embedder,
      judge,
    });
    expect(out[0]!.entity_id).toBeNull();
  });

  it('embedder failure degrades to create-new, never throws', async () => {
    const embedder: Embedder = async () => {
      throw new Error('embedding service down');
    };
    const out = await resolveCandidates([{ ref: 'm0', kind: 'place', label: 'NYC' }], PLACES, {
      embedder,
    });
    expect(out[0]!.entity_id).toBeNull();
    expect(out[0]!.basis).toBe('none');
  });

  it('a rejected entity is never nominated, even on a strong cosine', async () => {
    const embedder = fakeEmbedder({ 'Big Apple': [1, 0, 0, 0], NYC: [1, 0, 0, 0] });
    const memory = new InMemoryDecisionMemory();
    // Surfaces are recorded normalized (the host passes normalizeName output).
    memory.record({ surface: 'nyc', kind: 'place', entity_id: 'p1', decision: 'rejected' });
    const out = await resolveCandidates([{ ref: 'm0', kind: 'place', label: 'NYC' }], PLACES, {
      embedder,
      memory,
    });
    expect(out[0]!.entity_id).toBeNull();
  });

  it('does not override an exact match', async () => {
    const embedder = fakeEmbedder({ 'Big Apple': [1, 0, 0, 0] });
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'place', label: 'Big Apple' }],
      PLACES,
      { embedder },
    );
    expect(out[0]).toMatchObject({ entity_id: 'p1', basis: 'exact', requires_review: false });
  });

  it('rescues a low-entropy name the fuzzy gate drops', async () => {
    // "Al" fails the entropy gate, so fuzzy never runs; the embedder is
    // the only path that can reach the entity.
    const catalog: CatalogEntity[] = [{ id: 'x1', kind: 'person', label: 'Alexander', aliases: [] }];
    const embedder = fakeEmbedder({ Alexander: [1, 0, 0, 0], Al: [1, 0, 0, 0] });
    const out = await resolveCandidates([{ ref: 'm0', kind: 'person', label: 'Al' }], catalog, {
      embedder,
    });
    expect(out[0]).toMatchObject({ entity_id: 'x1', basis: 'embedding' });
  });

  it('no embedder leaves the deterministic behavior unchanged', async () => {
    const out = await resolveCandidates([{ ref: 'm0', kind: 'place', label: 'NYC' }], PLACES);
    expect(out[0]!.entity_id).toBeNull();
    expect(out[0]!.basis).toBe('none');
  });
});
