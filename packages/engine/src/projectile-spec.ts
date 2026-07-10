import { z } from "zod";
import { parseWithSchema } from "./schema.js";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

const dragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds") }),
]);

const liftCoefficientSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});

/**
 * `ProjectileSpec` per §3.9: (m, R, Cd-model, Cl-model, provenance), stored
 * as a serializable record rather than engine class instances so it can be
 * validated (zod) and shipped as build-time data assets (P1.26).
 */
export const projectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: dragCoefficientSpecSchema,
  liftCoefficient: liftCoefficientSpecSchema.optional(),
  /** Spin decay time constant tau_omega (§3.6), seconds. Omit if spin decay isn't modeled. */
  spinDecayTau: z.number().positive().optional(),
  /** Citation for every numeric datum above (§3.9: "every numeric datum carries a citation field"). */
  provenance: z.string().min(1),
});

export type ProjectileSpec = z.infer<typeof projectileSpecSchema>;

export function parseProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(projectileSpecSchema, data);
}

function createDragCoefficientModel(spec: ProjectileSpec["dragCoefficient"]): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.cd);
    case "tabulated-reynolds":
      return new TabulatedReynoldsCd();
  }
}

function createLiftCoefficientModel(
  spec: ProjectileSpec["liftCoefficient"],
): LiftCoefficientModel | undefined {
  if (!spec) return undefined;
  return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
}

/** Converts a validated ProjectileSpec asset into engine-ready ProjectileParams. */
export function projectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  const liftCoefficient = createLiftCoefficientModel(spec.liftCoefficient);
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: createDragCoefficientModel(spec.dragCoefficient),
    ...(liftCoefficient !== undefined ? { liftCoefficient } : {}),
  });
}
