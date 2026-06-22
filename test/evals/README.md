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

## With a real model

The library never imports an LLM SDK; the judge and embedder are injected
seams. To score the semantic cases (and let the judge/embedder help on the
base set), point `GRAPHWRIGHT_EVAL_ADAPTER` at a module that exports `judge`
and/or `embedder` wired to your gateway:

```bash
GRAPHWRIGHT_EVAL_ADAPTER=./my-eval-adapter.js pnpm eval
```

```ts
// my-eval-adapter.ts — exports the graphwright LLM seams
import type { PairJudge, Embedder } from 'graphwright';
export const judge: PairJudge = async ({ left, right }) => { /* call your model */ };
export const embedder: Embedder = async (texts) => { /* return vectors */ };
```

## Files

- `corpus.ts` — the catalog and labeled cases (`base` is lexical; `semantic`
  needs a model). Invented names only.
- `metrics.ts` — precision/recall/F1 over the merge decision (`metrics.test.ts`
  checks the math in normal CI).
- `resolution.eval.test.ts` — the gated harness.

Add a case by appending to `corpus.ts` with the entity it should resolve to,
or `null` if it should stay a new entity.
