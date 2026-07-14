import { z } from "zod";

/** Discriminated-union, serializable description of a drag-coefficient model (§3.3). */
export const dragModelSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("constant"), cd: z.number().positive() }),
  z.object({
    type: z.literal("tabulated-reynolds"),
    table: z
      .object({
        re: z.array(z.number().positive()).min(2),
        cd: z.array(z.number().positive()).min(2),
      })
      .refine((t) => t.re.length === t.cd.length, {
        message: "re and cd arrays must be the same length",
      }),
  }),
]);
export type DragModelSpec = z.infer<typeof dragModelSpecSchema>;

/** Discriminated-union, serializable description of a lift (Magnus) coefficient model (§3.6). */
export const liftModelSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("saturating"),
    maxCl: z.number().positive(),
    slope: z.number().positive(),
  }),
]);
export type LiftModelSpec = z.infer<typeof liftModelSpecSchema>;

/**
 * Serializable projectile data asset (§3.9): `(m, R, Cd-model, CL-model,
 * tau_omega, provenance)`. Every asset in `projectile-assets.ts` is validated
 * against this schema (P1.26 wires that check into the build); the loader
 * hydrates a validated spec into the `ProjectileParams` the engine actually
 * integrates with (`createSphericalProjectileParams`), since assets stay
 * spherical (radius, not a general area) for every shape shipped so far.
 *
 * `provenance` is one free-text citation per asset (data source and any
 * caveats) — the blueprint's ideal of a citation *per numeric datum* is
 * intentionally not implemented yet; this is the coarser, still-honest
 * version that scope allows today.
 */
export const projectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragModel: dragModelSpecSchema,
  liftModel: liftModelSpecSchema,
  spinDecayTauSeconds: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof projectileSpecSchema>;
