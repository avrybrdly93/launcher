/**
 * Quasi-Monte Carlo sampling: a scrambled Sobol' sequence (P6.15, blueprint §7
 * phase 6).
 *
 * Plain Monte Carlo pays for its generality with a convergence rate that does
 * not depend on the integrand at all: the standard error of a mean over `N`
 * independent draws falls as `N^(-1/2)`, so buying one more digit of accuracy
 * costs a hundredfold in replicates. A low-discrepancy sequence buys a better
 * rate by giving up independence. Its points are constructed to fill the unit
 * cube evenly at every scale, and for an integrand of bounded variation the
 * Koksma-Hlawka inequality bounds the error by the sequence's discrepancy,
 * which for Sobol' is `O((log N)^s / N)` -- effectively `N^(-1)` at the sizes
 * a study of this kind runs at, and that is what this module's acceptance
 * test measures rather than assumes.
 *
 * ## How the points are built
 *
 * Sobol's construction is one *generator matrix* per dimension, applied to
 * the bits of the index over GF(2). Concretely, dimension `j` owns a set of
 * **direction numbers** `v_1 .. v_32`, and the point for index `i` is the XOR
 * of the `v_k` for every set bit `k` of `i`. The direction numbers come from a
 * primitive polynomial over GF(2) and a set of odd initialising values, which
 * is the table below; the polynomials and initial values are Joe & Kuo's, the
 * standard published set.
 *
 * That direct form -- rather than the Gray-code recurrence most
 * implementations use -- is deliberate. The recurrence derives point `i` from
 * point `i - 1` and is faster for a full sweep, but it makes a point a
 * function of the enumeration rather than of its own index. P6.03 requires the
 * opposite: replicate `i` must be derivable from `i` alone, so that a worker
 * pool of any size handed any contiguous ranges reproduces the same ensemble.
 * The direct form costs one loop over the set bits of `i` -- at most 32
 * iterations -- and keeps that property exactly.
 *
 * ## Why the sequence must be scrambled, and what "scrambled" means here
 *
 * An unscrambled Sobol' sequence is *deterministic*. Used as-is it is a
 * quadrature rule, not a Monte Carlo estimator: its error is a fixed number
 * with no distribution, the spread across replicates estimates nothing, and no
 * confidence interval can be formed from it. Everything downstream in this
 * repo -- P6.07's standard errors, P6.09's confidence bands -- would be
 * reporting a quantity that does not exist.
 *
 * Randomised QMC fixes that by applying a random, measure-preserving map to
 * the points. The map used here is a **nested uniform scramble** (Owen 1995):
 * permute the first digit of every coordinate; then, independently within each
 * of the two halves, permute the second digit; and so on down the digits. Each
 * point stays uniformly distributed, so the estimator is unbiased and its
 * sample spread is meaningful again -- while the stratification the sequence
 * was built for survives, because a permutation of digit `k` that depends only
 * on digits `1..k-1` maps every elementary interval onto another one of the
 * same size.
 *
 * A true Owen scramble stores a permutation tree. The implementation here is
 * Laine & Karras's hash construction (as set out by Burley, *Practical
 * Hash-based Owen Scrambling*, 2020), which reproduces the nesting in `O(1)`
 * with no state: reverse the bits, apply a hash built from `x ^= x * C` steps
 * with **even** `C`, reverse back. Even constants are the whole trick. `x * C`
 * with `C` even has a zero low bit, so bit `k` of `x ^ (x * C)` depends only
 * on bits `0..k` of `x` -- the map is triangular, hence a bijection, and after
 * the two reversals each digit's permutation depends only on the digits above
 * it, which is exactly Owen's nesting. {@link nestedUniformScramble} is
 * therefore net-preserving as a matter of structure rather than of hope, and
 * this module's tests check that structure directly instead of taking it on
 * trust.
 *
 * ## The one thing Sobol' has that Latin hypercube sampling cannot
 *
 * `latin-hypercube.ts` documents its central caveat: changing a study's
 * replicate count changes every replicate, because the strata are `1/N` wide
 * and `N` is in their definition. A Sobol' study has no such dependence. Point
 * `i` is a function of `i` and the scramble key only, so **the first `N`
 * points of a longer study are the same points** and an estimator can be
 * refined by appending replicates. That makes this the right sampler under a
 * convergence sweep or a progressive display (P6.25), where LHS is measuring a
 * sequence of unrelated designs.
 *
 * The trade is dimensional. QMC's advantage rests on the integrand having low
 * effective dimension, and it decays as the number of drawn parameters grows;
 * with many overlays, or with a response dominated by a discontinuity, the
 * `N^(-1)` rate degrades toward plain Monte Carlo's. This is an option beside
 * the other three, not a replacement for them.
 */

