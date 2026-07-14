import { z } from "zod";

/** Serializable description of a drag-coefficient model (§3.3), resolved to a DragCoefficientModel by the asset loader (P1.26). */
export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({
    kind: z.literal("tabulated-reynolds"),
    re: z.array(z.number().positive()).min(2),
    cd: z.array(z.number().positive()).min(2),
  }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Serializable description of a lift-coefficient model (§3.6). */
export const LiftCoefficientSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive(),
  slope: z.number().positive(),
});
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): $(m, R, C_d\text{-model}, C_L\text{-model},
 * \tau_\omega, \text{provenance})$. Every numeric datum is backed by a
 * `provenance` citation string — this schema is the contract the asset
 * loader (P1.26) validates data assets against at build time.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** Spin decay timescale, dω/dt = -ω/tau (§3.6). Sport-typical ~20-30s. */
  spinDecayTau: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;
