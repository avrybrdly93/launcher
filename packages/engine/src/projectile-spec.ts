import { z } from "zod";
import { parseWithSchema } from "./schema.js";

/** Declarative drag-coefficient choice for an asset (§3.9). Sport-specific Cd(Re) curves are added in P4.05; P1.25's assets all use the constant smooth-sphere value. */
export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Declarative lift-coefficient choice for spin-capable assets (eq. 3.16). */
export const LiftCoefficientSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * Declarative, serializable projectile description (§3.9) — the asset-library
 * counterpart of the live `ProjectileParams`. Unlike `ProjectileParams`,
 * `dragCoefficient`/`liftCoefficient` are plain data (not model instances)
 * so specs can be validated and round-tripped through JSON; the asset loader
 * (P1.26) resolves them into concrete `DragCoefficientModel`/
 * `LiftCoefficientModel` instances to build `ProjectileParams`.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** τ_ω, spin-decay time constant (§3.6), s. Omit to disable spin decay. */
  spinDecayTau: z.number().positive().optional(),
  /** Citation for the numeric data above (rule book, standard, or explicit "generic reference" note). */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

export function parseProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, data);
}
