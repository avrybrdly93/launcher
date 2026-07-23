/**
 * Pure numeric-control behavior shared by every slider/number `ControlDescriptor`
 * (P3.19, §6.3 "Sliders with synced numeric inputs; ... keyboard nudge (±1
 * step, shift = fine)"): clamping to the descriptor's own schema-derived
 * range, and computing one keyboard nudge's step. Kept independent of any
 * rendered component (mirrors `schema-controls.ts`'s framework-agnostic
 * split) so "clamps to schema ranges" and "shift-fine works" -- this task's
 * literal validation criteria -- are exercised directly, without needing a
 * DOM.
 */

/** The subset of a `ControlDescriptor` this module needs -- just the schema-derived bounds, not its label/kind/value. */
export interface NumericRange {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

/** A step of exactly `1` when a field declares no `.step()`/`.multipleOf()` of its own. */
const DEFAULT_STEP = 1;

/** Shift-held ("fine") nudges move a tenth of the normal step (§6.3). */
const FINE_STEP_DIVISOR = 10;

/** Clamps `value` into `[range.min, range.max]`; a missing bound leaves that side unclamped. */
export function clampToRange(value: number, range: NumericRange): number {
  let clamped = value;
  if (range.min !== undefined && clamped < range.min) clamped = range.min;
  if (range.max !== undefined && clamped > range.max) clamped = range.max;
  return clamped;
}

/**
 * The effective step size for one keyboard nudge: `range.step` (default
 * {@link DEFAULT_STEP}), divided by {@link FINE_STEP_DIVISOR} when `fine`
 * (shift held) -- §6.3's "±1 step, shift = fine".
 */
export function nudgeStep(range: NumericRange, fine: boolean): number {
  const base = range.step ?? DEFAULT_STEP;
  return fine ? base / FINE_STEP_DIVISOR : base;
}

/**
 * `value` moved by one keyboard nudge (`direction` +1 for up/right, -1 for
 * down/left) at `fine`'s step size, clamped back into `range` -- so a nudge
 * can never push a control's value out of its schema-declared bounds, even
 * repeated at the range edge.
 */
export function nudgeValue(
  value: number,
  range: NumericRange,
  direction: 1 | -1,
  fine: boolean,
): number {
  return clampToRange(value + direction * nudgeStep(range, fine), range);
}
