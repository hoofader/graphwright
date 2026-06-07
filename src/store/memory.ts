// graphwright/store — in-memory reference implementation.
//
// For tests, prototypes, and as the executable specification of
// GraphStore semantics. Not for production data.

import { randomUUID } from 'node:crypto';
import type { Edge, Entity, EntityKind, Episode, Mention, MentionStatus } from '../types.js';
import type { GraphStore } from './store.js';

export class InMemoryGraphStore implements GraphStore {
  private entities = new Map<string, Entity>();
  private mentions = new Map<string, Mention>();
  private edges = new Map<string, Edge>();
  private episodes = new Map<string, Episode>();

  // Rows never leave the store live: a DB-backed implementation can't
  // hand back its storage, so mutating a returned row here must not
  // bypass the write methods either (addAlias dedup, support
  // provenance). Shallow copy with fresh arrays is enough — rows hold
  // no nested objects beyond arrays and Dates, and Dates are only ever
  // replaced, never mutated in place.
  private static cloneEntity(e: Entity): Entity {
    return { ...e, aliases: [...e.aliases] };
  }

  private static cloneMention(m: Mention): Mention {
    return { ...m };
  }

  private static cloneEdge(e: Edge): Edge {
    return { ...e, support: [...e.support] };
  }

  private static cloneEpisode(e: Episode): Episode {
    return { ...e, mention_ids: [...e.mention_ids] };
  }

  // ── Entities ─────────────────────────────────────────────────────

  async createEntity(input: Omit<Entity, 'id' | 'created_at'>): Promise<Entity> {
    const entity: Entity = {
      ...input,
      aliases: [...input.aliases],
      id: randomUUID(),
      created_at: new Date(),
    };
    this.entities.set(entity.id, entity);
    return InMemoryGraphStore.cloneEntity(entity);
  }

  async getEntity(id: string): Promise<Entity | null> {
    const e = this.entities.get(id);
    return e ? InMemoryGraphStore.cloneEntity(e) : null;
  }

  async listEntities(kind?: EntityKind): Promise<Entity[]> {
    const all = [...this.entities.values()];
    const out = kind === undefined ? all : all.filter((e) => e.kind === kind);
    return out.map(InMemoryGraphStore.cloneEntity);
  }

  async addAlias(entity_id: string, alias: string): Promise<void> {
    const e = this.entities.get(entity_id);
    if (!e) throw new Error(`entity not found: ${entity_id}`);
    if (!e.aliases.includes(alias)) e.aliases.push(alias);
  }

  // ── Mentions ─────────────────────────────────────────────────────

  async createMention(input: Omit<Mention, 'id' | 'created_at'>): Promise<Mention> {
    const mention: Mention = { ...input, id: randomUUID(), created_at: new Date() };
    this.mentions.set(mention.id, mention);
    return InMemoryGraphStore.cloneMention(mention);
  }

  async getMention(id: string): Promise<Mention | null> {
    const m = this.mentions.get(id);
    return m ? InMemoryGraphStore.cloneMention(m) : null;
  }

  async listMentions(filter?: {
    source_id?: string;
    entity_id?: string;
    status?: MentionStatus;
  }): Promise<Mention[]> {
    let out = [...this.mentions.values()];
    if (filter?.source_id !== undefined) out = out.filter((m) => m.source_id === filter.source_id);
    if (filter?.entity_id !== undefined) out = out.filter((m) => m.entity_id === filter.entity_id);
    if (filter?.status !== undefined) out = out.filter((m) => m.status === filter.status);
    return out.map(InMemoryGraphStore.cloneMention);
  }

  async setMentionStatus(
    id: string,
    status: MentionStatus,
    entity_id?: string | null,
  ): Promise<void> {
    const m = this.mentions.get(id);
    if (!m) throw new Error(`mention not found: ${id}`);
    m.status = status;
    if (entity_id !== undefined) m.entity_id = entity_id;
  }

  // ── Edges ────────────────────────────────────────────────────────

  async createEdge(input: Omit<Edge, 'id'>): Promise<Edge> {
    const edge: Edge = { ...input, support: [...input.support], id: randomUUID() };
    this.edges.set(edge.id, edge);
    return InMemoryGraphStore.cloneEdge(edge);
  }

  async getEdge(id: string): Promise<Edge | null> {
    const e = this.edges.get(id);
    return e ? InMemoryGraphStore.cloneEdge(e) : null;
  }

  async listCurrentEdges(filter?: {
    source_entity_id?: string;
    predicate?: string;
  }): Promise<Edge[]> {
    let out = [...this.edges.values()].filter((e) => e.expired_at === null);
    if (filter?.source_entity_id !== undefined) {
      out = out.filter((e) => e.source_entity_id === filter.source_entity_id);
    }
    if (filter?.predicate !== undefined) {
      out = out.filter((e) => e.predicate === filter.predicate);
    }
    return out.map(InMemoryGraphStore.cloneEdge);
  }

  async invalidateEdge(id: string, invalid_at: Date): Promise<void> {
    const e = this.edges.get(id);
    if (!e) throw new Error(`edge not found: ${id}`);
    e.invalid_at = invalid_at;
  }

  async expireEdge(id: string, expired_at: Date): Promise<void> {
    const e = this.edges.get(id);
    if (!e) throw new Error(`edge not found: ${id}`);
    e.expired_at = expired_at;
  }

  async setEdgeSupport(id: string, support: string[]): Promise<void> {
    const e = this.edges.get(id);
    if (!e) throw new Error(`edge not found: ${id}`);
    e.support = [...support];
  }

  // ── Episodes ─────────────────────────────────────────────────────

  async createEpisode(input: Omit<Episode, 'id'>): Promise<Episode> {
    const episode: Episode = {
      ...input,
      mention_ids: [...input.mention_ids],
      id: randomUUID(),
    };
    this.episodes.set(episode.id, episode);
    return InMemoryGraphStore.cloneEpisode(episode);
  }

  async listEpisodes(source_id?: string): Promise<Episode[]> {
    const all = [...this.episodes.values()];
    const out = source_id === undefined ? all : all.filter((e) => e.source_id === source_id);
    return out.map(InMemoryGraphStore.cloneEpisode);
  }
}
