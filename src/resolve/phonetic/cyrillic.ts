// graphwright/resolve/phonetic — Cyrillic-script scheme.
//
// Maps Cyrillic letters onto the shared consonant-skeleton space, so a
// Russian-written name meets its romanization: "Хабаров" and "Khabarov"
// both reduce to "xbrv". Pronunciation is Russian-leaning (г → g, not the
// Ukrainian h); cross-script keys are lossy on purpose, and a collision is
// a review proposal, never an auto-merge.
//
// Vowels drop (the consonant skeleton is what survives romanization). The
// soft/hard signs are silent. The two ambiguous glides fork: й is a y in
// "Андрей" but colors a preceding vowel away in "Сергей", and a word-
// initial iotated vowel (Я, Ю, Ё, Е, …) carries a y-glide ("Яна" / "Yana").

import { expandClasses, type PhoneticScheme } from './scheme.js';

const CLASSES: Record<string, string[]> = {
  'б': ['b'],
  'в': ['v'],
  'г': ['g'],
  'д': ['d'],
  'ж': ['j'],
  'з': ['z'],
  'к': ['k'],
  'л': ['l'],
  'м': ['m'],
  'н': ['n'],
  'п': ['p'],
  'р': ['r'],
  'с': ['s'],
  'т': ['t'],
  'ф': ['f'],
  'х': ['x'],
  'ц': ['ts'],
  'ч': ['c'],
  'ш': ['c'],
  'щ': ['c'],
  // Glide: consonant word-initially, vowel-coloring elsewhere.
  'й': ['y', ''],
  // Vowels and the soft/hard signs contribute nothing.
  'а': [''],
  'о': [''],
  'у': [''],
  'ы': [''],
  'э': [''],
  'и': [''],
  'е': [''],
  'ё': [''],
  'я': [''],
  'ю': [''],
  'і': [''],
  'ї': [''],
  'є': [''],
  'ь': [''],
  'ъ': [''],
};

// Word-initial iotated vowels begin with a y-glide.
const INITIAL_IOTATED = new Set(['я', 'ю', 'ё', 'е', 'є', 'ї']);

export const cyrillicScheme: PhoneticScheme = {
  id: 'cyrl',

  matches(word: string): boolean {
    return /[Ѐ-ӿ]/u.test(word);
  },

  wordKeys(word: string): string[] {
    const chars = [...word];
    const classSeq: string[][] = [];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      if (i === 0 && INITIAL_IOTATED.has(ch)) {
        classSeq.push(['y', '']);
        continue;
      }
      const classes = CLASSES[ch];
      if (classes === undefined) continue; // unknown mark
      // Word-initial й is reliably a consonant (Йосеф).
      if (i === 0 && ch === 'й') {
        classSeq.push(['y']);
        continue;
      }
      classSeq.push(classes);
    }
    return expandClasses(classSeq);
  },
};
