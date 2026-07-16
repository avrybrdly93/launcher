import { z } from "zod";

/**
 * Serializable drag-model choice for a `ProjectileSpec` data asset (§3.3).
 * Distinct from the live `DragCoefficientModel` instance a loader (P1.26)
 * constructs from it — this is the on-disk/citable representation.
 */
export const dragModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds") }),
]);
export type DragModelSpec = z.infer<typeof dragModelSpecSchema>;

/** Serializable lift-model choice (§3.6); "none" disables Magnus entirely. */
export const liftModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("saturating") }),
]);
export type LiftModelSpec = z.infer<typeof liftModelSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): records (m, R, Cd-model, Cl-model, tau_omega,
 * provenance) for one entry in the projectile/scenario database. Every
 * numeric datum must carry a `provenance` citation — this is a data-asset
 * schema; the build-time asset loader (P1.26) is what turns these into live
 * `ProjectileParams`.
 */
export const projectileSpecSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragModel: dragModelSpecSchema,
  liftModel: liftModelSpecSchema.default({ kind: "none" }),
  spinDecayTau: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof projectileSpecSchema>;
