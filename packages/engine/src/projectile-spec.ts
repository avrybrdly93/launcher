import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import type { Schema } from "./schema.js";

/** Serializable drag-model choice for a `ProjectileSpec` (§3.3/§3.9). */
export const DragModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-smooth-sphere") }),
]);
export type DragModelSpec = z.infer<typeof DragModelSpecSchema>;

/** Serializable lift-model choice (Magnus, eq. 3.16); omitted entirely disables lift/spin. */
export const LiftModelSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive(),
  slope: z.number().positive(),
});
export type LiftModelSpec = z.infer<typeof LiftModelSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): (m, R, Cd-model, CL-model, tau_omega, provenance).
 * Spherical projectiles only for now, matching every current force/model
 * implementation; area/volume are derived from radius at resolve time.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragModel: DragModelSpecSchema,
  liftModel: LiftModelSpecSchema.optional(),
  /** Spin-decay time constant tau_omega (s), sport-typical 20-30s (§3.6). Metadata only until spin decay is wired into a model. */
  spinDecayTau: z.number().positive().optional(),
  /** Citation for every numeric datum above (§3.9: "every numeric datum carries a citation field"). */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

export const projectileSpecSchema: Schema<ProjectileSpec> = ProjectileSpecSchema;

/** Realizes a validated `ProjectileSpec` into the runtime `ProjectileParams` forces/models consume. */
export function resolveProjectileSpec(spec: ProjectileSpec, spin?: number): ProjectileParams {
  const dragCoefficient =
    spec.dragModel.kind === "constant"
      ? new ConstantCd(spec.dragModel.cd)
      : new TabulatedReynoldsCd();
  const liftCoefficient = spec.liftModel
    ? new SaturatingLiftCoefficient(spec.liftModel.maxCl, spec.liftModel.slope)
    : undefined;

  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient,
    liftCoefficient,
    spin,
  });
}
