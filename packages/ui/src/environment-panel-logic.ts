/**
 * Environment panel's non-rendering logic (§6.3 panel group 3: "gravity
 * preset, atmosphere model, wind model + its params"; P3.21). Split out from
 * the `.tsx` component for the same reason `projectile-panel-logic.ts` is:
 * the kind-swap transitions -- this task's actual validation surface ("wind
 * model swap regenerates its param controls") -- are directly unit-testable
 * without a DOM.
 *
 * `atmosphereSpecSchema`/`gravitySpecSchema`/`windSpecSchema` (P1.34,
 * `@ballista/engine`) already describe the serializable shapes; none carry
 * `.describe("Label|unit")` annotations or slider bounds (they're the wire
 * format, not a UI concern), so -- mirroring `launch-schema.ts` and
 * `projectile-panel-logic.ts`'s `customProjectileParamsSchema` -- this
 * module defines its own parallel per-kind schemas with the bounds/labels
 * `generateControlDescriptors` (P3.18) needs, kept entirely in the `ui`
 * package rather than added to the engine's wire schemas.
 */

import { z } from "zod";
import { G_STD, ISA, type AtmosphereSpec, type GravitySpec, type WindSpec } from "@ballista/engine";

// --- Gravity ---

/** Gravity body presets (§3.2: "user-adjustable for other bodies (Moon 1.62, Mars 3.71)"). */
export const GRAVITY_PRESETS = [
  { id: "earth", name: "Earth", g0: G_STD },
  { id: "moon", name: "Moon", g0: 1.62 },
  { id: "mars", name: "Mars", g0: 3.71 },
] as const;

/** The synthetic id a hand-edited (non-preset) g0 carries in the preset dropdown. */
export const CUSTOM_GRAVITY_ID = "custom";

const GRAVITY_PRESET_EPSILON = 1e-9;

/** Finds the preset whose g0 matches `g0` to within a small epsilon, or `undefined` (-> Custom) otherwise. */
export function findGravityPreset(g0: number): (typeof GRAVITY_PRESETS)[number] | undefined {
  return GRAVITY_PRESETS.find((preset) => Math.abs(preset.g0 - g0) < GRAVITY_PRESET_EPSILON);
}

/** The preset dropdown's current selection for a given g0: a matching preset's id, or Custom. */
export function gravityPresetSelection(g0: number): string {
  return findGravityPreset(g0)?.id ?? CUSTOM_GRAVITY_ID;
}

/** Schema-driven params for the always-present gravity controls (g0 slider + altitude-dependence toggle). */
export const gravityPanelSchema = z.object({
  g0: z.number().min(0.1).max(30).step(0.01).describe("Gravity g0|m/s²"),
  altitudeDependent: z.boolean().describe("Altitude-dependent g"),
});

/** `GravitySpec` field values with their engine-side defaults filled in, ready for `generateControlDescriptors`. */
export function gravityPanelValues(spec: GravitySpec): { g0: number; altitudeDependent: boolean } {
  return { g0: spec.g0 ?? G_STD, altitudeDependent: spec.altitudeDependent ?? false };
}

// --- Atmosphere ---

export const ATMOSPHERE_KINDS = [
  { id: "constant", label: "Constant (ISA sea level)" },
  { id: "exponential", label: "Exponential" },
] as const;

/** `true` iff `value` is one of `atmosphereSpecSchema`'s own `kind` literals. */
export function isAtmosphereKind(value: string): value is AtmosphereSpec["kind"] {
  return ATMOSPHERE_KINDS.some((k) => k.id === value);
}

export const exponentialAtmospherePanelSchema = z.object({
  rho0: z.number().min(0.01).max(2).step(0.001).describe("Sea-level density ρ₀|kg/m³"),
  T0: z.number().min(150).max(350).step(0.1).describe("Sea-level temperature T₀|K"),
  p0: z.number().min(1000).max(150000).step(100).describe("Sea-level pressure p₀|Pa"),
  scaleHeight: z.number().min(100).max(20000).step(10).describe("Scale height H|m"),
});

