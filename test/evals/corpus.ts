// graphwright/evals — a labeled resolution corpus.
//
// Invented names only. Each case names the entity a candidate SHOULD
// resolve to (target), or null when it should stay a new entity. The
// `base` set is what the deterministic cascade (exact + phonetic + fuzzy +
// gate) is expected to get on its own. The `semantic` set needs a real
// judge or embedder; it is scored only when an adapter is supplied, and it
// is where a model earns its keep over the lexical stages.

import type { CatalogEntity, ResolutionCandidate } from '../../src/index.js';

export interface EvalCase {
  candidate: ResolutionCandidate;
  target: string | null;
}

export const CATALOG: CatalogEntity[] = [
  { id: 'p_khashayar', kind: 'person', label: 'Khashayar', aliases: [] },
  { id: 'p_faezeh', kind: 'person', label: 'Faezeh Karimi', aliases: [] },
  { id: 'p_shahrbanoo', kind: 'person', label: 'Shahrbanoo Deylami', aliases: [] },
  { id: 'p_ali', kind: 'person', label: 'Ali Razavi', aliases: [] },
  { id: 'pl_esfahan', kind: 'place', label: 'Esfahan', aliases: ['اصفهان'] },
];

// Resolvable without an LLM.
export const BASE_CASES: EvalCase[] = [
  // Exact on the normalized key.
  { candidate: { ref: 'b1', kind: 'person', label: 'faezeh karimi' }, target: 'p_faezeh' },
  // Cross-script phonetic: Persian spelling of a Latin-catalogued name.
  { candidate: { ref: 'b2', kind: 'person', label: 'خشایار' }, target: 'p_khashayar' },
  // Fuzzy: a one-letter typo in a long, distinctive name.
  { candidate: { ref: 'b3', kind: 'person', label: 'Shahrbanoo Deilami' }, target: 'p_shahrbanoo' },
  // Place, cross-script exact via the Persian alias.
  { candidate: { ref: 'b4', kind: 'place', label: 'اصفهان' }, target: 'pl_esfahan' },
  // Different person who happens to share a given name: must NOT merge.
  { candidate: { ref: 'b5', kind: 'person', label: 'Ali Hosseini' }, target: null },
  // Unrelated new place.
  { candidate: { ref: 'b6', kind: 'place', label: 'Tabriz' }, target: null },
];

// Needs semantic similarity (embedder) or a pairwise judge to reach.
export const SEMANTIC_CASES: EvalCase[] = [
  // Abbreviated family name: lexically far, same person.
  { candidate: { ref: 's1', kind: 'person', label: 'Shahrbanoo D.' }, target: 'p_shahrbanoo' },
  // Given name only, in a context where the catalog has one match.
  { candidate: { ref: 's2', kind: 'person', label: 'Faezeh' }, target: 'p_faezeh' },
];
