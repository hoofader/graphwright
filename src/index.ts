// graphwright — public API.
//
// Extraction → mentions (pending) → resolution proposals → host
// applies → bi-temporal edges with provenance. Storage and LLM are
// injected; every LLM-using path has a deterministic degradation.

// Core types
export type {
  Edge,
  Entity,
  EntityKind,
  Episode,
  Mention,
  MentionStatus,
} from './types.js';

// LLM seams
export type {
  Embedder,
  JudgePairInput,
  JudgePairOutput,
  LLMCaller,
  LLMCallerInput,
  LLMCallerOutput,
  PairJudge,
} from './llm.js';

// Extraction
export {
  extractEntities,
  parseExtractionResponse,
  buildTrustedContext,
  extractDates,
  jalaliToGregorian,
  gregorianToJalali,
  isLeapJalaliYear,
  jalaliMonthLength,
  EXTRACTOR_SYSTEM,
  EXTRACTOR_PROMPT_VERSION,
} from './extract/index.js';
export type {
  BuiltTrustedContext,
  ContentLanguage,
  DateGrain,
  DateLanguage,
  DateMention,
  ExtractDatesOptions,
  ExtractionKind,
  ExtractedEntities,
  ExtractedMention,
  ExtractorContext,
  ExtractorInput,
  KnownConcept,
  KnownPerson,
  KnownPlace,
  RecentConfirmation,
} from './extract/index.js';

// Resolution
export { resolveCandidates } from './resolve/cascade.js';
export type {
  CatalogEntity,
  ProposalBasis,
  ResolutionCandidate,
  ResolutionProposal,
  ResolveOptions,
} from './resolve/cascade.js';
export { normalizeName } from './resolve/normalize.js';
export {
  phoneticKeys,
  phoneticMatch,
  latinScheme,
  persianScheme,
  cyrillicScheme,
  DEFAULT_PHONETIC_SCHEMES,
} from './resolve/phonetic/index.js';
export type { PhoneticScheme } from './resolve/phonetic/index.js';
export { InMemoryDecisionMemory } from './resolve/memory.js';
export type { Decision, DecisionLookup, DecisionMemory, DecisionRecord } from './resolve/memory.js';
export {
  shannonEntropy,
  passesEntropyGate,
  DEFAULT_FUZZY_ENTROPY_THRESHOLD,
} from './resolve/entropy.js';
export {
  shingles,
  jaccard,
  minhashSignature,
  estimateJaccard,
  lshBandKeys,
} from './resolve/minhash.js';
export type { MinHashSignature } from './resolve/minhash.js';

// Graph maintenance
export { planEdgeUpsert } from './graph/bitemporal.js';
export type {
  Cardinality,
  IncomingFact,
  InvalidationProposal,
  PlanEdgeUpsertResult,
  PredicatePolicy,
} from './graph/bitemporal.js';
export { planSupportRemoval } from './graph/support.js';
export type { SupportReview } from './graph/support.js';

// Storage
export type { GraphStore } from './store/store.js';
export { InMemoryGraphStore } from './store/memory.js';
export { PostgresGraphStore, POSTGRES_SCHEMA } from './store/postgres.js';
export type { SqlExecutor } from './store/postgres.js';
