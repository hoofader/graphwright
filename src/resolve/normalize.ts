// graphwright/resolve — name normalization for matching.
//
// All lexical stages of the cascade compare NORMALIZED strings.
// Normalization is intentionally aggressive for matching purposes
// only — display labels are never normalized.
//
// Persian/Arabic-specific folds matter because user-typed and
// keyboard-dependent variants of the same name differ at the
// codepoint level: Arabic yeh (ي U+064A) vs Persian yeh (ی U+06CC),
// Arabic kaf (ك U+0643) vs Persian keheh (ک U+06A9), optional
// diacritics, tatweel padding, and ZWNJ joins ("می‌روم" vs "میروم").

/** Arabic combining diacritics + Quranic annotation marks. */
const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
/** Tatweel (kashida) — pure padding, never semantic. */
const TATWEEL = /ـ/g;
/** Zero-width non-joiner and zero-width joiner. */
const ZERO_WIDTH = /[‌‍]/g;

export function normalizeName(raw: string): string {
  let s = raw.normalize('NFKC');
  // Persian/Arabic folds before casefolding (casefold is a no-op for
  // these scripts, but ordering keeps the pipeline easy to reason
  // about).
  s = s
    .replace(/ي/g, 'ی') // Arabic yeh → Persian yeh
    .replace(/ك/g, 'ک') // Arabic kaf → Persian keheh
    .replace(/[آأإ]/g, 'ا') // alef variants → bare alef
    .replace(/ة/g, 'ه') // teh marbuta → heh
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(ZERO_WIDTH, '');
  s = s.toLowerCase();
  // Strip leading/trailing punctuation the extractor sometimes keeps
  // ("Sara," / "«سارا»") and collapse whitespace, repeated to a fixed
  // point: alternating layers (' «Sara» ', '" «Sara» "') shield each
  // other from a single pass, and idempotence is what lets a stored
  // normalized alias and a freshly normalized candidate agree.
  let prev: string;
  do {
    prev = s;
    s = s.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
    s = s.replace(/\s+/g, ' ').trim();
  } while (s !== prev);
  return s;
}
