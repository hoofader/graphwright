// Multi-document ingestion chains: the maintenance story end-to-end.
// Each chain pushes a sequence of documents through the real pieces
// (parseExtractionResponse with synthetic LLM JSON, resolveCandidates
// against the store's catalog, planEdgeUpsert, planSupportRemoval)
// with a host-style apply step over InMemoryGraphStore. All names are
// invented; all dates are fixed.

import { describe, expect, it } from 'vitest';
import { parseExtractionResponse } from '../src/extract/parse.js';
import type { ExtractedMention } from '../src/extract/types.js';
import {
  resolveCandidates,
  type ResolutionProposal,
} from '../src/resolve/cascade.js';
import { normalizeName } from '../src/resolve/normalize.js';
import {
  planEdgeUpsert,
  type PlanEdgeUpsertResult,
  type PredicatePolicy,
} from '../src/graph/bitemporal.js';
import { planSupportRemoval, type SupportReview } from '../src/graph/support.js';
import { InMemoryGraphStore } from '../src/store/memory.js';
import type { Mention } from '../src/types.js';

const POLICIES: Record<string, PredicatePolicy> = {
  lives_in: { predicate: 'lives_in', cardinality: 'exclusive_per_source' },
  met_at: { predicate: 'met_at', cardinality: 'additive' },
};

// The chain typos sit in the 0.6-0.75 jaccard band (3-gram cost of one
// edit on a 12-char name); the host-tuned threshold below admits them
// while keeping unrelated names out. The chains test the pending-not-
// create behavior, not the threshold value itself.
const FUZZY_THRESHOLD = 0.55;

interface LlmMentionSpec {
  kind: 'person' | 'place' | 'concept';
  surface: string;
  label?: string;
  span_start?: number;
  span_end?: number;
}

interface DocSpec {
  sourceId: string;
  text: string;
  mentions: LlmMentionSpec[];
  /** Host-known aliases attached when an entity is first created. */
  aliasesFor?: Record<string, string[]>;
  facts?: Array<{
    predicate: string;
    sourceLabel: string;
    targetLabel: string;
    valid_at?: Date;
  }>;
  now: Date;
}

interface IngestResult {
  proposals: ResolutionProposal[];
  plans: PlanEdgeUpsertResult[];
  mentions: Mention[];
  entityIdByLabel: Map<string, string>;
}

function llmJson(specs: LlmMentionSpec[]): string {
  const toMention = (s: LlmMentionSpec) => {
    const m: Record<string, unknown> = {
      surface_form: s.surface,
      candidate_label: s.label ?? s.surface,
      candidate_id: null,
      confidence: 0.9,
    };
    if (s.span_start !== undefined) m['span_start'] = s.span_start;
    if (s.span_end !== undefined) m['span_end'] = s.span_end;
    return m;
  };
  return JSON.stringify({
    extraction: {
      people: specs.filter((s) => s.kind === 'person').map(toMention),
      places: specs.filter((s) => s.kind === 'place').map(toMention),
      concepts: specs.filter((s) => s.kind === 'concept').map(toMention),
    },
  });
}

