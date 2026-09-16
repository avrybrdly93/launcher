/**
 * Philox4x32-10, the counter-based RNG the GPU MC pipeline draws its parameter
 * jitter from (P7.21).
 *
 * ## Why a second RNG exists alongside PCG32
 *
 * `random.ts`'s PCG32 is *stateful*: each draw advances an internal word, so
 * the n-th number in a stream is only reachable by producing the n-1 before it.
 * That is fine on a CPU walking one replicate at a time and impossible in a
 * kernel, where ten thousand invocations want their own draws simultaneously
 * and no two of them may share mutable state.
 *
 * A counter-based generator inverts that. There is no state at all: the output
 * is a pure function of a 128-bit counter and a 64-bit key, so invocation `i`
 * computes its own draw from `i` directly and two invocations cannot interfere
 * with each other however they are scheduled. That property is what makes the
 * second clause of P7.21's criterion -- "replicate determinism by counter" --
 * meaningful rather than aspirational: a replicate's numbers are determined by
 * the counter it is handed, so they do not depend on dispatch order, workgroup
 * size, or how many replicates ran alongside it.
 *
 * PCG32 is *not* being replaced. It remains the CPU path's generator and
 * ADR-011's reproducibility story; this is the kernel-side one.
 *
 * ## The algorithm, written from its specification
 *
 * Ten rounds over a 4x32-bit counter with a 2x32-bit key. One round is
 *
 * ```
 *   hi0, lo0 = mulhilo32(0xD2511F53, c0)
 *   hi1, lo1 = mulhilo32(0xCD9E8D57, c2)
 *   c' = (hi1 ^ c1 ^ k0,  lo1,  hi0 ^ c3 ^ k1,  lo0)
 * ```
 *
 * and between rounds the key is bumped by the two Weyl constants
 * `0x9E3779B9` and `0xBB67AE85`. The first round uses the key as given, so ten
 * rounds bump it nine times.
 *
 * `mulhilo32` is the full 64-bit product of two 32-bit words, split. JavaScript
 * numbers cannot hold it, so the high word is assembled from 16-bit halves;
 * the low word is `Math.imul`, which *is* the wrapping 32-bit multiply.
 *
 * ## What is and is not claimed about correctness
 *
 * This implementation was written from the specification above, not
 * transcribed from a reference implementation. `philox.test.ts` asserts it
 * against published known-answer vectors, which is a genuine cross-check
 * precisely because the two came from different places: an implementation that
 * reproduces a vector it was not derived from agrees with the standard, and one
 * that does not is wrong no matter how plausible it reads.
 *
 * ## Scope
 *
 * Uniforms in [0, 1) are here because they are what a statistical test is run
 * on. Mapping those to a *distribution* -- normal jitter on a launch angle, say
 * -- is the MC pipeline's job and deliberately not this module's.
 */

/** The two round multipliers. */
const M0 = 0xd2511f53;
const M1 = 0xcd9e8d57;

/** The two key-bump (Weyl) increments. */
const W0 = 0x9e3779b9;
const W1 = 0xbb67ae85;

/** The round count this module implements; the "10" in Philox4x32-10. */
export const PHILOX_ROUNDS = 10;

/** A 128-bit counter as four 32-bit words, little end first. */
export type PhiloxCounter = readonly [number, number, number, number];

/** A 64-bit key as two 32-bit words. */
export type PhiloxKey = readonly [number, number];

/**
 * The high and low 32-bit words of the 64-bit product `a * b`.
 *
 * The low word is `Math.imul(a, b) >>> 0` — that operation is *defined* as the
 * low 32 bits of the product, so it needs no correction. The high word is
 * assembled from 16-bit halves: with `a = ahi·2^16 + alo`, the product is
 * `ahi·bhi·2^32 + (ahi·blo + alo·bhi)·2^16 + alo·blo`, so the carry out of the
 * middle term is what the high word must pick up. Each half-product is at most
 * `(2^16-1)^2`, and `mid` is a sum of three values below `2^16` scaled such
 * that it stays under 2^32 — both well inside a double's exact integer range,
 * which is why this can be done in ordinary arithmetic without BigInt.
 */
