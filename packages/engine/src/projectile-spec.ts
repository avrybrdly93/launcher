import { z } from "zod";

/**
 * Serializable description of a drag-coefficient model (§3.3): raw asset
 * data, not a `DragCoefficientModel` instance — the asset loader (P1.26)
 * turns this into one.
 */
export const DragModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds") }),
]);
export type DragModelSpec = z.infer<typeof DragModelSpecSchema>;

/** Serializable description of a lift-coefficient model (§3.6). */
export const LiftModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("saturating"),
    maxCl: z.number().positive(),
    slope: z.number().positive(),
  }),
]);
export type LiftModelSpec = z.infer<typeof LiftModelSpecSchema>;

/**
 * A projectile's physical properties and provenance (§3.9): mass, radius,
 * drag/lift model choice, optional spin-decay timescale, and a citation for
 * every numeric datum. `ProjectileSpec` is data, not behavior — the asset
 * loader (P1.26) resolves it into a `ProjectileParams` + force set.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragModel: DragModelSpecSchema,
  liftModel: LiftModelSpecSchema.optional(),
  /** Spin-decay timescale tau_omega in seconds (§3.6), sport-typical ~20-30s. */
  spinDecayTau: z.number().positive().optional(),
  /** Citation for the numeric data above (rulebook, measurement, or reference text). */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;
