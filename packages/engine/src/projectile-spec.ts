import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

/** Serializable description of a `DragCoefficientModel` (§3.3, §3.9). */
export const dragModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
  z.object({
    kind: z.literal("tabulated-reynolds"),
    table: z.object({
      re: z.array(z.number().positive()).min(2),
      cd: z.array(z.number().positive()).min(2),
    }),
  }),
]);
/** Parsed type of {@link dragModelSpecSchema}. */
export type DragModelSpec = z.infer<typeof dragModelSpecSchema>;

/** Serializable description of a `LiftCoefficientModel` (§3.6, §3.9). */
export const liftModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("saturating"),
    maxCl: z.number().positive(),
    slope: z.number().positive(),
  }),
]);
/** Parsed type of {@link liftModelSpecSchema}. */
export type LiftModelSpec = z.infer<typeof liftModelSpecSchema>;

/**
 * Data-asset description of a projectile (§3.9): mass, radius, drag/lift
 * models, optional spin-decay time constant tau_omega (§3.6, wired by
 * P4.07), and a provenance citation for the numeric data. Distinct from the
 * runtime `ProjectileParams` (which holds live model instances) so that
 * assets can be stored as plain JSON and schema-validated (P1.26).
 */
export const projectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragModel: dragModelSpecSchema,
  liftModel: liftModelSpecSchema.optional(),
  /** Spin-decay time constant tau_omega, s (§3.6). Unused until P4.07 wires spin-decay dynamics. */
  spinDecayTime: z.number().positive().optional(),
  provenance: z.string().min(1),
});
/** Parsed type of {@link projectileSpecSchema}. */
export type ProjectileSpec = z.infer<typeof projectileSpecSchema>;

function toDragCoefficientModel(spec: DragModelSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.cd);
    case "tabulated-reynolds":
      return new TabulatedReynoldsCd(spec.table);
  }
}

function toLiftCoefficientModel(spec: LiftModelSpec | undefined): LiftCoefficientModel | undefined {
  if (spec === undefined || spec.kind === "none") return undefined;
  return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
}

/** Instantiates the runtime `ProjectileParams` (live model instances) described by a `ProjectileSpec` asset. */
export function projectileSpecToParams(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: toDragCoefficientModel(spec.dragModel),
    liftCoefficient: toLiftCoefficientModel(spec.liftModel),
  });
}
