import { z } from "zod";

/**
 * Declarative, serializable drag-coefficient model selector (§3.3). Only
 * "constant" exists as of P1.25 — tabulated sport-specific Cd(Re) curves
 * with literature-asserted bounds are P4.05.
 */
export const DragCoefficientSpecSchema = z.object({
  kind: z.literal("constant"),
  value: z.number().positive(),
});
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Declarative, serializable lift-coefficient model selector (§3.6). */
export const LiftCoefficientSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive(),
  slope: z.number().positive(),
});
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * A serializable projectile data asset (§3.9): `(m, R, Cd-model, CL-model,
 * tau_omega, provenance)`. Distinct from `ProjectileParams` (the live,
 * instantiated runtime object with model instances rather than model
 * selectors) — this is what gets stored as a JSON-serializable asset and
 * schema-validated at load time (P1.26).
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** tau_omega, spin exponential decay time constant, s (§3.6). */
  spinDecayTau: z.number().positive().optional(),
  /** Citation for mass/geometry/coefficient values — every asset must carry one. */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;
