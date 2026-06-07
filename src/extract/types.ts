// graphwright/extract — extraction input/output types.

import type { LLMCaller } from '../llm.js';

export type ContentLanguage = 'en' | 'fa' | 'unknown' | (string & {});

export type ExtractionKind = 'person' | 'place' | 'concept';

// ─── Context (what the host knows about this corpus/user) ──────────

export interface KnownPerson {
  /** Stable identifier in the host's data store. */
  id: string;
  display_name: string;
  aliases?: string[];
}

export interface KnownPlace {
  id: string;
  label: string;
  aliases?: string[];
}

export interface KnownConcept {
  id: string;
  label: string;
}

/**
 * A prior decision the user made — sent as a few-shot example so the
 * LLM resolves repeat mentions consistently. Keep small (≤20 entries).
 */
export interface RecentConfirmation {
  surface: string;
  entity_kind: ExtractionKind;
  entity_id: string;
  entity_label: string;
}

export interface ExtractorContext {
  knownPeople?: KnownPerson[];
  knownPlaces?: KnownPlace[];
  knownConcepts?: KnownConcept[];
  recentConfirmations?: RecentConfirmation[];
}

// ─── Public input + output ────────────────────────────────────────

export interface ExtractorInput {
  text: string;
  /** When known, helps the LLM disambiguate non-capitalized scripts. */
  language?: ContentLanguage;
  context?: ExtractorContext;
  llm: LLMCaller;
  /** Override the built-in system prompt. */
  systemPrompt?: string;
  /**
   * Concepts below this confidence are dropped before returning.
   * Defaults to 0.7 — keeps the review queue useful.
   */
  conceptConfidenceFloor?: number;
  /**
   * Hard caps applied to the context before sending. Defaults are
   * `{ knownPeople: 100, knownPlaces: 50, knownConcepts: 50,
   *    recentConfirmations: 20 }`.
   */
  contextLimits?: {
    knownPeople?: number;
    knownPlaces?: number;
    knownConcepts?: number;
    recentConfirmations?: number;
  };
}

export interface ExtractedMention {
  kind: ExtractionKind;
  surface_form: string;
  span_start: number;
  span_end: number;
  /** Normalized label used for cross-mention grouping. */
  candidate_label: string;
  /**
   * The LLM matched this mention to a known entity passed in via
   * context. Null when unknown.
   */
  candidate_id: string | null;
  confidence: number;
}

export interface ExtractedEntities {
  people: ExtractedMention[];
  places: ExtractedMention[];
  concepts: ExtractedMention[];
}
