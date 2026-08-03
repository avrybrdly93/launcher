/**
 * Density-Altitude exercise page's non-rendering logic (§7 P4.29). Split out
 * from `density-altitude-page.tsx` per this package's established
 * `<feature>-page-logic.ts` convention (`neglected-effects-page-logic.ts`,
 * `energy-drift-page-logic.ts`): formatting is directly unit-testable
 * without a DOM. Distance formatting reuses `terrain-editor-page-logic.ts`'s
 * `formatMeters` rather than duplicating an identical one-line helper.
 */

/** Renders an air density in kg/m^3 to three decimal places ("1.225 kg/m³"). */
export function formatDensity(value: number): string {
  return `${value.toFixed(3)} kg/m³`;
}

/**
 * Renders the range increase as "+<metres> m (+<percent>%)", this page's
 * headline number -- both the absolute and relative size of the effect.
 */
export function formatRangeIncrease(
  rangeIncreaseMeters: number,
  rangeIncreasePercent: number,
): string {
  const sign = rangeIncreaseMeters >= 0 ? "+" : "";
  return `${sign}${rangeIncreaseMeters.toFixed(1)} m (${sign}${rangeIncreasePercent.toFixed(1)}%)`;
}
