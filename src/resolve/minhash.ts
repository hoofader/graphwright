// graphwright/resolve — character-shingle similarity.
//
// 3-gram character shingles + exact Jaccard for small alias sets, and
// MinHash signatures + banded LSH for candidate generation when the
// entity catalog is large enough that all-pairs comparison hurts.
// Pure deterministic code — no dependencies, fully unit-testable.

const SHINGLE_SIZE = 3;

export function shingles(s: string, size: number = SHINGLE_SIZE): Set<string> {
  const out = new Set<string>();
  if (s.length === 0) return out;
  if (s.length <= size) {
    out.add(s);
    return out;
  }
  for (let i = 0; i <= s.length - size; i++) {
    out.add(s.slice(i, i + size));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) {
    if (large.has(x)) inter++;
  }
  return inter / (a.size + b.size - inter);
}

// ─── MinHash + LSH ─────────────────────────────────────────────────

const NUM_HASHES = 64;
const LSH_BANDS = 16; // 16 bands × 4 rows
const ROWS_PER_BAND = NUM_HASHES / LSH_BANDS;

/** FNV-1a 32-bit, salted per hash function. */
function fnv1a(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type MinHashSignature = Uint32Array;

export function minhashSignature(sh: Set<string>): MinHashSignature {
  const sig = new Uint32Array(NUM_HASHES).fill(0xffffffff);
  for (const shingle of sh) {
    for (let i = 0; i < NUM_HASHES; i++) {
      const h = fnv1a(shingle, i * 0x9e3779b9);
      const current = sig[i]!;
      if (h < current) sig[i] = h;
    }
  }
  return sig;
}

/** Estimated Jaccard from two signatures. */
export function estimateJaccard(a: MinHashSignature, b: MinHashSignature): number {
  let same = 0;
  for (let i = 0; i < NUM_HASHES; i++) {
    if (a[i] === b[i]) same++;
  }
  return same / NUM_HASHES;
}

/**
 * LSH band keys for a signature. Two strings land in the same bucket
 * when ANY band matches; with 16×4 the curve puts the 50%-recall
 * point near Jaccard ≈ 0.5 and catches nearly everything above 0.8.
 */
export function lshBandKeys(sig: MinHashSignature): string[] {
  const keys: string[] = [];
  for (let band = 0; band < LSH_BANDS; band++) {
    const parts: number[] = [];
    for (let row = 0; row < ROWS_PER_BAND; row++) {
      parts.push(sig[band * ROWS_PER_BAND + row]!);
    }
    keys.push(`${band}:${parts.join(',')}`);
  }
  return keys;
}
