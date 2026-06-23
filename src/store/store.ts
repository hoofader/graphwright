// graphwright/store — the storage extension point.
//
// Hosts implement GraphStore over whatever they run (Postgres, SQLite,
// a graph DB, an in-memory map). The library's planning functions are
// pure; the store is only read for context and written by the HOST
// after it decides which proposals to apply. graphwright ships an
// in-memory reference implementation for tests and prototyping.

import type { Edge, Entity, EntityKind, Episode, Mention, MentionStatus } from '../types.js';

export interface GraphStore {
  // Entities
  createEntity(input: Omit<Entity, 'id' | 'created_at'>): Promise<Entity>;
  getEntity(id: string): Promise<Entity | null>;
  listEntities(kind?: EntityKind): Promise<Entity[]>;
  addAlias(entity_id: string, alias: string): Promise<void>;

  // Mentions
  createMention(input: Omit<Mention, 'id' | 'created_at'>): Promise<Mention>;
  getMention(id: string): Promise<Mention | null>;
  listMentions(filter?: {
    source_id?: string;
    entity_id?: string;
    status?: MentionStatus;
  }): Promise<Mention[]>;
  setMentionStatus(id: string, status: MentionStatus, entity_id?: string | null): Promise<void>;

  // Edges
  createEdge(input: Omit<Edge, 'id'>): Promise<Edge>;
  getEdge(id: string): Promise<Edge | null>;
  listCurrentEdges(filter?: {
    source_entity_id?: string;
    predicate?: string;
  }): Promise<Edge[]>;
  invalidateEdge(id: string, invalid_at: Date): Promise<void>;
  expireEdge(id: string, expired_at: Date): Promise<void>;
  setEdgeSupport(id: string, support: string[]): Promise<void>;

  // Episodes
  createEpisode(input: Omit<Episode, 'id'>): Promise<Episode>;
  listEpisodes(source_id?: string): Promise<Episode[]>;
}
