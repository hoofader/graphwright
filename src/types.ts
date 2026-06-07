// graphwright — core domain types.
//
// The design center: AI output is never canon. Extraction produces
// MENTIONS (pending), resolution produces PROPOSALS, and only an
// explicit accept (by a human, or by host policy on high-confidence
// deterministic matches) mutates the graph. Storage is behind the
// GraphStore interface so hosts choose where the graph lives.

export type EntityKind = 'person' | 'place' | 'concept' | (string & {});

export interface Entity {
  id: string;
  kind: EntityKind;
  /** Canonical display label. */
  label: string;
  /** Alternate surface strings that resolve to this entity. */
  aliases: string[];
  created_at: Date;
}

// ─── Mentions (the human-in-the-loop unit) ─────────────────────────

export type MentionStatus = 'pending' | 'confirmed' | 'rejected';

export interface Mention {
  id: string;
  /** Host-supplied source document id (diary entry, note, email…). */
  source_id: string;
  kind: EntityKind;
  /** Exact substring of the source text. */
  surface_form: string;
  /** UTF-16 code-unit offsets into the source text; end exclusive. */
  span_start: number;
  span_end: number;
  /** Normalized label used to group repeat mentions within a source. */
  candidate_label: string;
  /** Entity this mention resolves to. Null until linked. */
  entity_id: string | null;
  status: MentionStatus;
  /** Extractor confidence in [0, 1]. */
  confidence: number;
  created_at: Date;
}

// ─── Relationships (bi-temporal edges) ─────────────────────────────

/**
 * Four-timestamp model (after Graphiti / the Zep paper,
 * arXiv:2501.13956): valid_at/invalid_at track when the fact held in
 * the world; recorded_at/expired_at track when the system learned and
 * superseded it. Contradictions invalidate, never delete — history
 * stays queryable.
 */
export interface Edge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  /** Predicate from the host's closed vocabulary. */
  predicate: string;
  /** When the fact became true in the world. Null = unknown. */
  valid_at: Date | null;
  /** When the fact stopped being true. Null = still true. */
  invalid_at: Date | null;
  /** When the system learned the fact. */
  recorded_at: Date;
  /** When the system superseded this row. Null = current. */
  expired_at: Date | null;
  /** Mention ids supporting this edge (episode provenance). */
  support: string[];
}

// ─── Episodes (provenance) ─────────────────────────────────────────

/**
 * One ingestion event: a source document passing through extraction.
 * Everything derived from it points back here, which is what makes
 * "why does the graph believe this" answerable and makes source
 * deletion tractable (decrement support, flag zero-support edges).
 */
export interface Episode {
  id: string;
  source_id: string;
  ingested_at: Date;
  mention_ids: string[];
}
