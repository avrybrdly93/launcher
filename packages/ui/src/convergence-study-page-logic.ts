/**
 * Convergence-study page's non-rendering logic (§7 P3.42): the h-ladder
 * text-input <-> numeric-array conversion and slope display formatting,
 * split out from `convergence-study-page.tsx` per this package's
 * established `<feature>-page-logic.ts` convention so both directions of
 * the h-ladder parse are unit-tested without a DOM.
 */

/** The h-ladder a fresh page starts with: four halvings, a reasonable default range for a planar-projectile flight measured in fractions of a second. */
export const DEFAULT_H_LADDER: readonly number[] = [0.04, 0.02, 0.01, 0.005];

/** Renders an h-ladder as the comma-separated text the `<input>` shows/edits. */
export function formatHLadder(hs: readonly number[]): string {
  return hs.join(", ");
}

/**
 * Parses a comma/whitespace-separated h-ladder text field into positive,
 * finite, strictly-decreasing-or-equal-ignoring `h` values, in the order
 * given (not re-sorted -- a user reordering the ladder is meaningful for
 * reading the resulting log-log plot left-to-right). Non-numeric or
 * non-positive tokens are silently dropped rather than rejecting the whole
 * field, so a still-being-typed trailing comma ("0.04, 0.02,") doesn't blank
 * the study on every keystroke.
 */
export function parseHLadder(text: string): readonly number[] {
  return text
    .split(/[,\s]+/)
    .map((token) => Number(token))
    .filter((value) => Number.isFinite(value) && value > 0);
}

/** Renders a fitted convergence slope for display: fixed to 2 decimal places, which is plenty of resolution to distinguish e.g. order 1 from order 4. */
export function formatSlope(slope: number): string {
  if (!Number.isFinite(slope)) return Number.isNaN(slope) ? "NaN" : "∞";
  return slope.toFixed(2);
}