async function ingestDoc(store: InMemoryGraphStore, doc: DocSpec): Promise<IngestResult> {
  const extracted = parseExtractionResponse(llmJson(doc.mentions), doc.text, 0.7);
  const flat: Array<ExtractedMention> = [
    ...extracted.people,
    ...extracted.places,
    ...extracted.concepts,
  ];

  const catalog = (await store.listEntities()).map((e) => ({
    id: e.id,
    kind: e.kind,
    label: e.label,
    aliases: e.aliases,
  }));
  const proposals = await resolveCandidates(
    flat.map((m, i) => ({ ref: String(i), kind: m.kind, label: m.candidate_label })),
    catalog,
    { fuzzyThreshold: FUZZY_THRESHOLD },
  );
  const byRef = new Map(proposals.map((p) => [p.ref, p]));

  // Host apply policy: exact links and auto-confirms; create-new makes
  // the entity then confirms; fuzzy stays a pending mention so a human
  // decides. One entity per (kind, normalized label) within the doc.
  const createdInDoc = new Map<string, string>();
  const mentions: Mention[] = [];
  const entityIdByLabel = new Map<string, string>();
  const mentionIdByLabel = new Map<string, string>();
  for (let i = 0; i < flat.length; i++) {
    const em = flat[i]!;
    const p = byRef.get(String(i))!;
    let entity_id: string | null = null;
    let status: Mention['status'] = 'pending';
    if (p.basis === 'exact') {
      entity_id = p.entity_id;
      status = 'confirmed';
    } else if (p.basis === 'none') {
      const key = `${em.kind}|${normalizeName(em.candidate_label)}`;
      let id = createdInDoc.get(key);
      if (id === undefined) {
        const entity = await store.createEntity({
          kind: em.kind,
          label: em.candidate_label,
          aliases: doc.aliasesFor?.[em.candidate_label] ?? [],
        });
        id = entity.id;
        createdInDoc.set(key, id);
      }
      entity_id = id;
      status = 'confirmed';
    }
    const mention = await store.createMention({
      source_id: doc.sourceId,
      kind: em.kind,
      surface_form: em.surface_form,
      span_start: em.span_start,
      span_end: em.span_end,
      candidate_label: em.candidate_label,
      entity_id,
      status,
      confidence: em.confidence,
    });
    mentions.push(mention);
    if (entity_id !== null && !entityIdByLabel.has(em.candidate_label)) {
      entityIdByLabel.set(em.candidate_label, entity_id);
    }
    if (!mentionIdByLabel.has(em.candidate_label)) {
      mentionIdByLabel.set(em.candidate_label, mention.id);
    }
  }

  await store.createEpisode({
    source_id: doc.sourceId,
    ingested_at: doc.now,
    mention_ids: mentions.map((m) => m.id),
  });

  const plans: PlanEdgeUpsertResult[] = [];
  for (const fact of doc.facts ?? []) {
    const source_entity_id = entityIdByLabel.get(fact.sourceLabel)!;
    const target_entity_id = entityIdByLabel.get(fact.targetLabel)!;
    const support = [
      mentionIdByLabel.get(fact.sourceLabel)!,
      mentionIdByLabel.get(fact.targetLabel)!,
    ];
    const incoming = {
      source_entity_id,
      target_entity_id,
      predicate: fact.predicate,
      valid_at: fact.valid_at ?? null,
      support,
    };
    const plan = planEdgeUpsert(
      incoming,
      POLICIES[fact.predicate]!,
      await store.listCurrentEdges(),
      doc.now,
    );
    plans.push(plan);
    for (const inv of plan.invalidations) {
      await store.invalidateEdge(inv.edge_id, inv.invalid_at);
    }
    if (plan.action === 'refresh') {
      const existing = (await store.getEdge(plan.existing_edge_id!))!;
      await store.setEdgeSupport(plan.existing_edge_id!, [
        ...new Set([...existing.support, ...support]),
      ]);
    } else {
      await store.createEdge({
        source_entity_id,
        target_entity_id,
        predicate: fact.predicate,
        valid_at: fact.valid_at ?? null,
        invalid_at: null,
        recorded_at: doc.now,
        expired_at: null,
        support,
      });
    }
  }

  return { proposals, plans, mentions, entityIdByLabel };
}

// Source deletion: remove the doc's mentions from edge support and
// return the reviews. The edges themselves are never deleted here;
// that is the library's contract.
async function deleteDoc(store: InMemoryGraphStore, sourceId: string): Promise<SupportReview[]> {
  const docMentions = await store.listMentions({ source_id: sourceId });
  const removed = new Set(docMentions.map((m) => m.id));
  const reviews = planSupportRemoval(await store.listCurrentEdges(), removed);
  for (const r of reviews) {
    await store.setEdgeSupport(r.edge_id, r.remaining_support);
  }
  return reviews;
}

const T = (s: string) => new Date(s);

