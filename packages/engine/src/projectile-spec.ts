import { z } from "zod";

/**
 * Serializable projectile data record (§3.9): $(m, R, C_d, C_L, \tau_\omega,
 * \text{provenance})$. This is the on-disk/asset representation — a plain,
 * zod-validated data shape, not the runtime `ProjectileParams` (which holds
 * live `DragCoefficientModel`/`LiftCoefficientModel` instances). The asset
 * loader (P1.26) is what turns a validated `ProjectileSpec` into
 * `ProjectileParams`.
 */
export const projectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  /** Reference Cd for the ConstantCd model (§3.3 option 1); higher-fidelity Cd(Re) tables are a build-time choice, not part of the asset. */
  dragCoefficient: z.number().positive(),
  /** SaturatingLiftCoefficient parameters (eq. 3.16); omitted for projectiles with no meaningful Magnus regime. */
  liftCoefficient: z
    .object({
      maxCl: z.number().positive(),
      slope: z.number().positive(),
    })
    .optional(),
  /** tau_omega, spin-decay time constant in seconds (§3.6); omitted where spin isn't modeled. */
  spinDecayTau: z.number().positive().optional(),
  /** Citation for every numeric datum above (§3.9: "every numeric datum carries a citation"). */
  provenance: z.string().min(1),
});

export type ProjectileSpec = z.infer<typeof projectileSpecSchema>;
