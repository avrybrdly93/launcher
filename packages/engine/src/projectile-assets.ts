import { parseProjectileSpec, type ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf, soccer,
 * baseball, table-tennis, cannonball, shot put. Every numeric datum carries
 * a provenance citation. Parsed through the schema at module load, so a
 * malformed asset fails immediately rather than at first use.
 */
const RAW_PROJECTILE_ASSETS: readonly unknown[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.1,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds" },
    provenance:
      "Generic 10 cm smooth sphere; Cd(Re) drag-crisis curve is the platform's default Reynolds-dependent fit (SMOOTH_SPHERE_CD_TABLE in drag-coefficient.ts), broadly consistent with classical smooth-sphere drag data (e.g. Achenbach, 1972).",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", cd: 0.25 },
    liftCoefficient: { kind: "saturating" },
    provenance:
      "USGA/R&A regulation golf ball (mass <= 45.93 g, diameter >= 42.67 mm); Cd ~= 0.25 for a dimpled sphere in its operating Reynolds range (Bearman & Harvey, 'Golf ball aerodynamics', Aeronautical Quarterly, 1976).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", cd: 0.25 },
    provenance:
      "FIFA Laws of the Game, Law 2 (ball mass 410-450 g, circumference 68-70 cm); Cd ~= 0.25, typical for a modern soccer ball at match-speed Reynolds numbers (Asai et al., 'Fundamental aerodynamics of the soccer ball', Sports Engineering, 2007).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", cd: 0.3 },
    provenance:
      "MLB regulation baseball (mass 5.125 oz = 0.145 kg, circumference 9.125 in => radius 0.0366 m); effective Cd ~= 0.3 including seam effects (Adair, 'The Physics of Baseball', 3rd ed., 2002).",
  },
  {
    id: "table-tennis-ball",
    name: "Table tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", cd: 0.5 },
    provenance:
      "ITTF regulation ball (mass 2.7 g, diameter 40 mm); Cd ~= 0.5 for a smooth sphere at its low operating Reynolds number, consistent with subcritical smooth-sphere drag data.",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 3.82,
    radius: 0.05,
    dragCoefficient: { kind: "constant", cd: 0.47 },
    provenance:
      "0.1 m diameter cast-iron sphere (density ~= 7300 kg/m^3 => mass ~= 3.82 kg); Cd ~= 0.47 subcritical smooth-sphere default. Real cast-iron surface roughness, neglected here, would shift the drag crisis to lower Re than a polished sphere.",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", cd: 0.47 },
    provenance:
      "World Athletics men's shot specification (mass 7.26 kg, diameter 110-130 mm); Cd ~= 0.47 smooth-sphere default -- drag is negligible next to gravity for this projectile's low Pi (drag-to-gravity dimensionless group, eq. 3.10/3.19 nondimensionalization).",
  },
];

export const PROJECTILE_ASSETS: readonly ProjectileSpec[] =
  RAW_PROJECTILE_ASSETS.map(parseProjectileSpec);
