# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This is a 0.x preview: the API may change between minor versions.

## [Unreleased]

### Fixed

- `extractDates` rejected impossible Gregorian days (`April 31`, `2024-02-30`)
  instead of rolling them forward to the next month.

### Added

- Tests for `extractEntities` and `buildTrustedContext` (the extraction
  entry points), covering the deterministic fallback and the context caps.

## [0.1.0]

First public preview. Carved out of a private application after a
build-vs-buy survey found no library that left entity merges to a human
and storage to the host.

- Extraction: provider-agnostic LLM tagging with local span repair.
- Resolution cascade: memory, exact, cross-script phonetic (Latin,
  Persian, Cyrillic), entropy gate, 3-gram fuzzy, optional embedding and
  pairwise judge. Stages before the judge run with no LLM.
- Adaptive matching: a `DecisionMemory` that replays each user's
  confirmations and rejections.
- Bi-temporal edges, provenance/support planning, and a `GraphStore`
  interface with in-memory and Postgres reference implementations.
- A rule-based date lane (`extractDates`): English and Persian relative
  terms plus Gregorian and Jalali absolute forms.
