/**
 * Display-boundary unit conversion (§6.3 "units toggleable ... imperial
 * display-only conversion at the boundary — internal state never leaves
 * SI"; P3.37). Every schema field's SI unit and value (`ControlDescriptor`,
 * P3.18) stays exactly as `schema-controls.ts` derived it; this module only
 * computes what a renderer should *show* and how to translate a user's
 * typed/dragged display-space number back to SI before it re-enters the
 * app as a committed value. No caller of these functions ever mutates a
 * descriptor or a store -- that is what makes "internal state unchanged
 * when toggling" (this task's validation criterion) true by construction:
 * there is no code path from flipping `unitsDisplay` to a scenario mutation.
 *
 * Every conversion here is a pure scale factor (no additive offset, unlike
 * e.g. Kelvin<->Fahrenheit), so the same factor is valid for both absolute
 * values and deltas -- which is what lets `toDisplayValue` also be used to
 * convert a schema range's `step` (a delta, not a position) below.
 */

import { ftToM, kgToLb, lbToKg, mphToMs, msToMph, mToFt } from "@ballista/engine";
import type { UnitsDisplay } from "@ballista/runtime";

interface UnitConversion {
  readonly displayUnit: string;
  readonly toDisplay: (si: number) => number;
  readonly toSI: (display: number) => number;
}

/** The only SI units this v1 converter knows an imperial equivalent for; every other unit (deg, rad/s, kg/m^3, Pa, K, ...) passes through unconverted in both display modes. */
const IMPERIAL_CONVERSIONS: Readonly<Record<string, UnitConversion>> = {
  m: { displayUnit: "ft", toDisplay: mToFt, toSI: ftToM },
  "m/s": { displayUnit: "mph", toDisplay: msToMph, toSI: mphToMs },
  kg: { displayUnit: "lb", toDisplay: kgToLb, toSI: lbToKg },
};

/** The unit label to render for `siUnit` under `unitsDisplay` -- unchanged in `"SI"` mode or when `siUnit` has no known imperial equivalent. */
export function displayUnitFor(
  siUnit: string | undefined,
  unitsDisplay: UnitsDisplay,
): string | undefined {
  if (unitsDisplay !== "imperial" || siUnit === undefined) return siUnit;
  return IMPERIAL_CONVERSIONS[siUnit]?.displayUnit ?? siUnit;
}

/** `siValue` (or a delta in the same unit, e.g. a range's `step`) converted for display under `unitsDisplay`. */
export function toDisplayValue(
  siValue: number,
  siUnit: string | undefined,
  unitsDisplay: UnitsDisplay,
): number {
  if (unitsDisplay !== "imperial" || siUnit === undefined) return siValue;
  return IMPERIAL_CONVERSIONS[siUnit]?.toDisplay(siValue) ?? siValue;
}

/** The inverse of {@link toDisplayValue}: a value the user entered/dragged in display units, converted back to SI for `onChange`. */
export function toSIValue(
  displayValue: number,
  siUnit: string | undefined,
  unitsDisplay: UnitsDisplay,
): number {
  if (unitsDisplay !== "imperial" || siUnit === undefined) return displayValue;
  return IMPERIAL_CONVERSIONS[siUnit]?.toSI(displayValue) ?? displayValue;
}
