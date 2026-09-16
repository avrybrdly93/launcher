/**
 * Philox4x32-10 as WGSL text, for kernels that jitter their parameters in-kernel
 * (P7.21).
 *
 * ## Why this is a separate opt-in constant
 *
 * The same reason `WGSL_PLANAR_COMPENSATED_STEP_FNS` is one (P0.136): a kernel
 * that does not ask for an RNG must interpolate **exactly** the characters it
 * interpolated before. P7.14's bit-identical device result, P7.16's 0-ULP
 * observables agreement and P7.17's budgets are all measurements of specific
 * shader text, and appending anything to the shared fragment would move that
 * text under all of them and quietly invalidate the records. Nothing here is
 * appended to {@link WGSL_PLANAR_STEP_FNS} or to any existing builder's default
 * output; `wgsl-philox.test.ts` asserts that rather than trusting it.
 *
 * ## The arithmetic is `philox4x32` from `@ballista/engine`, operation for
 * operation
 *
 * Two 32x32→64 multiplies and a fixed permutation, ten times, with the key
 * bumped between rounds. The CPU module is the reference and carries the full
 * rationale; this is the same computation in a language with no 64-bit integer,
 * which is the one place the two texts *look* different:
 *
 * - The **low** word is `a * b`. WGSL's `u32` arithmetic is modulo 2^32, so the
 *   product's low word is simply the product — the same fact `Math.imul` states
 *   on the CPU side.
 * - The **high** word is assembled from 16-bit halves, exactly as the CPU does
 *   it, because there is nothing wider to compute it in. The carry out of the
 *   middle term is what `mid >> 16u` contributes, and none of the partial sums
 *   can overflow: each is bounded by the true high word, which is below 2^32 by
 *   definition.
 *
 * ## The uniform conversion is NOT `f32(word) / 4294967296.0`, and that is a
 * correctness matter rather than a preference
 *
 * `f32` has 24 bits of mantissa, so converting a full 32-bit word to `f32`
 * rounds — and `f32(0xFFFFFFFFu)` rounds **up**, to 4294967296.0 exactly.
 * Dividing that by 2^32 yields **1.0**, so the obvious spelling emits an
 * attainable 1.0 and the range is closed, not half-open. Any caller doing
 * `log(1.0 - u)` in an inverse-CDF gets `-inf` for one word in 2^32 — which on
 * a 1e5-replicate ensemble is rare enough to survive every test anyone writes
 * and still be wrong.
 *
 * So the top 24 bits are used and the divisor is 2^24: `f32(word >> 8u)` is
 * exact for every input, the maximum is `(2^24 - 1) / 2^24 < 1`, and no
 * precision is lost that an `f32` could have carried anyway.
 *
 * `u32ToUnitFloatF32` in `@ballista/engine` is the CPU spelling of this same
 * rule, and exists so the two arms can be compared without one of them being
 * the other's tolerance.
 */

/**
 * The generator: constants, the wide multiply, one round, ten rounds, and the
 * `f32` uniform conversion.
 *
 * Reads no binding and writes none — like {@link WGSL_PLANAR_STEP_FNS}, which
 * is what lets any kernel interpolate it regardless of its own buffers.
 */
export const WGSL_PHILOX_FNS = `// Philox4x32-10. Counter-based: the output is a pure function of (ctr, key),
// so invocation i draws from counter i with no state shared between threads
// and no dependence on dispatch order or workgroup size.
const PHILOX_M0: u32 = 0xD2511F53u;
const PHILOX_M1: u32 = 0xCD9E8D57u;
const PHILOX_W0: u32 = 0x9E3779B9u;
const PHILOX_W1: u32 = 0xBB67AE85u;

// The 64-bit product of two u32s, as (hi, lo). The low word is the wrapping
// product itself, since u32 arithmetic is modulo 2^32; the high word is
// assembled from 16-bit halves because WGSL has no wider integer to hold it.
fn philoxMulhilo32(a: u32, b: u32) -> vec2<u32> {
  let alo = a & 0xFFFFu;
  let ahi = a >> 16u;
  let blo = b & 0xFFFFu;
  let bhi = b >> 16u;

  let ll = alo * blo;
  let lh = alo * bhi;
  let hl = ahi * blo;
  let hh = ahi * bhi;

  let mid = ((ll >> 16u) + (lh & 0xFFFFu)) + (hl & 0xFFFFu);
  let hi = (((hh + (lh >> 16u)) + (hl >> 16u)) + (mid >> 16u));
  return vec2<u32>(hi, a * b);
}

// One round: two wide multiplies, then the fixed permutation
// (hi1^c1^k0, lo1, hi0^c3^k1, lo0).
fn philox4x32Round(ctr: vec4<u32>, key: vec2<u32>) -> vec4<u32> {
  let m0 = philoxMulhilo32(PHILOX_M0, ctr.x);
  let m1 = philoxMulhilo32(PHILOX_M1, ctr.z);
  return vec4<u32>((m1.x ^ ctr.y) ^ key.x, m1.y, (m0.x ^ ctr.w) ^ key.y, m0.y);
}

// Ten rounds. The first is taken outside the loop because the key is bumped
// BETWEEN rounds -- round 0 sees the key exactly as supplied, so ten rounds
// bump it nine times. Writing the bump at the top of every iteration instead
// gives a generator that is statistically fine and agrees with nobody.
fn philox4x32(ctr: vec4<u32>, key: vec2<u32>) -> vec4<u32> {
  var c = philox4x32Round(ctr, key);
  var k = key;
  for (var r = 1u; r < 10u; r = r + 1u) {
    k = vec2<u32>(k.x + PHILOX_W0, k.y + PHILOX_W1);
    c = philox4x32Round(c, k);
  }
  return c;
}

// A word to a uniform in [0, 1). The top 24 bits and a divisor of 2^24, NOT
// f32(word) / 4294967296.0: f32 has 24 mantissa bits, so the latter rounds
// 0xFFFFFFFFu up to 4294967296.0 and returns exactly 1.0, closing the range.
fn philoxUnitFloat(word: u32) -> f32 {
  return f32(word >> 8u) * (1.0 / 16777216.0);
}

// The four uniforms of one evaluation.
fn philox4x32Uniforms(ctr: vec4<u32>, key: vec2<u32>) -> vec4<f32> {
  let w = philox4x32(ctr, key);
  return vec4<f32>(
    philoxUnitFloat(w.x),
    philoxUnitFloat(w.y),
    philoxUnitFloat(w.z),
    philoxUnitFloat(w.w),
  );
}`;

/**
 * The counter convention, as WGSL: replicate index in the low word, rest zero.
 *
 * Separate from {@link WGSL_PHILOX_FNS} because a kernel that indexes its
 * ensemble differently — a 2D dispatch, say, or a counter carrying a timestep
 * — should supply its own and still get the generator. The convention is worth
 * naming because it is the contract `replicateCounter` states on the CPU side,
 * and two spellings of it would give one arm a different stream.
 */
export const WGSL_PHILOX_REPLICATE_COUNTER = `// Replicate i draws from counter (i, 0, 0, 0) -- the same convention as
// replicateCounter() in @ballista/engine. The two must agree or the arms draw
// different numbers while both looking correct.
fn philoxReplicateCounter(replicateIndex: u32) -> vec4<u32> {
  return vec4<u32>(replicateIndex, 0u, 0u, 0u);
}`;
