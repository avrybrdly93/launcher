import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball (0.1 m iron), and shot put.
 * Every numeric datum cites its source in `provenance` (P1.25 validation
 * criterion); Cd values are deliberately simple constants except the
 * reference smooth sphere, which uses the tabulated Re-dependent curve to
 * exercise the drag-crisis model (P1.09).
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth Sphere (reference)",
    mass: 1,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds-smooth-sphere" },
    provenance:
      "Generic reference smooth sphere (m=1 kg, R=0.05 m by convention); Cd(Re) curve including the drag crisis near Re~3e5 per Achenbach, 'Experiments on the flow past spheres at very high Reynolds numbers' (1972).",
  },
  {
    id: "golf-ball",
    name: "Golf Ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating" },
    provenance:
      "USGA/R&A Rules of Golf, Appendix III: mass <= 45.93 g, diameter >= 42.67 mm; Cd~0.25 for a dimpled ball per Bearman & Harvey, 'Golf ball aerodynamics' (Aeronautical Quarterly, 1976).",
  },
  {
    id: "soccer-ball",
    name: "Soccer Ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "FIFA Laws of the Game, Law 2: mass 410-450 g, circumference 68-70 cm (R~0.11 m); Cd~0.25 per Asai et al., 'Fundamental aerodynamics of the soccer ball' (Sports Engineering, 2007).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.3 },
    provenance:
      "MLB Official Baseball Rules: mass 5.00-5.25 oz, circumference 9.00-9.25 in (R~0.0366 m); Cd~0.3-0.4 per Adair, 'The Physics of Baseball' (3rd ed., 2002).",
  },
  {
    id: "table-tennis-ball",
    name: "Table Tennis Ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.45 },
    provenance:
      "ITTF Table Tennis Equipment Regulations: mass 2.7 g, diameter 40 mm; Cd~0.45 (subcritical smooth-sphere regime) per Cross, 'The Physics of Table Tennis' (2013).",
  },
  {
    id: "cannonball-0.1m-iron",
    name: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Solid iron sphere, 0.1 m diameter; density 7870 kg/m^3 per CRC Handbook of Chemistry and Physics, mass = density * (4/3)*pi*R^3 ~ 4.12 kg; Cd~0.47 smooth-sphere subcritical per Hoerner, 'Fluid-Dynamic Drag' (1965).",
  },
  {
    id: "shot-put",
    name: "Shot Put",
    mass: 7.26,
    radius: 0.055,
    dragCoefficient: { kind: "constant", value: 0.5 },
    provenance:
      "World Athletics Technical Rules: men's shot mass 7.260 kg, diameter 110-130 mm (R~0.055 m); Cd~0.5 rough-sphere approximation per Hoerner, 'Fluid-Dynamic Drag' (1965).",
  },
];
