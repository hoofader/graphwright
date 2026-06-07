// graphwright/resolve/phonetic — cross-script phonetic keys.
//
// Lexical similarity cannot bridge scripts: "Faeze" and "فائزه" share
// zero character shingles, so the fuzzy stage scores them 0 and only a
// stored alias can match them. Phonetic keys map every supported
// script onto a shared consonant-skeleton space so unseen cross-script
// spellings meet BEFORE any alias exists.
//
// Keys are intentionally lossy. A key collision is a PROPOSAL for
// review, never an auto-merge, so recall is favored over precision.
//
// Language rules live in per-language schemes (latin.ts, persian.ts);
// adding a script is a new scheme file plus a registry entry, or a
// host-supplied scheme list at the call site.

import { MAX_KEYS_PER_WORD, type PhoneticScheme } from './scheme.js';
import { latinScheme } from './latin.js';
import { persianScheme } from './persian.js';

/**
 * Registry order matters only when scripts overlap, which the default
 * schemes do not. Hosts extend by passing their own list (prepend a
 * specialized scheme to shadow a default one).
 */
export const DEFAULT_PHONETIC_SCHEMES: readonly PhoneticScheme[] = [persianScheme, latinScheme];

/**
 * Build the set of phonetic keys for one name (any script, possibly
 * multi-word, possibly mixed-script across words). Keys are per-word
 * skeletons joined by a space; word order is preserved because
 * given/family order is stable within one user's data. Returns an
 * empty set when no scheme claims any word.
 */
export function phoneticKeys(
  name: string,
  schemes: readonly PhoneticScheme[] = DEFAULT_PHONETIC_SCHEMES,
): Set<string> {
  const words = name
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{M}']+/u)
    .filter((w) => w.length > 0);
  if (words.length === 0) return new Set();

  const perWord = words.map((w) => {
    const scheme = schemes.find((s) => s.matches(w));
    return scheme ? scheme.wordKeys(w) : [];
  });
  // A word that produced no keys (unclaimed script, pure vowels)
  // drops out rather than voiding the whole name; the remaining words
  // still carry signal.
  const keyed = perWord.filter((ks) => ks.length > 0);
  if (keyed.length === 0) return new Set();

  let keys: string[] = [''];
  for (const wordKeys of keyed) {
    const next: string[] = [];
    for (const prefix of keys) {
      for (const wk of wordKeys) {
        next.push(prefix === '' ? wk : `${prefix} ${wk}`);
      }
    }
    keys = next.slice(0, MAX_KEYS_PER_WORD * 4);
  }
  return new Set(keys);
}

/** True when two names can denote the same pronunciation. */
export function phoneticMatch(
  a: string,
  b: string,
  schemes: readonly PhoneticScheme[] = DEFAULT_PHONETIC_SCHEMES,
): boolean {
  const ka = phoneticKeys(a, schemes);
  if (ka.size === 0) return false;
  const kb = phoneticKeys(b, schemes);
  for (const k of kb) {
    if (ka.has(k)) return true;
  }
  return false;
}

export type { PhoneticScheme } from './scheme.js';
export { MAX_KEYS_PER_WORD, collapseRepeats, dedupeCap, expandClasses } from './scheme.js';
export { latinScheme } from './latin.js';
export { persianScheme } from './persian.js';
