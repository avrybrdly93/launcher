/**
 * One boolean control's row (P3.18 declared `"checkbox"` as a
 * `ControlKind` but no renderer consumed it yet; P3.21's gravity group --
 * "altitude-dependent" -- is the first schema field that needs one).
 * Mirrors `NumericControlRow`'s "one descriptor in, one committed value
 * out" shape so a panel can render either kind uniformly off the same
 * `generateControlDescriptors` result.
 */

import type { JSX } from "preact";
import type { ControlDescriptor } from "./schema-controls.js";

export interface CheckboxControlRowProps {
  readonly descriptor: ControlDescriptor;
  readonly onChange: (value: boolean) => void;
}

/** Renders `descriptor` (expected `kind: "checkbox"`) as a labeled checkbox row. */
export function CheckboxControlRow({ descriptor, onChange }: CheckboxControlRowProps) {
  const checked = descriptor.value === true;

  function handleChange(event: JSX.TargetedEvent<HTMLInputElement>): void {
    onChange(event.currentTarget.checked);
  }

  return (
    <div class="checkbox-control-row" data-testid={`control-${descriptor.path}`}>
      <label>
        <input
          type="checkbox"
          checked={checked}
          data-testid={`control-${descriptor.path}-checkbox`}
          onChange={handleChange}
        />
        {descriptor.label}
      </label>
    </div>
  );
}