describe('Chain A — English: introduce, alias link, typo, new person', () => {
  it('runs the 4-doc chain with the expected store end-state', async () => {
    const store = new InMemoryGraphStore();

    const d1 = await ingestDoc(store, {
      sourceId: 'a-doc1',
      text: 'Katayoun Mohebbi and Ramin Golzar biked to Lakeshore Park.',
      mentions: [
        { kind: 'person', surface: 'Katayoun Mohebbi' },
        { kind: 'person', surface: 'Ramin Golzar' },
        { kind: 'place', surface: 'Lakeshore Park' },
      ],
      aliasesFor: { 'Katayoun Mohebbi': ['Katayoun'] },
      now: T('2026-01-05T10:00:00Z'),
    });
    expect(d1.proposals.every((p) => p.basis === 'none')).toBe(true);
    expect(await store.listEntities('person')).toHaveLength(2);
    expect(await store.listEntities('place')).toHaveLength(1);
    const katayounId = d1.entityIdByLabel.get('Katayoun Mohebbi')!;

    // Doc 2: short-form alias must link to the existing entity, with
    // no duplicate person created.
    const d2 = await ingestDoc(store, {
      sourceId: 'a-doc2',
      text: 'Coffee with Katayoun after work.',
      mentions: [{ kind: 'person', surface: 'Katayoun' }],
      now: T('2026-01-12T10:00:00Z'),
    });
    expect(d2.proposals[0]).toMatchObject({
      entity_id: katayounId,
      basis: 'exact',
      requires_review: false,
    });
    expect(await store.listEntities('person')).toHaveLength(2);
    expect(d2.mentions[0]).toMatchObject({ status: 'confirmed', entity_id: katayounId });

    // Doc 3: a typo is a guess, not an identity; it must wait as a
    // pending mention instead of creating a duplicate or auto-linking.
    const d3 = await ingestDoc(store, {
      sourceId: 'a-doc3',
      text: 'Ran into Ramin Golzaar at the gym.',
      mentions: [{ kind: 'person', surface: 'Ramin Golzaar' }],
      now: T('2026-01-20T10:00:00Z'),
    });
    expect(d3.proposals[0]).toMatchObject({ basis: 'fuzzy', requires_review: true });
    expect(d3.proposals[0]!.entity_id).toBe(d1.entityIdByLabel.get('Ramin Golzar'));
    expect(d3.mentions[0]).toMatchObject({ status: 'pending', entity_id: null });
    expect(await store.listEntities('person')).toHaveLength(2);

    const d4 = await ingestDoc(store, {
      sourceId: 'a-doc4',
      text: 'Lunch with Dariush Fanai.',
      mentions: [{ kind: 'person', surface: 'Dariush Fanai' }],
      now: T('2026-01-27T10:00:00Z'),
    });
    expect(d4.proposals[0]!.basis).toBe('none');
    expect(await store.listEntities('person')).toHaveLength(3);

    expect(await store.listMentions({ status: 'confirmed' })).toHaveLength(5);
    expect(await store.listMentions({ status: 'pending' })).toHaveLength(1);
  });
});

