import { describe, expect, it } from 'vitest';
import {
  phoneticKeys,
  phoneticMatch,
  latinScheme,
  persianScheme,
  DEFAULT_PHONETIC_SCHEMES,
  type PhoneticScheme,
} from '../src/resolve/phonetic/index.js';
import { InMemoryDecisionMemory } from '../src/resolve/memory.js';
import { resolveCandidates, type CatalogEntity } from '../src/resolve/cascade.js';

describe('phonetic keys — cross-script equivalence', () => {
  it('Faeze meets both Persian spellings (hamza and yeh)', () => {
    // The motivating case: zero shingle overlap across scripts, so
    // nothing below the exact stage could bridge these before.
    expect(phoneticMatch('Faeze', 'فائزه')).toBe(true);
    expect(phoneticMatch('Faeze', 'فایزه')).toBe(true);
    expect(phoneticMatch('Faezeh', 'فائزه')).toBe(true);
    expect(phoneticMatch('Fayezeh', 'فایزه')).toBe(true);
  });

  it('romanization digraphs meet their Persian letters', () => {
    expect(phoneticMatch('Khashayar', 'خشایار')).toBe(true);
    expect(phoneticMatch('Shahrzad', 'شهرزاد')).toBe(true);
    expect(phoneticMatch('Ghasem', 'قاسم')).toBe(true);
    expect(phoneticMatch('Jahangir', 'جهانگیر')).toBe(true);
  });

  it('ambiguous glides fork: Kaveh (vav as v) and Noora (vav as u) both match', () => {
    expect(phoneticMatch('Kaveh', 'کاوه')).toBe(true);
    expect(phoneticMatch('Noora', 'نورا')).toBe(true);
  });

  it('different names do not collide', () => {
    expect(phoneticMatch('Faeze', 'نرگس')).toBe(false);
    expect(phoneticMatch('Daniel', 'شهرزاد')).toBe(false);
    expect(phoneticMatch('Khashayar', 'قاسم')).toBe(false);
  });

  it('multi-word names key per word in order', () => {
    expect(phoneticMatch('Parisa Rostami', 'پریسا رستمی')).toBe(true);
    // Same words, different people order is a different key on purpose:
    // within one user's data the order is stable, and collapsing it
    // would merge father and son sharing swapped name pairs.
    expect(phoneticMatch('Parisa Rostami', 'رستمی پریسا')).toBe(false);
  });

  it('unclaimed scripts degrade to silence, not garbage', () => {
    // Greek is not in the default registry.
    expect(phoneticKeys('Ιβαν').size).toBe(0);
    expect(phoneticMatch('Ιβαν', 'ایوان')).toBe(false);
  });

  it('mixed-script names keep signal from the claimed words', () => {
    // The unclaimed word drops out; the claimed word still matches.
    const keys = phoneticKeys('Ιβαν Karimi');
    expect(keys.size).toBeGreaterThan(0);
    expect(phoneticMatch('Ιβαν Karimi', 'Karimi')).toBe(true);
  });

  it('a custom scheme extends the registry without touching built-ins', () => {
    // Minimal Greek scheme: enough to prove the seam works.
    const greek: PhoneticScheme = {
      id: 'grek',
      matches: (w) => /[α-ωϊ-ώ]/.test(w),
      wordKeys: (w) => {
        const map: Record<string, string> = { ι: '', β: 'v', α: '', ν: 'n' };
        let out = '';
        for (const ch of w) out += map[ch] ?? '';
        return out.length > 0 ? [out] : [];
      },
    };
    const schemes = [...DEFAULT_PHONETIC_SCHEMES, greek];
    expect(phoneticMatch('Ιβαν', 'ایوان', schemes)).toBe(true);
  });

  it('schemes do not claim each other\'s scripts', () => {
    expect(latinScheme.matches('سارا')).toBe(false);
    expect(persianScheme.matches('sara')).toBe(false);
  });
});

