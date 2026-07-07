import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

/**
 * Serializable description of a drag-coefficient model (§5.2: specs store
 * `(kind, ...params)`, not live class instances, so they survive
 * JSON round-trips). `createProjectileParamsFromSpec` is what turns this
 * back into a real `DragCoefficientModel`.
 */
export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds-smooth-sphere") }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Serializable description of a lift-coefficient model (only one implementation exists so far). */
export const LiftCoefficientSpecSchema = z.object({ kind: z.literal("saturating") });
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * Static projectile data (§3.9): `(m, R, Cd-model, CL-model, tau_omega,
 * provenance)`. `provenance` is mandatory — every numeric datum in the asset
 * library must cite its source (P1.25 validation criterion).
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** Spin-decay time constant, tau_omega (s) — not yet wired into spin dynamics (no decay model exists yet); carried as data for when it is. */
  spinDecayTimeConstant: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/** Instantiates the live `ProjectileParams` (with real model objects) a `ProjectileSpec` describes. */
export function createProjectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  const dragCoefficient =
    spec.dragCoefficient.kind === "constant"
      ? new ConstantCd(spec.dragCoefficient.value)
      : new TabulatedReynoldsCd();
  const liftCoefficient = spec.liftCoefficient ? new SaturatingLiftCoefficient() : undefined;
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient,
    ...(liftCoefficient ? { liftCoefficient } : {}),
  });
}
