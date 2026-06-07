// graphwright — LLM injection seams.
//
// The library never imports a provider SDK. Hosts adapt their own
// gateway (with whatever safety wrapping, cost tracking, and redaction
// policy they run) to these three interfaces. Every LLM-using path in
// the library has a deterministic behavior when the adapter is absent
// or fails: extraction returns empty, the resolution cascade stops at
// its deterministic stages and marks survivors for review.

/** Raw-text completion used by extraction. */
export interface LLMCallerInput {
  system: string;
  /** Structured, trusted context (known entities, prior decisions). */
  trustedContext: Record<string, unknown>;
  /** The user-authored text. Hosts should wrap it as untrusted. */
  untrustedText: string;
  /** Literal text to return on any failure (parses as empty). */
  fallback: string;
}

export interface LLMCallerOutput {
  text: string;
}

export type LLMCaller = (input: LLMCallerInput) => Promise<LLMCallerOutput>;

/**
 * Pairwise same-entity judge used as the LAST stage of the resolution
 * cascade. Receives two labels plus their alias sets and answers
 * whether they denote the same real-world entity. Hosts back this with
 * a small-model call through their gateway.
 */
export interface JudgePairInput {
  kind: string;
  left: { label: string; aliases: string[] };
  right: { label: string; aliases: string[] };
  /** Optional source-text snippets for context. */
  leftContext?: string;
  rightContext?: string;
}

export interface JudgePairOutput {
  same: boolean;
  confidence: number;
}

export type PairJudge = (input: JudgePairInput) => Promise<JudgePairOutput>;

/**
 * Optional embedding hook for candidate generation. When provided, the
 * cascade nominates merge candidates by cosine similarity in addition
 * to the lexical stages. Hosts that treat name embeddings as sensitive
 * decide where vectors are stored; the library only computes pairs.
 */
export type Embedder = (texts: string[]) => Promise<number[][]>;
