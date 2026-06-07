// graphwright/resolve/phonetic — Latin-script scheme.
//
// Targets romanizations of names rather than English phonology:
// digraphs that transliterate single letters of other scripts
// (kh, gh, sh, ch, zh) map onto the same symbols their source letters
// use in the sibling schemes, so "Khashayar" and "خشایار" meet on one
// key. Vowels drop: romanizations of the same name disagree mostly in
// vowels (Faeze / Faezeh / Fayezeh), consonants survive.

import { collapseRepeats, dedupeCap, type PhoneticScheme } from './scheme.js';

/**
 * Longest-first; applied before per-letter mapping. Placeholders are
 * UPPERCASE so the per-letter walk can tell a digraph product from a
 * raw letter: 'sh' maps to the same class symbol as ش, and that symbol
 * must not be re-interpreted by the bare-letter rules (bare c becomes
 * k, but the c that ش produces must stay c).
 */
const DIGRAPHS: Array<[string, string]> = [
  ['kh', 'X'],
  ['gh', 'Q'],
  ['sh', 'C'],
  ['ch', 'C'],
  ['zh', 'J'],
  ['ph', 'F'],
];

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

export const latinScheme: PhoneticScheme = {
  id: 'latn',

  matches(word: string): boolean {
    return /[a-z]/.test(word);
  },

  wordKeys(word: string): string[] {
    let s = word.replace(/'/g, '');
    for (const [digraph, symbol] of DIGRAPHS) {
      s = s.split(digraph).join(symbol);
    }
    let out = '';
    const chars = [...s];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      // Digraph placeholder: already a class symbol, pass through.
      if (/[A-Z]/.test(ch)) {
        out += ch.toLowerCase();
        continue;
      }
      if (VOWELS.has(ch)) continue;
      if (!/[a-z]/.test(ch)) continue;
      // Glides are consonants word-initially (Yasamin, Walid) and
      // vowel-colored elsewhere (Fayezeh, Kavoosi); mirrors the
      // Persian scheme's glide rule.
      if ((ch === 'y' || ch === 'w') && i > 0) continue;
      if (ch === 'w') {
        out += 'v';
        continue;
      }
      // Bare c is k (Cyrus); the digraph pass already claimed ch/sh.
      out += ch === 'c' ? 'k' : ch;
    }
    const key = collapseRepeats(out);
    if (key.length === 0) return [];
    // Word-final h after a vowel forks, mirroring the Persian scheme's
    // silent-heh rule: Sarah/Sara and Faezeh/Faeze are the same name,
    // and the Persian side already keys both ways.
    const endsVowelH = /[aeiou]h$/.test(s.replace(/[A-Z]/g, ''));
    if (endsVowelH && key.endsWith('h')) {
      return dedupeCap([key, key.slice(0, -1)].filter((k) => k.length > 0));
    }
    return [key];
  },
};