describe('Chain B — Persian: cross-script alias and keyboard variant', () => {
  it('Arabic-keyboard variant lands at the exact stage, not fuzzy', async () => {
    const store = new InMemoryGraphStore();

    const d1 = await ingestDoc(store, {
      sourceId: 'b-doc1',
      text: 'با نرگس کاشانی در اصفهان قدم زدیم',
      mentions: [
        { kind: 'person', surface: 'نرگس کاشانی' },
        { kind: 'place', surface: 'اصفهان' },
      ],
      aliasesFor: { 'نرگس کاشانی': ['Narges Kashani'] },
      now: T('2026-02-03T10:00:00Z'),
    });
    const nargesId = d1.entityIdByLabel.get('نرگس کاشانی')!;

    // Doc 2: alias in the opposite script of the doc1 label. There is
    // no transliteration in the cascade; only the host-known alias can
    // make this exact.
    const d2 = await ingestDoc(store, {
      sourceId: 'b-doc2',
      text: 'Lunch with Narges Kashani downtown.',
      mentions: [{ kind: 'person', surface: 'Narges Kashani' }],
      now: T('2026-02-10T10:00:00Z'),
    });
    expect(d2.proposals[0]).toMatchObject({ entity_id: nargesId, basis: 'exact' });

    // Doc 3: Arabic kaf in the surname. If normalization weakens, this
    // degrades to fuzzy/pending and the user gets asked about a name
    // they already confirmed; pin exact.
    const d3 = await ingestDoc(store, {
      sourceId: 'b-doc3',
      text: 'با نرگس كاشانی چای خوردیم',
      mentions: [{ kind: 'person', surface: 'نرگس كاشانی' }],
      now: T('2026-02-17T10:00:00Z'),
    });
    expect(d3.proposals[0]).toMatchObject({
      entity_id: nargesId,
      basis: 'exact',
      requires_review: false,
    });
    expect(d3.mentions[0]).toMatchObject({ status: 'confirmed', entity_id: nargesId });

    const d4 = await ingestDoc(store, {
      sourceId: 'b-doc4',
      text: 'بهرام تهرانی زنگ زد',
      mentions: [{ kind: 'person', surface: 'بهرام تهرانی' }],
      now: T('2026-02-24T10:00:00Z'),
    });
    expect(d4.proposals[0]!.basis).toBe('none');

    const people = await store.listEntities('person');
    expect(people).toHaveLength(2);
    expect((await store.listMentions({ entity_id: nargesId })).map((m) => m.status)).toEqual([
      'confirmed',
      'confirmed',
      'confirmed',
    ]);
  });
});

describe('Chain C — bi-temporal: contradiction, invalidation, re-assertion', () => {
  it('lives_in moves Tehran -> Berlin and a re-assertion refreshes', async () => {
    const store = new InMemoryGraphStore();
    const V2 = T('2026-03-15T00:00:00Z');

    await ingestDoc(store, {
      sourceId: 'c-doc1',
      text: 'Sahand Moradi lives in Tehran.',
      mentions: [
        { kind: 'person', surface: 'Sahand Moradi' },
        { kind: 'place', surface: 'Tehran' },
      ],
      facts: [{ predicate: 'lives_in', sourceLabel: 'Sahand Moradi', targetLabel: 'Tehran' }],
      now: T('2026-03-01T10:00:00Z'),
    });
    const tehranEdge = (await store.listCurrentEdges({ predicate: 'lives_in' }))[0]!;
    expect(tehranEdge.invalid_at).toBeNull();

    const d2 = await ingestDoc(store, {
      sourceId: 'c-doc2',
      text: 'Sahand Moradi moved to Berlin.',
      mentions: [
        { kind: 'person', surface: 'Sahand Moradi' },
        { kind: 'place', surface: 'Berlin' },
      ],
      facts: [
        {
          predicate: 'lives_in',
          sourceLabel: 'Sahand Moradi',
          targetLabel: 'Berlin',
          valid_at: V2,
        },
      ],
      now: T('2026-03-20T10:00:00Z'),
    });
    expect(d2.plans[0]!.action).toBe('insert');
    expect(d2.plans[0]!.invalidations).toHaveLength(1);
    expect(d2.plans[0]!.invalidations[0]!.edge_id).toBe(tehranEdge.id);
    // The old fact stops being true when the new one starts, not when
    // the system happened to ingest the document.
    expect(d2.plans[0]!.invalidations[0]!.invalid_at.toISOString()).toBe(V2.toISOString());
    expect((await store.getEdge(tehranEdge.id))!.invalid_at?.toISOString()).toBe(V2.toISOString());

    const berlinEdge = (await store.listCurrentEdges({ predicate: 'lives_in' })).find(
      (e) => e.invalid_at === null,
    )!;
    const supportAfterD2 = berlinEdge.support.length;

    // Doc 3: same fact again. Must refresh support, not insert a
    // duplicate edge and not touch the already-closed Tehran edge.
    const d3 = await ingestDoc(store, {
      sourceId: 'c-doc3',
      text: 'Sahand Moradi is settled in Berlin now.',
      mentions: [
        { kind: 'person', surface: 'Sahand Moradi' },
        { kind: 'place', surface: 'Berlin' },
      ],
      facts: [
        {
          predicate: 'lives_in',
          sourceLabel: 'Sahand Moradi',
          targetLabel: 'Berlin',
          valid_at: V2,
        },
      ],
      now: T('2026-04-01T10:00:00Z'),
    });
    expect(d3.plans[0]!.action).toBe('refresh');
    expect(d3.plans[0]!.existing_edge_id).toBe(berlinEdge.id);
    expect(d3.plans[0]!.invalidations).toHaveLength(0);

    const after = await store.listCurrentEdges({ predicate: 'lives_in' });
    expect(after.filter((e) => e.invalid_at === null)).toHaveLength(1);
    expect((await store.getEdge(berlinEdge.id))!.support.length).toBeGreaterThan(supportAfterD2);
    // History stays queryable: the Tehran edge is closed, not erased.
    const tehranAfter = (await store.getEdge(tehranEdge.id))!;
    expect(tehranAfter.invalid_at?.toISOString()).toBe(V2.toISOString());
    expect(tehranAfter.expired_at).toBeNull();
  });
});

