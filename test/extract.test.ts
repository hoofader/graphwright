import { describe, expect, it } from 'vitest';
import { buildTrustedContext, extractEntities } from '../src/extract/index.js';
import type { LLMCaller, LLMCallerInput } from '../src/llm.js';

// An LLMCaller that returns a fixed body, capturing what it was handed.
function fakeLLM(body: string): { llm: LLMCaller; seen: LLMCallerInput[] } {
  const seen: LLMCallerInput[] = [];
  const llm: LLMCaller = async (input) => {
    seen.push(input);
    return { text: body };
  };
  return { llm, seen };
}

describe('buildTrustedContext', () => {
  it('defaults the language and emits only what is present', () => {
    const out = buildTrustedContext({ text: 'hi', llm: fakeLLM('').llm });
    expect(out).toEqual({ content_language: 'unknown' });
  });

  it('carries aliases only when non-empty', () => {
    const out = buildTrustedContext({
      text: 'hi',
      language: 'fa',
      llm: fakeLLM('').llm,
      context: {
        knownPeople: [
          { id: 'p1', display_name: 'Parisa Rostami', aliases: ['پریسا'] },
          { id: 'p2', display_name: 'Sara' },
        ],
      },
    });
    expect(out.content_language).toBe('fa');
    expect(out.known_people).toEqual([
      { id: 'p1', display_name: 'Parisa Rostami', aliases: ['پریسا'] },
      { id: 'p2', display_name: 'Sara' },
    ]);
  });

  it('clips each kind to its cap', () => {
    const knownPeople = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      display_name: `Person ${i}`,
    }));
    const out = buildTrustedContext({
      text: 'hi',
      llm: fakeLLM('').llm,
      context: { knownPeople },
      contextLimits: { knownPeople: 2 },
    });
    expect(out.known_people).toHaveLength(2);
    expect(out.known_people?.map((p) => p.id)).toEqual(['p0', 'p1']);
  });
});

describe('extractEntities', () => {
  const extraction = (people: unknown[], places: unknown[], concepts: unknown[]) =>
    JSON.stringify({ extraction: { people, places, concepts } });

  it('parses a well-formed response and resolves spans locally', async () => {
    const text = 'I had coffee with Sarah in Berlin.';
    const { llm, seen } = fakeLLM(
      extraction(
        [{ surface_form: 'Sarah', candidate_label: 'Sarah', candidate_id: null, confidence: 0.9 }],
        [{ surface_form: 'Berlin', candidate_label: 'Berlin', candidate_id: null, confidence: 0.95 }],
        [],
      ),
    );
    const out = await extractEntities({ text, language: 'en', llm });

    expect(out.people).toHaveLength(1);
    expect(out.places).toHaveLength(1);
    const sarah = out.people[0]!;
    expect(sarah.surface_form).toBe('Sarah');
    // The library computes the span; the response carried none.
    expect(text.slice(sarah.span_start, sarah.span_end)).toBe('Sarah');
    // The context the host built is what reached the adapter.
    expect(seen[0]!.untrustedText).toBe(text);
    expect((seen[0]!.trustedContext as { content_language: string }).content_language).toBe('en');
  });

  it('returns the empty extraction when the adapter falls back, never throws', async () => {
    // A failing gateway returns the fallback literal verbatim.
    const llm: LLMCaller = async ({ fallback }) => ({ text: fallback });
    const out = await extractEntities({ text: 'anything at all', llm });
    expect(out).toEqual({ people: [], places: [], concepts: [] });
  });

  it('drops a concept below the confidence floor', async () => {
    const text = 'We talked about grief for a while.';
    const body = extraction(
      [],
      [],
      [{ surface_form: 'grief', candidate_label: 'grief', candidate_id: null, confidence: 0.5 }],
    );
    const below = await extractEntities({ text, llm: fakeLLM(body).llm });
    expect(below.concepts).toHaveLength(0);

    const above = await extractEntities({
      text,
      llm: fakeLLM(body).llm,
      conceptConfidenceFloor: 0.4,
    });
    expect(above.concepts).toHaveLength(1);
  });

  it('survives a garbage response without throwing', async () => {
    const out = await extractEntities({ text: 'hello', llm: fakeLLM('not json at all').llm });
    expect(out).toEqual({ people: [], places: [], concepts: [] });
  });
});
