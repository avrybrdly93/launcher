import { loadProjectileAssets } from "./asset-loader.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball, shot put. Every numeric
 * datum carries a citation in `provenance`. Routed through
 * `loadProjectileAssets` so a typo here fails at import time with a useful
 * per-asset error rather than silently shipping bad physics data.
 */
const RAW_PROJECTILE_ASSETS: readonly unknown[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.1,
    radius: 0.05,
    dragModel: { kind: "tabulated-smooth-sphere" },
    provenance:
      "Synthetic reference sphere for validation (round m=0.1 kg, R=0.05 m); Cd(Re) from the smooth-sphere drag-crisis table (§3.3).",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragModel: { kind: "constant", cd: 0.47 },
    liftModel: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 25,
    provenance:
      "USGA/R&A Rules of Golf, Equipment Rules: mass <=45.93 g, diameter >=42.67 mm. Cd modeled as the smooth-sphere subcritical default (0.47); dimple aerodynamics not modeled.",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball (size 5)",
    mass: 0.43,
    radius: 0.11,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "FIFA Laws of the Game, Law 2: mass 410-450 g, circumference 68-70 cm (=> diameter ~22 cm). Cd modeled as the smooth-sphere subcritical default (0.47); panel-seam aerodynamics not modeled.",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragModel: { kind: "constant", cd: 0.47 },
    liftModel: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 20,
    provenance:
      "MLB Official Baseball Rules 3.01: weight 5-5.25 oz (142-149 g), circumference 9-9.25 in (=> diameter ~73 mm). Cd modeled as the smooth-sphere subcritical default (0.47); seam aerodynamics not modeled.",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "ITTF Equipment Regulations: mass 2.7 g, diameter 40 mm. Cd modeled as the smooth-sphere subcritical default (0.47).",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.121,
    radius: 0.05,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "0.1 m diameter solid sphere, cast iron density 7870 kg/m^3 (CRC Handbook of Chemistry and Physics) => mass = rho*(4/3)*pi*R^3 ~= 4.121 kg. Cd modeled as the smooth-sphere subcritical default (0.47).",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "World Athletics Technical Rules, TR32: men's shot mass 7.26 kg, diameter 110-130 mm. Cd modeled as the smooth-sphere subcritical default (0.47).",
  },
];

export const PROJECTILE_ASSETS = loadProjectileAssets(RAW_PROJECTILE_ASSETS);
