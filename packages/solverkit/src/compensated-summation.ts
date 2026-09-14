import type { RoundFn } from "./planar-rk4-precision-reference.js";

/**
 * Kahan (compensated) summation for one state channel (§4.7, P2.20): adds
 * `term` to `sum`, using and updating `compensation[index]` to recover the
 * low-order bits a plain `sum + term` would round away. Returns the
 * corrected sum.
 *
 * A fixed-step solver's state update is exactly this operation repeated
 * `t_f / h` times per channel -- a large running value (the state) plus a
 * much smaller per-step increment (`h * f`) -- so naive addition's total
 * rounding error grows like `n * eps_mach`, the rising right-hand branch of
 * the V-shaped total-error curve (truncation error `C1 h^p` falling,
 * rounding error `C2 eps/h` rising). Kahan summation holds that growth to
 * `O(eps_mach)`, independent of `n`, flattening the branch.
 *
 * Scalar (one channel at a time, called from inside a stepper's own update
 * loop) rather than a vectorized whole-state operation: the low-order bits
 * are only recoverable at the exact point a stepper forms `y + increment`,
 * before that addition rounds -- by the time a driver sees the stepper's
 * output the rounding has already happened and can no longer be corrected
 * from the outside. `compensation` is caller-owned persistent state
 * (zero-initialized before the first call, one entry per state channel) so
 * this allocates nothing per call (ADR-004).
 */
export function kahanAdd(
  sum: number,
  term: number,
  compensation: Float64Array,
  index: number,
): number {
  const y = term - compensation[index]!;
  const t = sum + y;
  compensation[index] = t - sum - y;
  return t;
}

/**
 * {@link kahanAdd} with every operation taken at a chosen working precision
 * (P7.18): the two-float accumulator the f32 planar path needs.
 *
 * ## Why this is not just `kahanAdd`
 *
 * `kahanAdd` performs its compensation arithmetic in f64. Used from inside an
 * f32 march that is emulating a device, that would be cheating in the precise
 * sense that matters here: the correction would carry information binary32
 * cannot hold, so the CPU arm would stop being a model of what a WGSL kernel
 * computes, and the measured improvement would not be available on the device.
 * Routing every operation through `round` keeps the accumulator inside the
 * working format -- the running value and its residual are two binary32 numbers,
 * which is what "two-float" means -- so the improvement is one a shader can
 * reproduce.
 *
 * Under {@link identity} this is exactly `kahanAdd`, so the f64 path is
 * unchanged bit-for-bit and a caller can switch precision without switching
 * algorithm.
 *
 * ## Why the error-free transformation still works in binary32
 *
 * `t - sum` is exact whenever `sum` and `t` are within a factor of two of each
 * other (Sterbenz), which is the regime a state update lives in: the increment
 * is small against the running value, so `t` is a neighbour of `sum`. That is
 * also the regime where plain addition loses the most, because the increment's
 * low bits fall off the end of the accumulator. The two facts are the same fact,
 * which is why compensation pays for itself exactly where it is needed.
 *
 * The subtraction order is written out rather than left to the compiler:
 * `(t - sum) - y`, not `t - sum - y`. Under `round` those are different
 * computations, and only the first is the error-free transformation.
 */
export function roundedKahanAdd(
  sum: number,
  term: number,
  compensation: Float64Array,
  index: number,
  round: RoundFn,
): number {
  const y = round(term - compensation[index]!);
  const t = round(sum + y);
  compensation[index] = round(round(t - sum) - y);
  return t;
}
