import { z } from "zod";

/**
 * Serializable description of a drag-coefficient model (§3.3): either a
 * fixed value (P1.10's `ConstantCd`) or the built-in smooth-sphere Cd(Re)
 * curve including the drag crisis (P1.12's `TabulatedReynoldsCd`). Kept as
 * plain data -- not a live `DragCoefficientModel` instance -- so it survives
 * JSON round-trips; the asset loader (P1.26) is what turns this into a
 * runtime object.
 */
export const DragModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-re") }),
]);
export type DragModelSpec = z.infer<typeof DragModelSpecSchema>;

/** Serializable description of a lift-coefficient model (§3.6); currently only the one shipped fit. */
export const LiftModelSpecSchema = z.object({
  kind: z.literal("saturating"),
});
export type LiftModelSpec = z.infer<typeof LiftModelSpecSchema>;

/**
 * A projectile's physical data (§3.9): mass, radius, and the drag/lift
 * models it uses, plus a mandatory `provenance` citation for every asset --
 * "every numeric datum carries a citation field" (§3.9). Sourced from
 * spherical projectiles only for Phase 1 (`area`/`volume` are derived by the
 * loader from `radius`, as in `createSphericalProjectileParams`).
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragModel: DragModelSpecSchema,
  liftModel: LiftModelSpecSchema.optional(),
  spin: z.number().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/**
 * Initial projectile asset library (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball, shot put. Figures are
 * standard textbook/rulebook values (see each `provenance`), not
 * high-precision measurements of a specific manufactured ball.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    displayName: "Smooth sphere (reference)",
    mass: 0.1,
    radius: 0.05,
    dragModel: { kind: "tabulated-re" },
    provenance:
      "Idealized 10 cm smooth sphere; drag coefficient follows the standard smooth-sphere Cd(Re) curve including the drag crisis (Achenbach 1972, J. Fluid Mech. 54; White, Fluid Mechanics).",
  },
  {
    id: "golf-ball",
    displayName: "Golf ball",
    mass: 0.04593,
    radius: 0.02134,
    dragModel: { kind: "constant", cd: 0.25 },
    provenance:
      "USGA/R&A Rules of Golf: diameter >= 42.67 mm, mass <= 45.93 g. Cd ~= 0.25 typical for a dimpled ball in the post-critical regime at driver speeds (Bearman & Harvey 1976, 'Golf ball aerodynamics', Aeronautical Quarterly 27).",
  },
  {
    id: "soccer-ball",
    displayName: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragModel: { kind: "constant", cd: 0.25 },
    provenance:
      "FIFA Laws of the Game, Law 2: circumference 68-70 cm (radius ~= 0.11 m), mass 410-450 g. Cd ~= 0.25 typical for a soccer ball (Goff & Carre 2009, Am. J. Phys. 77; Asai et al. 2007, Sports Eng. 10).",
  },
  {
    id: "baseball",
    displayName: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragModel: { kind: "constant", cd: 0.3 },
    provenance:
      "MLB rulebook: mass 5-5.25 oz (~=0.145 kg), circumference 9-9.25 in (radius ~=0.0366 m). Cd ~= 0.3 typical at pitch/batted-ball speeds (Adair, The Physics of Baseball; Nathan 2008, Am. J. Phys. 76).",
  },
  {
    id: "table-tennis-ball",
    displayName: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragModel: { kind: "constant", cd: 0.4 },
    provenance:
      "ITTF equipment regulations: diameter 40 mm, mass 2.7 g. Cd ~= 0.4, subcritical smooth-sphere regime at typical rally speeds (Re ~ 1e4-1e5; per the smooth-sphere Cd(Re) curve, Achenbach 1972).",
  },
  {
    id: "cannonball",
    displayName: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragModel: { kind: "tabulated-re" },
    provenance:
      "0.1 m diameter solid sphere, cast iron (rho ~= 7870 kg/m^3, standard materials tables) => mass = rho*(4/3)*pi*r^3 ~= 4.12 kg. Modeled as a smooth sphere, Cd(Re) per Achenbach 1972.",
  },
  {
    id: "shot-put",
    displayName: "Shot put",
    mass: 7.26,
    radius: 0.06,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "World Athletics (IAAF) rules: men's shot mass 7.26 kg, diameter 110-130 mm (using ~120 mm). Modeled as a smooth sphere; Cd ~= 0.47 subcritical -- shot-put speeds keep Re well below the drag crisis.",
  },
];