import { distributionQuantile } from "./distribution.js";
import { writeSpecNumberAtPath, type Replicate } from "./replicate-generator.js";
import { scenarioSpecSchema, type ScenarioSpec } from "./scenario-spec.js";
import type { UncertainScenarioSpec } from "./uncertain-scenario-spec.js";

/**
 * Digits of resolution in a Sobol' coordinate.
 *
 * Thirty-two is the width of the direction numbers and of the scramble, and
 * so also the number of index bits that can influence a point: indices at or
 * above `2^32` would alias onto smaller ones. {@link MAX_SOBOL_INDEX} enforces
 * that rather than letting it happen quietly.
 */
const SOBOL_BITS = 32;

/** `2^32`, the denominator that turns a scrambled integer into `[0, 1)`. */
const SOBOL_SCALE = 2 ** SOBOL_BITS;

/**
 * Highest replicate index this module will place.
 *
 * Six orders of magnitude above the `10^4` replicates P6.04 budgets for.
 * Beyond it the index no longer fits the generator matrices and points would
 * repeat, so this is a caller error rather than something to degrade through.
 */
export const MAX_SOBOL_INDEX = 2 ** SOBOL_BITS - 1;

/**
 * Dimensions this module can place, i.e. the largest number of overlays a
 * Sobol' study may draw.
 *
 * Bounded by the direction-number table below. Extending it is a matter of
 * adding rows from Joe & Kuo's published set; twenty-one is well past what any
 * scenario in this repo overlays, and the QMC advantage is thinning badly long
 * before that many dimensions anyway (see the module doc).
 */
export const MAX_SOBOL_DIMENSIONS = 21;

/**
 * Joe & Kuo's primitive polynomials and initial direction numbers, for
 * dimensions 2 upward.
 *
 * Each row is `[degree, coefficients, initial]`: the degree `s` of the
 * primitive polynomial, its middle coefficients packed into the low `s - 1`
 * bits (most significant first), and the `s` initialising values `m_1..m_s`.
 * Every `m_k` is odd and less than `2^k`, which is what makes the resulting
 * generator matrix unit upper triangular -- and that, in turn, is what gives
 * each dimension its perfect one-dimensional stratification.
 *
 * Dimension 1 is not in the table: its generator matrix is the identity, so
 * `v_k = 2^(32-k)` and its points are the van der Corput sequence in base 2.
 */
const SOBOL_POLYNOMIALS: ReadonlyArray<readonly [number, number, readonly number[]]> = [
  [1, 0, [1]],
  [2, 1, [1, 3]],
  [3, 1, [1, 3, 1]],
  [3, 2, [1, 1, 1]],
  [4, 1, [1, 1, 3, 3]],
  [4, 4, [1, 3, 5, 13]],
  [5, 2, [1, 1, 5, 5, 17]],
  [5, 4, [1, 1, 5, 5, 5]],
  [5, 7, [1, 1, 7, 11, 19]],
  [5, 11, [1, 1, 5, 1, 1]],
  [5, 13, [1, 1, 1, 3, 11]],
  [5, 14, [1, 3, 5, 5, 31]],
  [6, 1, [1, 3, 3, 9, 7, 49]],
  [6, 13, [1, 1, 1, 15, 21, 21]],
  [6, 16, [1, 3, 1, 13, 27, 49]],
  [6, 19, [1, 1, 1, 15, 7, 5]],
  [6, 22, [1, 3, 1, 15, 13, 25]],
  [6, 25, [1, 1, 5, 5, 19, 61]],
  [7, 1, [1, 3, 7, 11, 23, 15, 103]],
  [7, 4, [1, 3, 7, 5, 19, 21, 113]],
];

