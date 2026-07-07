import { z } from "zod";

/** Serializable selector for a `DragCoefficientModel` (§3.3); the asset loader (P1.26) instantiates the class. */
export const DragCoefficientSpecSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("constant"),
    value: z.number().positive(),
  }),
  z.object({
    type: z.literal("tabulatedReynolds"),
    table: z
      .object({
        re: z.array(z.number().positive()).min(2).readonly(),
        cd: z.array(z.number().positive()).min(2).readonly(),
      })
      .refine((t) => t.re.length === t.cd.length, {
        message: "re and cd arrays must have equal length",
      }),
  }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Serializable selector for a `LiftCoefficientModel` (§3.6); only the saturating fit (3.16) exists so far. */
export const LiftCoefficientSpecSchema = z.object({
  type: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): the serializable projectile database record —
 * `(m, R, Cd-model, CL-model, tau_omega, provenance)`. Every numeric datum
 * carries a citation via `provenance`; the asset loader (P1.26) validates
 * this schema at build time and converts a spec into a runtime
 * `ProjectileParams` by instantiating the drag/lift model classes it names.
 */
export const ProjectileSpecSchema = z.object({
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** Spin decay time constant tau_omega (s), sport-typical ~20-30s (§3.6). */
  spinDecayTau: z.number().positive().optional(),
  /** Citation(s) for every numeric datum above. */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;
