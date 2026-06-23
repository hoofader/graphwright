// graphwright/evals — a labeled resolution corpus.
//
// Invented names only. Each case names the entity a candidate SHOULD
// resolve to (target), or null when it should stay a new entity.
//
//   BASE_CASES     lexical, resolvable by the deterministic cascade.
//   HARD_CASES     adversarial: cross-script positives that stress recall,
//                  and near-miss negatives that stress precision (the ones
//                  a naive matcher over-merges).
//   SEMANTIC_CASES need a real judge or embedder; scored only with an
//                  adapter, and where a model earns its keep.
//
// The signal is in HARD_CASES. Exact matches are always right; what tells
// you the cascade's quality is whether it bridges scripts and typos
// WITHOUT merging different people who share a name or a sound.

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
  { id: 'p_sara', kind: 'person', label: 'Sara Moradi', aliases: [] },
  { id: 'p_reza', kind: 'person', label: 'Reza Kazemi', aliases: [] },
  { id: 'p_bahar', kind: 'person', label: 'Bahar', aliases: [] }, // short, low-entropy
  { id: 'p_esf', kind: 'person', label: 'Esfandiyarpoor', aliases: [] }, // long; for the fuzzy case
  { id: 'pl_esfahan', kind: 'place', label: 'Esfahan', aliases: ['اصفهان'] },
];

// Resolvable without an LLM.
export const BASE_CASES: EvalCase[] = [
  // Exact on the normalized key.
  { candidate: { ref: 'b1', kind: 'person', label: 'faezeh karimi' }, target: 'p_faezeh' },
  // Cross-script phonetic: Persian spelling of a Latin-catalogued name.
  { candidate: { ref: 'b2', kind: 'person', label: 'خشایار' }, target: 'p_khashayar' },
  // Fuzzy/phonetic: a one-letter typo in a long, distinctive name.
  { candidate: { ref: 'b3', kind: 'person', label: 'Shahrbanoo Deilami' }, target: 'p_shahrbanoo' },
  // Place, cross-script exact via the Persian alias.
  { candidate: { ref: 'b4', kind: 'place', label: 'اصفهان' }, target: 'pl_esfahan' },
  // Different person who happens to share a given name: must NOT merge.
  { candidate: { ref: 'b5', kind: 'person', label: 'Ali Hosseini' }, target: null },
  // Unrelated new place.
  { candidate: { ref: 'b6', kind: 'place', label: 'Tabriz' }, target: null },
];

export const HARD_CASES: EvalCase[] = [
  // ── positives that stress recall ──
  // A typo that keeps the consonant skeleton (Kazemi -> Kazimi).
  { candidate: { ref: 'h1', kind: 'person', label: 'Reza Kazimi' }, target: 'p_reza' },
  // Cross-script, multi-word: both words must bridge for the name to.
  { candidate: { ref: 'h2', kind: 'person', label: 'فائزه کریمی' }, target: 'p_faezeh' },
  // A final-consonant typo (r -> n): the phonetic skeleton forks, so ONLY
  // the fuzzy stage (high shingle overlap) can reach it. This is the case
  // that gives fuzzy its marginal value over phonetic.
  { candidate: { ref: 'h8', kind: 'person', label: 'Esfandiyarpoon' }, target: 'p_esf' },

  // ── negatives that stress precision (specificity) ──
  // A bare given name must not attach to a full-name entity.
  { candidate: { ref: 'h3', kind: 'person', label: 'Ali' }, target: null },
  // Shares one token with two entities, but is a distinct person.
  { candidate: { ref: 'h4', kind: 'person', label: 'Sara Karimi' }, target: null },
  // Different surname, no skeleton overlap.
  { candidate: { ref: 'h5', kind: 'person', label: 'Reza Ghassemi' }, target: null },

  // ── the traps: a naive matcher merges these, the cascade should not ──
  // Same consonant skeleton as 'Sara Moradi' (sr mrd) but a different
  // person. Phonetic WILL propose this merge; that is its precision cost,
  // and why a phonetic hit is requires_review, not auto. Turning the
  // phonetic stage off recovers the precision (and loses b2/h2 recall).
  { candidate: { ref: 'h6', kind: 'person', label: 'Soroor Moeedi' }, target: null },
  // Low-entropy near-duplicate. The entropy gate should keep it out of the
  // fuzzy stage so it does not auto-merge to 'Bahar'.
  { candidate: { ref: 'h7', kind: 'person', label: 'Bahaar' }, target: null },
];

// The full lexical set the ablation sweeps (no adapter needed).
export const LEXICAL_CASES: EvalCase[] = [...BASE_CASES, ...HARD_CASES];

// Needs semantic similarity (embedder) or a pairwise judge to reach.
export const SEMANTIC_CASES: EvalCase[] = [
  // Abbreviated family name: lexically far, same person.
  { candidate: { ref: 's1', kind: 'person', label: 'Shahrbanoo D.' }, target: 'p_shahrbanoo' },
  // Given name only, in a context where the catalog has one match.
  { candidate: { ref: 's2', kind: 'person', label: 'Faezeh' }, target: 'p_faezeh' },
];
