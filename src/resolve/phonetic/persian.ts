// graphwright/resolve/phonetic — Persian-script scheme.
//
// Maps Perso-Arabic letters onto the shared symbol space. Arabic-only
// letters fold into their Iranian pronunciation (ث/ص → s, ط → t,
// ق/غ → q) because names are romanized by sound, not by letter.
// Persian writes almost no short vowels, which is exactly why
// consonant skeletons survive the round trip to Latin.
//
// Ambiguity forks: medial و is v in کاوه but u in نورا; medial ی is
// y in some names and a pure vowel in فایزه; word-final ه is routinely
// dropped in romanization (Faeze / Faezeh). Each fork doubles the key
// set, capped by the shared expansion bound.

import { expandClasses, type PhoneticScheme } from './scheme.js';

const CLASSES: Record<string, string[]> = {
  'ب': ['b'],
  'پ': ['p'],
  'ت': ['t'],
  'ط': ['t'],
  'ث': ['s'],
  'س': ['s'],
  'ص': ['s'],
  'ج': ['j'],
  'چ': ['c'],
  'ح': ['h'],
  'ه': ['h'],
  'ة': ['h'],
  'خ': ['x'],
  'د': ['d'],
  'ذ': ['z'],
  'ز': ['z'],
  'ض': ['z'],
  'ظ': ['z'],
  'ر': ['r'],
  'ژ': ['j'],
  'ش': ['c'],
  'ف': ['f'],
  'ک': ['k'],
  'ك': ['k'],
  'گ': ['g'],
  'ل': ['l'],
  'م': ['m'],
  'ن': ['n'],
  'ق': ['q'],
  'غ': ['q'],
  // Glottal carriers and pure vowels contribute nothing; recall over
  // precision, and a key collision is only ever a review proposal.
  'ع': [''],
  'ء': [''],
  'ئ': [''],
  'أ': [''],
  'إ': [''],
  'ؤ': [''],
  'ا': [''],
  'آ': [''],
  // Ambiguous glides.
  'و': ['v', ''],
  'ی': ['y', ''],
  'ي': ['y', ''],
};

export const persianScheme: PhoneticScheme = {
  id: 'fa',

  matches(word: string): boolean {
    return /[؀-ۿ]/u.test(word);
  },

  wordKeys(word: string): string[] {
    const chars = [...word];
    const classSeq: string[][] = [];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      const classes = CLASSES[ch];
      if (classes === undefined) continue; // diacritics, tatweel, ZWNJ
      // Word-initial glides are reliably consonants (وحید, یاسمن).
      if (i === 0 && (ch === 'و' || ch === 'ی' || ch === 'ي')) {
        classSeq.push([classes[0]!]);
        continue;
      }
      // Word-final heh is routinely dropped in romanization (Faeze vs
      // Faezeh both spell فایزه). Medial heh is a real consonant
      // (شهرزاد) and stays.
      if (i === chars.length - 1 && (ch === 'ه' || ch === 'ة')) {
        classSeq.push(['h', '']);
        continue;
      }
      classSeq.push(classes);
    }
    return expandClasses(classSeq);
  },
};
