// graphwright/extract — public entry point.
//
// Provider-agnostic entity tagger. Given freeform text + a context
// (known entities, recent confirmations), returns structured mentions
// with spans and candidate matches. Deterministic fallback: when the
// adapter fails (returns its `fallback` literal), the result is the
// empty extraction — never a throw.

import { buildTrustedContext } from './context.js';
import { parseExtractionResponse } from './parse.js';
import { EXTRACTOR_SYSTEM } from './prompt.js';
import type { ExtractedEntities, ExtractorInput } from './types.js';

const EMPTY_FALLBACK_JSON = '{"extraction":{"people":[],"places":[],"concepts":[]}}';

const DEFAULT_CONCEPT_FLOOR = 0.7;

export async function extractEntities(input: ExtractorInput): Promise<ExtractedEntities> {
  const trustedContext = buildTrustedContext(input);
  const { text: llmText } = await input.llm({
    system: input.systemPrompt ?? EXTRACTOR_SYSTEM,
    trustedContext: trustedContext as unknown as Record<string, unknown>,
    untrustedText: input.text,
    fallback: EMPTY_FALLBACK_JSON,
  });

  const conceptFloor = input.conceptConfidenceFloor ?? DEFAULT_CONCEPT_FLOOR;
  return parseExtractionResponse(llmText, input.text, conceptFloor);
}

export { EXTRACTOR_SYSTEM, EXTRACTOR_PROMPT_VERSION } from './prompt.js';
export { buildTrustedContext, type BuiltTrustedContext } from './context.js';
export { parseExtractionResponse } from './parse.js';
export { extractDates } from './dates.js';
export type { DateGrain, DateLanguage, DateMention, ExtractDatesOptions } from './dates.js';
export {
  jalaliToGregorian,
  gregorianToJalali,
  isLeapJalaliYear,
  jalaliMonthLength,
} from './jalali.js';
export type {
  ContentLanguage,
  ExtractionKind,
  ExtractedEntities,
  ExtractedMention,
  ExtractorContext,
  ExtractorInput,
  KnownConcept,
  KnownPerson,
  KnownPlace,
  RecentConfirmation,
} from './types.js';
