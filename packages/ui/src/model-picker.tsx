/**
 * Model picker (P4.30 "Model registry UI: model picker (projectile
 * 2D/2D+spin/3D)"). A flat `<select>` over `MODEL_OPTIONS`
 * (`model-picker-logic.ts`) -- unlike `SolverPanel`'s grouped dropdown,
 * model ids have no sub-grouping, so a single `<optgroup>`-free `<select>`
 * is the whole component. Selecting an option commits a fresh
 * `ScenarioSpec` via `toScenarioSpecForModel`; the consumer re-resolving
 * that spec through `resolveModel` (`@ballista/runtime`) is what actually
 * regenerates `model.channels`/`dim` -- this task's validation criterion.
 */

import type { ScenarioSpec } from "@ballista/engine";
import { MODEL_OPTIONS, toScenarioSpecForModel } from "./model-picker-logic.js";

export interface ModelPickerProps {
  readonly scenario: ScenarioSpec;
  readonly onChange: (next: ScenarioSpec) => void;
}

export function ModelPicker({ scenario, onChange }: ModelPickerProps) {
  function handleModelSelect(modelId: string): void {
    if (!MODEL_OPTIONS.some((option) => option.id === modelId)) return;
    onChange(toScenarioSpecForModel(modelId, scenario));
  }

  return (
    <div class="model-picker" data-testid="model-picker">
      <select
        value={scenario.model.id}
        aria-label="Projectile model"
        data-testid="model-picker-select"
        onInput={(event) => handleModelSelect(event.currentTarget.value)}
      >
        {MODEL_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