export function mulhilo32(a: number, b: number): { hi: number; lo: number } {
  const au = a >>> 0;
  const bu = b >>> 0;

  const alo = au & 0xffff;
  const ahi = au >>> 16;
  const blo = bu & 0xffff;
  const bhi = bu >>> 16;

  const ll = alo * blo;
  const lh = alo * bhi;
  const hl = ahi * blo;
  const hh = ahi * bhi;

  const mid = (ll >>> 16) + (lh & 0xffff) + (hl & 0xffff);
  const hi = (hh + (lh >>> 16) + (hl >>> 16) + Math.floor(mid / 0x10000)) >>> 0;

  return { hi, lo: Math.imul(au, bu) >>> 0 };
}

/**
 * One Philox4x32 round: two wide multiplies and a fixed permutation.
 *
 * Exported because the round is the unit a known-answer vector for a
 * *reduced-round* variant pins, and because a test that can step one round at a
 * time can localise a disagreement instead of only observing one ten rounds
 * later.
 */
export function philox4x32Round(ctr: PhiloxCounter, key: PhiloxKey): PhiloxCounter {
  const { hi: hi0, lo: lo0 } = mulhilo32(M0, ctr[0]);
  const { hi: hi1, lo: lo1 } = mulhilo32(M1, ctr[2]);

  return [(hi1 ^ ctr[1] ^ key[0]) >>> 0, lo1, (hi0 ^ ctr[3] ^ key[1]) >>> 0, lo0];
}

/** The key bump applied between rounds. */
export function philox4x32BumpKey(key: PhiloxKey): PhiloxKey {
  return [((key[0] + W0) & 0xffffffff) >>> 0, ((key[1] + W1) & 0xffffffff) >>> 0];
}

/**
 * Philox4x32-10: four uniformly distributed 32-bit words from a counter and a
 * key.
 *
 * Pure. The same `(ctr, key)` gives the same four words on every call, on every
 * machine, in any order — which is the whole point, and is what the kernel
 * relies on when it hands invocation `i` the counter `[i, 0, 0, 0]`.
 *
 * `rounds` exists for the reduced-round known-answer vectors only. Production
 * callers take the default; a lower count is cryptographically and
 * statistically weaker and is not a tuning knob.
 */
export function philox4x32(
  ctr: PhiloxCounter,
  key: PhiloxKey,
  rounds: number = PHILOX_ROUNDS,
): PhiloxCounter {
  let c: PhiloxCounter = [ctr[0] >>> 0, ctr[1] >>> 0, ctr[2] >>> 0, ctr[3] >>> 0];
  let k: PhiloxKey = [key[0] >>> 0, key[1] >>> 0];

  for (let r = 0; r < rounds; r += 1) {
    // The key is bumped *before* every round after the first, so round 0 sees
    // the key exactly as supplied.
    if (r > 0) k = philox4x32BumpKey(k);
    c = philox4x32Round(c, k);
  }

  return c;
}

/**
 * The [0, 1) uniform a 32-bit word maps to.
 *
 * Division by 2^32 rather than by 2^32 - 1: the former makes 1.0 unreachable
 * and every one of the 2^32 outcomes equally likely, while the latter would
 * emit an attainable 1.0 and break any caller that assumes a half-open range —
 * `Math.log(1 - u)` in an inverse-CDF, for instance. This matches
 * `PCG32.nextF64`, deliberately.
 */
export function u32ToUnitFloat(word: number): number {
  return (word >>> 0) / 4294967296;
}

/**
 * Four uniforms in [0, 1) from one Philox4x32-10 evaluation.
 *
 * Four rather than one because the generator produces four words per call and
 * discarding three would cost four times the arithmetic per draw. A replicate
 * jittering four parameters gets them from a single counter.
 */
export function philox4x32Uniforms(
  ctr: PhiloxCounter,
  key: PhiloxKey,
  rounds: number = PHILOX_ROUNDS,
): [number, number, number, number] {
  const out = philox4x32(ctr, key, rounds);
  return [
    u32ToUnitFloat(out[0]),
    u32ToUnitFloat(out[1]),
    u32ToUnitFloat(out[2]),
    u32ToUnitFloat(out[3]),
  ];
}

/**
 * The counter a replicate draws from: its index in the low word, the rest zero.
 *
 * A named function rather than an inline literal at each call site because the
 * *convention* is the contract. "Replicate `i` uses counter `[i, 0, 0, 0]`" is
 * what makes a replicate's numbers reproducible from its index alone, and two
 * call sites spelling it differently would silently give one of them a
 * different stream.
 */
export function replicateCounter(replicateIndex: number): PhiloxCounter {
  return [replicateIndex >>> 0, 0, 0, 0];
}