describe('Chain D — support removal on document deletion', () => {
  it('losing one source reduces support; losing both orphans without deleting', async () => {
    const store = new InMemoryGraphStore();

    await ingestDoc(store, {
      sourceId: 'd-doc1',
      text: 'Golnaz Sharifi and I met at Cafe Sorme.',
      mentions: [
        { kind: 'person', surface: 'Golnaz Sharifi' },
        { kind: 'place', surface: 'Cafe Sorme' },
      ],
      facts: [{ predicate: 'met_at', sourceLabel: 'Golnaz Sharifi', targetLabel: 'Cafe Sorme' }],
      now: T('2026-05-01T10:00:00Z'),
    });
    const d2 = await ingestDoc(store, {
      sourceId: 'd-doc2',
      text: 'Met Golnaz Sharifi at Cafe Sorme again.',
      mentions: [
        { kind: 'person', surface: 'Golnaz Sharifi' },
        { kind: 'place', surface: 'Cafe Sorme' },
      ],
      facts: [{ predicate: 'met_at', sourceLabel: 'Golnaz Sharifi', targetLabel: 'Cafe Sorme' }],
      now: T('2026-05-08T10:00:00Z'),
    });
    expect(d2.plans[0]!.action).toBe('refresh');

    await ingestDoc(store, {
      sourceId: 'd-doc3',
      text: 'Ran into Kianoush Saberi at Cafe Sorme.',
      mentions: [
        { kind: 'person', surface: 'Kianoush Saberi' },
        { kind: 'place', surface: 'Cafe Sorme' },
      ],
      facts: [{ predicate: 'met_at', sourceLabel: 'Kianoush Saberi', targetLabel: 'Cafe Sorme' }],
      now: T('2026-05-15T10:00:00Z'),
    });

    const edges = await store.listCurrentEdges({ predicate: 'met_at' });
    expect(edges).toHaveLength(2);
    const golnazEdge = edges.find((e) => e.support.length === 4)!;
    const kianoushEdge = edges.find((e) => e.id !== golnazEdge.id)!;

    // Deleting doc1 must touch only the doubly-supported edge, and the
    // edge must read as reduced, not orphaned.
    const reviews1 = await deleteDoc(store, 'd-doc1');
    expect(reviews1).toHaveLength(1);
    expect(reviews1[0]).toMatchObject({ edge_id: golnazEdge.id, orphaned: false });
    expect(reviews1[0]!.remaining_support).toHaveLength(2);

    const reviews2 = await deleteDoc(store, 'd-doc2');
    expect(reviews2).toHaveLength(1);
    expect(reviews2[0]).toMatchObject({ edge_id: golnazEdge.id, orphaned: true });
    expect(reviews2[0]!.remaining_support).toHaveLength(0);

    // Orphaned means flagged for a human, never auto-deleted: the user
    // may know the fact is still true without the diary entry.
    const orphan = (await store.getEdge(golnazEdge.id))!;
    expect(orphan.expired_at).toBeNull();
    expect(await store.listCurrentEdges({ predicate: 'met_at' })).toHaveLength(2);
    expect((await store.getEdge(kianoushEdge.id))!.support).toHaveLength(2);
  });
});