/**
 * Direction numbers per dimension, built once on first use.
 *
 * The table is small and immutable, so a module-level cache is safe; it exists
 * because {@link sobolInteger} is called once per replicate per overlay and
 * rebuilding thirty-two direction numbers each time would dominate the cost of
 * a study.
 */
const directionCache = new Map<number, Uint32Array>();

/**
 * Reads `values[index]`, throwing rather than yielding `undefined`.
 *
 * Every index in this module is provably in range -- the callers bound them by
 * {@link SOBOL_BITS} or by {@link assertDimension} -- but the compiler checks
 * indexed access, and the two honest ways to satisfy it are an assertion or a
 * default. A default of `0` would turn a future off-by-one into a silently
 * wrong point, which for a low-discrepancy sequence means a quietly worse
 * convergence rate and no failing test. So: throw.
 */
function elementAt(values: Uint32Array | readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`sobol: index ${index} is outside a table of length ${values.length}`);
  }
  return value;
}

/**
 * The direction numbers `v_1..v_32` for `dimension`, one-indexed as
 * `v[k - 1]`, each already shifted so that `v_k`'s leading bit sits at bit 31.
 *
 * For `k > s` the recurrence is Sobol's:
 *
 * ```
 * m_k = 2^s * m_{k-s}  XOR  m_{k-s}  XOR  ( a_i * 2^i * m_{k-i}  for 0 < i < s )
 * ```
 *
 * where the `a_i` are the primitive polynomial's middle coefficients. It
 * preserves oddness of `m_k` and keeps `m_k < 2^k`, which is why the
 * stratification property holds for every `k` and not just the tabulated ones.
 */
function directionNumbers(dimension: number): Uint32Array {
  const cached = directionCache.get(dimension);
  if (cached !== undefined) return cached;

  const v = new Uint32Array(SOBOL_BITS);
  if (dimension === 1) {
    for (let k = 1; k <= SOBOL_BITS; k += 1) v[k - 1] = (2 ** (SOBOL_BITS - k)) >>> 0;
    directionCache.set(dimension, v);
    return v;
  }

  const row = SOBOL_POLYNOMIALS[dimension - 2];
  if (row === undefined) {
    throw new Error(`sobol: no direction numbers tabulated for dimension ${dimension}`);
  }
  const [degree, coefficients, initial] = row;
  const m = new Uint32Array(SOBOL_BITS);
  for (let k = 1; k <= degree; k += 1) m[k - 1] = elementAt(initial, k - 1);
  for (let k = degree + 1; k <= SOBOL_BITS; k += 1) {
    const seedValue = elementAt(m, k - degree - 1);
    let value = seedValue ^ ((seedValue << degree) >>> 0);
    for (let i = 1; i < degree; i += 1) {
      if ((coefficients >>> (degree - 1 - i)) & 1) value ^= (elementAt(m, k - i - 1) << i) >>> 0;
    }
    m[k - 1] = value >>> 0;
  }
  for (let k = 1; k <= SOBOL_BITS; k += 1) {
    v[k - 1] = (elementAt(m, k - 1) * 2 ** (SOBOL_BITS - k)) >>> 0;
  }

  directionCache.set(dimension, v);
  return v;
}

function assertDimension(dimension: number): void {
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > MAX_SOBOL_DIMENSIONS) {
    throw new Error(
      `sobol: dimension must be an integer in [1, ${MAX_SOBOL_DIMENSIONS}], got ${dimension}`,
    );
  }
}

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > MAX_SOBOL_INDEX) {
    throw new Error(`sobol: index must be an integer in [0, ${MAX_SOBOL_INDEX}], got ${index}`);
  }
}

