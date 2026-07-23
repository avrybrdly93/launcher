/**
 * Environment panel (§6.3 panel group 3: "gravity preset, atmosphere model,
 * wind model + its params"; P3.21). Three independent sub-groups -- gravity,
 * atmosphere, wind -- each following the same "hand-rolled kind `<select>` +
 * schema-driven param controls for the selected kind" shape `ProjectilePanel`
 * established for its preset dropdown (P3.20): selecting a different
 * atmosphere or wind model kind swaps in that kind's own freshly-seeded
 * spec (`environment-panel-logic.ts`), which regenerates a fresh set of
 * `generateControlDescriptors` for its own params -- this task's "wind
 * model swap regenerates its param controls" validation criterion.
 */

import type { AtmosphereSpec, EnvironmentSpec, WindSpec } from "@ballista/engine";
import { CheckboxControlRow } from "./checkbox-control-row.js";
import {
  ATMOSPHERE_KINDS,
  CUSTOM_GRAVITY_ID,
  exponentialAtmospherePanelSchema,
  exponentialAtmospherePanelValues,
  GRAVITY_PRESETS,
  gravityPanelSchema,
  gravityPanelValues,
  gravityPresetSelection,
  isAtmosphereKind,
  isWindKind,
  toAtmosphereSpec,
  toWindSpec,
  WIND_KINDS,
  windPanelValues,
  windParamsSchemaFor,
} from "./environment-panel-logic.js";
import { NumericControlRow } from "./numeric-control-row.js";
import { generateControlDescriptors, type ControlDescriptor } from "./schema-controls.js";

export interface EnvironmentPanelProps {
  readonly environment: EnvironmentSpec;
  readonly onChange: (next: EnvironmentSpec) => void;
}

export function EnvironmentPanel({ environment, onChange }: EnvironmentPanelProps) {
  const { gravity, atmosphere, wind } = environment;

  function handleGravityPresetSelect(id: string): void {
    if (id === CUSTOM_GRAVITY_ID) return;
    const preset = GRAVITY_PRESETS.find((p) => p.id === id);
    if (preset) onChange({ ...environment, gravity: { ...gravity, g0: preset.g0 } });
  }

  function handleGravityFieldChange(descriptor: ControlDescriptor, next: number | boolean): void {
    onChange({ ...environment, gravity: { ...gravity, [descriptor.path]: next } });
  }

  function handleAtmosphereKindSelect(kind: string): void {
    if (!isAtmosphereKind(kind)) return;
    onChange({ ...environment, atmosphere: toAtmosphereSpec(kind, atmosphere) });
  }

  function handleAtmosphereFieldChange(descriptor: ControlDescriptor, next: number): void {
    onChange({
      ...environment,
      atmosphere: { ...atmosphere, [descriptor.path]: next } as AtmosphereSpec,
    });
  }

  function handleWindKindSelect(kind: string): void {
    if (!isWindKind(kind)) return;
    onChange({ ...environment, wind: toWindSpec(kind, wind) });
  }

  function handleWindFieldChange(descriptor: ControlDescriptor, next: number): void {
    onChange({ ...environment, wind: { ...wind, [descriptor.path]: next } as WindSpec });
  }

  const gravityValues = gravityPanelValues(gravity);
  const gravityDescriptors = generateControlDescriptors(gravityPanelSchema, gravityValues);
  const gravitySelection = gravityPresetSelection(gravityValues.g0);

  const atmosphereParamsSchema =
    atmosphere.kind === "exponential" ? exponentialAtmospherePanelSchema : undefined;
  const atmosphereDescriptors = atmosphereParamsSchema
    ? generateControlDescriptors(
        atmosphereParamsSchema,
        exponentialAtmospherePanelValues(
          atmosphere as Extract<AtmosphereSpec, { kind: "exponential" }>,
        ),
      )
    : [];

  const windParamsSchema = windParamsSchemaFor(wind.kind);
  const windValues = windPanelValues(wind);
  const windDescriptors =
    windParamsSchema && windValues ? generateControlDescriptors(windParamsSchema, windValues) : [];

  return (
    <div class="environment-panel" data-testid="environment-panel">
      <div class="environment-panel-gravity" data-testid="environment-panel-gravity">
        <select
          value={gravitySelection}
          data-testid="gravity-preset-select"
          onInput={(event) => handleGravityPresetSelect(event.currentTarget.value)}
        >
          {GRAVITY_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
          <option value={CUSTOM_GRAVITY_ID}>Custom</option>
        </select>

        {gravityDescriptors.map((descriptor) =>
          descriptor.kind === "checkbox" ? (
            <CheckboxControlRow
              key={descriptor.path}
              descriptor={descriptor}
              onChange={(next) => handleGravityFieldChange(descriptor, next)}
            />
          ) : (
            <NumericControlRow
              key={descriptor.path}
              descriptor={descriptor}
              onChange={(next) => handleGravityFieldChange(descriptor, next)}
            />
          ),
        )}
      </div>

      <div class="environment-panel-atmosphere" data-testid="environment-panel-atmosphere">
        <select
          value={atmosphere.kind}
          data-testid="atmosphere-kind-select"
          onInput={(event) => handleAtmosphereKindSelect(event.currentTarget.value)}
        >
          {ATMOSPHERE_KINDS.map((kind) => (
            <option key={kind.id} value={kind.id}>
              {kind.label}
            </option>
          ))}
        </select>

        {atmosphereDescriptors.map((descriptor) => (
          <NumericControlRow
            key={descriptor.path}
            descriptor={descriptor}
            onChange={(next) => handleAtmosphereFieldChange(descriptor, next)}
          />
        ))}
      </div>

      <div class="environment-panel-wind" data-testid="environment-panel-wind">
        <select
          value={wind.kind}
          data-testid="wind-kind-select"
          onInput={(event) => handleWindKindSelect(event.currentTarget.value)}
        >
          {WIND_KINDS.map((kind) => (
            <option key={kind.id} value={kind.id}>
              {kind.label}
            </option>
          ))}
        </select>

        {windDescriptors.map((descriptor) => (
          <NumericControlRow
            key={descriptor.path}
            descriptor={descriptor}
            onChange={(next) => handleWindFieldChange(descriptor, next)}
          />
        ))}
      </div>
    </div>
  );
}
