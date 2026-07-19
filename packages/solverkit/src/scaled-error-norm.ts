/**
 * Tolerance-scaled RMS error norm (§4.5, eq. 4.9) for embedded-pair step
 * acceptance (P2.27's controller job, not this task's): given the raw local
 * error estimate `delta` (P2.23's $\boldsymbol\delta$, already computed by
 * {@link stepEmbeddedRK}), the pre-step state `y`, and the proposed
 * post-step state `yNext`, forms the per-component tolerance
 *
 * $$sc_i = \text{atol}_i + \text{rtol} \cdot \max(|y_i|, |\hat y_i|)$$
 *
 * and returns the RMS norm $\text{err} = \sqrt{\tfrac1n \sum_i (\delta_i /
 * sc_i)^2}$. A step is accepted iff `err <= 1`. `atol` accepts either a
 * single scalar (applied to every channel) or a `Float64Array` matching
 * `delta`'s length (per-channel tolerance, e.g. wildly different position
 * vs. velocity magnitudes). Allocates nothing (ADR-004): every argument is
 * caller-owned and this only reads them.
 */
export function scaledErrorNorm(
  delta: Float64Array,
  y: Float64Array,
  yNext: Float64Array,
  rtol: number,
  atol: number | Float64Array,
): number {
  const n = delta.length;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const atolI = typeof atol === "number" ? atol : atol[i]!;
    const yi = y[i]!;
    const yNextI = yNext[i]!;
    const scale = Math.abs(yi) > Math.abs(yNextI) ? Math.abs(yi) : Math.abs(yNextI);
    const sc = atolI + rtol * scale;
    const ratio = delta[i]! / sc;
    sumSq += ratio * ratio;
  }
  return Math.sqrt(sumSq / n);
}
