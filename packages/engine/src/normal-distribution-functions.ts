/**
 * The normal distribution's special functions: `erf`, `erfc`, the standard
 * normal CDF and its quantile.
 *
 * These exist for phase 6 (P6.01 onwards). A truncated normal or lognormal
 * cannot be sampled without the CDF and its inverse, and its analytic mean and
 * variance cannot be written down without them either -- which is exactly what
 * P6.01's validation criterion ("sampling moments match analytics") compares
 * against. P6.08's t-based confidence bands will want them too.
 *
 * Accuracy policy. `erf`/`erfc` are computed from the regularised incomplete
 * gamma function at `a = 1/2`, iterated to double-precision convergence rather
 * than truncated at a fixed polynomial order, so they carry no fitted
 * coefficients and no fixed error floor. {@link normalQuantile} starts from a
 * cheap rational approximation and refines it by Halley's method against
 * {@link normalCdf}; the starting point therefore affects only how many
 * iterations run, never the answer, which is why an approximation good to
 * 4.5e-4 is an acceptable seed for a function asserted to 1e-14.
 *
 * Tail policy. Everything here is written in whichever of `Phi` or
 * `Q = 1 - Phi` stays away from 1, because the far tail is where a truncated
 * distribution actually gets used and where `Phi(b) - Phi(a)` loses every
 * significant digit it has. See {@link standardNormalIntervalMass}.
 */

/** `Gamma(1/2) = sqrt(pi)`, as its logarithm. */
const LN_GAMMA_HALF = 0.5 * Math.log(Math.PI);

const SQRT2 = Math.SQRT2;
/** `1 / sqrt(2 * pi)`, the standard normal density's normalising constant. */
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/** Smallest number the continued fraction below may divide by. */
const FP_MIN = Number.MIN_VALUE / Number.EPSILON;
const EPS = Number.EPSILON;
const MAX_ITERATIONS = 300;

/**
 * Regularised lower incomplete gamma `P(1/2, x)` by its series expansion.
 *
 * Converges quickly for `x < a + 1`; the caller is responsible for that split
 * (see {@link regularizedGammaQHalf}), because the series converges slowly and
 * then not at all as `x` grows.
 */
function regularizedGammaPHalf(x: number): number {
  if (x <= 0) return 0;
  const a = 0.5;
  let ap = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < MAX_ITERATIONS; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) {
      return sum * Math.exp(-x + a * Math.log(x) - LN_GAMMA_HALF);
    }
  }
  /* istanbul ignore next -- unreachable for a = 1/2 and x < 1.5; see the test. */
  throw new Error(`regularizedGammaPHalf: series did not converge for x=${x}`);
}

/**
 * Regularised upper incomplete gamma `Q(1/2, x)` by its continued fraction,
 * evaluated with the modified Lentz algorithm.
 *
 * This is the branch that keeps `erfc` accurate in the tail: it computes the
 * small quantity directly instead of as `1 - P`, where every digit would be
 * lost to cancellation.
 */
function regularizedGammaQHalf(x: number): number {
  const a = 0.5;
  let b = x + 1 - a;
  let c = 1 / FP_MIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= MAX_ITERATIONS; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FP_MIN) d = FP_MIN;
    c = b + an / c;
    if (Math.abs(c) < FP_MIN) c = FP_MIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) {
      return Math.exp(-x + a * Math.log(x) - LN_GAMMA_HALF) * h;
    }
  }
  /* istanbul ignore next -- unreachable for a = 1/2 and x >= 1.5; see the test. */
  throw new Error(`regularizedGammaQHalf: continued fraction did not converge for x=${x}`);
}

/** The crossover `x = a + 1` at which the series stops being the better branch. */
const GAMMA_BRANCH = 1.5;

/** The error function, `erf(x)`. */
export function erf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === 0) return 0;
  const t = x * x;
  const p = t < GAMMA_BRANCH ? regularizedGammaPHalf(t) : 1 - regularizedGammaQHalf(t);
  return x > 0 ? p : -p;
}

/**
 * The complementary error function, `erfc(x) = 1 - erf(x)`.
 *
 * Accurate for large positive `x`, where `1 - erf(x)` would return 0: the
 * upper-tail branch is computed as itself rather than by subtraction.
 */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const t = x * x;
  if (x >= 0) {
    return t < GAMMA_BRANCH ? 1 - regularizedGammaPHalf(t) : regularizedGammaQHalf(t);
  }
  return t < GAMMA_BRANCH ? 1 + regularizedGammaPHalf(t) : 2 - regularizedGammaQHalf(t);
}

