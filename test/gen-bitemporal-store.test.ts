// The maintenance layer's untested corners: exclusive_pair cardinality,
// multi-edge invalidation, predicate/source scoping, out-of-order
// ingestion, re-assertion of a dead fact, and InMemoryGraphStore's
// copy semantics and small write contracts. All names invented; all
// dates fixed.

import { describe, expect, it } from 'vitest';
import {
  planEdgeUpsert,
  type IncomingFact,
  type PredicatePolicy,
} from '../src/graph/bitemporal.js';
import { InMemoryGraphStore } from '../src/store/memory.js';
import type { Edge } from '../src/types.js';

const T = (s: string) => new Date(s);
const NOW = T('2026-06-01T00:00:00Z');

function edge(partial: Partial<Edge> & Pick<Edge, 'id'>): Edge {
  return {
    source_entity_id: 'src-a',
    target_entity_id: 'tgt-b',
    predicate: 'lives_in',
    valid_at: null,
    invalid_at: null,
    recorded_at: T('2026-01-01T00:00:00Z'),
    expired_at: null,
    support: [],
    ...partial,
  };
}

const PER_SOURCE: PredicatePolicy = { predicate: 'lives_in', cardinality: 'exclusive_per_source' };
const PAIR: PredicatePolicy = { predicate: 'works_with', cardinality: 'exclusive_pair' };

describe('planEdgeUpsert — exclusive_pair', () => {
  const current = [
    edge({ id: 'e1', predicate: 'works_with', target_entity_id: 'colleague-1' }),
  ];

  it('re-asserting the same pair refreshes the existing edge', () => {
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'colleague-1',
      predicate: 'works_with',
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PAIR, current, NOW);
    expect(plan).toEqual({ action: 'refresh', existing_edge_id: 'e1', invalidations: [] });
  });

  it('a different target inserts WITHOUT invalidations', () => {
    // exclusive_pair constrains (source, predicate, target), so two
    // colleagues coexist; only the duplicate pair would be a refresh.
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'colleague-2',
      predicate: 'works_with',
      valid_at: T('2026-04-01T00:00:00Z'),
      support: ['m2'],
    };
    const plan = planEdgeUpsert(incoming, PAIR, current, NOW);
    expect(plan).toEqual({ action: 'insert', invalidations: [] });
  });

  it('same input under exclusive_per_source would invalidate; the cardinality is the only difference', () => {
    // Pins the semantic gap between the two cardinalities on identical
    // inputs, so a future refactor cannot quietly collapse them.
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'colleague-2',
      predicate: 'works_with',
      valid_at: T('2026-04-01T00:00:00Z'),
      support: ['m2'],
    };
    const asPair = planEdgeUpsert(incoming, PAIR, current, NOW);
    const asPerSource = planEdgeUpsert(
      incoming,
      { predicate: 'works_with', cardinality: 'exclusive_per_source' },
      current,
      NOW,
    );
    expect(asPair.invalidations).toHaveLength(0);
    expect(asPerSource.invalidations).toHaveLength(1);
    expect(asPerSource.invalidations[0]!.edge_id).toBe('e1');
    expect(asPair.action).toBe('insert');
    expect(asPerSource.action).toBe('insert');
  });
});

describe('planEdgeUpsert — multiple current edges under exclusive_per_source', () => {
  it('all three current targets are proposed for invalidation', () => {
    // Three current lives_in edges is already a data problem, but the
    // planner must still propose closing every one of them; leaving a
    // survivor would make the data problem permanent.
    const current = ['t1', 't2', 't3'].map((t, i) =>
      edge({ id: `e${i + 1}`, target_entity_id: t }),
    );
    const validAt = T('2026-05-01T00:00:00Z');
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 't4',
      predicate: 'lives_in',
      valid_at: validAt,
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, current, NOW);
    expect(plan.action).toBe('insert');
    expect(plan.invalidations.map((p) => p.edge_id).sort()).toEqual(['e1', 'e2', 'e3']);
    for (const p of plan.invalidations) {
      expect(p.invalid_at.toISOString()).toBe(validAt.toISOString());
      expect(p.incoming).toBe(incoming);
    }
  });
});

