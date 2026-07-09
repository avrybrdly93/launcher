import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import type { ProjectileParams } from "./projectile-params.js";
import { createSphericalProjectileParams } from "./projectile-params.js";

const dragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-smooth-sphere") }),
]);

const liftCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("saturating"),
    maxCl: z.number().positive(),
    slope: z.number().positive(),
  }),
]);

/**
 * Serializable projectile data asset (§3.9): (m, R, Cd-model, CL-model,
 * tau_omega, provenance). Every asset carries a `provenance` citation for
 * its numeric data, validated at build time by the asset loader (P1.26).
 */
export const projectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  massKg: z.number().positive(),
  radiusM: z.number().positive(),
  dragCoefficient: dragCoefficientSpecSchema,
  liftCoefficient: liftCoefficientSpecSchema.optional(),
  /** Spin relaxation timescale tau_omega (§3.6): omega_dot = -omega/tau_omega. */
  spinDecayTauSeconds: z.number().positive().optional(),
  provenance: z.string().min(1),
});

export type ProjectileSpec = z.infer<typeof projectileSpecSchema>;

function buildDragCoefficient(spec: ProjectileSpec["dragCoefficient"]): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.value);
    case "tabulated-smooth-sphere":
      return new TabulatedReynoldsCd();
  }
}

function buildLiftCoefficient(
  spec: ProjectileSpec["liftCoefficient"],
): LiftCoefficientModel | undefined {
  if (!spec) return undefined;
  switch (spec.kind) {
    case "saturating":
      return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
  }
}

/** Materializes the live `ProjectileParams` (model instances) a validated `ProjectileSpec` describes. */
export function createProjectileParams(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.massKg,
    radius: spec.radiusM,
    dragCoefficient: buildDragCoefficient(spec.dragCoefficient),
    liftCoefficient: buildLiftCoefficient(spec.liftCoefficient),
  });
}
