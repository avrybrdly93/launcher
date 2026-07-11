import { loadAssets } from "./asset-loader.js";
import { projectileSpecSchema, type ProjectileSpec } from "./projectile-spec.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball, shot put. Each is parsed
 * through `projectileSpecSchema` at module load so a malformed asset fails
 * fast rather than surfacing as a silent bad simulation. Cd figures here are
 * single representative literature values pending the sport-specific
 * Cd(Re)/Cd(M) tables and asserted-bounds validation of Phase 4 (P4.04/P4.05).
 */
const RAW_PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.5,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds-smooth-sphere" },
    provenance:
      "Generic reference sphere; Cd(Re) drag-crisis curve is the engine's default smooth-sphere " +
      "table (SMOOTH_SPHERE_CD_TABLE), approximating the classical curve in Achenbach (1972) and " +
      "White, Fluid Mechanics.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.0459,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "Mass/diameter from the R&A/USGA Rules of Golf (mass <=45.93 g, diameter >=42.67 mm). " +
      "Cd~0.25 typical dimpled-ball value per Bearman & Harvey (1976), 'Golf ball aerodynamics'. " +
      "Lift (backspin) modeling arrives in P4.05-P4.08.",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball (size 5)",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "Mass/circumference from FIFA Laws of the Game, Law 2 (mass 410-450 g, circumference " +
      "68-70 cm). Cd~0.25 for the turbulent-regime match-speed range per Asai et al. (2007), " +
      "'Fundamental aerodynamics of the soccer ball'.",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.35 },
    provenance:
      "Mass/circumference from MLB Official Baseball Rules (mass 5.00-5.25 oz, circumference " +
      "9.00-9.25 in). Cd~0.3-0.4 depending on seam orientation per Adair, The Physics of Baseball " +
      "(3rd ed., 2002); midpoint used pending sport-specific fit (P4.05).",
  },
  {
    id: "table-tennis-ball",
    name: "Table tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.4 },
    provenance:
      "Mass/diameter from ITTF Table Tennis Rules (mass 2.67-2.77 g, diameter 40 mm). Cd~0.4, " +
      "representative of the Re~1e4-1e5 range typical of table-tennis play on the smooth-sphere " +
      "curve.",
  },
  {
    id: "cannonball-0.1m-iron",
    name: "Cannonball (0.1 m iron)",
    mass: 4.1207,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds-smooth-sphere" },
    provenance:
      "0.1 m diameter solid iron sphere; mass = rho_Fe * (4/3)*pi*r^3 with rho_Fe = 7870 kg/m^3 " +
      "(CRC Handbook of Chemistry and Physics). Cd from the engine's smooth-sphere Cd(Re) curve, " +
      "high-Re post-drag-crisis regime typical of muzzle velocities.",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.061,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Mass/diameter from World Athletics Technical Rules, C2.1 (men's mass 7.260 kg, diameter " +
      "110-130 mm). Cd=0.47 standard-sphere approximation; drag is a negligible perturbation for " +
      "this low-Pi scenario (Sec. 3.8).",
  },
];

export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = loadAssets(
  projectileSpecSchema,
  RAW_PROJECTILE_ASSETS,
  "projectile-assets",
);

export const PROJECTILE_ASSETS_BY_ID: ReadonlyMap<string, ProjectileSpec> = new Map(
  PROJECTILE_ASSETS.map((spec) => [spec.id, spec]),
);
