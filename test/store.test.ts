import { describe, expect, it } from 'vitest';
import { InMemoryGraphStore } from '../src/store/memory.js';

describe('InMemoryGraphStore', () => {
  it('round-trips an entity with aliases', async () => {
    const store = new InMemoryGraphStore();
    const e = await store.createEntity({ kind: 'person', label: 'Parisa Rostami', aliases: [] });
    await store.addAlias(e.id, 'پریسا');
    const got = await store.getEntity(e.id);
    expect(got?.aliases).toEqual(['پریسا']);
    // Duplicate alias is a no-op.
    await store.addAlias(e.id, 'پریسا');
    expect((await store.getEntity(e.id))?.aliases).toEqual(['پریسا']);
  });

  it('mention status transitions write entity links', async () => {
    const store = new InMemoryGraphStore();
    const e = await store.createEntity({ kind: 'person', label: 'Parisa', aliases: [] });
    const m = await store.createMention({
      source_id: 'doc1',
      kind: 'person',
      surface_form: 'پریسا',
      span_start: 0,
      span_end: 5,
      candidate_label: 'پریسا',
      entity_id: null,
      status: 'pending',
      confidence: 0.9,
    });
    await store.setMentionStatus(m.id, 'confirmed', e.id);
    const got = await store.getMention(m.id);
    expect(got?.status).toBe('confirmed');
    expect(got?.entity_id).toBe(e.id);
  });

  it('listCurrentEdges excludes expired rows', async () => {
    const store = new InMemoryGraphStore();
    const e = await store.createEdge({
      source_entity_id: 'a',
      target_entity_id: 'b',
      predicate: 'lives_in',
      valid_at: null,
      invalid_at: null,
      recorded_at: new Date(),
      expired_at: null,
      support: [],
    });
    expect(await store.listCurrentEdges()).toHaveLength(1);
    await store.expireEdge(e.id, new Date());
    expect(await store.listCurrentEdges()).toHaveLength(0);
  });

  it('filters mentions by source and status', async () => {
    const store = new InMemoryGraphStore();
    const base = {
      kind: 'person' as const,
      surface_form: 'x',
      span_start: 0,
      span_end: 1,
      candidate_label: 'x',
      entity_id: null,
      confidence: 0.9,
    };
    await store.createMention({ ...base, source_id: 'doc1', status: 'pending' });
    await store.createMention({ ...base, source_id: 'doc1', status: 'confirmed' });
    await store.createMention({ ...base, source_id: 'doc2', status: 'pending' });
    expect(await store.listMentions({ source_id: 'doc1' })).toHaveLength(2);
    expect(await store.listMentions({ source_id: 'doc1', status: 'pending' })).toHaveLength(1);
  });
});
