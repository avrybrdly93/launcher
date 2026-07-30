/**
 * Energy-drift dashboard page's non-rendering logic (§7 P3.44 shell + P4.12
 * full content). Split out from `energy-drift-page.tsx` per this package's
 * established `<feature>-page-logic.ts` convention, mirroring
 * `solver-lab-page-logic.ts`'s split for the same reason: formatting is
 * directly unit-testable without a DOM.
 */

/**
 * Renders a relative-energy-error readout. Exponential notation, mirroring
 * `solver-lab-page-logic.ts`'s `formatErrorReadout`, since the exhibit's
 * whole point is comparing drift magnitudes spanning many orders of
 * magnitude (Euler's O(h) drift next to Verlet's near-machine-precision
 * one) -- a fixed-precision decimal would print several as "0.000".
 */
export function formatEnergyError(error: number): string {
  if (error === 0) return "0";
  if (!Number.isFinite(error)) return Number.isNaN(error) ? "NaN" : "∞";
  return error.toExponential(2);
}
