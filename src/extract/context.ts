// graphwright/extract — context shaping for the LLM payload.
//
// The library accepts arbitrarily large context arrays and clips
// them to per-kind caps before sending. This keeps prompt token
// usage predictable and protects against accidental cost blowups.

import type {
  ContentLanguage,
  ExtractorContext,
  ExtractorInput,
  KnownConcept,
  KnownPerson,
  KnownPlace,
  RecentConfirmation,
} from './types.js';

const DEFAULT_LIMITS = {
  knownPeople: 100,
  knownPlaces: 50,
  knownConcepts: 50,
  recentConfirmations: 20,
} as const;

export interface BuiltTrustedContext {
  content_language: ContentLanguage;
  known_people?: Array<Pick<KnownPerson, 'id' | 'display_name' | 'aliases'>>;
  known_places?: Array<Pick<KnownPlace, 'id' | 'label' | 'aliases'>>;
  known_concepts?: Array<Pick<KnownConcept, 'id' | 'label'>>;
  recent_confirmations?: RecentConfirmation[];
}

/**
 * Reduce the caller-supplied context to a compact JSON payload safe
 * to embed in the LLM prompt. The caller picks ordering (e.g. most
 * recently active first) — only the per-kind cap is enforced here.
 */
export function buildTrustedContext(input: ExtractorInput): BuiltTrustedContext {
  const language = input.language ?? 'unknown';
  const limits = {
    knownPeople: input.contextLimits?.knownPeople ?? DEFAULT_LIMITS.knownPeople,
    knownPlaces: input.contextLimits?.knownPlaces ?? DEFAULT_LIMITS.knownPlaces,
    knownConcepts: input.contextLimits?.knownConcepts ?? DEFAULT_LIMITS.knownConcepts,
    recentConfirmations:
      input.contextLimits?.recentConfirmations ?? DEFAULT_LIMITS.recentConfirmations,
  };
  const ctx = input.context ?? ({} as ExtractorContext);

  const out: BuiltTrustedContext = { content_language: language };

  if (ctx.knownPeople && ctx.knownPeople.length > 0) {
    out.known_people = ctx.knownPeople.slice(0, limits.knownPeople).map((p) => ({
      id: p.id,
      display_name: p.display_name,
      ...(p.aliases && p.aliases.length > 0 ? { aliases: p.aliases } : {}),
    }));
  }
  if (ctx.knownPlaces && ctx.knownPlaces.length > 0) {
    out.known_places = ctx.knownPlaces.slice(0, limits.knownPlaces).map((p) => ({
      id: p.id,
      label: p.label,
      ...(p.aliases && p.aliases.length > 0 ? { aliases: p.aliases } : {}),
    }));
  }
  if (ctx.knownConcepts && ctx.knownConcepts.length > 0) {
    out.known_concepts = ctx.knownConcepts.slice(0, limits.knownConcepts).map((c) => ({
      id: c.id,
      label: c.label,
    }));
  }
  if (ctx.recentConfirmations && ctx.recentConfirmations.length > 0) {
    out.recent_confirmations = ctx.recentConfirmations.slice(0, limits.recentConfirmations);
  }

  return out;
}
