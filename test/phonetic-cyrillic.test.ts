// The Cyrillic scheme bridges a Russian-written name to its romanization,
// the same way the Persian scheme bridges Perso-Arabic to Latin.

import { describe, it, expect } from 'vitest';
import { cyrillicScheme, phoneticKeys, phoneticMatch } from '../src/index.js';

describe('cyrillic phonetic scheme', () => {
  it('claims Cyrillic words and leaves the others alone', () => {
    expect(cyrillicScheme.matches('хабаров')).toBe(true);
    expect(cyrillicScheme.matches('Khabarov')).toBe(false);
    expect(cyrillicScheme.matches('فائزه')).toBe(false);
  });

  it('reduces a name to its consonant skeleton', () => {
    expect(cyrillicScheme.wordKeys('хабаров')).toContain('xbrv');
    expect(cyrillicScheme.wordKeys('иванов')).toContain('vnv');
  });

  it('bridges Cyrillic and Latin spellings of the same name', () => {
    expect(phoneticMatch('Хабаров', 'Khabarov')).toBe(true); // both -> xbrv
    expect(phoneticMatch('Сергей', 'Sergei')).toBe(true); // share srg
    expect(phoneticMatch('Яна', 'Yana')).toBe(true); // initial iotated -> yn
  });

  it('does not bridge unrelated names', () => {
    expect(phoneticMatch('Хабаров', 'Иванов')).toBe(false);
    expect(phoneticMatch('Khabarov', 'Иванов')).toBe(false);
  });

  it('is part of the default registry, so cross-script keys meet', () => {
    const ru = phoneticKeys('Хабаров');
    const en = phoneticKeys('Khabarov');
    expect([...ru].some((k) => en.has(k))).toBe(true);
  });
});
