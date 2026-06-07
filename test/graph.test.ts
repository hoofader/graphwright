import { describe, expect, it } from 'vitest';
import { planEdgeUpsert, type PredicatePolicy } from '../src/graph/bitemporal.js';
import { planSupportRemoval } from '../src/graph/support.js';
import type { Edge } from '../src/types.js';

const NOW = new Date('2026-06-07T00:00:00Z');

function edge(partial: Partial<Edge> & Pick<Edge, 'id'>): Edge {
  return {
    source_entity_id: 'a',
    target_entity_id: 'b',
    predicate: 'lives_in',
    valid_at: null,
    invalid_at: null,
    recorded_at: new Date('2026-01-01T00:00:00Z'),
    expired_at: null,
    support: [],
    ...partial,
  };
}

describe('planEdgeUpsert', () => {
  const exclusive: PredicatePolicy = { predicate: 'lives_in', cardinality: 'exclusive_per_source' };
  const additive: PredicatePolicy = { predicate: 'met_at', cardinality: 'additive' };

  it('re-asserting the same fact refreshes instead of duplicating', () => {
    const existing = edge({ id: 'e1', target_entity_id: 'tehran' });
    const plan = planEdgeUpsert(
      { source_entity_id: 'a', target_entity_id: 'tehran', predicate: 'lives_in', support: ['m9'] },
      exclusive,
      [existing],
      NOW,
    );
    expect(plan.action).toBe('refresh');
    expect(plan.existing_edge_id).toBe('e1');
    expect(plan.invalidations).toHaveLength(0);
  });

  it('exclusive predicate: new target proposes invalidating the old edge', () => {
    const existing = edge({ id: 'e1', target_entity_id: 'tehran' });
    const plan = planEdgeUpsert(
      {
        source_entity_id: 'a',
        target_entity_id: 'berlin',
        predicate: 'lives_in',
        valid_at: new Date('2026-05-01T00:00:00Z'),
        support: ['m9'],
      },
      exclusive,
      [existing],
      NOW,
    );
    expect(plan.action).toBe('insert');
    expect(plan.invalidations).toHaveLength(1);
    expect(plan.invalidations[0]!.edge_id).toBe('e1');
    // The old fact stops being true when the new one starts.
    expect(plan.invalidations[0]!.invalid_at.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('additive predicate: edges coexist', () => {
    const existing = edge({ id: 'e1', predicate: 'met_at', target_entity_id: 'cafe' });
    const plan = planEdgeUpsert(
      { source_entity_id: 'a', target_entity_id: 'park', predicate: 'met_at', support: [] },
      additive,
      [existing],
      NOW,
    );
    expect(plan.action).toBe('insert');
    expect(plan.invalidations).toHaveLength(0);
  });

  it('already-invalidated edges are not re-invalidated', () => {
    const gone = edge({ id: 'e1', target_entity_id: 'tehran', invalid_at: NOW });
    const plan = planEdgeUpsert(
      { source_entity_id: 'a', target_entity_id: 'berlin', predicate: 'lives_in', support: [] },
      exclusive,
      [gone],
      NOW,
    );
    expect(plan.invalidations).toHaveLength(0);
  });
});

describe('planSupportRemoval', () => {
  it('flags orphaned edges, keeps supported ones', () => {
    const edges = [
      edge({ id: 'e1', support: ['m1', 'm2'] }),
      edge({ id: 'e2', support: ['m1'] }),
      edge({ id: 'e3', support: ['m3'] }),
    ];
    const out = planSupportRemoval(edges, new Set(['m1']));
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.edge_id === 'e1')).toMatchObject({
      remaining_support: ['m2'],
      orphaned: false,
    });
    expect(out.find((r) => r.edge_id === 'e2')).toMatchObject({
      remaining_support: [],
      orphaned: true,
    });
  });

  it('ignores expired edges', () => {
    const edges = [edge({ id: 'e1', support: ['m1'], expired_at: NOW })];
    expect(planSupportRemoval(edges, new Set(['m1']))).toHaveLength(0);
  });
});
