/**
 * Solver Lab page formatting helpers (§6.3 "distinct route ... side-by-side
 * method comparison against reference solution"; P3.41). Kept separate from
 * `solver-lab-page.tsx` so the error-readout formatting rule is unit-tested
 * directly, mirroring every other `<name>.tsx` + `<name>-logic.ts` panel
 * pair in this package.
 */

/**
 * Renders a global-error-vs-reference value for a Solver Lab column readout.
 * Exponential notation (`toExponential`) is used rather than `toPrecision`
 * (the convention elsewhere in this package, e.g. `forces-panel.tsx`'s force
 * magnitudes) because the whole point of this exhibit is comparing errors
 * that span many orders of magnitude across methods (e.g. Euler's O(h) error
 * next to DOPRI5's O(h^5)) -- a fixed-precision decimal would print several
 * of those as indistinguishable "0.000".
 */
export function formatErrorReadout(error: number): string {
  if (error === 0) return "0";
  if (!Number.isFinite(error)) return Number.isNaN(error) ? "NaN" : "∞";
  return error.toExponential(2);
}

/** Renders an integer count (steps, rhs evaluations) with thousands separators for readability at typical column sizes (10^2-10^5). */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
