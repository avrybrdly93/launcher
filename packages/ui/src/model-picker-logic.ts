/**
 * Model picker's non-rendering logic (P4.30 "Model registry UI: model
 * picker (projectile 2D/2D+spin/3D)"). Split out from the `.tsx` component
 * for the same reason `solver-panel-logic.ts`/`forces-panel-logic.ts` are:
 * the model-swap transition -- this task's validation surface ("switching
 * model regenerates channels/controls") -- is directly unit-testable
 * without a DOM.
 */

import { KNOWN_MODEL_IDS } from "@ballista/runtime";
import type { ScenarioSpec } from "@ballista/engine";

/** Human label per model id, in `KNOWN_MODEL_IDS`'s own registration order (the picker's option order). */
export const MODEL_LABELS: Readonly<Record<string, string>> = {
  "planar-projectile": "2D (planar)",
  "planar-projectile-spin": "2D + spin",
  "spatial-projectile": "3D (spatial)",
};

/**
 * `KNOWN_MODEL_IDS` paired with its label -- a test failure here (rather
 * than the picker silently rendering a blank option) is the signal that a
 * model was added to `scenario-resolver.ts`'s registry without a matching
 * picker label.
 */
export const MODEL_OPTIONS: readonly { readonly id: string; readonly label: string }[] =
  KNOWN_MODEL_IDS.map((id) => ({ id, label: MODEL_LABELS[id] ?? id }));

/**
 * Seeds a `ScenarioSpec` for `modelId`: swaps only `.model.id`, keeping
 * `forceIds`/`initialConditions`/everything else unchanged. `resolveModel`
 * (`@ballista/runtime`) is what actually regenerates the model's
 * `channels`/`dim` from the new id (seeding any state the current
 * `initialConditions` doesn't carry -- e.g. z0/vz0 for `spatial-projectile`
 * -- at a documented default; see its own doc comment) -- this function's
 * job is only to produce the spec that triggers that, mirroring
 * `toSolverConfigForStepper`'s "produce the next spec, let the resolver do
 * the rest" split.
 */
export function toScenarioSpecForModel(modelId: string, current: ScenarioSpec): ScenarioSpec {
  return { ...current, model: { ...current.model, id: modelId } };
}
