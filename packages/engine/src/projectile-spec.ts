import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { parseWithSchema } from "./schema.js";

/**
 * How a data asset names its drag model (§3.3). "constant" is a single
 * literature Cd figure; "tabulated-reynolds-smooth-sphere" defers to the
 * engine's built-in smooth-sphere Cd(Re) curve (`SMOOTH_SPHERE_CD_TABLE`)
 * rather than duplicating it per asset. Sport-specific Cd(Re)/Cd(M) tables
 * with their own provenance arrive in Phase 4 (P4.04/P4.05).
 */
const dragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds-smooth-sphere") }),
]);
export type DragCoefficientSpec = z.infer<typeof dragCoefficientSpecSchema>;

/**
 * A physical projectile data asset (§3.9): $(m, R, C_d\text{-model},
 * \tau_\omega, \text{provenance})$. Every numeric datum's source is recorded
 * in `provenance` so plausibility can be audited independently of code
 * correctness (§8's V&V distinction). Lift-coefficient data and spin decay
 * are wired per-sport starting in Phase 4 (P4.05-P4.07); this initial pass
 * covers mass, radius, and drag only.
 */
export const projectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: dragCoefficientSpecSchema,
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof projectileSpecSchema>;

function createDragCoefficientModel(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.value);
    case "tabulated-reynolds-smooth-sphere":
      return new TabulatedReynoldsCd();
  }
}

/** Resolves a validated data asset into the engine's runtime `ProjectileParams` (§3.9 -> §3.7 rhs input). */
export function resolveProjectileSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: createDragCoefficientModel(spec.dragCoefficient),
  });
}

/** Parses and validates a `ProjectileSpec` data asset, throwing `SchemaValidationError` on failure. */
export function parseProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(projectileSpecSchema, data);
}
