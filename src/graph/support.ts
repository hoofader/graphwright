// graphwright/graph — support tracking for source removal.
//
// Every edge carries the mention ids that support it (episode
// provenance). When a source document is deleted or re-extracted, the
// host removes its mentions and asks what that does to the graph.
// Edges whose support drops to zero are NOT deleted — they're flagged
// for review, because the user may know the fact is still true even
// if the diary entry that established it is gone.

import type { Edge } from '../types.js';

export interface SupportReview {
  edge_id: string;
  /** Support remaining after the removal. */
  remaining_support: string[];
  /** True when no mentions support this edge anymore. */
  orphaned: boolean;
}

/**
 * Pure function: given current edges and the set of mention ids being
 * removed, compute each affected edge's remaining support. The host
 * applies the support updates and queues orphaned edges for review.
 */
export function planSupportRemoval(
  edges: Edge[],
  removedMentionIds: ReadonlySet<string>,
): SupportReview[] {
  const out: SupportReview[] = [];
  for (const edge of edges) {
    if (edge.expired_at !== null) continue;
    const remaining = edge.support.filter((id) => !removedMentionIds.has(id));
    if (remaining.length === edge.support.length) continue;
    out.push({
      edge_id: edge.id,
      remaining_support: remaining,
      orphaned: remaining.length === 0,
    });
  }
  return out;
}
