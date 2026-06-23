// graphwright/evals — the resolution eval lane.
//
// Skipped by default so CI stays deterministic and offline. Run it on
// demand with `pnpm eval` (sets GRAPHWRIGHT_RUN_EVALS). It scores the
// cascade against a labeled corpus and asserts precision/recall floors.
//
// The LLM stages are off unless you point GRAPHWRIGHT_EVAL_ADAPTER at a
// module that exports `judge` and/or `embedder` (the graphwright LLM
// extension points) wired to your own gateway. With an adapter, the harder semantic
// cases are scored too, and the recall floor rises.

import { describe, it, expect } from 'vitest';
import { resolveCandidates, type Embedder, type PairJudge } from '../../src/index.js';
import { CATALOG, BASE_CASES, SEMANTIC_CASES, type EvalCase } from './corpus.js';
import { score, precision, recall, f1 } from './metrics.js';

const RUN = !!process.env.GRAPHWRIGHT_RUN_EVALS;
const ADAPTER_PATH = process.env.GRAPHWRIGHT_EVAL_ADAPTER;

interface Adapter {
  judge?: PairJudge | undefined;
  embedder?: Embedder | undefined;
}

async function loadAdapter(): Promise<Adapter> {
  if (!ADAPTER_PATH) return {};
  const mod = (await import(ADAPTER_PATH)) as Adapter;
  return { judge: mod.judge, embedder: mod.embedder };
}

async function run(cases: EvalCase[], adapter: Adapter) {
  // Built conditionally: exactOptionalPropertyTypes rejects an explicit
  // `undefined` for the optional extension points.
  const opts: Parameters<typeof resolveCandidates>[2] = {};
  if (adapter.judge) opts.judge = adapter.judge;
  if (adapter.embedder) opts.embedder = adapter.embedder;
  const proposals = await resolveCandidates(
    cases.map((c) => c.candidate),
    CATALOG,
    opts,
  );
  const expected = cases.map((c) => ({ ref: c.candidate.ref, target: c.target }));
  return score(proposals, expected);
}

function report(label: string, o: ReturnType<typeof score>) {
  // Visible when the eval runs, so a human reads the numbers, not just pass/fail.
  // eslint-disable-next-line no-console
  console.log(
    `${label}: precision=${precision(o).toFixed(3)} recall=${recall(o).toFixed(3)} ` +
      `f1=${f1(o).toFixed(3)} (tp=${o.truePositive} fp=${o.falsePositive} ` +
      `fn=${o.falseNegative} tn=${o.trueNegative})`,
  );
}

describe.skipIf(!RUN)('resolution eval', () => {
  it('deterministic cascade clears the precision/recall floor', async () => {
    const adapter = await loadAdapter();
    const o = await run(BASE_CASES, adapter);
    report('base', o);
    expect(precision(o)).toBeGreaterThanOrEqual(0.85);
    expect(recall(o)).toBeGreaterThanOrEqual(0.85);
  });

  it.skipIf(!ADAPTER_PATH)('semantic cases lift recall with an adapter', async () => {
    const adapter = await loadAdapter();
    const o = await run([...BASE_CASES, ...SEMANTIC_CASES], adapter);
    report('base+semantic', o);
    // Precision must hold; recall should clear a higher bar than lexical alone.
    expect(precision(o)).toBeGreaterThanOrEqual(0.85);
    expect(recall(o)).toBeGreaterThanOrEqual(0.9);
  });
});
