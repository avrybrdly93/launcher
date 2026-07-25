/**
 * One numeric control's row (§6.3 "Sliders with synced numeric inputs ...
 * keyboard nudge"; P3.19): a `<input type=range>` (slider kind only) kept
 * in sync with a `<input type=number>`, both driven by the same
 * schema-derived `ControlDescriptor` (P3.18) and both wired to the same
 * clamp/nudge logic (`numeric-control-logic.ts`) -- there is exactly one
 * place a committed value can end up out of range or a nudge step wrong,
 * shared by every field this renders, not per-field bespoke handlers.
 *
 * `unitsDisplay` (P3.37, §6.3 "units toggleable ... imperial display-only
 * conversion at the boundary") converts `descriptor`'s SI value/range/unit
 * to display units purely for rendering, and converts a committed display
 * value back to SI before it ever reaches `onChange` -- `descriptor` itself
 * (the caller's SI source of truth) is read, never written.
 */

import type { JSX } from "preact";
import type { UnitsDisplay } from "@ballista/runtime";
import { clampToRange, nudgeValue, type NumericRange } from "./numeric-control-logic.js";
import type { ControlDescriptor } from "./schema-controls.js";
import { displayUnitFor, toDisplayValue, toSIValue } from "./units-display-logic.js";

export interface NumericControlRowProps {
  readonly descriptor: ControlDescriptor;
  readonly onChange: (value: number) => void;
  /** Defaults to `"SI"` (the descriptor's own units, unconverted). */
  readonly unitsDisplay?: UnitsDisplay;
}

function toNumericRange(descriptor: ControlDescriptor): NumericRange {
  return {
    ...(descriptor.min !== undefined ? { min: descriptor.min } : {}),
    ...(descriptor.max !== undefined ? { max: descriptor.max } : {}),
    ...(descriptor.step !== undefined ? { step: descriptor.step } : {}),
  };
}

/**
 * Renders `descriptor` (expected `kind: "slider"` or `"number"`; other
 * kinds are out of this component's scope, see `schema-controls.ts`) as a
 * labeled row. Every commit -- slider drag, numeric-input edit, or
 * keyboard nudge -- clamps through {@link clampToRange} before calling
 * `onChange`, so a value can never escape the schema's own range
 * regardless of which control produced it (this task's "values clamp to
 * schema ranges" validation criterion).
 */
export function NumericControlRow({
  descriptor,
  onChange,
  unitsDisplay = "SI",
}: NumericControlRowProps) {
  const siRange = toNumericRange(descriptor);
  const range: NumericRange = {
    ...(siRange.min !== undefined
      ? { min: toDisplayValue(siRange.min, descriptor.unit, unitsDisplay) }
      : {}),
    ...(siRange.max !== undefined
      ? { max: toDisplayValue(siRange.max, descriptor.unit, unitsDisplay) }
      : {}),
    ...(siRange.step !== undefined
      ? { step: toDisplayValue(siRange.step, descriptor.unit, unitsDisplay) }
      : {}),
  };
  const siValue = typeof descriptor.value === "number" ? descriptor.value : 0;
  const value = toDisplayValue(siValue, descriptor.unit, unitsDisplay);
  const unit = displayUnitFor(descriptor.unit, unitsDisplay);
  const labelId = `control-${descriptor.path}-label`;

  function commit(next: number): void {
    if (!Number.isFinite(next)) return;
    const clampedDisplay = clampToRange(next, range);
    onChange(toSIValue(clampedDisplay, descriptor.unit, unitsDisplay));
  }

  function handleInput(event: JSX.TargetedEvent<HTMLInputElement>): void {
    commit(Number(event.currentTarget.value));
  }

  /** ArrowUp/ArrowRight nudge up, ArrowDown/ArrowLeft nudge down; shift held -> fine step (§6.3, "shift-fine works"). */
  function handleKeyDown(event: JSX.TargetedKeyboardEvent<HTMLInputElement>): void {
    const direction =
      event.key === "ArrowUp" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowDown" || event.key === "ArrowLeft"
          ? -1
          : undefined;
    if (direction === undefined) return;

    event.preventDefault();
    commit(nudgeValue(value, range, direction, event.shiftKey));
  }

  return (
    <div class="numeric-control-row" data-testid={`control-${descriptor.path}`}>
      <label id={labelId}>
        {descriptor.label}
        {unit ? ` (${unit})` : ""}
      </label>
      {descriptor.kind === "slider" && (
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          aria-labelledby={labelId}
          data-testid={`control-${descriptor.path}-slider`}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
      )}
      <input
        type="number"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-labelledby={labelId}
        data-testid={`control-${descriptor.path}-number`}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
