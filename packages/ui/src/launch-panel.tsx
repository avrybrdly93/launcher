/**
 * Launch control panel (§6.3 panel group 1; P3.19): v₀/θ/y₀/ω sliders with
 * synced numeric inputs and keyboard nudge. Composed entirely from
 * `launchSpecSchema` (P3.18's `generateControlDescriptors`) plus
 * `NumericControlRow` -- adding or re-ranging a launch field only ever
 * touches `launch-schema.ts`, never this component.
 *
 * `unitsDisplay` (P3.37) forwards straight through to every row; this panel
 * never touches a value itself, so it stays SI-only end to end regardless
 * of what the user sees.
 */

import type { UnitsDisplay } from "@ballista/runtime";
import { generateControlDescriptors } from "./schema-controls.js";
import { launchSpecSchema, type LaunchSpec } from "./launch-schema.js";
import { NumericControlRow } from "./numeric-control-row.js";

export interface LaunchPanelProps {
  readonly value: LaunchSpec;
  readonly onChange: (next: LaunchSpec) => void;
  readonly unitsDisplay?: UnitsDisplay;
}

/** Renders one {@link NumericControlRow} per `launchSpecSchema` field, each committing back a full, updated `LaunchSpec`. */
export function LaunchPanel({ value, onChange, unitsDisplay }: LaunchPanelProps) {
  const descriptors = generateControlDescriptors(launchSpecSchema, value);

  return (
    <div class="launch-panel" data-testid="launch-panel">
      {descriptors.map((descriptor) => (
        <NumericControlRow
          key={descriptor.path}
          descriptor={descriptor}
          {...(unitsDisplay !== undefined ? { unitsDisplay } : {})}
          onChange={(next) => onChange({ ...value, [descriptor.path]: next })}
        />
      ))}
    </div>
  );
}
