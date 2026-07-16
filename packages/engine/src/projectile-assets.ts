import { SMOOTH_SPHERE_CD_TABLE } from "./drag-coefficient.js";
import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";
import { parseWithSchema } from "./schema.js";

const DEFAULT_LIFT_COEFFICIENT = { kind: "saturating", maxCl: 0.6, slope: 1.6 } as const;

/** Synthetic smooth sphere spanning the classical drag-crisis curve (§3.3 option 2). */
const SMOOTH_SPHERE: ProjectileSpec = {
  id: "smooth-sphere",
  name: "Smooth Reference Sphere",
  mass: 0.5,
  radius: 0.05,
  dragCoefficient: {
    kind: "tabulated-reynolds",
    table: { re: [...SMOOTH_SPHERE_CD_TABLE.re], cd: [...SMOOTH_SPHERE_CD_TABLE.cd] },
  },
  provenance:
    "Synthetic reference sphere (not a specific commercial object), sized to illustrate the " +
    "smooth-sphere Cd(Re) drag-crisis curve digitized in SMOOTH_SPHERE_CD_TABLE from standard " +
    "aerodynamics references, e.g. Hoerner, Fluid-Dynamic Drag (1965); Achenbach, " +
    "'Experiments on the flow past spheres at very high Reynolds numbers', J. Fluid Mech. (1972).",
};

const GOLF_BALL: ProjectileSpec = {
  id: "golf-ball",
  name: "Golf Ball",
  mass: 0.04593,
  radius: 0.021335,
  dragCoefficient: { kind: "constant", value: 0.25 },
  liftCoefficient: DEFAULT_LIFT_COEFFICIENT,
  provenance:
    "Mass/diameter: USGA/R&A Rules of Golf, Equipment Rules (max mass 45.93 g, min diameter " +
    "42.67 mm). Cd≈0.25 for a dimpled golf ball (dimples trip the boundary layer, delaying " +
    "separation well below a smooth sphere's drag crisis): Bearman & Harvey, 'Golf ball " +
    "aerodynamics', Aeronautical Quarterly 27 (1976).",
};

const SOCCER_BALL: ProjectileSpec = {
  id: "soccer-ball",
  name: "Soccer Ball",
  mass: 0.43,
  radius: 0.1114,
  dragCoefficient: { kind: "constant", value: 0.25 },
  liftCoefficient: DEFAULT_LIFT_COEFFICIENT,
  provenance:
    "Mass/circumference: FIFA Laws of the Game, Law 2 (mass 410-450 g, circumference 68-70 cm; " +
    "midpoints used, giving radius = 0.70 m / (2*pi)). Cd≈0.25 at typical play speeds: Asai et " +
    "al., 'Fundamental aerodynamics of the soccer ball', Sports Engineering 10 (2007).",
};

const BASEBALL: ProjectileSpec = {
  id: "baseball",
  name: "Baseball",
  mass: 0.145,
  radius: 0.0366,
  dragCoefficient: { kind: "constant", value: 0.35 },
  liftCoefficient: DEFAULT_LIFT_COEFFICIENT,
  provenance:
    "Mass/circumference: Official Baseball Rules, Rule 3.01 (mass 5.00-5.25 oz, circumference " +
    "9.00-9.25 in; midpoints used). Cd≈0.3-0.4 in flight (midpoint 0.35 used): Adair, The " +
    "Physics of Baseball, 3rd ed. (2002).",
};

const TABLE_TENNIS_BALL: ProjectileSpec = {
  id: "table-tennis-ball",
  name: "Table Tennis Ball",
  mass: 0.0027,
  radius: 0.02,
  dragCoefficient: { kind: "constant", value: 0.47 },
  liftCoefficient: DEFAULT_LIFT_COEFFICIENT,
  provenance:
    "Mass/diameter: ITTF Table Tennis Equipment Regulations (mass 2.70 g, diameter 40 mm). " +
    "Cd≈0.47 (subcritical smooth-sphere regime at typical play Reynolds numbers ~2-5e4): " +
    "Hoerner, Fluid-Dynamic Drag (1965).",
};

const CANNONBALL: ProjectileSpec = {
  id: "cannonball",
  name: "Cannonball (0.1 m iron)",
  mass: 3.82,
  radius: 0.05,
  dragCoefficient: { kind: "constant", value: 0.47 },
  provenance:
    "Diameter 0.1 m cast-iron shot; mass = (4/3)*pi*r^3 * 7300 kg/m^3 (cast-iron density) ≈ " +
    "3.82 kg. Cd≈0.47 (standard sphere, subcritical regime): NASA Glenn Research Center, " +
    "'Shape Effects on Drag'.",
};

const SHOT_PUT: ProjectileSpec = {
  id: "shot-put",
  name: "Shot Put",
  mass: 7.26,
  radius: 0.06,
  dragCoefficient: { kind: "constant", value: 0.47 },
  provenance:
    "Mass 7.26 kg (16 lb, men's); diameter 110-130 mm (midpoint 120 mm used): World Athletics " +
    "Technical Rules, Rule 32 (Shot Put). Cd≈0.47 (standard sphere, subcritical regime): NASA " +
    "Glenn Research Center, 'Shape Effects on Drag'.",
};

/** The Phase-1 projectile asset library (§3.9): sphere, golf, soccer, baseball, TT ball, cannonball, shot put. */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  SMOOTH_SPHERE,
  GOLF_BALL,
  SOCCER_BALL,
  BASEBALL,
  TABLE_TENNIS_BALL,
  CANNONBALL,
  SHOT_PUT,
].map((spec) => parseWithSchema(ProjectileSpecSchema, spec));
