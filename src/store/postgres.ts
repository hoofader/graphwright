// graphwright/store — Postgres reference implementation.
//
// graphwright takes no runtime dependency on a database driver. Instead
// the host injects a minimal executor with the shape of node-postgres'
// `query(text, params)`, so passing a `pg.Pool` works directly and any
// other client adapts in a few lines. The library stays driver-agnostic;
// this class is just the SQL that realizes GraphStore's semantics.
//
// Run POSTGRES_SCHEMA once (it is idempotent) before using the store.
// Tables are prefixed `gw_` so they coexist with host tables.

import { randomUUID } from 'node:crypto';
import type { Edge, Entity, EntityKind, Episode, Mention, MentionStatus } from '../types.js';
import type { GraphStore } from './store.js';

/** node-postgres-compatible executor. `pg.Pool` and `pg.Client` satisfy it. */
export interface SqlExecutor {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS gw_entities (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  label       TEXT NOT NULL,
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gw_entities_kind ON gw_entities (kind);

CREATE TABLE IF NOT EXISTS gw_mentions (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  surface_form    TEXT NOT NULL,
  span_start      INTEGER NOT NULL,
  span_end        INTEGER NOT NULL,
  candidate_label TEXT NOT NULL,
  entity_id       TEXT REFERENCES gw_entities(id) ON DELETE SET NULL,
  status          TEXT NOT NULL,
  confidence      REAL NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gw_mentions_source ON gw_mentions (source_id);
CREATE INDEX IF NOT EXISTS gw_mentions_entity ON gw_mentions (entity_id);
CREATE INDEX IF NOT EXISTS gw_mentions_status ON gw_mentions (status);

CREATE TABLE IF NOT EXISTS gw_edges (
  id                TEXT PRIMARY KEY,
  source_entity_id  TEXT NOT NULL REFERENCES gw_entities(id) ON DELETE CASCADE,
  target_entity_id  TEXT NOT NULL REFERENCES gw_entities(id) ON DELETE CASCADE,
  predicate         TEXT NOT NULL,
  valid_at          TIMESTAMPTZ,
  invalid_at        TIMESTAMPTZ,
  recorded_at       TIMESTAMPTZ NOT NULL,
  expired_at        TIMESTAMPTZ,
  support           TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS gw_edges_source ON gw_edges (source_entity_id);
CREATE INDEX IF NOT EXISTS gw_edges_predicate ON gw_edges (predicate);
CREATE INDEX IF NOT EXISTS gw_edges_current ON gw_edges (source_entity_id, predicate)
  WHERE expired_at IS NULL;

CREATE TABLE IF NOT EXISTS gw_episodes (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL,
  ingested_at  TIMESTAMPTZ NOT NULL,
  mention_ids  TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS gw_episodes_source ON gw_episodes (source_id);
`;

interface EntityRow {
  id: string;
  kind: string;
  label: string;
  aliases: string[] | null;
  created_at: Date;
}
interface MentionRow {
  id: string;
  source_id: string;
  kind: string;
  surface_form: string;
  span_start: number;
  span_end: number;
  candidate_label: string;
  entity_id: string | null;
  status: string;
  confidence: number;
  created_at: Date;
}
interface EdgeRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  predicate: string;
  valid_at: Date | null;
  invalid_at: Date | null;
  recorded_at: Date;
  expired_at: Date | null;
  support: string[] | null;
}
interface EpisodeRow {
  id: string;
  source_id: string;
  ingested_at: Date;
  mention_ids: string[] | null;
}

function toEntity(r: EntityRow): Entity {
  return { id: r.id, kind: r.kind, label: r.label, aliases: r.aliases ?? [], created_at: r.created_at };
}
function toMention(r: MentionRow): Mention {
  return {
    id: r.id,
    source_id: r.source_id,
    kind: r.kind,
    surface_form: r.surface_form,
    span_start: r.span_start,
    span_end: r.span_end,
    candidate_label: r.candidate_label,
    entity_id: r.entity_id,
    status: r.status as MentionStatus,
    confidence: r.confidence,
    created_at: r.created_at,
  };
}
function toEdge(r: EdgeRow): Edge {
  return {
    id: r.id,
    source_entity_id: r.source_entity_id,
    target_entity_id: r.target_entity_id,
    predicate: r.predicate,
    valid_at: r.valid_at,
    invalid_at: r.invalid_at,
    recorded_at: r.recorded_at,
    expired_at: r.expired_at,
    support: r.support ?? [],
  };
}
function toEpisode(r: EpisodeRow): Episode {
  return { id: r.id, source_id: r.source_id, ingested_at: r.ingested_at, mention_ids: r.mention_ids ?? [] };
}

export class PostgresGraphStore implements GraphStore {
  constructor(private readonly sql: SqlExecutor) {}

  /** Apply the (idempotent) schema. Convenience for setup + tests. */
  async migrate(): Promise<void> {
    await this.sql.query(POSTGRES_SCHEMA);
  }

  // ── Entities ─────────────────────────────────────────────────────

  async createEntity(input: Omit<Entity, 'id' | 'created_at'>): Promise<Entity> {
    const id = randomUUID();
    const { rows } = await this.sql.query<EntityRow>(
      `INSERT INTO gw_entities (id, kind, label, aliases, created_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING *`,
      [id, input.kind, input.label, input.aliases],
    );
    return toEntity(rows[0]!);
  }

  async getEntity(id: string): Promise<Entity | null> {
    const { rows } = await this.sql.query<EntityRow>('SELECT * FROM gw_entities WHERE id = $1', [id]);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async listEntities(kind?: EntityKind): Promise<Entity[]> {
    const { rows } =
      kind === undefined
        ? await this.sql.query<EntityRow>('SELECT * FROM gw_entities ORDER BY created_at')
        : await this.sql.query<EntityRow>(
            'SELECT * FROM gw_entities WHERE kind = $1 ORDER BY created_at',
            [kind],
          );
    return rows.map(toEntity);
  }

  async addAlias(entity_id: string, alias: string): Promise<void> {
    // Touch the row whenever it exists (dup alias is a no-op via CASE) so
    // a 0-row result unambiguously means "not found".
    const { rows } = await this.sql.query(
      `UPDATE gw_entities
          SET aliases = CASE WHEN $2 = ANY(aliases) THEN aliases ELSE array_append(aliases, $2) END
        WHERE id = $1 RETURNING id`,
      [entity_id, alias],
    );
    if (rows.length === 0) throw new Error(`entity not found: ${entity_id}`);
  }

  // ── Mentions ─────────────────────────────────────────────────────

  async createMention(input: Omit<Mention, 'id' | 'created_at'>): Promise<Mention> {
    const id = randomUUID();
    const { rows } = await this.sql.query<MentionRow>(
      `INSERT INTO gw_mentions
         (id, source_id, kind, surface_form, span_start, span_end, candidate_label, entity_id, status, confidence, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now()) RETURNING *`,
      [
        id,
        input.source_id,
        input.kind,
        input.surface_form,
        input.span_start,
        input.span_end,
        input.candidate_label,
        input.entity_id,
        input.status,
        input.confidence,
      ],
    );
    return toMention(rows[0]!);
  }

  async getMention(id: string): Promise<Mention | null> {
    const { rows } = await this.sql.query<MentionRow>('SELECT * FROM gw_mentions WHERE id = $1', [id]);
    return rows[0] ? toMention(rows[0]) : null;
  }

  async listMentions(filter?: {
    source_id?: string;
    entity_id?: string;
    status?: MentionStatus;
  }): Promise<Mention[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.source_id !== undefined) where.push(`source_id = $${params.push(filter.source_id)}`);
    if (filter?.entity_id !== undefined) where.push(`entity_id = $${params.push(filter.entity_id)}`);
    if (filter?.status !== undefined) where.push(`status = $${params.push(filter.status)}`);
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const { rows } = await this.sql.query<MentionRow>(
      `SELECT * FROM gw_mentions${clause} ORDER BY created_at`,
      params,
    );
    return rows.map(toMention);
  }

  async setMentionStatus(id: string, status: MentionStatus, entity_id?: string | null): Promise<void> {
    const setEntity = entity_id !== undefined;
    const { rows } = await this.sql.query(
      `UPDATE gw_mentions
          SET status = $2,
              entity_id = CASE WHEN $4 THEN $3 ELSE entity_id END
        WHERE id = $1 RETURNING id`,
      [id, status, entity_id ?? null, setEntity],
    );
    if (rows.length === 0) throw new Error(`mention not found: ${id}`);
  }

  // ── Edges ────────────────────────────────────────────────────────

  async createEdge(input: Omit<Edge, 'id'>): Promise<Edge> {
    const id = randomUUID();
    const { rows } = await this.sql.query<EdgeRow>(
      `INSERT INTO gw_edges
         (id, source_entity_id, target_entity_id, predicate, valid_at, invalid_at, recorded_at, expired_at, support)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id,
        input.source_entity_id,
        input.target_entity_id,
        input.predicate,
        input.valid_at,
        input.invalid_at,
        input.recorded_at,
        input.expired_at,
        input.support,
      ],
    );
    return toEdge(rows[0]!);
  }

  async getEdge(id: string): Promise<Edge | null> {
    const { rows } = await this.sql.query<EdgeRow>('SELECT * FROM gw_edges WHERE id = $1', [id]);
    return rows[0] ? toEdge(rows[0]) : null;
  }

  async listCurrentEdges(filter?: {
    source_entity_id?: string;
    predicate?: string;
  }): Promise<Edge[]> {
    const where: string[] = ['expired_at IS NULL'];
    const params: unknown[] = [];
    if (filter?.source_entity_id !== undefined) {
      where.push(`source_entity_id = $${params.push(filter.source_entity_id)}`);
    }
    if (filter?.predicate !== undefined) where.push(`predicate = $${params.push(filter.predicate)}`);
    const { rows } = await this.sql.query<EdgeRow>(
      `SELECT * FROM gw_edges WHERE ${where.join(' AND ')} ORDER BY recorded_at`,
      params,
    );
    return rows.map(toEdge);
  }

  async invalidateEdge(id: string, invalid_at: Date): Promise<void> {
    const { rows } = await this.sql.query(
      'UPDATE gw_edges SET invalid_at = $2 WHERE id = $1 RETURNING id',
      [id, invalid_at],
    );
    if (rows.length === 0) throw new Error(`edge not found: ${id}`);
  }

  async expireEdge(id: string, expired_at: Date): Promise<void> {
    const { rows } = await this.sql.query(
      'UPDATE gw_edges SET expired_at = $2 WHERE id = $1 RETURNING id',
      [id, expired_at],
    );
    if (rows.length === 0) throw new Error(`edge not found: ${id}`);
  }

  async setEdgeSupport(id: string, support: string[]): Promise<void> {
    const { rows } = await this.sql.query(
      'UPDATE gw_edges SET support = $2 WHERE id = $1 RETURNING id',
      [id, support],
    );
    if (rows.length === 0) throw new Error(`edge not found: ${id}`);
  }

  // ── Episodes ─────────────────────────────────────────────────────

  async createEpisode(input: Omit<Episode, 'id'>): Promise<Episode> {
    const id = randomUUID();
    const { rows } = await this.sql.query<EpisodeRow>(
      `INSERT INTO gw_episodes (id, source_id, ingested_at, mention_ids)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, input.source_id, input.ingested_at, input.mention_ids],
    );
    return toEpisode(rows[0]!);
  }

  async listEpisodes(source_id?: string): Promise<Episode[]> {
    const { rows } =
      source_id === undefined
        ? await this.sql.query<EpisodeRow>('SELECT * FROM gw_episodes ORDER BY ingested_at')
        : await this.sql.query<EpisodeRow>(
            'SELECT * FROM gw_episodes WHERE source_id = $1 ORDER BY ingested_at',
            [source_id],
          );
    return rows.map(toEpisode);
  }
}
