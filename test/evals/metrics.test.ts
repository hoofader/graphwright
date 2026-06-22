// The eval scoring is plain arithmetic, so it is checked in normal CI even
// though the eval lane itself (which calls the cascade) is gated.

import { describe, it, expect } from 'vitest';
import type { ResolutionProposal } from '../../src/index.js';
import { score, precision, recall, f1 } from './metrics.js';

function prop(ref: string, entity_id: string | null): ResolutionProposal {
  return { ref, entity_id, basis: entity_id ? 'exact' : 'none', score: 1, requires_review: false };
}

describe('eval metrics', () => {
  it('classifies merge decisions against the labels', () => {
    const proposals = [
      prop('a', 'e1'), // correct merge
      prop('b', null), // should have merged
      prop('c', 'wrong'), // merged to the wrong entity
      prop('d', null), // correctly new
    ];
    const expected = [
      { ref: 'a', target: 'e1' },
      { ref: 'b', target: 'e2' },
      { ref: 'c', target: 'e3' },
      { ref: 'd', target: null },
    ];
    const o = score(proposals, expected);
    expect(o).toEqual({ truePositive: 1, falsePositive: 1, falseNegative: 2, trueNegative: 1 });
    expect(precision(o)).toBeCloseTo(0.5);
    expect(recall(o)).toBeCloseTo(1 / 3);
  });

  it('a perfect run scores 1.0', () => {
    const o = score([prop('a', 'e1'), prop('b', null)], [
      { ref: 'a', target: 'e1' },
      { ref: 'b', target: null },
    ]);
    expect(precision(o)).toBe(1);
    expect(recall(o)).toBe(1);
    expect(f1(o)).toBe(1);
  });
});
