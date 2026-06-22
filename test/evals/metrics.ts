// graphwright/evals — scoring for the resolution eval lane.
//
// An eval case states what a candidate SHOULD resolve to: an existing
// entity id (it should merge) or null (it should stay new). We score the
// cascade's proposal against that and aggregate precision/recall/F1 over
// the "merge" decision, the one that mutates the graph if accepted.

import type { ResolutionProposal } from '../../src/index.js';

export type Expected = { ref: string; target: string | null };

export interface Outcome {
  /** Proposed merge to the right entity. */
  truePositive: number;
  /** Proposed a merge that should not have happened (wrong or over-merge). */
  falsePositive: number;
  /** Should have merged, but proposed new (or the wrong entity). */
  falseNegative: number;
  /** Correctly left as a new entity. */
  trueNegative: number;
}

export function score(proposals: ResolutionProposal[], expected: Expected[]): Outcome {
  const byRef = new Map(proposals.map((p) => [p.ref, p]));
  const out: Outcome = { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 };
  for (const { ref, target } of expected) {
    const got = byRef.get(ref)?.entity_id ?? null;
    if (target === null) {
      // Should stay new.
      if (got === null) out.trueNegative++;
      else out.falsePositive++;
    } else if (got === target) {
      out.truePositive++;
    } else if (got === null) {
      out.falseNegative++;
    } else {
      // Merged, but to the wrong entity: wrong AND missed.
      out.falsePositive++;
      out.falseNegative++;
    }
  }
  return out;
}

export function precision(o: Outcome): number {
  const denom = o.truePositive + o.falsePositive;
  return denom === 0 ? 1 : o.truePositive / denom;
}

export function recall(o: Outcome): number {
  const denom = o.truePositive + o.falseNegative;
  return denom === 0 ? 1 : o.truePositive / denom;
}

export function f1(o: Outcome): number {
  const p = precision(o);
  const r = recall(o);
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}