describe('decision memory — adaptive per-user matching', () => {
  const catalog: CatalogEntity[] = [
    { id: 'p1', kind: 'person', label: 'Parisa Rostami', aliases: [] },
    { id: 'p2', kind: 'person', label: 'Parisah Rostami', aliases: [] },
  ];

  it('a remembered confirmation resolves without review', async () => {
    const memory = new InMemoryDecisionMemory();
    memory.record({ surface: 'پری', kind: 'person', entity_id: 'p1', decision: 'confirmed' });
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'پری' }],
      catalog,
      { memory },
    );
    expect(out[0]).toMatchObject({
      entity_id: 'p1',
      basis: 'remembered',
      requires_review: false,
    });
  });

  it('a rejection suppresses even an exact alias match', async () => {
    const withAlias: CatalogEntity[] = [
      { id: 'p1', kind: 'person', label: 'Parisa Rostami', aliases: ['پری'] },
    ];
    const memory = new InMemoryDecisionMemory();
    memory.record({ surface: 'پری', kind: 'person', entity_id: 'p1', decision: 'rejected' });
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'پری' }],
      withAlias,
      { memory },
    );
    // The user looked at exactly this pairing and said no; the alias
    // must not bring it back.
    expect(out[0]!.entity_id).toBeNull();
  });

  it('context scopes a confirmation; the other context falls back to the cascade', async () => {
    const memory = new InMemoryDecisionMemory();
    memory.record({
      surface: 'مامان',
      kind: 'person',
      entity_id: 'p1',
      decision: 'confirmed',
      context: 'family-journal',
    });
    const inFamily = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'مامان', context: 'family-journal' }],
      catalog,
      { memory },
    );
    const elsewhere = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'مامان', context: 'work-notes' }],
      catalog,
      { memory },
    );
    expect(inFamily[0]).toMatchObject({ entity_id: 'p1', basis: 'remembered' });
    expect(elsewhere[0]!.basis).not.toBe('remembered');
  });

  it('a context-free confirmation applies in every context', async () => {
    const memory = new InMemoryDecisionMemory();
    memory.record({ surface: 'پری', kind: 'person', entity_id: 'p1', decision: 'confirmed' });
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'پری', context: 'anywhere' }],
      catalog,
      { memory },
    );
    expect(out[0]).toMatchObject({ entity_id: 'p1', basis: 'remembered' });
  });

  it('the user changing their mind updates the cell', async () => {
    const memory = new InMemoryDecisionMemory();
    memory.record({ surface: 'پری', kind: 'person', entity_id: 'p1', decision: 'rejected' });
    memory.record({ surface: 'پری', kind: 'person', entity_id: 'p1', decision: 'confirmed' });
    const after = await memory.lookup('پری', 'person');
    expect(after.confirmed).toBe('p1');
    expect(after.rejected.has('p1')).toBe(false);
  });

  it('converges on the last decision across repeated mind-changes', async () => {
    const memory = new InMemoryDecisionMemory();
    // Applied oldest-first, as a host replays a decision log.
    for (const decision of ['rejected', 'confirmed', 'rejected', 'confirmed'] as const) {
      memory.record({ surface: 'پری', kind: 'person', entity_id: 'p1', decision });
    }
    const after = await memory.lookup('پری', 'person');
    expect(after.confirmed).toBe('p1');
    expect(after.rejected.has('p1')).toBe(false);
  });

  it('a corrected mistaken rejection lets the entity win again in the cascade', async () => {
    // The host's "rejected by mistake, then re-linked" path: the
    // correcting confirm, replayed last, must clear the suppression so
    // the entity resolves without review.
    const withAlias: CatalogEntity[] = [
      { id: 'p1', kind: 'person', label: 'Parisa Rostami', aliases: ['پری'] },
    ];
    const memory = new InMemoryDecisionMemory();
    memory.record({ surface: 'پری', kind: 'person', entity_id: 'p1', decision: 'rejected', context: 'diary' });
    memory.record({ surface: 'پری', kind: 'person', entity_id: 'p1', decision: 'confirmed', context: 'diary' });
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'پری', context: 'diary' }],
      withAlias,
      { memory },
    );
    expect(out[0]).toMatchObject({ entity_id: 'p1', basis: 'remembered', requires_review: false });
  });

  it('a confirmation pointing at an entity missing from the catalog is ignored', async () => {
    const memory = new InMemoryDecisionMemory();
    memory.record({ surface: 'پری', kind: 'person', entity_id: 'gone', decision: 'confirmed' });
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'پری' }],
      catalog,
      { memory },
    );
    expect(out[0]!.basis).not.toBe('remembered');
  });

  it('memory failure degrades to no-memory resolution', async () => {
    const broken = {
      lookup: async () => {
        throw new Error('store down');
      },
    };
    const withAlias: CatalogEntity[] = [
      { id: 'p1', kind: 'person', label: 'Parisa Rostami', aliases: ['پری'] },
    ];
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'پری' }],
      withAlias,
      { memory: broken },
    );
    expect(out[0]).toMatchObject({ entity_id: 'p1', basis: 'exact' });
  });
});

describe('phonetic stage in the cascade', () => {
  const catalog: CatalogEntity[] = [
    { id: 'p1', kind: 'person', label: 'Faeze Eshgham', aliases: [] },
    { id: 'p2', kind: 'person', label: 'Daniel Rivera', aliases: [] },
  ];

  it('an unseen cross-script spelling resolves phonetic, requires review', async () => {
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'فائزه اشقام' }],
      catalog,
    );
    expect(out[0]).toMatchObject({
      entity_id: 'p1',
      basis: 'phonetic',
      score: 0.9,
      requires_review: true,
    });
  });

  it('two phonetic hits is an ambiguity: the stage stays silent', async () => {
    const homophones: CatalogEntity[] = [
      { id: 'p1', kind: 'person', label: 'Sara Karimi', aliases: [] },
      { id: 'p2', kind: 'person', label: 'Sarah Karimi', aliases: [] },
    ];
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'سارا کریمی' }],
      homophones,
    );
    expect(out[0]!.basis).not.toBe('phonetic');
  });

  it('a rejected entity cannot win the phonetic stage', async () => {
    const memory = new InMemoryDecisionMemory();
    memory.record({
      surface: 'فائزه اشقام',
      kind: 'person',
      entity_id: 'p1',
      decision: 'rejected',
    });
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'فائزه اشقام' }],
      catalog,
      { memory },
    );
    expect(out[0]!.entity_id).toBeNull();
  });

  it('phoneticSchemes: [] disables the stage', async () => {
    const out = await resolveCandidates(
      [{ ref: 'm0', kind: 'person', label: 'فائزه اشقام' }],
      catalog,
      { phoneticSchemes: [] },
    );
    expect(out[0]!.basis).not.toBe('phonetic');
  });
});
