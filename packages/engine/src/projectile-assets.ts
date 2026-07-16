import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * The core `ProjectileSpec` data assets (§3.9): smooth sphere, golf, soccer,
 * baseball, table-tennis, cannonball, and shot put. Every entry cites where
 * its numbers came from; the build-time loader (P1.26) turns these into live
 * `ProjectileParams` via `createSphericalProjectileParams`.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    displayName: "Smooth sphere (reference)",
    mass: 1,
    radius: 0.05,
    dragModel: { kind: "constant", value: 0.47 },
    liftModel: { kind: "none" },
    provenance:
      "Generic pedagogical reference sphere (10 cm diameter, 1 kg); Cd=0.47 is the textbook subcritical smooth-sphere value (e.g. Achenbach 1972 correlation, Re < 2e5).",
  },
  {
    id: "golf-ball",
    displayName: "Golf ball",
    mass: 0.0459,
    radius: 0.02135,
    dragModel: { kind: "constant", value: 0.25 },
    liftModel: { kind: "saturating" },
    provenance:
      "Rules of Golf (R&A/USGA): mass <= 45.93 g, diameter >= 42.67 mm. Cd~0.25 reflects the dimpled-surface drag reduction relative to a smooth sphere in its typical drive-speed operating range (~30-70 m/s).",
  },
  {
    id: "soccer-ball",
    displayName: "Soccer ball (size 5)",
    mass: 0.43,
    radius: 0.11,
    dragModel: { kind: "constant", value: 0.25 },
    liftModel: { kind: "saturating" },
    provenance:
      "FIFA size-5 ball: mass 420-450 g, circumference 68-70 cm (radius ~= 0.11 m). Cd~0.25 is a commonly cited operating-range value for a modern paneled ball.",
  },
  {
    id: "baseball",
    displayName: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragModel: { kind: "constant", value: 0.3 },
    liftModel: { kind: "saturating" },
    provenance:
      "MLB spec: mass 5.00-5.25 oz (~0.145 kg), circumference 9.00-9.25 in (radius ~= 0.0366 m). Cd~0.3 folds in seam-roughness drag reduction relative to a smooth sphere (blueprint 3.3).",
  },
  {
    id: "table-tennis-ball",
    displayName: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragModel: { kind: "constant", value: 0.5 },
    liftModel: { kind: "saturating" },
    provenance:
      "ITTF spec (post-2014 plastic ball): diameter 40 mm, mass 2.7 g. Cd~0.5 reflects its low-Reynolds-number operating regime relative to a smooth sphere at comparable speed.",
  },
  {
    id: "cannonball",
    displayName: "Cannonball (0.1 m iron sphere)",
    mass: 4.12,
    radius: 0.05,
    dragModel: { kind: "constant", value: 0.47 },
    liftModel: { kind: "none" },
    provenance:
      "0.1 m diameter solid sphere of wrought iron (rho ~= 7874 kg/m^3): mass = rho * (4/3)*pi*r^3 ~= 4.12 kg. Cd=0.47 is the simplified constant-sphere approximation; real supersonic/drag-crisis regimes need the tabulated Cd(Re) model.",
  },
  {
    id: "shot-put",
    displayName: "Shot put (men's, 7.26 kg)",
    mass: 7.26,
    radius: 0.06,
    dragModel: { kind: "constant", value: 0.47 },
    liftModel: { kind: "none" },
    provenance:
      "World Athletics men's shot: mass 7.260 kg, diameter 110-130 mm (radius ~= 0.06 m at midrange). Cd=0.47 (smooth sphere); its very low Pi (drag-to-gravity ratio) comes from its high mass, not a special Cd.",
  },
];
