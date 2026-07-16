import { z } from "zod";

/** A numeric datum paired with a citation for where it came from (§3.9: "every numeric datum carries a citation field"). */
const CitedNumberSchema = z.object({
  value: z.number().positive(),
  citation: z.string().min(1),
});
export type CitedNumber = z.infer<typeof CitedNumberSchema>;

/** Data-only description of a `DragCoefficientModel` choice; the asset loader (P1.26) turns this into an instance. */
export const DragModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive(), citation: z.string().min(1) }),
  z.object({ kind: z.literal("tabulated-reynolds-smooth-sphere"), citation: z.string().min(1) }),
]);
export type DragModelSpec = z.infer<typeof DragModelSpecSchema>;

/** Data-only description of a `LiftCoefficientModel` choice (Magnus lift), or none. */
export const LiftModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("saturating"), citation: z.string().min(1) }),
]);
export type LiftModelSpec = z.infer<typeof LiftModelSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): (m, R, Cd-model, CL-model, τ_ω, provenance).
 * Assets are plain data, validated at build time (P1.26 wires the loader);
 * SolverKit/engine never imports a specific projectile's identity, only this
 * schema.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: CitedNumberSchema, // kg
  radius: CitedNumberSchema, // m
  dragModel: DragModelSpecSchema,
  liftModel: LiftModelSpecSchema,
  /** Spin-decay time constant τ_ω (§3.6), only meaningful when spin/lift is modeled. */
  spinDecayTau: CitedNumberSchema.optional(), // s
  /** Overall source note for the asset as a whole (in addition to the per-datum citations). */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;
