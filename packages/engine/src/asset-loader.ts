import type { DragCoefficientModel } from "./drag-coefficient.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import type { LiftCoefficientModel } from "./lift-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import type { DragModelSpec, LiftModelSpec, ProjectileSpec } from "./projectile-spec.js";
import { projectileSpecSchema } from "./projectile-spec.js";
import type { ProjectileParams } from "./projectile-params.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { parseWithSchema } from "./schema.js";

/**
 * Parses and validates raw (e.g. JSON-sourced) data into a `ProjectileSpec`,
 * throwing a `SchemaValidationError` with a per-field message on invalid
 * input (P1.26) — the entry point for any asset not already statically
 * typed as `ProjectileSpec` in source.
 */
export function loadProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(projectileSpecSchema, data);
}

function hydrateDragModel(spec: DragModelSpec): DragCoefficientModel {
  switch (spec.type) {
    case "constant":
      return new ConstantCd(spec.cd);
    case "tabulated-reynolds":
      return new TabulatedReynoldsCd(spec.table);
  }
}

function hydrateLiftModel(spec: LiftModelSpec): LiftCoefficientModel | undefined {
  switch (spec.type) {
    case "none":
      return undefined;
    case "saturating":
      return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
  }
}

/**
 * Hydrates a validated `ProjectileSpec` into the `ProjectileParams` the
 * engine actually runs with. `spin` (rad/s) is a per-scenario runtime value
 * — not part of the static asset data (only its decay time constant,
 * `spinDecayTauSeconds`, is) — so it's supplied by the caller.
 */
export function hydrateProjectileSpec(spec: ProjectileSpec, spin?: number): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: hydrateDragModel(spec.dragModel),
    liftCoefficient: hydrateLiftModel(spec.liftModel),
    spin,
  });
}

/**
 * Validates every shipped asset against `projectileSpecSchema`. Called
 * eagerly below at module load, this is what makes a corrupt asset a
 * *build-time* failure (P1.26): the moment anything imports this module —
 * every test run, `tsc -b`, or a bundler pulling in the engine — a bad
 * asset throws immediately, rather than surfacing only when that one asset
 * happens to be selected at runtime.
 */
export function loadProjectileAssets(): Readonly<Record<string, ProjectileSpec>> {
  const validated: Record<string, ProjectileSpec> = {};
  for (const [key, spec] of Object.entries(PROJECTILE_ASSETS)) {
    validated[key] = parseWithSchema(projectileSpecSchema, spec);
  }
  return validated;
}

/** The shipped asset library, validated at module-load ("build") time. */
export const VALIDATED_PROJECTILE_ASSETS: Readonly<Record<string, ProjectileSpec>> =
  loadProjectileAssets();
