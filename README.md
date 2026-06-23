# graphwright

[![CI](https://github.com/hoofader/graphwright/actions/workflows/ci.yml/badge.svg)](https://github.com/hoofader/graphwright/actions/workflows/ci.yml)

Knowledge graphs where AI proposes and humans decide.

graphwright turns freeform text (diary entries, notes, transcripts) into a knowledge graph of people, places, and concepts, and keeps that graph honest as more documents arrive. It is built around one rule: **AI output is never canon.** `extractEntities` produces *mentions* (pending), `resolveCandidates` produces *proposals*, and only an explicit accept mutates the graph. No auto-merge, no owned storage, no Python sidecar. Zero runtime dependencies; storage and the LLM are extension points you provide.

## Install

Not on npm yet. Install from the git source:

```sh
pnpm add github:hoofader/graphwright
# or: npm install github:hoofader/graphwright
```

ESM only (`"type": "module"`), Node 20+. An npm release comes with the first stable API.

## Why another knowledge-graph library

Existing LLM-to-graph frameworks (GraphRAG, LightRAG, Graphiti, Cognee) share three assumptions that do not hold for personal-data applications:

1. They auto-merge entities. There is no extension point for "the user confirms this is the same person."
2. They own storage, usually a graph database. Your data lives where they say.
3. They are Python. A Node backend runs them as a sidecar service.

graphwright inverts all three. It is a library of pure planning functions plus a few injected extension points (LLM, storage, memory). It proposes; your application disposes.

## Try it (no LLM required)

The deterministic stages run with no model and no network. This resolves three mentions against a catalog: an exact hit, a cross-script match that needs review, and an unknown.

```ts
import { resolveCandidates } from 'graphwright';

const catalog = [
  { id: 'p1', kind: 'person', label: 'Faeze Eshgham', aliases: [] },
  { id: 'p2', kind: 'person', label: 'Daniel Rivera', aliases: [] },
];

const proposals = await resolveCandidates(
  [
    { ref: 'm0', kind: 'person', label: 'Faeze Eshgham' }, // exact
    { ref: 'm1', kind: 'person', label: 'فائزه اشقام' },    // same person, other script
    { ref: 'm2', kind: 'person', label: 'Mina Karimi' },   // unknown
  ],
  catalog,
);

console.log(proposals.map((p) => ({ ref: p.ref, id: p.entity_id, basis: p.basis, review: p.requires_review })));
// [
//   { ref: 'm0', id: 'p1', basis: 'exact',    review: false },  // auto-resolved
//   { ref: 'm1', id: 'p1', basis: 'phonetic', review: true  },  // proposal, a human confirms
//   { ref: 'm2', id: null, basis: 'none',     review: true  },  // new entity, or review
// ]
```

Only `exact` (and a remembered confirmation) auto-resolves. Everything else is a proposal your review flow decides.

## What's in the box

- **Extraction**: LLM-based tagging of people / places / concepts with character spans. Provider-agnostic: you supply an `LLMCaller` that adapts your gateway. Spans are repaired locally (LLMs miscount characters, reliably, especially in non-Latin scripts); the model answers *what* was mentioned, the library computes *where*. Returns an empty extraction on any model failure, never throws.
- **Resolution cascade**: deterministic-first entity resolution:
  1. the user's own remembered decisions (see adaptive matching below),
  2. exact match on normalized names and aliases,
  3. cross-script phonetic keys (consonant skeletons; "فائزه" and "Faeze" share zero shingles, so nothing below exact could bridge scripts without this stage),
  4. an entropy gate that keeps short names ("Ali", "علی") away from fuzzy matching, where one edit step reaches a different real person,
  5. 3-gram Jaccard against the catalog (MinHash/LSH-pruned when large),
  6. an optional pairwise LLM judge, budget-capped.

  Stages 1-5 run with no LLM and no network. Phonetic rules are per-language schemes (`latinScheme`, `persianScheme`, `cyrillicScheme`); adding a script is a new `PhoneticScheme`, passed at the call site or contributed upstream.
- **Adaptive matching**: a `DecisionMemory` extension point remembers each user's confirmations and rejections per surface, optionally scoped by a host-chosen context (a journal, a thread). A remembered confirmation resolves on the user's own authority; a remembered rejection suppresses that pairing at every stage, including exact, so the review queue never re-asks a settled question. Normalization is cross-script aware: Arabic/Persian character folding (`ي→ی`, `ك→ک`), diacritic and tatweel stripping, ZWNJ handling, so "پریسا" and a confirmed alias of "Parisa Rostami" meet at the exact stage.
- **Bi-temporal edges**: relationships carry `valid_at`/`invalid_at` (when the fact held in the world) and `recorded_at`/`expired_at` (when the system learned and superseded it). Contradictions produce *invalidation proposals*; accepted ones close the old edge's validity window. Nothing is deleted; history stays queryable.
- **Provenance and support**: every edge keeps the mention ids that support it. Deleting a source document yields a support-removal plan; edges that lose all support are flagged for review, not silently dropped.
- **Storage extension point**: a `GraphStore` interface plus in-memory and Postgres reference implementations. Bring Postgres, SQLite, or a graph DB; the library never touches storage on its own.

## With an LLM

```ts
import {
  extractEntities,
  resolveCandidates,
  planEdgeUpsert,
  InMemoryGraphStore,
  type LLMCaller,
} from 'graphwright';

// 1. Adapt your LLM gateway once.
const llm: LLMCaller = async ({ system, trustedContext, untrustedText, fallback }) => {
  try {
    return { text: await myGateway.call({ system, trustedContext, untrustedText }) };
  } catch {
    return { text: fallback }; // parses as the empty extraction
  }
};

// 2. Extract mentions from a document.
const extracted = await extractEntities({
  text: 'امروز با پریسا رفتیم دوچرخه سواری',
  language: 'fa',
  context: { knownPeople: [{ id: 'p1', display_name: 'Parisa Rostami', aliases: ['پریسا'] }] },
  llm,
});

// 3. Resolve against your entity catalog. Proposals, not mutations.
const proposals = await resolveCandidates(
  extracted.people.map((m, i) => ({ ref: `m${i}`, kind: 'person', label: m.candidate_label })),
  catalog,
  { judge: myPairJudge }, // optional; omit and the cascade stays fully deterministic
);

// 4. Apply what your policy allows; queue the rest for human review.
for (const p of proposals) {
  if (p.basis === 'exact') await applyLink(p);      // deterministic identity
  else await queueForReview(p);                      // everything else
}
```

## API

- `extractEntities(input)` — text + context to `ExtractedEntities` (pending mentions). Never throws; empty on adapter failure.
- `resolveCandidates(candidates, catalog, opts?)` — mentions to proposals via the cascade.
- `planEdgeUpsert(...)` / `planSupportRemoval(...)` — bi-temporal edge and provenance plans the host applies in its own transaction.
- `extractDates(text, opts)` — rule-based EN/FA date lane (Gregorian and Jalali).
- `InMemoryGraphStore` / `PostgresGraphStore` — `GraphStore` reference implementations.

Injected extension points: `LLMCaller`, `PairJudge`, `Embedder`, `GraphStore`, `DecisionMemory`, `PhoneticScheme`.

## Design positions

- **Proposals over mutations.** Every function that could change the graph returns a plan. The host applies plans inside its own transactions and review flows.
- **Deterministic fallback as a contract.** Each LLM-using path has a defined no-LLM behavior, which is what CI should test. The model is the upgrade, not the foundation.
- **Mention statuses are first-class.** `pending` / `confirmed` / `rejected` live in the core types, because review queues are the product surface that makes a personal knowledge graph trustworthy.
- **Names are hostile input.** Cross-script aliases, keyboard-variant codepoints, half-space joins, trailing punctuation from extraction: the normalization layer treats all of it as expected, not exceptional.

## Related

- **[pg_graphwright](https://github.com/hoofader/pg_graphwright)**: the Postgres-native version. A `pgrx` index access method where graph visibility follows row-level security. Built on these ideas, in Rust.
- **[graphwright-onnx](https://github.com/hoofader/graphwright-onnx)**: a no-LLM extraction backend. Runs a GLiNER (zero-shot NER) model locally via ONNX, no API key, nothing leaves the machine. Depends on this package for types.

Start here (`graphwright`) unless you specifically want the Postgres index access method.

## Status

The extraction and resolution layers are extracted from a private application with a real Persian/English user corpus; they are not written speculatively. The bi-temporal and support planners are newer and have less production exposure. The API is not stable yet and will move before 1.0.

Recently landed:

- Embedding-based candidate generation (`resolveCandidates({ embedder })`): when exact, phonetic, and fuzzy all miss, the candidate is nominated against the catalog by cosine and either judged or returned as a reviewable `'embedding'` proposal.
- A rule-based, locale-aware date lane (`extractDates`): English and Persian relative terms plus Gregorian and Jalali absolute forms, resolved against a caller-supplied reference. Persian/Arabic-Indic digits and Solar Hijri month names are handled; `jalaliToGregorian`/`gregorianToJalali` are exported for hosts that display Jalali dates.
- A Postgres `GraphStore` reference (`PostgresGraphStore`) over an injected executor, so the core stays dependency-free.

The ONNX extraction backend now lives in [graphwright-onnx](https://github.com/hoofader/graphwright-onnx) (it needs a model runtime, so it stays out of the dependency-free core).

## License

MIT
