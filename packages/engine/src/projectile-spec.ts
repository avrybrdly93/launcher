import { z } from "zod";

/**
 * Serializable description of a drag-coefficient model (§3.3), the data
 * form of `DragCoefficientModel` — a `ProjectileSpec` stores this, not a
 * live class instance, so it round-trips through JSON/localStorage/URL.
 */
export const DragModelSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("constant"), cd: z.number().positive() }),
  z.object({
    type: z.literal("tabulated-reynolds"),
    re: z.array(z.number().positive()).min(2).readonly(),
    cd: z.array(z.number().positive()).min(2).readonly(),
  }),
]);
export type DragModelSpec = z.infer<typeof DragModelSpecSchema>;

/** Serializable description of a lift-coefficient model (§3.6, eq. 3.16). */
export const LiftModelSpecSchema = z.object({
  type: z.literal("saturating"),
  maxCl: z.number().positive(),
  slope: z.number().positive(),
});
export type LiftModelSpec = z.infer<typeof LiftModelSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): (m, R, Cd-model, Cl-model, tau_omega,
 * provenance). Data assets (sphere, golf, soccer, baseball, TT ball,
 * cannonball, shot put) are plain objects validated against this schema —
 * every numeric datum's source is recorded in `provenance` so the platform
 * never presents an uncited number as fact.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragModel: DragModelSpecSchema,
  liftModel: LiftModelSpecSchema.optional(),
  /** Spin-decay time constant tau_omega, seconds (§3.6). Omit to disable spin decay. */
  spinDecayTau: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;