describe('planEdgeUpsert — scoping to (source, predicate)', () => {
  it('edges of other predicates and other sources are never invalidated', () => {
    const current = [
      edge({ id: 'mine', target_entity_id: 'tehran' }),
      edge({ id: 'other-pred', predicate: 'met_at', target_entity_id: 'tehran' }),
      edge({ id: 'other-src', source_entity_id: 'src-z', target_entity_id: 'tehran' }),
    ];
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'berlin',
      predicate: 'lives_in',
      valid_at: T('2026-05-01T00:00:00Z'),
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, current, NOW);
    expect(plan.invalidations.map((p) => p.edge_id)).toEqual(['mine']);
  });

  it('a same-pair edge under a different predicate or source does not trigger a refresh', () => {
    // Refreshing across these boundaries would merge support of
    // unrelated facts onto one row.
    const current = [
      edge({ id: 'other-pred', predicate: 'met_at', target_entity_id: 'tehran' }),
      edge({ id: 'other-src', source_entity_id: 'src-z', target_entity_id: 'tehran' }),
    ];
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'tehran',
      predicate: 'lives_in',
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, current, NOW);
    expect(plan.action).toBe('insert');
    expect(plan.existing_edge_id).toBeUndefined();
    expect(plan.invalidations).toHaveLength(0);
  });
});

describe('planEdgeUpsert — out-of-order ingestion', () => {
  it('a backfilled fact that predates the current edge proposes NO invalidation', () => {
    // INTENT: a backfilled fact (diary entry about a 2026-01 Tehran
    // residency) does not contradict a current edge that began later
    // (Berlin, 2026-03): the backfilled fact is the one that already
    // ended. Proposing invalid_at = incoming.valid_at would close
    // Berlin six weeks before it opened, a negative validity window;
    // clamping to Berlin's own valid_at would close a fact that is
    // still true. So the planner suppresses the proposal: the
    // backfilled edge inserts alongside, and bounding ITS window is
    // the host's review decision.
    const existing = edge({
      id: 'e1',
      target_entity_id: 'berlin',
      valid_at: T('2026-03-01T00:00:00Z'),
      recorded_at: T('2026-03-05T00:00:00Z'),
    });
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'tehran',
      predicate: 'lives_in',
      valid_at: T('2026-01-15T00:00:00Z'),
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, [existing], NOW);
    expect(plan.action).toBe('insert');
    expect(plan.invalidations).toHaveLength(0);
  });

  it('an incoming fact dated after the current edge still proposes invalid_at = incoming.valid_at', () => {
    const existing = edge({
      id: 'e1',
      target_entity_id: 'tehran',
      valid_at: T('2026-03-01T00:00:00Z'),
    });
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'berlin',
      predicate: 'lives_in',
      valid_at: T('2026-05-01T00:00:00Z'),
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, [existing], NOW);
    expect(plan.invalidations).toHaveLength(1);
    expect(plan.invalidations[0]!.invalid_at.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('an edge with unknown valid_at still gets a proposal, even from a backfilled fact', () => {
    // An unknown start can't prove the window would be negative, and
    // proposals are reviewable; silently dropping them would let an
    // undated current edge survive every contradiction.
    const existing = edge({ id: 'e1', target_entity_id: 'tehran', valid_at: null });
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'berlin',
      predicate: 'lives_in',
      valid_at: T('2026-01-15T00:00:00Z'),
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, [existing], NOW);
    expect(plan.invalidations).toHaveLength(1);
    expect(plan.invalidations[0]!.invalid_at.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('equal valid_at instants still propose: the zero-length window is the tie-break', () => {
    // Two same-instant assertions of an exclusive predicate: the newer
    // recording wins, the old row stays in history with an empty
    // window rather than surviving as a contradiction.
    const t = T('2026-03-01T00:00:00Z');
    const existing = edge({ id: 'e1', target_entity_id: 'tehran', valid_at: t });
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'berlin',
      predicate: 'lives_in',
      valid_at: t,
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, [existing], NOW);
    expect(plan.invalidations).toHaveLength(1);
    expect(plan.invalidations[0]!.invalid_at.toISOString()).toBe(t.toISOString());
  });

  it('an undated incoming fact (invalid_at = now) is suppressed against a future-dated edge', () => {
    // The suppression compares the effective invalid_at (valid_at ??
    // now), not just the presence of valid_at, so the no-negative-
    // window invariant holds on the dateless path too.
    const existing = edge({
      id: 'e1',
      target_entity_id: 'tehran',
      valid_at: T('2026-09-01T00:00:00Z'),
    });
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'berlin',
      predicate: 'lives_in',
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, [existing], NOW);
    expect(plan.action).toBe('insert');
    expect(plan.invalidations).toHaveLength(0);
  });

  it('suppression is per-edge: of three current edges, only the later-dated one survives', () => {
    const current = [
      edge({ id: 'older', target_entity_id: 't1', valid_at: T('2025-06-01T00:00:00Z') }),
      edge({ id: 'undated', target_entity_id: 't2', valid_at: null }),
      edge({ id: 'newer', target_entity_id: 't3', valid_at: T('2026-04-01T00:00:00Z') }),
    ];
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 't4',
      predicate: 'lives_in',
      valid_at: T('2026-02-01T00:00:00Z'),
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, current, NOW);
    expect(plan.invalidations.map((p) => p.edge_id).sort()).toEqual(['older', 'undated']);
  });
});

