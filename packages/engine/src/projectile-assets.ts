import { SMOOTH_SPHERE_CD_TABLE } from "./drag-coefficient.js";
import type { DragModelSpec, LiftModelSpec, ProjectileSpec } from "./projectile-spec.js";

const SMOOTH_SPHERE_TABLE_SPEC: DragModelSpec = {
  type: "tabulated-reynolds",
  table: { re: [...SMOOTH_SPHERE_CD_TABLE.re], cd: [...SMOOTH_SPHERE_CD_TABLE.cd] },
};

const SATURATING_LIFT_SPEC: LiftModelSpec = { type: "saturating", maxCl: 0.6, slope: 1.6 };

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball, shot put. Numeric values
 * are representative textbook/rulebook figures for teaching use, not a
 * precision reference dataset — each `provenance` string says so and names
 * its source, per the platform's "every datum is traceable" policy.
 */
export const PROJECTILE_ASSETS: Record<string, ProjectileSpec> = {
  smoothSphere: {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.1,
    radius: 0.05,
    dragModel: SMOOTH_SPHERE_TABLE_SPEC,
    liftModel: { type: "none" },
    provenance:
      "Illustrative reference sphere (not a specific object); Cd(Re) drag-crisis curve is the platform's digitized smooth-sphere table (see drag-coefficient.ts), a standard textbook fit spanning subcritical through supercritical flow.",
  },
  golfBall: {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.02133,
    dragModel: { type: "constant", cd: 0.25 },
    liftModel: SATURATING_LIFT_SPEC,
    spinDecayTauSeconds: 25,
    provenance:
      "Mass (45.93 g max) and diameter (42.67 mm min) per the R&A/USGA Rules of Golf equipment specifications; Cd ~0.25 is a representative dimpled-ball value (dimples trip the boundary layer turbulent well below the smooth-sphere drag crisis) from sports-aerodynamics literature (e.g. Bearman & Harvey).",
  },
  soccerBall: {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragModel: { type: "constant", cd: 0.25 },
    liftModel: SATURATING_LIFT_SPEC,
    spinDecayTauSeconds: 25,
    provenance:
      "Mass (410-450 g, midpoint used) and circumference (68-70 cm, radius derived) per FIFA Quality Programme ball specifications; Cd ~0.25 is a representative value from soccer-ball aerodynamics studies (e.g. Asai et al.), which is itself Reynolds- and panel-seam-dependent in practice.",
  },
  baseball: {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragModel: { type: "constant", cd: 0.35 },
    liftModel: SATURATING_LIFT_SPEC,
    spinDecayTauSeconds: 25,
    provenance:
      "Mass (5.125 oz) and circumference (9-9.25 in, radius derived) per MLB Official Baseball Rule 3.02; Cd ~0.3-0.4 (0.35 used) per Adair, The Physics of Baseball, a representative turbulent-regime value (seam orientation and spin shift it in practice).",
  },
  tableTennisBall: {
    id: "table-tennis-ball",
    name: "Table tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragModel: SMOOTH_SPHERE_TABLE_SPEC,
    liftModel: SATURATING_LIFT_SPEC,
    spinDecayTauSeconds: 20,
    provenance:
      "Mass (2.7 g) and diameter (40 mm) per ITTF Table Tennis Equipment Regulations; drag modeled via the platform's tabulated smooth-sphere Cd(Re) curve since typical rally speeds keep Re in the subcritical range, the platform's canonical high-Pi (high-drag) demonstration scenario.",
  },
  cannonball: {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragModel: SMOOTH_SPHERE_TABLE_SPEC,
    liftModel: { type: "none" },
    provenance:
      "0.1 m diameter cast/wrought iron sphere per the platform brief; mass derived from that diameter and a typical cast-iron density of 7870 kg/m^3 ((4/3)*pi*r^3*rho ~= 4.12 kg). Drag modeled via the platform's tabulated smooth-sphere Cd(Re) curve, which puts historical cannonball speeds past the drag crisis (supercritical, lower Cd).",
  },
  shotPut: {
    id: "shot-put",
    name: "Shot put",
    mass: 7.26,
    radius: 0.06,
    dragModel: { type: "constant", cd: 0.47 },
    liftModel: { type: "none" },
    provenance:
      "Mass (7.26 kg, men's implement) and diameter (110-130 mm, midpoint radius used) per World Athletics (IAAF) Rules of Competition, Rule 27. Cd uses the platform's subcritical-smooth-sphere default; the exact value barely matters here since shot-put speeds make the drag-to-gravity ratio Pi negligible (the platform's canonical low-Pi scenario).",
  },
};
