import type { ProjectileSpec } from "./projectile-spec.js";

/** Generic smooth sphere sized for the Re range that spans the drag crisis (§3.3 option 2 demo). */
export const SMOOTH_SPHERE: ProjectileSpec = {
  id: "smooth-sphere",
  name: "Smooth sphere",
  mass: 0.5,
  radius: 0.05,
  dragModel: "tabulated-reynolds",
  provenance:
    "Generic smooth sphere; Cd(Re) drag-crisis curve per Achenbach (1972) experimental data. Mass/radius chosen to put typical launch speeds through Re ~ 1e4-1e6, not a specific physical object.",
};

/** Regulation golf ball (R&A/USGA rules). */
export const GOLF_BALL: ProjectileSpec = {
  id: "golf-ball",
  name: "Golf ball",
  mass: 0.0459,
  radius: 0.02135,
  dragModel: "constant",
  constantCd: 0.25,
  liftModel: "saturating",
  spinDecayTau: 25,
  provenance:
    "R&A/USGA Rules of Golf: mass <= 45.93 g, diameter >= 42.67 mm. Cd ~ 0.25 for a dimpled ball in its operating range per blueprint §3.3 option 3.",
};

/** FIFA-regulation size-5 soccer ball; also the buoyancy-ratio reference case (P1.16). */
export const SOCCER_BALL: ProjectileSpec = {
  id: "soccer-ball",
  name: "Soccer ball",
  mass: 0.43,
  radius: 0.11,
  dragModel: "constant",
  constantCd: 0.25,
  liftModel: "saturating",
  spinDecayTau: 20,
  provenance:
    "FIFA Laws of the Game, size 5: circumference 68-70 cm (radius ~0.11 m), mass 410-450 g. Cd ~ 0.25 typical of a modern paneled ball per blueprint §3.3 option 3.",
};

/** Regulation MLB baseball. */
export const BASEBALL: ProjectileSpec = {
  id: "baseball",
  name: "Baseball",
  mass: 0.145,
  radius: 0.0366,
  dragModel: "constant",
  constantCd: 0.3,
  liftModel: "saturating",
  spinDecayTau: 20,
  provenance:
    "MLB official ball: mass 5.00-5.25 oz (0.145 kg used here), circumference 9-9.25 in (radius ~0.0366 m). Cd ~ 0.3 with seam effects folded in, per Adair, The Physics of Baseball, and blueprint §3.3 option 3.",
};

/** Regulation ITTF table-tennis ball, the platform's canonical high-Pi (drag-dominated) preset. */
export const TABLE_TENNIS_BALL: ProjectileSpec = {
  id: "table-tennis-ball",
  name: "Table-tennis ball",
  mass: 0.0027,
  radius: 0.02,
  dragModel: "constant",
  constantCd: 0.47,
  liftModel: "saturating",
  spinDecayTau: 30,
  provenance:
    "ITTF regulation: mass 2.7 g, diameter 40 mm. Cd ~ 0.47 smooth-sphere subcritical value (Re ~ 7e4 at typical rally speeds, below the ~3e5 drag crisis) per blueprint §3.3 option 1.",
};

/** Historical 0.1 m iron smoothbore cannonball, a low-Pi ballistics reference. */
export const CANNONBALL: ProjectileSpec = {
  id: "cannonball",
  name: "Cannonball (0.1 m iron)",
  mass: 4.12,
  radius: 0.05,
  dragModel: "tabulated-reynolds",
  provenance:
    "Illustrative 0.1 m diameter smoothbore iron cannonball; mass from iron density 7870 kg/m^3 times sphere volume. Cd(Re) drag-crisis curve per Achenbach (1972) — historical launch speeds (~200-400 m/s) put Re well past the crisis.",
};

/** World Athletics men's shot put, the platform's canonical low-Pi (drag-negligible) preset. */
export const SHOT_PUT: ProjectileSpec = {
  id: "shot-put",
  name: "Shot put",
  mass: 7.26,
  radius: 0.06,
  dragModel: "constant",
  constantCd: 0.47,
  provenance:
    "World Athletics rules, men's shot: mass 7.260 kg, diameter 110-130 mm (radius ~0.06 m used here). Cd ~ 0.47 smooth-sphere default; drag is negligible for this preset's low Pi.",
};

/** The full initial projectile asset library (§3.9). */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  SMOOTH_SPHERE,
  GOLF_BALL,
  SOCCER_BALL,
  BASEBALL,
  TABLE_TENNIS_BALL,
  CANNONBALL,
  SHOT_PUT,
];
