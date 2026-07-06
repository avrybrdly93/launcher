import { z } from "zod";

/**
 * Serializable description of a projectile's drag-coefficient model (§3.3).
 * The asset loader (P1.26) resolves this into a live `DragCoefficientModel`
 * (`ConstantCd` or `TabulatedReynoldsCd`) — data assets never hold instances
 * directly so they stay plain, zod-validatable JSON.
 */
export const DRAG_COEFFICIENT_SPEC_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds") }),
]);
export type DragCoefficientSpec = z.infer<typeof DRAG_COEFFICIENT_SPEC_SCHEMA>;

/** Serializable description of a Magnus lift-coefficient model (§3.6, eq. 3.16). */
export const LIFT_COEFFICIENT_SPEC_SCHEMA = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive(),
  slope: z.number().positive(),
});
export type LiftCoefficientSpec = z.infer<typeof LIFT_COEFFICIENT_SPEC_SCHEMA>;

/**
 * `ProjectileSpec` (§3.9): $(m, R, C_d\text{-model}, C_L\text{-model},
 * \tau_\omega, \text{provenance})$. Every asset carries a `provenance`
 * citation string — the platform never ships an unsourced numeric datum.
 */
export const PROJECTILE_SPEC_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: DRAG_COEFFICIENT_SPEC_SCHEMA,
  liftCoefficient: LIFT_COEFFICIENT_SPEC_SCHEMA.optional(),
  /** Spin-decay time constant tau_omega (§3.6), seconds; omit to disable spin decay. */
  spinDecayTau: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof PROJECTILE_SPEC_SCHEMA>;

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball (0.1 m iron), shot put.
 * Values are representative regulation/reference figures with literature or
 * rulebook provenance; sport-specific Cd(Re) tables with tighter citations
 * follow in P4.05.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.5,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Idealized generic sphere for drag-free/analytic-comparison scenarios; Cd=0.47 is the standard subcritical smooth-sphere value (Morrison, 'An Introduction to Fluid Mechanics', 2013; Hoerner, 'Fluid-Dynamic Drag', 1965).",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.0459,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    spinDecayTau: 25,
    liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    provenance:
      "USGA/R&A Rules of Golf: mass <= 45.93 g, diameter >= 42.67 mm. Cd ~ 0.25 for a dimpled sphere in the operating Reynolds range (Bearman & Harvey, 'Golf ball aerodynamics', Aeronautical Quarterly, 1976).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "FIFA Laws of the Game: circumference 68-70 cm, mass 410-450 g. Cd ~ 0.25 in the typical kick-speed range (Asai et al., 'Fundamental aerodynamics of the soccer ball', Journal of Sports Sciences, 2007).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.3 },
    spinDecayTau: 20,
    liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    provenance:
      "MLB Official Baseball Rules: mass 142-149 g, circumference 229-235 mm. Cd ~ 0.3-0.4 depending on seam orientation and spin (Adair, 'The Physics of Baseball', 3rd ed., 2002).",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.4 },
    provenance:
      "ITTF equipment regulations: mass 2.67-2.77 g, diameter 40 mm. Cd ~ 0.4-0.5 for a smooth sphere at subcritical Reynolds numbers typical of table-tennis speeds (Achenbach, 'Experiments on the flow past spheres', Journal of Fluid Mechanics, 1972).",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.121,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "0.1 m diameter solid cast-iron sphere; mass from cast-iron density ~7870 kg/m^3 (standard engineering reference density) times sphere volume. Cd=0.47 smooth-sphere approximation, as in classical exterior-ballistics treatments (e.g. McCoy, 'Modern Exterior Ballistics', 1999).",
  },
  {
    id: "shot-put",
    name: "Shot put (men's, 7.26 kg)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", value: 0.5 },
    provenance:
      "World Athletics Technical Rules: men's shot mass 7.260 kg, diameter 110-130 mm (mid-range 120 mm used here). Cd ~ 0.5 approximate smooth-sphere value; drag is dynamically negligible for this scenario (low Pi, per §3.8's nondimensional grouping).",
  },
];