describe('Chain E — cross-doc dedup stress: six roads to one person', () => {
  it('label, alias, typo, Arabic variant, possessive, and a long paragraph yield one entity', async () => {
    const store = new InMemoryGraphStore();

    await ingestDoc(store, {
      sourceId: 'e-doc1',
      text: 'Leila Sharifi visited this morning.',
      mentions: [{ kind: 'person', surface: 'Leila Sharifi' }],
      aliasesFor: { 'Leila Sharifi': ['Leila', 'لیلا'] },
      now: T('2026-06-01T10:00:00Z'),
    });
    const leilaId = (await store.listEntities('person'))[0]!.id;

    await ingestDoc(store, {
      sourceId: 'e-doc2',
      text: 'Talked to Leila about the trip.',
      mentions: [{ kind: 'person', surface: 'Leila' }],
      now: T('2026-06-02T10:00:00Z'),
    });

    // Typo doc: must park as pending, not create entity number two.
    const d3 = await ingestDoc(store, {
      sourceId: 'e-doc3',
      text: 'Leila Sharfi called about the keys.',
      mentions: [{ kind: 'person', surface: 'Leila Sharfi' }],
      now: T('2026-06-03T10:00:00Z'),
    });
    expect(d3.proposals[0]).toMatchObject({ basis: 'fuzzy', entity_id: leilaId });

    // Arabic-keyboard yeh: exact via the normalized Persian alias.
    const d4 = await ingestDoc(store, {
      sourceId: 'e-doc4',
      text: 'با ليلا حرف زدم',
      mentions: [{ kind: 'person', surface: 'ليلا' }],
      now: T('2026-06-04T10:00:00Z'),
    });
    expect(d4.proposals[0]).toMatchObject({ basis: 'exact', entity_id: leilaId });

    // Possessive: the extractor hands over the bare name; the trailing
    // apostrophe-s stays in the text, outside the span.
    const possText = "Leila's notes were on the table.";
    const d5 = await ingestDoc(store, {
      sourceId: 'e-doc5',
      text: possText,
      mentions: [{ kind: 'person', surface: 'Leila' }],
      now: T('2026-06-05T10:00:00Z'),
    });
    expect(d5.proposals[0]).toMatchObject({ basis: 'exact', entity_id: leilaId });
    expect(
      possText.substring(d5.mentions[0]!.span_start, d5.mentions[0]!.span_end),
    ).toBe('Leila');

    // Long paragraph with a deliberately wrong span deep inside: the
    // full pipeline (span repair, then resolution) must still converge
    // on the same entity.
    const filler =
      'The afternoon was slow and the house was quiet for a long stretch of time. '.repeat(8);
    const longText = `${filler}Eventually Leila Sharifi knocked and the silence broke. More tea was made and the notebooks came out for planning.`;
    const realStart = longText.indexOf('Leila Sharifi');
    const d6 = await ingestDoc(store, {
      sourceId: 'e-doc6',
      text: longText,
      mentions: [
        {
          kind: 'person',
          surface: 'Leila Sharifi',
          span_start: realStart + 13,
          span_end: realStart + 13 + 'Leila Sharifi'.length,
        },
      ],
      now: T('2026-06-06T10:00:00Z'),
    });
    expect(d6.proposals[0]).toMatchObject({ basis: 'exact', entity_id: leilaId });
    expect(d6.mentions[0]!.span_start).toBe(realStart);

    // The whole point of the chain: one human, one entity.
    const people = await store.listEntities('person');
    expect(people).toHaveLength(1);
    expect(people[0]!.id).toBe(leilaId);

    const confirmed = await store.listMentions({ status: 'confirmed' });
    expect(confirmed).toHaveLength(5);
    expect(confirmed.every((m) => m.entity_id === leilaId)).toBe(true);
    const pending = await store.listMentions({ status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      candidate_label: 'Leila Sharfi',
      entity_id: null,
      source_id: 'e-doc3',
    });
  });
});
