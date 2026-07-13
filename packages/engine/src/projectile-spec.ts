import { z } from "zod";

/** A numeric datum paired with a citation — the "every datum carries a citation field" requirement of §3.9. */
export const ProvenancedNumberSchema = z.object({
  value: z.number(),
  citation: z.string().min(1),
});
export type ProvenancedNumber = z.infer<typeof ProvenancedNumberSchema>;

/** Which `DragCoefficientModel` (§3.3) a spec asks for, plus the data needed to build it. */
export const DragModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive(), citation: z.string().min(1) }),
  z.object({ kind: z.literal("reynolds-smooth-sphere"), citation: z.string().min(1) }),
]);
export type DragModelSpec = z.infer<typeof DragModelSpecSchema>;

/** Which `LiftCoefficientModel` (§3.6) a spec asks for, if spin/Magnus is modeled at all. */
export const LiftModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("saturating"),
    maxCl: z.number().positive(),
    slope: z.number().positive(),
    citation: z.string().min(1),
  }),
]);
export type LiftModelSpec = z.infer<typeof LiftModelSpecSchema>;

/**
 * Declarative, serializable projectile data (§3.9): `(m, R, Cd-model,
 * Cl-model, tau_omega, provenance)`. Distinct from the runtime
 * `ProjectileParams` SolverKit consumes — a `ProjectileSpec` is what a
 * scenario file stores and what the asset loader (P1.26) validates; building
 * the runtime `ProjectileParams` from one is the loader/UI's job, not this
 * schema's.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: ProvenancedNumberSchema, // kg
  radius: ProvenancedNumberSchema, // m
  dragModel: DragModelSpecSchema,
  liftModel: LiftModelSpecSchema,
  spinDecayTauSeconds: ProvenancedNumberSchema.optional(),
  /** Top-level provenance note for the asset as a whole (sources, sport, edition). */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;