describe('planEdgeUpsert — re-assertion of a dead fact', () => {
  it('a same-pair edge with invalid_at set gets a fresh insert, not a refresh', () => {
    // A fact can become true again (moved back to Tehran). The
    // bi-temporal model needs a second validity window for that, so
    // the dead row must not be resurrected; refreshing it would erase
    // the gap during which the fact was false.
    const dead = edge({
      id: 'e1',
      target_entity_id: 'tehran',
      valid_at: T('2026-01-01T00:00:00Z'),
      invalid_at: T('2026-02-01T00:00:00Z'),
    });
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'tehran',
      predicate: 'lives_in',
      valid_at: T('2026-05-01T00:00:00Z'),
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, [dead], NOW);
    expect(plan.action).toBe('insert');
    expect(plan.existing_edge_id).toBeUndefined();
    // The dead edge is already closed; closing it again would move its
    // invalid_at and rewrite history.
    expect(plan.invalidations).toHaveLength(0);
  });

  it('a same-pair edge superseded at the system level (expired_at set) also gets a fresh insert', () => {
    const superseded = edge({
      id: 'e1',
      target_entity_id: 'tehran',
      expired_at: T('2026-02-01T00:00:00Z'),
    });
    const incoming: IncomingFact = {
      source_entity_id: 'src-a',
      target_entity_id: 'tehran',
      predicate: 'lives_in',
      support: ['m1'],
    };
    const plan = planEdgeUpsert(incoming, PER_SOURCE, [superseded], NOW);
    expect(plan.action).toBe('insert');
    expect(plan.invalidations).toHaveLength(0);
  });
});

describe('InMemoryGraphStore — input isolation', () => {
  it('mutating the aliases array after createEntity does not change the stored row', async () => {
    const store = new InMemoryGraphStore();
    const aliases = ['نرگس'];
    const e = await store.createEntity({ kind: 'person', label: 'Narges Kashani', aliases });
    aliases.push('hijacked');
    expect((await store.getEntity(e.id))!.aliases).toEqual(['نرگس']);
  });

  it('mutating the support array after createEdge does not change the stored row', async () => {
    const store = new InMemoryGraphStore();
    const support = ['m1'];
    const e = await store.createEdge({
      source_entity_id: 'src-a',
      target_entity_id: 'tgt-b',
      predicate: 'met_at',
      valid_at: null,
      invalid_at: null,
      recorded_at: T('2026-01-01T00:00:00Z'),
      expired_at: null,
      support,
    });
    support.push('m-forged');
    expect((await store.getEdge(e.id))!.support).toEqual(['m1']);
  });

  it('mutating the array passed to setEdgeSupport afterwards does not change the stored row', async () => {
    const store = new InMemoryGraphStore();
    const e = await store.createEdge({
      source_entity_id: 'src-a',
      target_entity_id: 'tgt-b',
      predicate: 'met_at',
      valid_at: null,
      invalid_at: null,
      recorded_at: T('2026-01-01T00:00:00Z'),
      expired_at: null,
      support: [],
    });
    const next = ['m1', 'm2'];
    await store.setEdgeSupport(e.id, next);
    next.push('m-forged');
    expect((await store.getEdge(e.id))!.support).toEqual(['m1', 'm2']);
  });

  it('mutating the mention_ids array after createEpisode does not change the stored row', async () => {
    const store = new InMemoryGraphStore();
    const mention_ids = ['m1'];
    await store.createEpisode({
      source_id: 'doc1',
      ingested_at: T('2026-01-01T00:00:00Z'),
      mention_ids,
    });
    mention_ids.push('m-forged');
    expect((await store.listEpisodes('doc1'))[0]!.mention_ids).toEqual(['m1']);
  });
});

