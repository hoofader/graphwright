// graphwright/evals — ablation + threshold sweep.
//
// Turns the eval into a benchmark: it runs the same labeled corpus with
// each cascade stage removed and across threshold settings, and prints
// precision/recall per configuration. That is how you read a stage's
// marginal value: how much recall it adds, and what it costs in precision
// (the false merges a human then has to reject).
//
// Gated like the rest of the eval lane:  pnpm eval

import { describe, expect, it } from 'vitest';
import { resolveCandidates } from '../../src/index.js';
import { CATALOG, LEXICAL_CASES, type EvalCase } from './corpus.js';
import { f1, precision, recall, score, type Outcome } from './metrics.js';

const RUN = !!process.env.GRAPHWRIGHT_RUN_EVALS;
type Opts = Parameters<typeof resolveCandidates>[2];

async function run(cases: EvalCase[], opts: Opts): Promise<{ o: Outcome; auto: number }> {
  const proposals = await resolveCandidates(
    cases.map((c) => c.candidate),
    CATALOG,
    opts,
  );
  const expected = cases.map((c) => ({ ref: c.candidate.ref, target: c.target }));
  // auto = proposals committed without review (exact / remembered).
  const auto = proposals.filter((p) => p.entity_id !== null && !p.requires_review).length;
  return { o: score(proposals, expected), auto };
}

function pr(o: Outcome): string {
  return `P=${precision(o).toFixed(3)} R=${recall(o).toFixed(3)} F1=${f1(o).toFixed(3)}`;
}

// eslint-disable-next-line no-console
const print = (s: string): void => console.log(s);

describe.skipIf(!RUN)('resolution ablation', () => {
  it('reports precision/recall as each stage is removed', async () => {
    const configs: { name: string; opts: Opts }[] = [
      { name: 'full', opts: {} },
      { name: 'no-fuzzy', opts: { fuzzyThreshold: 1.01 } },
      { name: 'no-phonetic', opts: { phoneticSchemes: [] } },
      { name: 'no-gate', opts: { entropyThreshold: 0 } },
      { name: 'exact-only', opts: { phoneticSchemes: [], fuzzyThreshold: 1.01 } },
    ];
    const lines = ['', 'ablation (lexical corpus; auto = merges that need no review):'];
    let full: Outcome | undefined;
    for (const c of configs) {
      const { o, auto } = await run(LEXICAL_CASES, c.opts);
      if (c.name === 'full') full = o;
      lines.push(
        `  ${c.name.padEnd(12)} ${pr(o)}  ` +
          `tp=${o.truePositive} fp=${o.falsePositive} fn=${o.falseNegative} tn=${o.trueNegative} auto=${auto}`,
      );
    }
    print(lines.join('\n'));
    // The cascade should propose most real merges (recall) without drowning
    // a reviewer in false ones (precision). Floors, not targets.
    expect(full).toBeDefined();
    expect(recall(full!)).toBeGreaterThanOrEqual(0.7);
    expect(precision(full!)).toBeGreaterThanOrEqual(0.6);
  });

  it('sweeps the fuzzy and entropy thresholds', async () => {
    const lines = ['', 'fuzzyThreshold sweep:'];
    for (const ft of [0.7, 0.78, 0.82, 0.88, 0.95]) {
      const { o } = await run(LEXICAL_CASES, { fuzzyThreshold: ft });
      lines.push(`  ft=${ft.toFixed(2)}  ${pr(o)}`);
    }
    lines.push('entropyThreshold sweep:');
    for (const et of [0, 1.5, 2.0, 2.5, 3.0]) {
      const { o } = await run(LEXICAL_CASES, { entropyThreshold: et });
      lines.push(`  et=${et.toFixed(1)}  ${pr(o)}`);
    }
    print(lines.join('\n'));
  });

  it('every auto-merge (no review) is correct', async () => {
    // Only requires_review=false proposals commit without a human, so those
    // must never be wrong. This is the hard guarantee under all the metrics.
    const proposals = await resolveCandidates(
      LEXICAL_CASES.map((c) => c.candidate),
      CATALOG,
      {},
    );
    const byRef = new Map(LEXICAL_CASES.map((c) => [c.candidate.ref, c.target]));
    for (const p of proposals) {
      if (p.entity_id !== null && !p.requires_review) {
        expect(p.entity_id, `auto-merged ${p.ref} via ${p.basis}`).toBe(byRef.get(p.ref));
      }
    }
  });
});
