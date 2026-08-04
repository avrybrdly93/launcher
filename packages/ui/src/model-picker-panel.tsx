/**
 * Model-picker panel (P4.30 "Model registry UI: model picker (projectile
 * 2D/2D+spin/3D)"). A `<select>` over `MODEL_KIND_OPTIONS` -- picking a
 * different kind seeds a fresh `{ model, initialConditions }` pair
 * (`applyModelKind`), which regenerates both the channel-list readout below
 * it (`channelsForModelKind`) and that kind's own schema-driven params
 * controls (`modelParamsSchemaFor`/`modelPanelValues` +
 * `generateControlDescriptors`, the same "kind swap regenerates its param
 * controls" shape `EnvironmentPanel`'s atmosphere/wind groups already
 * establish) -- this task's "switching model regenerates channels/controls"
 * validation criterion.
 */

import type { InitialConditions, ModelSpec } from "@ballista/engine";
import type { UnitsDisplay } from "@ballista/runtime";
import {
  applyModelKind,
  channelsForModelKind,
  isModelKind,
  MODEL_KIND_OPTIONS,
  modelKindOf,
  modelPanelValues,
  modelParamsSchemaFor,
} from "./model-picker-logic.js";
import { NumericControlRow } from "./numeric-control-row.js";
import { generateControlDescriptors, type ControlDescriptor } from "./schema-controls.js";

export interface ModelPickerPanelProps {
  readonly model: ModelSpec;
  readonly initialConditions: InitialConditions;
  readonly onChange: (next: {
    readonly model: ModelSpec;
    readonly initialConditions: InitialConditions;
  }) => void;
  readonly unitsDisplay?: UnitsDisplay;
}

export function ModelPickerPanel({
  model,
  initialConditions,
  onChange,
  unitsDisplay,
}: ModelPickerPanelProps) {
  const kind = modelKindOf(model);

  function handleKindSelect(value: string): void {
    if (!isModelKind(value)) return;
    onChange(applyModelKind(value, model, initialConditions));
  }

  function handleParamFieldChange(descriptor: ControlDescriptor, next: number): void {
    if (kind === "planar-spin") {
      onChange({ model: { ...model, tauOmega: next }, initialConditions });
    } else if (kind === "spatial") {
      onChange({
        model,
        initialConditions: { ...initialConditions, [descriptor.path]: next },
      });
    }
  }

  const channels = channelsForModelKind(kind);
  const paramsSchema = modelParamsSchemaFor(kind);
  const paramsValues = modelPanelValues(kind, model, initialConditions);
  const paramsDescriptors =
    paramsSchema && paramsValues ? generateControlDescriptors(paramsSchema, paramsValues) : [];

  return (
    <div class="model-picker-panel" data-testid="model-picker-panel">
      <select
        value={kind}
        aria-label="Physics model"
        data-testid="model-kind-select"
        onInput={(event) => handleKindSelect(event.currentTarget.value)}
      >
        {MODEL_KIND_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>

      <ul class="model-picker-panel-channels" data-testid="model-picker-channels">
        {channels.map((channel) => (
          <li key={channel.name} data-testid={`model-picker-channel-${channel.name}`}>
            {channel.name} <span class="model-picker-channel-unit">({channel.unit})</span>
          </li>
        ))}
      </ul>

      {paramsDescriptors.map((descriptor) => (
        <NumericControlRow
          key={descriptor.path}
          descriptor={descriptor}
          {...(unitsDisplay !== undefined ? { unitsDisplay } : {})}
          onChange={(next) => handleParamFieldChange(descriptor, next)}
        />
      ))}
    </div>
  );
}
