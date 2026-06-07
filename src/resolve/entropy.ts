// graphwright/resolve — entropy gate for fuzzy matching.
//
// Short, low-entropy names ("Ali", "علی", "Bob") produce false fuzzy
// merges: one edit step reaches a DIFFERENT real name ("Ali" → "Alia",
// "علی" → "ولی"). The gate (after Graphiti's dedup_helpers) routes
// low-entropy names past the fuzzy stages straight to the judge /
// review queue, where context decides instead of character overlap.

/** Shannon entropy in bits over the character distribution. */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const n = [...s].length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Default gate: fuzzy matching is allowed only when the normalized
 * name carries enough information. 2.0 bits ≈ at least four
 * reasonably distinct characters; "علی" (≈1.58) and "bob" (≈0.92)
 * fail, "faeze eshgham" passes.
 */
export const DEFAULT_FUZZY_ENTROPY_THRESHOLD = 2.0;

export function passesEntropyGate(
  normalized: string,
  threshold: number = DEFAULT_FUZZY_ENTROPY_THRESHOLD,
): boolean {
  return shannonEntropy(normalized) >= threshold;
}
