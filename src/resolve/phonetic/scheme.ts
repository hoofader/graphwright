// graphwright/resolve/phonetic — the per-language scheme contract.
//
// Phonetic keying is language-specific by nature: which letters carry
// the consonant skeleton, which are glides, which finals go silent in
// romanization. One scheme per language keeps each ruleset reviewable
// by someone who knows THAT language, and adding a script (Arabic
// proper, Hebrew, Cyrillic) is a new file implementing this interface,
// not an edit to a shared mapping table.

export interface PhoneticScheme {
  /** Stable identifier ('latn', 'fa', …) for diagnostics and tests. */
  id: string;
  /**
   * Does this scheme claim the word? Schemes are consulted in registry
   * order; the first claimant wins. A word no scheme claims contributes
   * no keys, so unknown scripts degrade to silence, never to garbage.
   */
  matches(word: string): boolean;
  /**
   * Phonetic keys for one word. The caller has already NFKC-normalized
   * and lowercased. Ambiguous letters may fork into alternatives; the
   * caller caps the expansion. Empty strings are discarded upstream.
   */
  wordKeys(word: string): string[];
}

export const MAX_KEYS_PER_WORD = 8;

/** "Faeze" and "Faezze" must key identically; repeats carry no signal. */
export function collapseRepeats(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch !== out[out.length - 1]) out += ch;
  }
  return out;
}

export function dedupeCap(xs: string[], cap: number = MAX_KEYS_PER_WORD): string[] {
  return [...new Set(xs)].slice(0, cap);
}

/**
 * Expand a per-character class sequence into concrete key variants.
 * Shared by schemes whose letters can fork (Persian glides); kept here
 * so every scheme bounds its expansion the same way.
 */
export function expandClasses(classSeq: string[][]): string[] {
  let variants: string[] = [''];
  for (const classes of classSeq) {
    const next: string[] = [];
    for (const v of variants) {
      for (const c of classes) {
        next.push(v + c);
      }
    }
    variants = dedupeCap(next);
  }
  return dedupeCap(variants.map(collapseRepeats)).filter((v) => v.length > 0);
}
