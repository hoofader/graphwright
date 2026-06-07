// graphwright/graph — bi-temporal contradiction handling.
//
// A new fact never silently rewrites the graph. When an incoming edge
// contradicts existing current edges, the library emits an
// InvalidationProposal: accept it and the old edge gets invalid_at set
// (fact stopped being true) while the new edge becomes current.
// Decline it and both stand — some predicates genuinely coexist.
//
// What counts as a contradiction is host-declared per predicate via
// PredicatePolicy, because the library cannot know that "lives_in" is
// exclusive while "friend_of" is not.

import type { Edge } from '../types.js';

export type Cardinality = 'exclusive_per_source' | 'exclusive_pair' | 'additive';

export interface PredicatePolicy {
  predicate: string;
  /**
   * exclusive_per_source — at most one current edge per (source,
   *   predicate); a new target supersedes ("lives_in").
   * exclusive_pair — at most one current edge per (source, predicate,
   *   target); re-assertion refreshes support instead of duplicating.
   * additive — edges accumulate ("met_at", "talked_about").
   */
  cardinality: Cardinality;
}

export interface IncomingFact {
  source_entity_id: string;
  target_entity_id: string;
  predicate: string;
  /** When the fact became true, when known. */
  valid_at?: Date | null;
  /** Mention ids supporting this fact. */
  support: string[];
}

export interface InvalidationProposal {
  /** Edge that the incoming fact supersedes. */
  edge_id: string;
  /** Why: the incoming fact, for the review surface. */
  incoming: IncomingFact;
  /** Suggested invalid_at for the old edge (the new fact's valid_at,
   * else now). */
  invalid_at: Date;
}

export interface PlanEdgeUpsertResult {
  /** 'insert' = new edge row; 'refresh' = same fact re-asserted, add
   * support to the existing row; in both cases invalidations are
   * separate proposals. */
  action: 'insert' | 'refresh';
  /** Present when action = 'refresh'. */
  existing_edge_id?: string;
  invalidations: InvalidationProposal[];
}

/**
 * Pure planning function: given the incoming fact, the policy for its
 * predicate, and the CURRENT same-source edges (expired_at null), say
 * what should happen. The host applies the plan inside its own
 * transaction and review flow.
 */
export function planEdgeUpsert(
  incoming: IncomingFact,
  policy: PredicatePolicy,
  currentEdges: Edge[],
  now: Date,
): PlanEdgeUpsertResult {
  const relevant = currentEdges.filter(
    (e) =>
      e.expired_at === null &&
      e.invalid_at === null &&
      e.predicate === incoming.predicate &&
      e.source_entity_id === incoming.source_entity_id,
  );

  const samePair = relevant.find((e) => e.target_entity_id === incoming.target_entity_id);
  if (samePair) {
    // Same fact again: refresh support, never duplicate. Holds for
    // every cardinality.
    return { action: 'refresh', existing_edge_id: samePair.id, invalidations: [] };
  }

  if (policy.cardinality === 'exclusive_per_source') {
    const invalid_at = incoming.valid_at ?? now;
    return {
      action: 'insert',
      invalidations: relevant.map((e) => ({
        edge_id: e.id,
        incoming,
        invalid_at,
      })),
    };
  }

  // exclusive_pair with a different target, or additive: coexists.
  return { action: 'insert', invalidations: [] };
}