describe('InMemoryGraphStore — returned-object isolation', () => {
  it('mutating aliases on an entity returned by getEntity does not change the store', async () => {
    // INTENT: store.ts says the graph is "written by the HOST after it
    // decides which proposals to apply", i.e. through the write
    // methods, and memory.ts bills itself as the executable
    // specification of GraphStore semantics. No DB-backed store hands
    // back a live storage row. getEntity returns the stored object
    // itself, so a host that treats a returned row as plain data
    // writes to the store without calling any write method, bypassing
    // addAlias and its dedup check.
    const store = new InMemoryGraphStore();
    const e = await store.createEntity({ kind: 'person', label: 'Ramin Golzar', aliases: ['رامین'] });
    const got = (await store.getEntity(e.id))!;
    got.aliases.push('out-of-band');
    expect((await store.getEntity(e.id))!.aliases).toEqual(['رامین']);
  });

  it('mutating support on an edge returned by listCurrentEdges does not change the store', async () => {
    // INTENT: same contract as above. listCurrentEdges copies the
    // array of rows but not the rows, so pushing onto a listed edge's
    // support forges provenance: planSupportRemoval would later count
    // a mention that no write method ever attached.
    const store = new InMemoryGraphStore();
    const e = await store.createEdge({
      source_entity_id: 'src-a',
      target_entity_id: 'tgt-b',
      predicate: 'met_at',
      valid_at: null,
      invalid_at: null,
      recorded_at: T('2026-01-01T00:00:00Z'),
      expired_at: null,
      support: ['m1'],
    });
    const listed = await store.listCurrentEdges();
    listed[0]!.support.push('m-forged');
    expect((await store.getEdge(e.id))!.support).toEqual(['m1']);
  });
});

describe('InMemoryGraphStore — small write contracts', () => {
  it('setEdgeSupport with an empty array clears support', async () => {
    const store = new InMemoryGraphStore();
    const e = await store.createEdge({
      source_entity_id: 'src-a',
      target_entity_id: 'tgt-b',
      predicate: 'met_at',
      valid_at: null,
      invalid_at: null,
      recorded_at: T('2026-01-01T00:00:00Z'),
      expired_at: null,
      support: ['m1', 'm2'],
    });
    await store.setEdgeSupport(e.id, []);
    expect((await store.getEdge(e.id))!.support).toEqual([]);
  });

  it('addAlias on a missing entity rejects', async () => {
    const store = new InMemoryGraphStore();
    await expect(store.addAlias('no-such-entity', 'x')).rejects.toThrow('entity not found');
  });

  it('setMentionStatus entity_id: a string links, omitted leaves the link, null clears it', async () => {
    const store = new InMemoryGraphStore();
    const m = await store.createMention({
      source_id: 'doc1',
      kind: 'person',
      surface_form: 'Ramin',
      span_start: 0,
      span_end: 5,
      candidate_label: 'Ramin',
      entity_id: null,
      status: 'pending',
      confidence: 0.9,
    });

    await store.setMentionStatus(m.id, 'confirmed', 'ent-1');
    expect(await store.getMention(m.id)).toMatchObject({ status: 'confirmed', entity_id: 'ent-1' });

    // Omitted means "status change only"; wiping the link here would
    // unlink every mention whose status is touched in passing.
    await store.setMentionStatus(m.id, 'rejected');
    expect(await store.getMention(m.id)).toMatchObject({ status: 'rejected', entity_id: 'ent-1' });

    // Null is the explicit unlink; it must not be conflated with
    // omitted.
    await store.setMentionStatus(m.id, 'pending', null);
    expect(await store.getMention(m.id)).toMatchObject({ status: 'pending', entity_id: null });
  });
});
