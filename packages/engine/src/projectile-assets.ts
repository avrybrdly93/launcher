import { SMOOTH_SPHERE_CD_TABLE } from "./drag-coefficient.js";
import type { ProjectileSpec } from "./projectile-spec.js";

const SATURATING_LIFT = { type: "saturating", maxCl: 0.6, slope: 1.6 } as const;
const SMOOTH_SPHERE_DRAG = {
  type: "tabulated-reynolds",
  re: SMOOTH_SPHERE_CD_TABLE.re,
  cd: SMOOTH_SPHERE_CD_TABLE.cd,
} as const;

/**
 * §3.9 initial projectile database. Every numeric datum's source is in
 * `provenance`; masses/radii are official/standard-reference values, drag
 * coefficients are representative for each body's typical flight-speed
 * Reynolds range (§3.3). Smooth, uncoated spheres (generic sphere,
 * cannonball, shot put) use the tabulated Re-dependent Cd from P1.12 to
 * show the drag crisis; textured/seamed sport balls use a single
 * operating-range constant per the blueprint's "sport-specific tables"
 * simplification for this task.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere",
    mass: 0.5,
    radius: 0.05,
    dragModel: SMOOTH_SPHERE_DRAG,
    liftModel: SATURATING_LIFT,
    spinDecayTau: 25,
    provenance:
      "Generic smooth sphere; Cd(Re) drag-crisis curve per Morrison-type correlation (subcritical ~0.47 -> supercritical ~0.1 near Re~3e5), as tabulated in P1.12 / §3.3 option 2.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragModel: { type: "constant", cd: 0.25 },
    liftModel: SATURATING_LIFT,
    spinDecayTau: 20,
    provenance:
      "Mass <=45.93 g, diameter >=42.67 mm per USGA/R&A Rules of Golf equipment standards. Cd~0.25 for a dimpled ball in its typical drive-speed Reynolds range, per Bearman & Harvey (1976) golf-ball aerodynamics measurements (§3.3).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.1098,
    dragModel: { type: "constant", cd: 0.25 },
    liftModel: SATURATING_LIFT,
    spinDecayTau: 25,
    provenance:
      "FIFA Quality Standard: mass 410-450 g, circumference 68-70 cm (radius from circumference/2*pi). Cd~0.25 typical supercritical value for a soccer ball in flight, per Asai et al. (2007) football aerodynamics studies.",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragModel: { type: "constant", cd: 0.3 },
    liftModel: SATURATING_LIFT,
    spinDecayTau: 30,
    provenance:
      "Official MLB baseball: mass 142-149 g, circumference 9-9.25 in (radius from circumference/2*pi). Effective Cd~0.3 folding seam-induced turbulent transition into a single coefficient, per Adair, 'The Physics of Baseball' (§3.3).",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragModel: { type: "constant", cd: 0.5 },
    liftModel: SATURATING_LIFT,
    spinDecayTau: 15,
    provenance:
      "ITTF specification: mass 2.7 g, diameter 40 mm. Cd~0.5 for the ball's low-Re flight range, per Cooke (2002) table-tennis ball aerodynamics.",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.121,
    radius: 0.05,
    dragModel: SMOOTH_SPHERE_DRAG,
    spinDecayTau: 25,
    provenance:
      "0.1 m diameter cast-iron sphere per §3.9 spec; mass = rho_iron * (4/3)*pi*R^3 with rho_iron = 7870 kg/m^3 (standard cast-iron density). Cd(Re) drag-crisis curve as for the generic smooth sphere (§3.3 option 2).",
  },
  {
    id: "shot-put",
    name: "Shot put",
    mass: 7.26,
    radius: 0.06,
    dragModel: SMOOTH_SPHERE_DRAG,
    spinDecayTau: 25,
    provenance:
      "World Athletics men's shot: mass 7.260 kg, diameter 110-130 mm (radius taken at the 120 mm midpoint). Smooth metal sphere, so Cd(Re) drag-crisis curve as for the generic smooth sphere (§3.3 option 2).",
  },
];
