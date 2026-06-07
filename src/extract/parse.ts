// graphwright/extract — response parsing + span resolution.
//
// The LLM returns { "extraction": { people, places, concepts } } as a
// single JSON object (possibly inside a ```json fence). The parser:
//   1. Strips optional fences.
//   2. JSON.parse — returns the EMPTY extraction on any parse error.
//   3. For each mention: validates surface_form, then RESOLVES the span
//      against the original text. LLM-provided spans are accepted when
//      they match exactly; otherwise the parser searches for the
//      surface in the text (tracking already-consumed positions per
//      kind, so repeated surfaces map to distinct occurrences).
//      Mentions whose surface_form cannot be found are dropped.
//   4. Drops malformed mentions silently (defense — never throw on a
//      bad LLM output).
//   5. Enforces the concept-confidence floor.
//
// Note on span resolution: LLMs are unreliable at character counting,
// especially in multibyte scripts (Persian, Arabic) and in any text
// past ~50 characters. Trusting model-provided offsets causes valid
// mentions to be silently dropped. The LLM answers "what did the user
// mention"; the parser computes "where".

import type { ExtractionKind, ExtractedEntities, ExtractedMention } from './types.js';

const EMPTY: ExtractedEntities = { people: [], places: [], concepts: [] };

const MAX_SURFACE_LEN = 200;

export function parseExtractionResponse(
  llmText: string,
  originalText: string,
  conceptFloor: number,
): ExtractedEntities {
  let parsed: unknown;
  try {
    const trimmed = llmText.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    const candidate = fenced ? (fenced[1] ?? '').trim() : trimmed;
    parsed = JSON.parse(candidate);
  } catch {
    return EMPTY;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { extraction?: unknown }).extraction !== 'object' ||
    (parsed as { extraction?: unknown }).extraction === null
  ) {
    return EMPTY;
  }
  const extraction = (parsed as { extraction: Record<string, unknown> }).extraction;

  return {
    people: validateArray(extraction.people, 'person', originalText, conceptFloor),
    places: validateArray(extraction.places, 'place', originalText, conceptFloor),
    concepts: validateArray(extraction.concepts, 'concept', originalText, conceptFloor),
  };
}

function validateArray(
  raw: unknown,
  kind: ExtractionKind,
  originalText: string,
  conceptFloor: number,
): ExtractedMention[] {
  if (!Array.isArray(raw)) return [];
  // Per-kind position registry: repeated surfaces map to successive
  // occurrences; the same (start,end) is never assigned twice.
  const consumedByExactPos = new Set<string>();
  const out: ExtractedMention[] = [];
  for (const m of raw) {
    const validated = validateMention(m, kind, originalText, conceptFloor, consumedByExactPos);
    if (validated) out.push(validated);
  }
  return out;
}

function validateMention(
  m: unknown,
  kind: ExtractionKind,
  originalText: string,
  conceptFloor: number,
  consumedByExactPos: Set<string>,
): ExtractedMention | null {
  if (typeof m !== 'object' || m === null) return null;
  const r = m as Record<string, unknown>;

  const surface_form = typeof r.surface_form === 'string' ? r.surface_form : null;
  if (!surface_form || surface_form.length === 0 || surface_form.length > MAX_SURFACE_LEN) {
    return null;
  }

  const resolved = resolveSpan(originalText, surface_form, r, consumedByExactPos);
  if (!resolved) return null;
  const { span_start, span_end } = resolved;

  const confidence = clampConfidence(r.confidence);
  if (kind === 'concept' && confidence < conceptFloor) return null;

  const candidate_label =
    typeof r.candidate_label === 'string' && r.candidate_label.length > 0
      ? r.candidate_label.slice(0, MAX_SURFACE_LEN)
      : surface_form;
  const candidate_id_raw = r.candidate_id;
  const candidate_id =
    typeof candidate_id_raw === 'string' && candidate_id_raw.length > 0 ? candidate_id_raw : null;

  return {
    kind,
    surface_form,
    span_start,
    span_end,
    candidate_label,
    candidate_id,
    confidence,
  };
}

/**
 * Resolve where in `originalText` `surface_form` actually appears.
 *
 *   1. If the LLM gave explicit integer spans AND those spans extract
 *      exactly `surface_form` from `originalText`, use them as-is.
 *      Negative/non-integer spans are explicitly rejected.
 *   2. Otherwise search for `surface_form` in `originalText`, skipping
 *      any (start,end) pair already used for this kind. This handles
 *      duplicate occurrences (e.g. "Sarah met Sarah").
 *   3. If `surface_form` cannot be found anywhere, return null.
 */
function resolveSpan(
  originalText: string,
  surface_form: string,
  r: Record<string, unknown>,
  consumedByExactPos: Set<string>,
): { span_start: number; span_end: number } | null {
  const claimedStart = r.span_start;
  const claimedEnd = r.span_end;
  if (claimedStart !== undefined || claimedEnd !== undefined) {
    if (
      typeof claimedStart !== 'number' ||
      typeof claimedEnd !== 'number' ||
      !Number.isFinite(claimedStart) ||
      !Number.isFinite(claimedEnd) ||
      !Number.isInteger(claimedStart) ||
      !Number.isInteger(claimedEnd)
    ) {
      return null;
    }
    if (claimedStart < 0 || claimedEnd <= claimedStart) {
      return null;
    }
    if (
      claimedEnd <= originalText.length &&
      originalText.substring(claimedStart, claimedEnd) === surface_form
    ) {
      const key = `${claimedStart}:${claimedEnd}`;
      if (!consumedByExactPos.has(key)) {
        consumedByExactPos.add(key);
        return { span_start: claimedStart, span_end: claimedEnd };
      }
    }
  }

  let cursor = 0;
  while (cursor <= originalText.length - surface_form.length) {
    const found = originalText.indexOf(surface_form, cursor);
    if (found === -1) return null;
    const span_end = found + surface_form.length;
    const key = `${found}:${span_end}`;
    if (!consumedByExactPos.has(key)) {
      consumedByExactPos.add(key);
      return { span_start: found, span_end };
    }
    cursor = found + 1;
  }
  return null;
}

function clampConfidence(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0.7;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
