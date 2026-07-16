import { ProjectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

const IRON_DENSITY_KG_M3 = 7870; // CRC Handbook of Chemistry and Physics, wrought/cast iron
const CANNONBALL_RADIUS_M = 0.05; // 0.1 m diameter, per §3.9 asset list
const CANNONBALL_MASS_KG = (4 / 3) * Math.PI * CANNONBALL_RADIUS_M ** 3 * IRON_DENSITY_KG_M3;

const SPHERE: ProjectileSpec = {
  id: "sphere",
  name: "Smooth reference sphere",
  mass: { value: 0.5, citation: "Synthetic teaching reference, chosen for round numbers" },
  radius: { value: 0.05, citation: "Synthetic teaching reference, chosen for round numbers" },
  dragModel: {
    kind: "constant",
    cd: 0.47,
    citation:
      "Subcritical smooth-sphere drag coefficient (White, Fluid Mechanics, std. aerodynamics reference)",
  },
  liftModel: { kind: "none" },
  provenance:
    "Idealized smooth sphere at constant Cd=0.47: the drag-free/quadratic-drag teaching baseline, not a real object.",
};

const GOLF_BALL: ProjectileSpec = {
  id: "golf-ball",
  name: "Golf ball",
  mass: { value: 0.0459, citation: "USGA/R&A Rules of Golf, Equipment Rules: mass <= 45.93 g" },
  radius: {
    value: 0.02135,
    citation: "USGA/R&A Rules of Golf, Equipment Rules: diameter >= 42.67 mm",
  },
  dragModel: {
    kind: "constant",
    cd: 0.25,
    citation:
      "Typical dimpled golf-ball drag coefficient ~0.25 at drive speeds (Bearman & Harvey, J. Fluid Mech. 1976; Mehta, Aerodynamics of Sports Balls)",
  },
  liftModel: {
    kind: "saturating",
    citation:
      "Backspin-driven lift is the dominant golf-drive effect (Mehta, Aerodynamics of Sports Balls)",
  },
  spinDecayTau: {
    value: 25,
    citation:
      "Order-of-magnitude sport-ball spin-decay time, 20-30 s range (Mehta, Aerodynamics of Sports Balls)",
  },
  provenance:
    "USGA/R&A regulation golf ball; drag/lift coefficients from sports-aerodynamics literature.",
};

const SOCCER_BALL: ProjectileSpec = {
  id: "soccer-ball",
  name: "Soccer ball",
  mass: { value: 0.43, citation: "FIFA Laws of the Game, Law 2: mass 410-450 g at start of play" },
  radius: { value: 0.11, citation: "FIFA Laws of the Game, Law 2: circumference 68-70 cm" },
  dragModel: {
    kind: "constant",
    cd: 0.25,
    citation:
      "Turbulent-regime soccer-ball drag coefficient ~0.2-0.25 at match speeds (Asai et al., Sports Eng. 2007)",
  },
  liftModel: {
    kind: "saturating",
    citation: "Magnus effect on curved free kicks (Asai et al., Sports Eng. 2007)",
  },
  spinDecayTau: {
    value: 25,
    citation:
      "Order-of-magnitude sport-ball spin-decay time, 20-30 s range (Mehta, Aerodynamics of Sports Balls)",
  },
  provenance:
    "FIFA regulation ball (P1.16's buoyancy validation preset); drag/lift from sports-aerodynamics literature.",
};

const BASEBALL: ProjectileSpec = {
  id: "baseball",
  name: "Baseball",
  mass: { value: 0.145, citation: "MLB Official Baseball Rules: mass 142-149 g (5.00-5.25 oz)" },
  radius: { value: 0.0366, citation: "MLB Official Baseball Rules: circumference 22.9-23.5 cm" },
  dragModel: {
    kind: "constant",
    cd: 0.35,
    citation:
      "Typical baseball drag coefficient ~0.3-0.4 depending on seam orientation (Adair, The Physics of Baseball)",
  },
  liftModel: {
    kind: "saturating",
    citation: "Seam-driven Magnus effect on curveballs/sliders (Adair, The Physics of Baseball)",
  },
  spinDecayTau: {
    value: 25,
    citation:
      "Order-of-magnitude sport-ball spin-decay time, 20-30 s range (Mehta, Aerodynamics of Sports Balls)",
  },
  provenance:
    "MLB regulation baseball; drag/lift coefficients from Adair's baseball aerodynamics analysis.",
};

const TABLE_TENNIS_BALL: ProjectileSpec = {
  id: "table-tennis-ball",
  name: "Table-tennis ball",
  mass: { value: 0.0027, citation: "ITTF Table Tennis Equipment Regulations: mass 2.67-2.77 g" },
  radius: { value: 0.02, citation: "ITTF Table Tennis Equipment Regulations: diameter 40 mm" },
  dragModel: {
    kind: "tabulated-reynolds-smooth-sphere",
    citation:
      "Light ball at typical play speeds sits in the transitional Re~1e4 regime of the smooth-sphere Cd(Re) curve (Achenbach 1972)",
  },
  liftModel: {
    kind: "saturating",
    citation:
      "High spin-to-speed ratio makes Magnus lift very pronounced for table tennis (Mehta, Aerodynamics of Sports Balls)",
  },
  spinDecayTau: {
    value: 20,
    citation:
      "Order-of-magnitude sport-ball spin-decay time, 20-30 s range (Mehta, Aerodynamics of Sports Balls)",
  },
  provenance:
    "ITTF regulation ball; the canonical high-Pi (drag-dominated), low-Reynolds-number scenario in the preset library.",
};

const CANNONBALL: ProjectileSpec = {
  id: "cannonball",
  name: "Cannonball (0.1 m iron)",
  mass: {
    value: CANNONBALL_MASS_KG,
    citation: `Computed from a 0.1 m diameter solid sphere at iron density ${IRON_DENSITY_KG_M3} kg/m^3 (CRC Handbook of Chemistry and Physics)`,
  },
  radius: {
    value: CANNONBALL_RADIUS_M,
    citation: "0.1 m diameter iron sphere, per the platform's asset list (Sec 3.9)",
  },
  dragModel: {
    kind: "constant",
    cd: 0.47,
    citation:
      "Subcritical smooth-sphere drag coefficient (White, Fluid Mechanics, std. aerodynamics reference)",
  },
  liftModel: { kind: "none" },
  provenance:
    "Idealized solid iron sphere, 0.1 m diameter: the platform's low-Pi, high-mass historical-projectile example.",
};

const SHOT_PUT: ProjectileSpec = {
  id: "shot-put",
  name: "Shot put",
  mass: { value: 7.26, citation: "World Athletics Rule 188 (men's shot put): mass 7.260 kg" },
  radius: { value: 0.06, citation: "World Athletics Rule 188: diameter 110-130 mm, midpoint used" },
  dragModel: {
    kind: "constant",
    cd: 0.47,
    citation:
      "Subcritical smooth-sphere drag coefficient (White, Fluid Mechanics, std. aerodynamics reference)",
  },
  liftModel: { kind: "none" },
  provenance:
    "World Athletics regulation shot put: the platform's canonical low-Pi (drag-negligible) reference scenario.",
};

/** All shipped `ProjectileSpec` assets (§3.9), each build-time validated against `ProjectileSpecSchema`. */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  SPHERE,
  GOLF_BALL,
  SOCCER_BALL,
  BASEBALL,
  TABLE_TENNIS_BALL,
  CANNONBALL,
  SHOT_PUT,
].map((spec) => ProjectileSpecSchema.parse(spec));