/**
 * The unscrambled Sobol' coordinate for `index` in `dimension`, as a 32-bit
 * integer whose value divided by `2^32` is the point in `[0, 1)`.
 *
 * XORs the direction numbers selected by the set bits of `index`, which is the
 * definition applied directly rather than through the Gray-code recurrence --
 * see the module doc for why that matters here. Note `sobolInteger(0, d)` is
 * `0` in every dimension: the origin is the sequence's first point, and it is
 * one of the reasons the raw sequence should not be used unscrambled.
 */
export function sobolInteger(index: number, dimension: number): number {
  assertIndex(index);
  assertDimension(dimension);
  const v = directionNumbers(dimension);
  let x = 0;
  let remaining = index;
  let k = 0;
  while (remaining > 0) {
    // `remaining` can exceed 2^31, where `&` would see a negative int32, so
    // the bit test is arithmetic rather than bitwise.
    if (remaining % 2 === 1) x = (x ^ elementAt(v, k)) >>> 0;
    remaining = Math.floor(remaining / 2);
    k += 1;
  }
  return x >>> 0;
}

/**
 * Laine & Karras's hash: a triangular bijection on 32 bits.
 *
 * Every constant is **even**, and that is load-bearing rather than
 * decorative. `x * C` with even `C` has bit 0 clear, so bit `k` of
 * `x ^ (x * C)` depends only on bits `0..k` of `x`; each step is therefore a
 * bijection, and so is the composition. `x + seed` is triangular for the same
 * reason -- carries propagate upward only. Substituting an odd constant would
 * still look like a hash and would silently stop being a permutation.
 */
function laineKarrasPermutation(input: number, seed: number): number {
  let x = (input + seed) >>> 0;
  x = (x ^ Math.imul(x, 0x6c50b47c)) >>> 0;
  x = (x ^ Math.imul(x, 0xb82f1e52)) >>> 0;
  x = (x ^ Math.imul(x, 0xc7afe638)) >>> 0;
  x = (x ^ Math.imul(x, 0x8d22f6e6)) >>> 0;
  return x >>> 0;
}

/** Reverses the 32 bits of `input`. */
function reverseBits(input: number): number {
  let x = input >>> 0;
  x = (((x & 0xaaaaaaaa) >>> 1) | ((x & 0x55555555) << 1)) >>> 0;
  x = (((x & 0xcccccccc) >>> 2) | ((x & 0x33333333) << 2)) >>> 0;
  x = (((x & 0xf0f0f0f0) >>> 4) | ((x & 0x0f0f0f0f) << 4)) >>> 0;
  x = (((x & 0xff00ff00) >>> 8) | ((x & 0x00ff00ff) << 8)) >>> 0;
  return ((x >>> 16) | (x << 16)) >>> 0;
}

/**
 * A nested uniform (Owen-style) scramble of a 32-bit Sobol' coordinate.
 *
 * The two bit reversals turn `laineKarrasPermutation`'s
 * low-bits-influence-high-bits triangularity into the high-bits-influence-low
 * form Owen's scramble needs: the permutation applied to digit `k` depends
 * only on digits `1..k-1`. Two consequences follow, and both are asserted in
 * this module's tests rather than argued for here:
 *
 * - **It is a bijection**, so it maps the sequence onto a permutation of
 *   itself and cannot collapse two points together.
 * - **It preserves stratification at every scale**, because for each `k` the
 *   map induced on the top `k` bits is itself a bijection on `[0, 2^k)`. An
 *   elementary interval therefore goes to an elementary interval of the same
 *   size, so a `(t, m, s)`-net stays a net of the same quality.
 *
 * Each coordinate is individually uniform afterwards, which is what restores
 * unbiasedness and makes a standard error across replicates mean something.
 */
export function nestedUniformScramble(value: number, seed: number): number {
  return reverseBits(laineKarrasPermutation(reverseBits(value >>> 0), seed >>> 0)) >>> 0;
}

