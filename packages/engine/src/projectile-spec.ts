import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { parseWithSchema } from "./schema.js";

const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({
    kind: z.literal("tabulated-reynolds"),
    table: z
      .object({
        re: z.array(z.number().positive()).min(2),
        cd: z.array(z.number().positive()).min(2),
      })
      .optional(),
  }),
]);

const LiftCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("saturating"),
    maxCl: z.number().positive().optional(),
    slope: z.number().positive().optional(),
  }),
]);

/**
 * Declarative, serializable projectile record (§3.9): (m, R, Cd-model,
 * CL-model, spin-decay tau, provenance). This is the asset/JSON-facing
 * shape; `projectileParamsFromSpec` converts a validated instance into the
 * live `ProjectileParams` the engine actually integrates with.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** Spin decay time constant, s (§3.6 eq. dω/dt=-ω/tau); recorded as asset
   * data but not yet consumed — spin decay adds a 5th state channel not
   * present in the current dim-4 planar model. */
  spinDecayTau: z.number().positive().optional(),
  /** Citation for the numeric data above (regulation spec, measurement source, or textbook reference). */
  provenance: z.string().min(1),
});

export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

function buildDragCoefficient(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.value);
    case "tabulated-reynolds":
      return spec.table ? new TabulatedReynoldsCd(spec.table) : new TabulatedReynoldsCd();
  }
}

function buildLiftCoefficient(spec: LiftCoefficientSpec): LiftCoefficientModel {
  switch (spec.kind) {
    case "saturating":
      return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
  }
}

/** Validates a raw (e.g. JSON-parsed) asset, throwing `SchemaValidationError` with a useful message on failure (P1.26). */
export function loadProjectileSpec(raw: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, raw);
}

/** Converts a validated `ProjectileSpec` into the runtime `ProjectileParams` a `Model` consumes. */
export function projectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: buildDragCoefficient(spec.dragCoefficient),
    liftCoefficient: spec.liftCoefficient ? buildLiftCoefficient(spec.liftCoefficient) : undefined,
  });
}
