// PostgresGraphStore — real-database CRUD + bi-temporal semantics.
//
// Gated on GRAPHWRIGHT_PG_URL so CI (which has no Postgres) skips it.
// Run locally against a throwaway database:
//   GRAPHWRIGHT_PG_URL=postgres://... pnpm test postgres-store

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresGraphStore, type SqlExecutor } from '../src/store/postgres.js';

const URL = process.env.GRAPHWRIGHT_PG_URL;

describe.skipIf(!URL)('PostgresGraphStore', () => {
  let pool: Pool;
  let store: PostgresGraphStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    // A thin adapter doubles as the documented "bring your own client"
    // path: forward to pg and cast its rows to the caller's row type.
    const exec: SqlExecutor = {
      query: async <R>(text: string, params?: unknown[]) => {
        const res = await pool.query(text, params);
        return { rows: res.rows as R[] };
      },
    };
    store = new PostgresGraphStore(exec);
    await store.migrate();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE gw_episodes, gw_edges, gw_mentions, gw_entities CASCADE');
  });

  it('entities: create, get, list-by-kind, alias dedup + not-found', async () => {
    const p = await store.createEntity({ kind: 'person', label: 'Parisa', aliases: ['پریسا'] });
    expect(p.id).toBeTruthy();
    expect(p.created_at).toBeInstanceOf(Date);
    expect(await store.getEntity(p.id)).toMatchObject({ label: 'Parisa', aliases: ['پریسا'] });

    await store.createEntity({ kind: 'place', label: 'Tehran', aliases: [] });
    expect((await store.listEntities('person')).map((e) => e.label)).toEqual(['Parisa']);

    await store.addAlias(p.id, 'Pari');
    await store.addAlias(p.id, 'Pari'); // dup is a no-op
    expect((await store.getEntity(p.id))!.aliases.sort()).toEqual(['Pari', 'پریسا']);
    await expect(store.addAlias('missing', 'x')).rejects.toThrow(/not found/);
  });

  it('mentions: create, filters, status transition + not-found', async () => {
    const p = await store.createEntity({ kind: 'person', label: 'Sara', aliases: [] });
    const m = await store.createMention({
      source_id: 'doc1',
      kind: 'person',
      surface_form: 'Sara',
      span_start: 0,
      span_end: 4,
      candidate_label: 'sara',
      entity_id: null,
      status: 'pending',
      confidence: 0.8,
    });
    expect(await store.getMention(m.id)).toMatchObject({ source_id: 'doc1', status: 'pending' });
    expect(await store.listMentions({ source_id: 'doc1' })).toHaveLength(1);
    expect(await store.listMentions({ status: 'confirmed' })).toHaveLength(0);

    await store.setMentionStatus(m.id, 'confirmed', p.id);
    expect(await store.getMention(m.id)).toMatchObject({ status: 'confirmed', entity_id: p.id });
    expect(await store.listMentions({ entity_id: p.id })).toHaveLength(1);
    await expect(store.setMentionStatus('missing', 'confirmed')).rejects.toThrow(/not found/);
  });

  it('edges: create, current filter, invalidate, expire, support', async () => {
    const a = await store.createEntity({ kind: 'person', label: 'A', aliases: [] });
    const b = await store.createEntity({ kind: 'place', label: 'B', aliases: [] });
    const recorded = new Date('2026-01-01T00:00:00Z');
    const e = await store.createEdge({
      source_entity_id: a.id,
      target_entity_id: b.id,
      predicate: 'lives_in',
      valid_at: recorded,
      invalid_at: null,
      recorded_at: recorded,
      expired_at: null,
      support: ['m1'],
    });
    expect(await store.getEdge(e.id)).toMatchObject({ predicate: 'lives_in', support: ['m1'] });
    expect(await store.listCurrentEdges({ source_entity_id: a.id })).toHaveLength(1);

    await store.setEdgeSupport(e.id, ['m1', 'm2']);
    expect((await store.getEdge(e.id))!.support).toEqual(['m1', 'm2']);

    await store.invalidateEdge(e.id, new Date('2026-02-01T00:00:00Z'));
    expect((await store.getEdge(e.id))!.invalid_at).toBeInstanceOf(Date);
    // Invalidated-but-not-expired is still "current" (the fact stopped
    // holding in the world, but the row is the live record of that).
    expect(await store.listCurrentEdges()).toHaveLength(1);

    await store.expireEdge(e.id, new Date('2026-02-01T00:00:00Z'));
    expect(await store.listCurrentEdges()).toHaveLength(0);
    await expect(store.expireEdge('missing', new Date())).rejects.toThrow(/not found/);
  });

  it('episodes: create + list by source', async () => {
    const ep = await store.createEpisode({
      source_id: 'doc1',
      ingested_at: new Date('2026-01-01T00:00:00Z'),
      mention_ids: ['m1', 'm2'],
    });
    expect(ep.mention_ids).toEqual(['m1', 'm2']);
    expect(await store.listEpisodes('doc1')).toHaveLength(1);
    expect(await store.listEpisodes('other')).toHaveLength(0);
  });
});
