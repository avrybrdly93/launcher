/**
 * Launch control panel (§6.3 panel group 1; P3.19): v₀/θ/y₀/ω sliders with
 * synced numeric inputs and keyboard nudge. Composed entirely from
 * `launchSpecSchema` (P3.18's `generateControlDescriptors`) plus
 * `NumericControlRow` -- adding or re-ranging a launch field only ever
 * touches `launch-schema.ts`, never this component.
 */

import { generateControlDescriptors } from "./schema-controls.js";
import { launchSpecSchema, type LaunchSpec } from "./launch-schema.js";
import { NumericControlRow } from "./numeric-control-row.js";

export interface LaunchPanelProps {
  readonly value: LaunchSpec;
  readonly onChange: (next: LaunchSpec) => void;
}

/** Renders one {@link NumericControlRow} per `launchSpecSchema` field, each committing back a full, updated `LaunchSpec`. */
export function LaunchPanel({ value, onChange }: LaunchPanelProps) {
  const descriptors = generateControlDescriptors(launchSpecSchema, value);

  return (
    <div class="launch-panel" data-testid="launch-panel">
      {descriptors.map((descriptor) => (
        <NumericControlRow
          key={descriptor.path}
          descriptor={descriptor}
          onChange={(next) => onChange({ ...value, [descriptor.path]: next })}
        />
      ))}
    </div>
  );
}
