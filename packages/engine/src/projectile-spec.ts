import { z } from "zod";

/**
 * Serializable description of a `DragCoefficientModel` (§3.3 options 1-2).
 * The asset loader (P1.26) turns this into a live `ConstantCd` /
 * `TabulatedReynoldsCd` instance; sport-specific tables (§3.3 option 3) can
 * extend this union without touching existing assets.
 */
export const DRAG_COEFFICIENT_SPEC_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds") }),
]);
export type DragCoefficientSpec = z.infer<typeof DRAG_COEFFICIENT_SPEC_SCHEMA>;

/** Serializable description of a `LiftCoefficientModel` (§3.6, eq. 3.16). */
export const LIFT_COEFFICIENT_SPEC_SCHEMA = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive(),
  slope: z.number().positive(),
});
export type LiftCoefficientSpec = z.infer<typeof LIFT_COEFFICIENT_SPEC_SCHEMA>;

/**
 * `ProjectileSpec` (§3.9): $(m, R, C_d\text{-model}, C_L\text{-model},
 * \tau_\omega, \text{provenance})$. This is the serialized, build-time-
 * validated form of `ProjectileParams` — the asset loader (P1.26) is what
 * turns one of these into the live object `createSphericalProjectileParams`
 * consumes. Every numeric datum's source is recorded in `provenance`
 * (§3.9: "every numeric datum carries a citation field").
 */
export const PROJECTILE_SPEC_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: DRAG_COEFFICIENT_SPEC_SCHEMA,
  liftCoefficient: LIFT_COEFFICIENT_SPEC_SCHEMA.optional(),
  /** Spin decay time constant tau_omega, seconds (§3.6). */
  spinDecayTau: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof PROJECTILE_SPEC_SCHEMA>;
