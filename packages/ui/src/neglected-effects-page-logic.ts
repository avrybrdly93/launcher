/**
 * Neglected Effects exercise page's non-rendering logic (§7 P4.20, blueprint
 * §5.5 worked example 1 "how big are the effects we ignore?"). Split out
 * from `neglected-effects-page.tsx` per this package's established
 * `<feature>-page-logic.ts` convention (`energy-drift-page-logic.ts`,
 * `solver-lab-page-logic.ts`).
 */

/** Renders a ratio (e.g. 0.0159) as a percentage with one decimal place ("1.6%"), the page's headline number. */
export function formatRatioAsPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
