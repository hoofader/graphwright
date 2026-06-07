import { describe, expect, it } from 'vitest';
import { parseExtractionResponse } from '../src/extract/parse.js';

const FLOOR = 0.7;

describe('parseExtractionResponse', () => {
  it('parses a well-formed response', () => {
    const text = 'Had coffee with Sarah today.';
    const resp = JSON.stringify({
      extraction: {
        people: [
          {
            surface_form: 'Sarah',
            span_start: 16,
            span_end: 21,
            candidate_label: 'Sarah',
            candidate_id: null,
            confidence: 0.97,
          },
        ],
        places: [],
        concepts: [],
      },
    });
    const out = parseExtractionResponse(resp, text, FLOOR);
    expect(out.people).toHaveLength(1);
    expect(out.people[0]!.span_start).toBe(16);
    expect(out.people[0]!.span_end).toBe(21);
  });

  it('repairs off-by-one LLM spans by searching for the surface', () => {
    const text = 'Had coffee with Sarah today.';
    const resp = JSON.stringify({
      extraction: {
        people: [
          {
            surface_form: 'Sarah',
            span_start: 15, // off by one — LLMs do this constantly
            span_end: 20,
            candidate_label: 'Sarah',
            candidate_id: null,
            confidence: 0.97,
          },
        ],
        places: [],
        concepts: [],
      },
    });
    const out = parseExtractionResponse(resp, text, FLOOR);
    expect(out.people).toHaveLength(1);
    expect(text.substring(out.people[0]!.span_start, out.people[0]!.span_end)).toBe('Sarah');
  });

  it('maps repeated surfaces to successive occurrences', () => {
    const text = 'Sarah told Sarah a secret.';
    const mention = (start: number) => ({
      surface_form: 'Sarah',
      span_start: start,
      span_end: start + 5,
      candidate_label: 'Sarah',
      candidate_id: null,
      confidence: 0.9,
    });
    const resp = JSON.stringify({
      extraction: { people: [mention(0), mention(0)], places: [], concepts: [] },
    });
    const out = parseExtractionResponse(resp, text, FLOOR);
    expect(out.people.map((p) => p.span_start)).toEqual([0, 11]);
  });

  it('resolves Persian surfaces with broken spans', () => {
    const text = 'امروز با پریسا رفتیم دوچرخه سواری';
    const resp = JSON.stringify({
      extraction: {
        people: [
          {
            surface_form: 'پریسا',
            span_start: 7, // wrong — multibyte counting failure
            span_end: 12,
            candidate_label: 'پریسا',
            candidate_id: null,
            confidence: 0.9,
          },
        ],
        places: [],
        concepts: [],
      },
    });
    const out = parseExtractionResponse(resp, text, FLOOR);
    expect(out.people).toHaveLength(1);
    const m = out.people[0]!;
    expect(text.substring(m.span_start, m.span_end)).toBe('پریسا');
  });

  it('drops mentions whose surface is not in the text', () => {
    const text = 'Nothing here.';
    const resp = JSON.stringify({
      extraction: {
        people: [
          {
            surface_form: 'Ghost',
            span_start: 0,
            span_end: 5,
            candidate_label: 'Ghost',
            candidate_id: null,
            confidence: 0.9,
          },
        ],
        places: [],
        concepts: [],
      },
    });
    expect(parseExtractionResponse(resp, text, FLOOR).people).toHaveLength(0);
  });

  it('returns empty on non-JSON', () => {
    const out = parseExtractionResponse('sorry, I cannot help with that', 'text', FLOOR);
    expect(out).toEqual({ people: [], places: [], concepts: [] });
  });

  it('strips markdown fences', () => {
    const text = 'Met Bo at noon.';
    const inner = JSON.stringify({
      extraction: {
        people: [
          {
            surface_form: 'Bo',
            span_start: 4,
            span_end: 6,
            candidate_label: 'Bo',
            candidate_id: null,
            confidence: 0.9,
          },
        ],
        places: [],
        concepts: [],
      },
    });
    const out = parseExtractionResponse('```json\n' + inner + '\n```', text, FLOOR);
    expect(out.people).toHaveLength(1);
  });

  it('enforces the concept confidence floor', () => {
    const text = 'thinking about therapy';
    const concept = (confidence: number) => ({
      surface_form: 'therapy',
      span_start: 15,
      span_end: 22,
      candidate_label: 'therapy',
      candidate_id: null,
      confidence,
    });
    const resp = (c: number) =>
      JSON.stringify({ extraction: { people: [], places: [], concepts: [concept(c)] } });
    expect(parseExtractionResponse(resp(0.6), text, FLOOR).concepts).toHaveLength(0);
    expect(parseExtractionResponse(resp(0.8), text, FLOOR).concepts).toHaveLength(1);
  });

  it('rejects negative and non-integer claimed spans', () => {
    const text = 'Met Bo.';
    const bad = (span_start: unknown, span_end: unknown) =>
      JSON.stringify({
        extraction: {
          people: [
            {
              surface_form: 'Zo', // not in text → fallback search also fails
              span_start,
              span_end,
              candidate_label: 'Zo',
              candidate_id: null,
              confidence: 0.9,
            },
          ],
          places: [],
          concepts: [],
        },
      });
    expect(parseExtractionResponse(bad(-1, 2), text, FLOOR).people).toHaveLength(0);
    expect(parseExtractionResponse(bad(0.5, 2), text, FLOOR).people).toHaveLength(0);
  });
});
