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
