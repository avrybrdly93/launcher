/**
 * Model-picker panel's non-rendering logic (§6.3-style panel logic split;
 * P4.30 "model registry UI: model picker"). Split out from the `.tsx`
 * component for the same reason `forces-panel-logic.ts`/
 * `environment-panel-logic.ts` are: the kind-swap transition -- this task's
 * actual validation surface ("switching model regenerates
 * channels/controls") -- is directly unit-testable without a DOM.
 *
 * `modelSpecSchema` (`@ballista/engine`) already carries the wire-format
 * `kind` discriminator and its extra per-kind params (`tauOmega`); this
 * module pairs that with human labels and the schema-driven params panels
 * `generateControlDescriptors` needs, mirroring
 * `environment-panel-logic.ts`'s `ATMOSPHERE_KINDS`/`WIND_KINDS` +
 * `toAtmosphereSpec`/`toWindSpec` shape exactly, just for `model.kind`
 * instead of `atmosphere.kind`/`wind.kind`.
 */

import { z } from "zod";
import {
  PLANAR_CHANNELS,
  PLANAR_SPIN_CHANNELS,
  SPATIAL_CHANNELS,
  type ChannelMeta,
  type InitialConditions,
  type ModelSpec,
} from "@ballista/engine";
import { DEFAULT_TAU_OMEGA } from "@ballista/runtime";

/** The three P4.30-registered model kinds, in the order this panel lists them (2D -> 2D+spin -> 3D, increasing state dimension). */
export const MODEL_KIND_OPTIONS = [
  { id: "planar", label: "Planar (2D)" },
  { id: "planar-spin", label: "Planar + spin decay (2D)" },
  { id: "spatial", label: "Spatial (3D)" },
] as const;

/** A P4.30-registered model kind -- the non-`undefined` half of `ModelSpec["kind"]`. */
export type ModelKind = (typeof MODEL_KIND_OPTIONS)[number]["id"];

/** `true` iff `value` is one of `MODEL_KIND_OPTIONS`'s own ids (mirrors `isAtmosphereKind`/`isWindKind`). */
export function isModelKind(value: string): value is ModelKind {
  return MODEL_KIND_OPTIONS.some((option) => option.id === value);
}

/** `model`'s active kind, defaulting to `"planar"` the same way `resolveModel` (`@ballista/runtime`) does when `kind` is omitted -- every pre-P4.30 `ModelSpec` (every `PRESET_SCENARIOS` entry). */
export function modelKindOf(model: ModelSpec): ModelKind {
  return model.kind ?? "planar";
}

/**
 * `kind`'s channel metadata, read straight off the engine's own per-model
 * exported constant -- literally the same array reference each
 * `create*ProjectileModel` sets as its `Model.channels` (verified in
 * `scenario-resolver.test.ts`'s `resolveModel` tests via `toBe`), not a
 * UI-side re-derivation that could drift from the real model. This is what
 * makes "switching model regenerates channels" (this task's validation
 * criterion) true by construction: a new `kind` selection looks up a
 * different constant here.
 */
export function channelsForModelKind(kind: ModelKind): readonly ChannelMeta[] {
  switch (kind) {
    case "planar":
      return PLANAR_CHANNELS;
    case "planar-spin":
      return PLANAR_SPIN_CHANNELS;
    case "spatial":
      return SPATIAL_CHANNELS;
  }
}

/** Schema-driven params for the `"planar-spin"` kind's one extra control. */
export const tauOmegaPanelSchema = z.object({
  tauOmega: z.number().min(0.1).max(200).step(0.1).describe("Spin decay time τω|s"),
});

/** Schema-driven params for the `"spatial"` kind's extra (lateral) initial-condition controls. */
export const spatialInitialConditionsPanelSchema = z.object({
  z0: z.number().min(-1000).max(1000).step(0.1).describe("Lateral launch position z0|m"),
  vz0: z.number().min(-200).max(200).step(0.1).describe("Lateral launch velocity vz0|m/s"),
});

/**
 * The schema-driven params schema for `kind`'s own extra controls, or
 * `undefined` for `"planar"` (no extra controls beyond the existing
 * Forces/Environment/Projectile panels -- mirrors `windParamsSchemaFor`'s
 * `"zero"` case).
 */
export function modelParamsSchemaFor(kind: ModelKind) {
  switch (kind) {
    case "planar":
      return undefined;
    case "planar-spin":
      return tauOmegaPanelSchema;
    case "spatial":
      return spatialInitialConditionsPanelSchema;
  }
}

/**
 * Field values for `modelParamsSchemaFor(kind)`, defaults filled in;
 * `undefined` when `kind` has no editable schema (`"planar"`).
 */
export function modelPanelValues(
  kind: ModelKind,
  model: ModelSpec,
  initialConditions: InitialConditions,
): Record<string, number> | undefined {
  switch (kind) {
    case "planar":
      return undefined;
    case "planar-spin":
      return { tauOmega: model.tauOmega ?? DEFAULT_TAU_OMEGA };
    case "spatial":
      return { z0: initialConditions.z0 ?? 0, vz0: initialConditions.vz0 ?? 0 };
  }
}

/** `model` with `kind`/`tauOmega` replaced but `id`/`forceIds` (and any other field) carried over unchanged. */
function withKind(model: ModelSpec, kind: ModelKind, tauOmega?: number): ModelSpec {
  return {
    id: model.id,
    forceIds: model.forceIds,
    kind,
    ...(tauOmega !== undefined && { tauOmega }),
  };
}

/**
 * Seeds a fresh `{ model, initialConditions }` pair for switching to
 * `kind` -- a no-op when `model` is already that kind. Mirrors
 * `environment-panel-logic.ts`'s `toWindSpec`: a fresh kind means fresh
 * kind-specific params (`tauOmega` for `"planar-spin"`, `z0`/`vz0` for
 * `"spatial"`, both dropped when switching away from their owning kind --
 * `withKind` never carries a stale `tauOmega` into a non-spin kind), so
 * `modelParamsSchemaFor`/`modelPanelValues` regenerating for the new kind
 * is this task's "switching model regenerates ... controls" validation
 * criterion; `channelsForModelKind` regenerating alongside it (driven by
 * the same `kind`) is the "... regenerates channels" half.
 */
export function applyModelKind(
  kind: ModelKind,
  model: ModelSpec,
  initialConditions: InitialConditions,
): { readonly model: ModelSpec; readonly initialConditions: InitialConditions } {
  if (modelKindOf(model) === kind) return { model, initialConditions };
  switch (kind) {
    case "planar":
      return { model: withKind(model, kind), initialConditions };
    case "planar-spin":
      return {
        model: withKind(model, kind, model.tauOmega ?? DEFAULT_TAU_OMEGA),
        initialConditions,
      };
    case "spatial":
      return {
        model: withKind(model, kind),
        initialConditions: {
          ...initialConditions,
          z0: initialConditions.z0 ?? 0,
          vz0: initialConditions.vz0 ?? 0,
        },
      };
  }
}
