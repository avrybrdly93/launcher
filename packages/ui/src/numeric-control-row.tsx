/**
 * One numeric control's row (§6.3 "Sliders with synced numeric inputs ...
 * keyboard nudge"; P3.19): a `<input type=range>` (slider kind only) kept
 * in sync with a `<input type=number>`, both driven by the same
 * schema-derived `ControlDescriptor` (P3.18) and both wired to the same
 * clamp/nudge logic (`numeric-control-logic.ts`) -- there is exactly one
 * place a committed value can end up out of range or a nudge step wrong,
 * shared by every field this renders, not per-field bespoke handlers.
 */

import type { JSX } from "preact";
import { clampToRange, nudgeValue, type NumericRange } from "./numeric-control-logic.js";
import type { ControlDescriptor } from "./schema-controls.js";

export interface NumericControlRowProps {
  readonly descriptor: ControlDescriptor;
  readonly onChange: (value: number) => void;
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
export function NumericControlRow({ descriptor, onChange }: NumericControlRowProps) {
  const range = toNumericRange(descriptor);
  const value = typeof descriptor.value === "number" ? descriptor.value : 0;

  function commit(next: number): void {
    if (Number.isFinite(next)) onChange(clampToRange(next, range));
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
      <label>
        {descriptor.label}
        {descriptor.unit ? ` (${descriptor.unit})` : ""}
      </label>
      {descriptor.kind === "slider" && (
        <input
          type="range"
          min={descriptor.min}
          max={descriptor.max}
          step={descriptor.step}
          value={value}
          data-testid={`control-${descriptor.path}-slider`}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
      )}
      <input
        type="number"
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.step}
        value={value}
        data-testid={`control-${descriptor.path}-number`}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