/**
 * The scramble key for one dimension of a study.
 *
 * Depends on the study seed and the overlay index and on nothing else --
 * notably **not** on the replicate count, which is the whole difference from
 * `latinHypercubeStratum`'s key and the reason a Sobol' study is extensible in
 * `N`. Dimensions must scramble independently: one shared key would apply the
 * same digit permutation to every coordinate, correlating the dimensions in
 * precisely the way the sequence is built to avoid.
 */
function scrambleKey(studySeed: number, overlayIndex: number): number {
  let x = (studySeed ^ Math.imul(overlayIndex + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * The scrambled Sobol' uniform for one replicate and one dimension, in the
 * open interval `(0, 1)`.
 *
 * Depends only on `(studySeed, replicateIndex, overlayIndex)`, so P6.03's
 * batch-partition independence holds exactly and without the replicate-count
 * caveat LHS carries.
 *
 * The clamp at zero is the same one `latinHypercubeUniform` makes and for the
 * same reason: {@link distributionQuantile} requires the open interval, and a
 * scrambled coordinate of exactly `0` is reachable.
 */
export function sobolUniform(
  studySeed: number,
  replicateIndex: number,
  overlayIndex: number,
): number {
  const raw = sobolInteger(replicateIndex, overlayIndex + 1);
  const scrambled = nestedUniformScramble(raw, scrambleKey(studySeed, overlayIndex));
  const u = scrambled / SOBOL_SCALE;
  return u > 0 ? u : Number.MIN_VALUE;
}

/**
 * Generates replicate `index` of `study` from the scrambled Sobol' sequence
 * (P6.15).
 *
 * Mirrors `generateLatinHypercubeReplicate`, including its contract: an
 * invalid drawn spec throws rather than being skipped, because silently
 * dropping a replicate is rejection sampling on the output and biases the
 * mean.
 *
 * @throws if `index` is negative or above {@link MAX_SOBOL_INDEX}, if the
 *   study overlays more than {@link MAX_SOBOL_DIMENSIONS} parameters, or if
 *   the drawn spec fails the base schema.
 */
export function generateSobolReplicate(study: UncertainScenarioSpec, index: number): Replicate {
  if (study.overlays.length > MAX_SOBOL_DIMENSIONS) {
    throw new Error(
      `generateSobolReplicate: study draws ${study.overlays.length} parameters, above the ` +
        `${MAX_SOBOL_DIMENSIONS}-dimension limit of the direction-number table`,
    );
  }

  const values: number[] = [];
  let spec: ScenarioSpec = study.base;
  study.overlays.forEach((overlay, overlayIndex) => {
    const u = sobolUniform(study.seed, index, overlayIndex);
    const value = distributionQuantile(overlay.distribution, u);
    values.push(value);
    spec = writeSpecNumberAtPath(spec, overlay.path, value);
  });

  const parsed = scenarioSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const drawn = study.overlays
      .map((overlay, overlayIndex) => `${overlay.path}=${values[overlayIndex]}`)
      .join(", ");
    throw new Error(
      `generateSobolReplicate: replicate ${index} drew a parameter vector the base schema rejects ` +
        `(${drawn}): ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. ` +
        "A distribution whose support reaches invalid values needs a truncated variant (P6.01).",
    );
  }

  return { index, values, spec: parsed.data };
}

/**
 * Lazily generates every replicate of `study` from the scrambled Sobol'
 * sequence, in index order (P6.15).
 *
 * One of four sampling options; the `replicates` generator in
 * `replicate-generator.ts` remains the default. Prefer this one when the
 * observable is smooth in a small number of drawn parameters, and especially
 * when the study will be extended or swept in `N` -- unlike a Latin hypercube,
 * the points already drawn stay valid when more are added.
 *
 * The `N^(-1)` error rate is measured, not claimed here: see
 * `packages/analysis/src/sobol-convergence.test.ts`.
 */
export function* sobolReplicates(study: UncertainScenarioSpec): Generator<Replicate> {
  for (let index = 0; index < study.replicates; index += 1) {
    yield generateSobolReplicate(study, index);
  }
}
