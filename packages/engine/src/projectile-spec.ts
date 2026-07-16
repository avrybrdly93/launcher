import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

export const ConstantDragCoefficientSpecSchema = z.object({
  kind: z.literal("constant"),
  value: z.number().positive(),
});

export const TabulatedReynoldsDragCoefficientSpecSchema = z.object({
  kind: z.literal("tabulated-reynolds"),
  table: z.object({
    re: z.array(z.number().positive()).min(2),
    cd: z.array(z.number().positive()).min(2),
  }),
});

export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  ConstantDragCoefficientSpecSchema,
  TabulatedReynoldsDragCoefficientSpecSchema,
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

export const SaturatingLiftCoefficientSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive(),
  slope: z.number().positive(),
});

export const LiftCoefficientSpecSchema = z.discriminatedUnion("kind", [
  SaturatingLiftCoefficientSpecSchema,
]);
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * A projectile's physical data record (§3.9): (m, R, Cd-model, Cl-model,
 * provenance). `spinDecayTau` is the tau_omega of §3.6's spin-decay ODE
 * (dOmega/dt = -omega/tau_omega); it is carried as descriptive data even
 * though no current Model consumes it yet (spin decay is a future state
 * component, §3.6). Every asset must cite where its numbers come from.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  spinDecayTau: z.number().positive().optional(), // s
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

export function createDragCoefficientModel(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.value);
    case "tabulated-reynolds":
      return new TabulatedReynoldsCd(spec.table);
  }
}

export function createLiftCoefficientModel(spec: LiftCoefficientSpec): LiftCoefficientModel {
  switch (spec.kind) {
    case "saturating":
      return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
  }
}

/** Materializes a validated ProjectileSpec into the runtime ProjectileParams the force models consume. */
export function createProjectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: createDragCoefficientModel(spec.dragCoefficient),
    liftCoefficient: spec.liftCoefficient
      ? createLiftCoefficientModel(spec.liftCoefficient)
      : undefined,
  });
}