/** The standard normal probability density, `phi(z)`. */
export function normalPdf(z: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * z * z);
}

/** The standard normal CDF, `Phi(z) = P(Z <= z)`. */
export function normalCdf(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  if (z === Number.POSITIVE_INFINITY) return 1;
  if (z === Number.NEGATIVE_INFINITY) return 0;
  return 0.5 * erfc(-z / SQRT2);
}

/**
 * The standard normal upper-tail probability, `Q(z) = 1 - Phi(z)`.
 *
 * Not a convenience wrapper: for `z = 8` this returns 6.22e-16 while
 * `1 - normalCdf(8)` returns 6.66e-16 -- one correct digit out of sixteen. Use
 * this wherever the answer is small.
 */
export function normalUpperTail(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  if (z === Number.POSITIVE_INFINITY) return 0;
  if (z === Number.NEGATIVE_INFINITY) return 1;
  return 0.5 * erfc(z / SQRT2);
}

/**
 * Abramowitz & Stegun 26.2.23: a rational approximation to the normal quantile
 * with absolute error below 4.5e-4.
 *
 * Only ever a starting point for {@link normalQuantile}'s Halley iteration, so
 * its error does not reach the caller.
 */
function quantileSeed(p: number): number {
  const lower = p < 0.5;
  const q = lower ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(q));
  const z =
    t -
    (2.515517 + 0.802853 * t + 0.010328 * t * t) /
      (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return lower ? -z : z;
}

/**
 * The standard normal quantile, `Phi^{-1}(p)`.
 *
 * Halley-refined against {@link normalCdf}, working from whichever tail keeps
 * the residual away from 1. Refinement stops early if the density underflows,
 * which happens past roughly `|z| = 38`; beyond that the seed approximation is
 * returned and the result is good to about 4 digits rather than 15. Truncation
 * bounds that far out are outside anything phase 6 samples, and a documented
 * degradation is better than a NaN.
 *
 * @param p - a probability in `[0, 1]`; 0 and 1 return -Infinity and Infinity.
 * @throws if `p` is NaN or outside `[0, 1]`.
 */
export function normalQuantile(p: number): number {
  if (Number.isNaN(p) || p < 0 || p > 1) {
    throw new RangeError(`normalQuantile: p must be in [0, 1], got ${p}`);
  }
  if (p === 0) return Number.NEGATIVE_INFINITY;
  if (p === 1) return Number.POSITIVE_INFINITY;
  if (p === 0.5) return 0;

  let z = quantileSeed(p);
  for (let i = 0; i < 8; i += 1) {
    const density = normalPdf(z);
    if (!(density > 0) || !Number.isFinite(density)) break;
    // Residual is Phi(z) - p throughout, but for z > 0 it is evaluated as
    // (1 - p) - Q(z) so that both sides of the subtraction are small rather
    // than both close to 1. The two forms are algebraically identical; the
    // second keeps its significant digits.
    const residual = z > 0 ? 1 - p - normalUpperTail(z) : normalCdf(z) - p;
    const newton = residual / density;
    // Halley, using phi'(z) = -z phi(z).
    const step = newton / (1 - 0.5 * newton * z);
    z -= step;
    if (Math.abs(step) <= 1e-15 * Math.max(1, Math.abs(z))) break;
  }
  return z;
}

/**
 * `Phi(beta) - Phi(alpha)`, the probability mass a truncation interval keeps.
 *
 * Written in whichever tail avoids cancellation. For `alpha = 4, beta = 5` the
 * naive difference of CDFs has both terms within 3.2e-5 of 1 and returns a
 * result with about eleven digits; this returns all sixteen. That matters
 * because the mass is a divisor in every truncated moment below.
 *
 * @param alpha - lower bound in standard units; may be -Infinity.
 * @param beta - upper bound in standard units; may be +Infinity.
 */
export function standardNormalIntervalMass(alpha: number, beta: number): number {
  if (!(beta > alpha)) return 0;
  if (alpha >= 0) return normalUpperTail(alpha) - normalUpperTail(beta);
  if (beta <= 0) return normalCdf(beta) - normalCdf(alpha);
  return normalCdf(beta) - normalCdf(alpha);
}
