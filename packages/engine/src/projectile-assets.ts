import {
  parseProjectileSpec,
  type DragCoefficientSpec,
  type ProjectileSpec,
} from "./projectile-spec.js";

/** Smooth-sphere subcritical Cd (§3.3 default), used by every P1.25 asset — sport-specific Cd(Re) curves arrive in P4.05. */
const SMOOTH_SPHERE_CD: DragCoefficientSpec = { kind: "constant", cd: 0.47 };

const SATURATING_LIFT = { kind: "saturating" } as const;

/**
 * The initial projectile asset library (§3.9): a generic reference sphere
 * plus the regulation sports balls named in the roadmap. Every numeric datum
 * is sourced from the governing rule book (or explicitly marked as a
 * platform-chosen reference value) via `provenance`.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  parseProjectileSpec({
    id: "sphere",
    name: "Smooth reference sphere",
    mass: 1,
    radius: 0.05,
    dragCoefficient: SMOOTH_SPHERE_CD,
    provenance:
      "Generic smooth-sphere reference (subcritical Cd=0.47, Re<~2e5); not a regulation object — used as the platform default and drag-free/analytic-comparison baseline.",
  }),
  parseProjectileSpec({
    id: "golf",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: SMOOTH_SPHERE_CD,
    liftCoefficient: SATURATING_LIFT,
    provenance:
      "USGA/R&A Rules of Golf, Equipment Rules: maximum mass 45.93 g (1.620 oz), minimum diameter 42.67 mm (1.680 in).",
  }),
  parseProjectileSpec({
    id: "soccer",
    name: "Soccer ball (size 5)",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: SMOOTH_SPHERE_CD,
    liftCoefficient: SATURATING_LIFT,
    provenance:
      "FIFA Laws of the Game, Law 2 (The Ball), size 5: circumference 68-70 cm, mass 410-450 g; mass/radius are the range midpoints (circumference 69 cm => diameter ~= 21.96 cm).",
  }),
  parseProjectileSpec({
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: SMOOTH_SPHERE_CD,
    liftCoefficient: SATURATING_LIFT,
    provenance:
      "MLB Official Baseball Rules, Rule 3.01: weight 5-5.25 oz (142-149 g), circumference 9-9.25 in (22.9-23.5 cm); mass/radius are the range midpoints.",
  }),
  parseProjectileSpec({
    id: "table-tennis",
    name: "Table tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: SMOOTH_SPHERE_CD,
    liftCoefficient: SATURATING_LIFT,
    provenance: "ITTF Table Tennis Rules, Rule 2.1 (The Ball): diameter 40 mm, mass 2.7 g.",
  }),
  parseProjectileSpec({
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 3.77,
    radius: 0.05,
    dragCoefficient: SMOOTH_SPHERE_CD,
    provenance:
      "Solid cast-iron sphere, diameter 0.1 m (platform reference size). Mass derived from V=(4/3)*pi*r^3 = 5.236e-4 m^3 and cast-iron density 7200 kg/m^3 (standard reference value) => m ~= 3.77 kg.",
  }),
  parseProjectileSpec({
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: SMOOTH_SPHERE_CD,
    provenance:
      "World Athletics Technical Rules, TR32 (The Shot), men's: minimum weight 7.260 kg, diameter 110-130 mm; radius is the range midpoint diameter (120 mm).",
  }),
];
