import { loadProjectileSpec } from "./projectile-asset-loader.js";
import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf, soccer,
 * baseball, table-tennis, cannonball (0.1 m iron), shot put. Cd values are
 * order-of-magnitude operating-range figures (constant-Cd model, §3.3 option
 * 1); richer sport-specific Cd(Re)/Cd(M) tables are a later-phase upgrade
 * behind the same `DragModelSpec` union, not a rework of this schema.
 */

export const SMOOTH_SPHERE: ProjectileSpec = {
  id: "smooth-sphere",
  name: "Smooth sphere (reference)",
  mass: {
    value: 1,
    citation: "Idealized reference mass, chosen for round-number characteristic scales.",
  },
  radius: {
    value: 0.05,
    citation: "Idealized reference radius, chosen for round-number characteristic scales.",
  },
  dragModel: {
    kind: "constant",
    cd: 0.47,
    citation:
      "Subcritical smooth-sphere drag coefficient (standard textbook value, e.g. Morrison 2013).",
  },
  liftModel: { kind: "none" },
  provenance:
    "Idealized non-sport reference body used as the platform's drag-free/quadratic-drag baseline.",
};

export const GOLF_BALL: ProjectileSpec = {
  id: "golf-ball",
  name: "Golf ball",
  mass: { value: 0.04593, citation: "USGA/R&A Rules of Golf, Appendix III: maximum mass 45.93 g." },
  radius: {
    value: 0.021335,
    citation: "USGA/R&A Rules of Golf, Appendix III: minimum diameter 42.67 mm.",
  },
  dragModel: {
    kind: "constant",
    cd: 0.25,
    citation: "Dimpled-ball operating-range Cd, typical launch-monitor literature value.",
  },
  liftModel: {
    kind: "saturating",
    maxCl: 0.6,
    slope: 1.6,
    citation: "Smooth-saturating CL(S) fit (eq. 3.16), backspin-dominated drive regime.",
  },
  spinDecayTauSeconds: {
    value: 25,
    citation: "Sport-typical spin-decay timescale order of magnitude (§3.6).",
  },
  provenance:
    "Regulation golf ball (USGA/R&A specifications); Magnus-dominated worked example (§3.9).",
};

export const SOCCER_BALL: ProjectileSpec = {
  id: "soccer-ball",
  name: "Soccer ball",
  mass: {
    value: 0.43,
    citation: "FIFA Laws of the Game, Law 2: size 5 ball mass 410-450 g (midpoint used).",
  },
  radius: {
    value: 0.11,
    citation:
      "FIFA Laws of the Game, Law 2: circumference 68-70 cm (midpoint) => diameter ~0.22 m.",
  },
  dragModel: {
    kind: "constant",
    cd: 0.25,
    citation: "Post-drag-crisis smooth-ish-sphere operating-range Cd for typical kick speeds.",
  },
  liftModel: {
    kind: "saturating",
    maxCl: 0.6,
    slope: 1.6,
    citation: "Smooth-saturating CL(S) fit (eq. 3.16); used for curling free-kick exhibits.",
  },
  provenance: "Regulation FIFA size-5 ball; high-Pi Magnus-curl worked example.",
};

export const BASEBALL: ProjectileSpec = {
  id: "baseball",
  name: "Baseball",
  mass: {
    value: 0.145,
    citation: "MLB Official Baseball Rules 1.09: mass 5-5.25 oz (~145 g, midpoint used).",
  },
  radius: {
    value: 0.0373,
    citation: "MLB Official Baseball Rules 1.09: circumference 9-9.25 in => diameter ~74.6 mm.",
  },
  dragModel: {
    kind: "constant",
    cd: 0.35,
    citation:
      "Seam-effect-inclusive effective Cd, typical pitched-ball operating range (~0.3-0.4).",
  },
  liftModel: {
    kind: "saturating",
    maxCl: 0.6,
    slope: 1.6,
    citation: "Smooth-saturating CL(S) fit (eq. 3.16); used for curveball/fastball spin exhibits.",
  },
  spinDecayTauSeconds: {
    value: 20,
    citation: "Sport-typical spin-decay timescale order of magnitude (§3.6).",
  },
  provenance:
    "Regulation MLB baseball; seam-effect Cd folded into one effective constant per §3.3 option 3.",
};

export const TABLE_TENNIS_BALL: ProjectileSpec = {
  id: "table-tennis-ball",
  name: "Table-tennis ball",
  mass: {
    value: 0.0027,
    citation: "ITTF Table Tennis Equipment Regulations: mass 2.67-2.77 g (~2.7 g used).",
  },
  radius: { value: 0.02, citation: "ITTF Table Tennis Equipment Regulations: diameter 40 mm." },
  dragModel: {
    kind: "constant",
    cd: 0.4,
    citation:
      "Low-mass, low-Re operating-range Cd for a light plastic sphere at typical rally speeds.",
  },
  liftModel: { kind: "none" },
  provenance: "Regulation ITTF ball; high-Pi (drag-dominated) worked example (§3.9).",
};

export const CANNONBALL: ProjectileSpec = {
  id: "cannonball",
  name: "Cannonball (0.1 m iron)",
  mass: {
    value: 4.12,
    citation:
      "0.1 m-diameter solid iron sphere: V = (4/3)*pi*0.05^3 m^3 * 7870 kg/m^3 (CRC Handbook iron density).",
  },
  radius: {
    value: 0.05,
    citation: "Nominal 0.1 m (10 cm) diameter historical cannonball, per task naming.",
  },
  dragModel: {
    kind: "constant",
    cd: 0.47,
    citation:
      "Subcritical smooth-sphere drag coefficient (standard textbook value, e.g. Morrison 2013).",
  },
  liftModel: { kind: "none" },
  provenance:
    "Historical-ballistics low-Pi worked example: high mass/area ratio, drag nearly negligible.",
};

export const SHOT_PUT: ProjectileSpec = {
  id: "shot-put",
  name: "Shot put (men's)",
  mass: {
    value: 7.26,
    citation: "World Athletics Technical Rules: men's shot put minimum mass 7.26 kg.",
  },
  radius: {
    value: 0.06,
    citation:
      "World Athletics Technical Rules: shot diameter range 110-130 mm (120 mm midpoint used).",
  },
  dragModel: {
    kind: "constant",
    cd: 0.47,
    citation:
      "Subcritical smooth-sphere drag coefficient (standard textbook value, e.g. Morrison 2013).",
  },
  liftModel: { kind: "none" },
  provenance:
    "Regulation men's shot put; lowest-Pi worked example in the initial catalog (drag ~ negligible).",
};

/**
 * The full initial catalog (§3.9); "custom" is a user-authored spec, not a
 * shipped asset. Every entry is re-validated through the asset loader (P1.26)
 * at module-evaluation time, so a corrupt hand-authored asset above fails
 * immediately rather than shipping silently.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  SMOOTH_SPHERE,
  GOLF_BALL,
  SOCCER_BALL,
  BASEBALL,
  TABLE_TENNIS_BALL,
  CANNONBALL,
  SHOT_PUT,
].map((asset) => loadProjectileSpec(asset));
