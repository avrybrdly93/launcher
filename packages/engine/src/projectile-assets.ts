import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * The platform's initial projectile data assets (§3.9): a smooth-sphere
 * reference plus six real-world sports/historical objects, each with a
 * provenance citation for its numeric data. Loading/validating these against
 * `ProjectileSpecSchema` at build time is P1.26; this module only holds the
 * data.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.5,
    radius: 0.05,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "Idealized smooth sphere used as the platform's drag-free/quadratic-drag reference case " +
      "(mass and radius are nominal platform values, not a measured object); Cd=0.47 is the " +
      "standard subcritical smooth-sphere value (Hoerner, Fluid-Dynamic Drag, 1965).",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragModel: { kind: "constant", cd: 0.25 },
    liftModel: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 25,
    provenance:
      "USGA/R&A Rules of Golf, Equipment Rules App. III: mass <= 45.93 g, diameter >= 42.67 mm; " +
      "Cd~0.25 for a dimpled ball at driver speeds (Bearman & Harvey, 'Golf ball aerodynamics', " +
      "Aeronautical Quarterly 27, 1976).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball (FIFA size 5)",
    mass: 0.43,
    radius: 0.10981,
    dragModel: { kind: "constant", cd: 0.25 },
    provenance:
      "FIFA Laws of the Game, Law 2: circumference 68-70 cm (69 cm midpoint used), mass 410-450 g " +
      "(430 g midpoint used); Cd~0.25 in the supercritical (turbulent) regime typical of match " +
      "speeds (Asai et al., 'Aerodynamics of a new soccer ball', J. Sports Sciences, 2007).",
  },
  {
    id: "baseball",
    name: "Baseball (MLB regulation)",
    mass: 0.145,
    radius: 0.0366,
    dragModel: { kind: "constant", cd: 0.35 },
    provenance:
      "MLB Official Baseball Rules 3.02: mass 5.00-5.25 oz (141.7-148.8 g), circumference " +
      "9-9.25 in; Cd~0.3-0.4 depending on seam orientation and speed, 0.35 used here " +
      "(Adair, The Physics of Baseball, 3rd ed., 2002).",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "ITTF Table Tennis Rules of the Game 2.1-2.2: mass 2.7 g, diameter 40 mm; treated as a " +
      "smooth sphere, Cd~0.47 (subcritical) at typical rally speeds.",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.1229,
    radius: 0.05,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "0.1 m diameter solid iron sphere (density 7874 kg/m^3, CRC Handbook of Chemistry and " +
      "Physics), giving mass = density * (4/3)*pi*r^3 ~= 4.123 kg; historical smoothbore-" +
      "cannonball reference case per the design blueprint (S3.9); Cd~0.47 (subcritical smooth sphere).",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "World Athletics Technical Rules, TR32: men's shot mass 7.260 kg, diameter 110-130 mm " +
      "(120 mm midpoint used); Cd~0.47 (subcritical smooth sphere) — aerodynamic effects are " +
      "negligible at shot-put speeds regardless of the exact value.",
  },
] as const;
