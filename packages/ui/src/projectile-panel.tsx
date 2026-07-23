/**
 * Projectile panel (§6.3 panel group 2: "preset dropdown + custom
 * mass/radius/C_d model"; P3.20). Selecting a catalog preset swaps in that
 * preset's full `ProjectileSpec` wholesale; selecting "Custom" (or already
 * being on one, e.g. after a prior edit) reveals schema-driven controls for
 * mass/radius/(constant) drag coefficient (P3.18's `generateControlDescriptors`),
 * each edit producing a fresh custom spec via `onChange` -- exactly the
 * same "commit a new spec" contract `LaunchPanel` uses, so a caller wiring
 * this to a `SimulationSession` (`updateDraft`, §5.3) re-solves on every
 * preset switch and keeps every custom edit in the draft between commits,
 * without this component needing to know that store exists.
 */

import type { ProjectileSpec } from "@ballista/engine";
import { PROJECTILE_ASSETS } from "@ballista/engine";
import { NumericControlRow } from "./numeric-control-row.js";
import {
  CUSTOM_PROJECTILE_ID,
  customDragCoefficientSchema,
  customProjectileParamsSchema,
  findProjectilePreset,
  hasEditableDragCoefficient,
  toCustomProjectileSpec,
} from "./projectile-panel-logic.js";
import { generateControlDescriptors } from "./schema-controls.js";

export interface ProjectilePanelProps {
  readonly projectile: ProjectileSpec;
  readonly onChange: (next: ProjectileSpec) => void;
}

export function ProjectilePanel({ projectile, onChange }: ProjectilePanelProps) {
  const isCustom = projectile.id === CUSTOM_PROJECTILE_ID;

  function handlePresetSelect(id: string): void {
    if (id === CUSTOM_PROJECTILE_ID) {
      onChange(toCustomProjectileSpec(projectile));
      return;
    }
    const preset = findProjectilePreset(id);
    if (preset) onChange(preset);
  }

  const paramDescriptors = isCustom
    ? generateControlDescriptors(customProjectileParamsSchema, projectile)
    : [];
  const dragDescriptors =
    isCustom && hasEditableDragCoefficient(projectile.dragModel)
      ? generateControlDescriptors(customDragCoefficientSchema, {
          dragCoefficient: projectile.dragModel.cd,
        })
      : [];

  return (
    <div class="projectile-panel" data-testid="projectile-panel">
      <select
        value={projectile.id}
        data-testid="projectile-preset-select"
        onInput={(event) => handlePresetSelect(event.currentTarget.value)}
      >
        {PROJECTILE_ASSETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
        <option value={CUSTOM_PROJECTILE_ID}>Custom</option>
      </select>

      {paramDescriptors.map((descriptor) => (
        <NumericControlRow
          key={descriptor.path}
          descriptor={descriptor}
          onChange={(next) => onChange({ ...projectile, [descriptor.path]: next })}
        />
      ))}

      {dragDescriptors.map((descriptor) => (
        <NumericControlRow
          key={descriptor.path}
          descriptor={descriptor}
          onChange={(next) =>
            onChange({ ...projectile, dragModel: { kind: "constant", cd: next } })
          }
        />
      ))}
    </div>
  );
}
