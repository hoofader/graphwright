# Resolution evals

A labeled-corpus eval for the resolution cascade. It is **off in CI**: the
normal `pnpm test` run is deterministic and offline, and the eval is gated
behind `GRAPHWRIGHT_RUN_EVALS` so it only runs on demand.

```bash
pnpm eval        # GRAPHWRIGHT_RUN_EVALS=1 vitest run test/evals
```

That scores the deterministic stages (exact, phonetic, fuzzy, gate) against
`corpus.ts` and asserts precision/recall floors. It prints the metrics, so
you read the numbers, not just pass/fail.

## The ablation benchmark

`ablation.eval.test.ts` is where you read each stage's worth. It runs the
labeled corpus with stages removed and across thresholds, and prints
precision/recall per configuration. A run today:

```
ablation (lexical corpus; auto = merges that need no review):
  full         P=0.875 R=1.000 F1=0.933  tp=7 fp=1 fn=0 tn=6 auto=2
  no-fuzzy     P=0.857 R=0.857 F1=0.857  tp=6 fp=1 fn=1 tn=6 auto=2
  no-phonetic  P=1.000 R=0.429 F1=0.600  tp=3 fp=0 fn=4 tn=7 auto=2
  no-gate      P=0.875 R=1.000 F1=0.933  tp=7 fp=1 fn=0 tn=6 auto=2
  exact-only   P=1.000 R=0.286 F1=0.444  tp=2 fp=0 fn=5 tn=7 auto=2
```

How to read it:

- **exact-only** is the floor: precision 1.0, recall 0.286 (it only catches
  literal matches). Those are the `auto` merges, committed without review.
- **phonetic** is the recall workhorse: it lifts recall to ~1.0 by bridging
  scripts and skeleton-preserving typos, at the cost of one false merge
  (precision 0.875). That false merge is a proposal a human rejects, which
  is why a phonetic hit is `requires_review`, not auto.
- **fuzzy** adds one case phonetic forks on (a final-consonant typo), so
  removing it costs recall but nothing in precision.
- the **entropy gate** is inert here (it only guards fuzzy, and no short
  name reaches the 0.82 threshold). It is a margin that binds at lower
  fuzzy thresholds.

The third test asserts the hard guarantee under any metric: every
**auto-merge** (`requires_review === false`) is correct. Proposals can be
wrong (a human reviews them); commits cannot.

Tune by adding hard cases to `corpus.ts` (especially negatives that share a
name or a sound), then watch precision in the ablation.

## With a real model

The library never imports an LLM SDK; the judge and embedder are injected
extension points. To score the semantic cases (and let the judge/embedder help on the
base set), point `GRAPHWRIGHT_EVAL_ADAPTER` at a module that exports `judge`
and/or `embedder` wired to your gateway:

```bash
GRAPHWRIGHT_EVAL_ADAPTER=./my-eval-adapter.js pnpm eval
```

```ts
// my-eval-adapter.ts: exports the graphwright LLM extension points
import type { PairJudge, Embedder } from 'graphwright';
export const judge: PairJudge = async ({ left, right }) => { /* call your model */ };
export const embedder: Embedder = async (texts) => { /* return vectors */ };
```

## Files

- `corpus.ts`: the catalog and labeled cases (`base` is lexical; `semantic`
  needs a model). Invented names only.
- `metrics.ts`: precision/recall/F1 over the merge decision (`metrics.test.ts`
  checks the math in normal CI).
- `resolution.eval.test.ts`: the gated harness.

Add a case by appending to `corpus.ts` with the entity it should resolve to,
or `null` if it should stay a new entity.