/**
 * Seeds an `AtmosphereSpec` of `kind`, its params defaulted from the same
 * ISA constants the engine's own `ExponentialAtmosphere` constructor
 * defaults to -- a no-op when `current` is already that kind.
 */
export function toAtmosphereSpec(
  kind: AtmosphereSpec["kind"],
  current: AtmosphereSpec,
): AtmosphereSpec {
  if (current.kind === kind) return current;
  switch (kind) {
    case "constant":
      return { kind: "constant" };
    case "exponential":
      return {
        kind: "exponential",
        rho0: ISA.rho0,
        T0: ISA.T0,
        p0: ISA.p0,
        scaleHeight: ISA.scaleHeight,
      };
  }
}

/** Field values for `exponentialAtmospherePanelSchema`, defaults filled in for optional fields. */
export function exponentialAtmospherePanelValues(
  spec: Extract<AtmosphereSpec, { kind: "exponential" }>,
): { rho0: number; T0: number; p0: number; scaleHeight: number } {
  return {
    rho0: spec.rho0 ?? ISA.rho0,
    T0: spec.T0 ?? ISA.T0,
    p0: spec.p0 ?? ISA.p0,
    scaleHeight: spec.scaleHeight ?? ISA.scaleHeight,
  };
}

// --- Wind ---

export const WIND_KINDS = [
  { id: "zero", label: "None" },
  { id: "uniform", label: "Uniform" },
  { id: "log-profile", label: "Log profile (boundary layer)" },
  { id: "sinusoidal-gust", label: "Sinusoidal gust" },
  { id: "gaussian-vortex", label: "Gaussian vortex" },
  { id: "gridded", label: "Gridded (imported)" },
] as const;

/** `true` iff `value` is one of `windSpecSchema`'s own `kind` literals. */
export function isWindKind(value: string): value is WindSpec["kind"] {
  return WIND_KINDS.some((k) => k.id === value);
}

export const uniformWindPanelSchema = z.object({
  wx: z.number().min(-50).max(50).step(0.1).describe("Wind speed wx|m/s"),
  wy: z.number().min(-20).max(20).step(0.1).describe("Vertical wind wy|m/s"),
});

export const logProfileWindPanelSchema = z.object({
  frictionVelocity: z.number().min(0.01).max(5).step(0.01).describe("Friction velocity u*|m/s"),
  roughnessLength: z.number().min(0.0001).max(2).step(0.0001).describe("Roughness length|m"),
  wy: z.number().min(-20).max(20).step(0.1).describe("Vertical wind wy|m/s"),
});

export const sinusoidalGustWindPanelSchema = z.object({
  mean: z.number().min(-50).max(50).step(0.1).describe("Mean wind w̄|m/s"),
  amplitude: z.number().min(0).max(50).step(0.1).describe("Gust amplitude A|m/s"),
  angularFrequency: z.number().min(0.01).max(20).step(0.01).describe("Angular frequency Ω|rad/s"),
  phase: z
    .number()
    .min(0)
    .max(2 * Math.PI)
    .step(0.01)
    .describe("Phase φ|rad"),
  wy: z.number().min(-20).max(20).step(0.1).describe("Vertical wind wy|m/s"),
});

export const gaussianVortexWindPanelSchema = z.object({
  circulation: z.number().min(-2000).max(2000).step(1).describe("Circulation Γ|m²/s"),
  coreRadius: z.number().min(0.1).max(200).step(0.1).describe("Core radius|m"),
  centerX: z.number().min(-1000).max(1000).step(1).describe("Vortex center x|m"),
  centerY: z.number().min(-1000).max(1000).step(1).describe("Vortex center y|m"),
});

