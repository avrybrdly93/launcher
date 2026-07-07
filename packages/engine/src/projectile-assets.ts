import { loadProjectileSpec, type ProjectileSpec } from "./projectile-spec.js";
import { SMOOTH_SPHERE_CD_TABLE } from "./drag-coefficient.js";

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball (0.1 m iron), shot put.
 * Every entry is run through `loadProjectileSpec` so a malformed literal
 * fails immediately on import rather than silently shipping bad data
 * (P1.26's "build-time" validation).
 */
const RAW_ASSETS: readonly Record<string, unknown>[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.5,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds", table: SMOOTH_SPHERE_CD_TABLE },
    provenance:
      "Reference smooth sphere for the drag-crisis exhibit; Cd(Re) curve digitized from the " +
      "standard smooth-sphere drag curve (e.g. Achenbach 1972), mass/radius chosen for a " +
      "convenient Reynolds range at walking-to-throwing speeds.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 20,
    provenance:
      "Mass/diameter: R&A/USGA Rules of Golf regulation limits (mass <= 45.93 g, diameter >= 42.67 mm). " +
      "Cd ~0.25 is a representative dimpled-ball value (lower than a smooth sphere at the same Re due to " +
      "the dimples tripping earlier turbulent transition); spin-decay tau is a typical-sport-scale estimate (§3.6).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.1114,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 15,
    provenance:
      "Mass/circumference: FIFA Laws of the Game regulation ranges (mass 410-450 g, circumference 68-70 cm; " +
      "radius derived from a 70 cm circumference). Cd ~0.2-0.3 is representative of match-speed Reynolds " +
      "numbers; spin-decay tau is a typical-sport-scale estimate (§3.6).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.3 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 40,
    provenance:
      "Mass/diameter: MLB official rules (mass 5-5.25 oz, circumference 9-9.25 in). Cd ~0.3-0.4 is the " +
      "commonly cited range for a seamed baseball; the lower end is used here as the default.",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.4 },
    provenance:
      "Mass/diameter: ITTF regulation (mass 2.7 g, diameter 40 mm). Cd ~0.4 is representative of the " +
      "low-Reynolds-number regime this very light, low-density ball flies in (the platform's high-Pi exemplar).",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds", table: SMOOTH_SPHERE_CD_TABLE },
    provenance:
      "0.1 m diameter solid iron sphere (density ~7874 kg/m^3) gives mass = rho*(4/3)*pi*r^3 ~4.12 kg; " +
      "modeled as a smooth sphere (Achenbach 1972 Cd(Re) curve) since a cast iron ball is aerodynamically smooth.",
  },
  {
    id: "shot-put",
    name: "Shot put (men's senior)",
    mass: 7.26,
    radius: 0.0575,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Mass/diameter: World Athletics rules for men's senior shot (mass 7.26 kg, diameter 110-130 mm). " +
      "Cd ~0.47 is the standard subcritical smooth-sphere value; drag is negligible next to gravity/inertia " +
      "for this projectile (the platform's low-Pi exemplar), so the exact Cd barely matters.",
  },
];

export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = RAW_ASSETS.map(loadProjectileSpec);
