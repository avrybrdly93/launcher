import { z } from "zod";
import { parseWithSchema } from "./schema.js";

/**
 * Serializable descriptor for a projectile's drag-coefficient model (§3.3).
 * Turning this into a live `DragCoefficientModel` instance is the asset
 * loader's job (P1.26) — this schema only describes the data.
 */
export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({
    kind: z.literal("tabulated-reynolds"),
    re: z.array(z.number().positive()).min(2),
    cd: z.array(z.number().positive()).min(2),
  }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Serializable descriptor for a projectile's lift-coefficient model (§3.6, eq. 3.16). */
export const LiftCoefficientSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive(),
  slope: z.number().positive(),
});
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * A projectile data asset (§3.9): physical properties plus aerodynamic model
 * descriptors, with a mandatory provenance citation for every numeric datum.
 * Detailed sport-specific Cd/Cl tables arrive in P4.05; these initial assets
 * intentionally use simple constant-Cd models, matching what the engine can
 * already model at this phase.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** Spin decay time constant tau_omega (§3.6), seconds. Omit to disable spin decay. */
  spinDecayTau: z.number().positive().optional(),
  /** Citation for every numeric datum above: source of the mass/radius/Cd/Cl values. */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf, soccer,
 * baseball, table-tennis ball, cannonball, shot put. Each is validated
 * against `ProjectileSpecSchema` below at module load — a malformed entry
 * fails immediately rather than surfacing downstream (P1.25 validation:
 * "assets validate; each has provenance string").
 */
const RAW_PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.5,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Cd=0.47 for a smooth sphere at subcritical Reynolds number (White, F.M., Fluid " +
      "Mechanics, 7th ed., Table 7.2); mass/radius are an arbitrary reference size used " +
      "for the platform's baseline validation scenarios, not a specific real object.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 25,
    provenance:
      "Mass <=45.93 g, diameter >=42.67 mm per USGA/R&A Rules of Golf, Equipment Rule 3 " +
      "(ball specifications). Cd~0.25 in the typical flight regime per Bearman, P.W. & " +
      "Harvey, J.K. (1976), 'Golf ball aerodynamics', Aeronautical Quarterly 27(2).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "Mass 410-450 g, circumference 68-70 cm per FIFA Laws of the Game, Law 2 (radius " +
      "derived from circumference midpoint). Cd~0.2-0.3 depending on flow regime per " +
      "Mehta, R.D. (1985), 'Aerodynamics of sports balls', Annual Review of Fluid Mechanics 17.",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.35 },
    liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 20,
    provenance:
      "Mass 142-149 g (5.00-5.25 oz), circumference 22.9-23.5 cm per MLB Official Baseball " +
      "Rules, Rule 3.01 (radius derived from circumference midpoint). Cd~0.3-0.4 for a " +
      "pitched/batted ball per Adair, R.K., The Physics of Baseball, 3rd ed.",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.5 },
    provenance:
      "Mass 2.67-2.77 g, diameter 40 mm per ITTF Technical Leaflet T3 (equipment " +
      "regulations). Cd~0.5 for a smooth sphere at this Reynolds-number regime per " +
      "White, F.M., Fluid Mechanics, 7th ed., Table 7.2.",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.121,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "0.1 m diameter solid iron sphere, density 7870 kg/m^3 (standard wrought-iron " +
      "density, historical-ordnance reference); mass derived as (4/3)*pi*r^3*density. " +
      "Cd=0.47 smooth-sphere subcritical baseline (White, F.M., Fluid Mechanics) -- " +
      "compressibility/Mach effects at historical muzzle velocities are out of scope " +
      "until the Mach-dependent Cd model (P4.04).",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Mass 7.260 kg, diameter 110-130 mm (men's) per World Athletics Technical Rules, " +
      "Rule 32 (shot specifications). Cd=0.47 smooth-sphere baseline (White, F.M., Fluid Mechanics).",
  },
];

/** Validated projectile data assets — see `RAW_PROJECTILE_ASSETS` for sourcing. */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = RAW_PROJECTILE_ASSETS.map((spec) =>
  parseWithSchema(ProjectileSpecSchema, spec),
);

/** Looks up a built-in projectile asset by id, or undefined if there's no such asset. */
export function findProjectileAsset(id: string): ProjectileSpec | undefined {
  return PROJECTILE_ASSETS.find((asset) => asset.id === id);
}