/**
 * The schema-driven params schema for `kind`, or `undefined` for a kind
 * this panel renders no params for: `"zero"` (no params at all) and
 * `"gridded"` (array grid data, not slider-representable -- mirrors
 * `ProjectilePanel`'s skip of a tabulated-Reynolds drag model's coefficient,
 * see `projectile-panel-logic.ts`).
 */
export function windParamsSchemaFor(kind: WindSpec["kind"]) {
  switch (kind) {
    case "uniform":
      return uniformWindPanelSchema;
    case "log-profile":
      return logProfileWindPanelSchema;
    case "sinusoidal-gust":
      return sinusoidalGustWindPanelSchema;
    case "gaussian-vortex":
      return gaussianVortexWindPanelSchema;
    case "zero":
    case "gridded":
      return undefined;
  }
}

/** Field values for `windParamsSchemaFor(spec.kind)`, defaults filled in for optional fields; `undefined` when `spec.kind` has no editable schema. */
export function windPanelValues(spec: WindSpec): Record<string, number> | undefined {
  switch (spec.kind) {
    case "uniform":
      return { wx: spec.wx, wy: spec.wy ?? 0 };
    case "log-profile":
      return {
        frictionVelocity: spec.frictionVelocity,
        roughnessLength: spec.roughnessLength ?? 0.01,
        wy: spec.wy ?? 0,
      };
    case "sinusoidal-gust":
      return {
        mean: spec.mean,
        amplitude: spec.amplitude,
        angularFrequency: spec.angularFrequency,
        phase: spec.phase ?? 0,
        wy: spec.wy ?? 0,
      };
    case "gaussian-vortex":
      return {
        circulation: spec.circulation,
        coreRadius: spec.coreRadius,
        centerX: spec.centerX ?? 0,
        centerY: spec.centerY ?? 0,
      };
    case "zero":
    case "gridded":
      return undefined;
  }
}

/** The shared vertical-wind field carried by uniform/log-profile/sinusoidal-gust, or `undefined` for a kind without one. */
function currentWy(spec: WindSpec): number | undefined {
  switch (spec.kind) {
    case "uniform":
    case "log-profile":
    case "sinusoidal-gust":
      return spec.wy;
    default:
      return undefined;
  }
}

/** A minimal valid (flat, zero-everywhere) grid, the seed for switching into "gridded" from this panel. */
const DEFAULT_WIND_GRID = {
  x0: -10,
  y0: -10,
  dx: 20,
  dy: 20,
  nx: 2,
  ny: 2,
  wx: [0, 0, 0, 0],
  wy: [0, 0, 0, 0],
};

/**
 * Seeds a `WindSpec` of `kind`, carrying over the shared `wy` field where
 * both the old and new kind have one (uniform/log-profile/sinusoidal-gust)
 * rather than resetting it -- a no-op when `current` is already that kind.
 * This is this task's "wind model swap regenerates its param controls"
 * validation criterion: a fresh spec of the new kind means a fresh
 * `windParamsSchemaFor`/`windPanelValues` pair, so the rendered controls
 * change with it.
 */
export function toWindSpec(kind: WindSpec["kind"], current: WindSpec): WindSpec {
  if (current.kind === kind) return current;
  const wy = currentWy(current) ?? 0;
  switch (kind) {
    case "zero":
      return { kind: "zero" };
    case "uniform":
      return { kind: "uniform", wx: 5, wy };
    case "log-profile":
      return { kind: "log-profile", frictionVelocity: 0.4, roughnessLength: 0.01, wy };
    case "sinusoidal-gust":
      return { kind: "sinusoidal-gust", mean: 5, amplitude: 2, angularFrequency: 1, phase: 0, wy };
    case "gaussian-vortex":
      return { kind: "gaussian-vortex", circulation: 50, coreRadius: 5, centerX: 0, centerY: 0 };
    case "gridded":
      return { kind: "gridded", grid: DEFAULT_WIND_GRID };
  }
}
