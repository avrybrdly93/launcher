import { z } from "zod";
import { loadAssetArray } from "./asset-loader.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

/**
 * Serializable projectile data record (§3.9): (m, R, Cd-model, Cl-model,
 * tau_omega, provenance). Every numeric datum carries a citation in
 * `provenance` — this is asset data, not live model instances, so it can
 * round-trip through JSON (scenario files, P1.34) before an asset loader
 * (P1.26) turns it into a `ProjectileParams`.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: z.number().positive(), // constant Cd (§3.3 option 1)
  liftCoefficient: z.literal("saturating").optional(), // enables Magnus via eq. (3.16)
  spinDecayTau: z.number().positive().optional(), // s, omitted => spin decay disabled
  provenance: z.string().min(1),
});

export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/** Instantiates the live drag/lift model instances a `ProjectileSpec` describes. */
export function toProjectileParams(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: new ConstantCd(spec.dragCoefficient),
    liftCoefficient:
      spec.liftCoefficient === "saturating" ? new SaturatingLiftCoefficient() : undefined,
  });
}

/**
 * Raw asset fixtures, deliberately untyped (`unknown[]`) — this simulates
 * data loaded from an external source (JSON asset file) and forces it
 * through the same `loadAssetArray` validation path a real loader would use,
 * rather than trusting the TS type system alone (P1.26).
 */
const PROJECTILE_ASSET_FIXTURES: readonly unknown[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere",
    mass: 0.1,
    radius: 0.05,
    dragCoefficient: 0.47,
    provenance:
      "Canonical reference case: Cd=0.47 is the standard textbook subcritical-regime value " +
      "for a smooth sphere (Re < ~2e5), e.g. Munson, Young & Okiishi, Fundamentals of Fluid Mechanics.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.0459,
    radius: 0.021335,
    dragCoefficient: 0.25,
    liftCoefficient: "saturating",
    spinDecayTau: 25,
    provenance:
      "Mass/diameter from the R&A/USGA Rules of Golf equipment spec (mass <= 45.93 g, " +
      "diameter >= 42.67 mm). Cd~0.25 for a dimpled sphere in its operating Reynolds range " +
      "per Bearman & Harvey, 'Golf ball aerodynamics', Aeronautical Quarterly (1976).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.1115,
    dragCoefficient: 0.25,
    provenance:
      "Mass/circumference midpoint of the FIFA Quality Standard spec (410-450 g, " +
      "68-70 cm circumference). Cd~0.25 in typical match-speed Reynolds range per " +
      "Asai, Seo, Kobayashi & Sakashita, 'Fundamental aerodynamics of the soccer ball', " +
      "Sports Engineering (2007).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: 0.3,
    liftCoefficient: "saturating",
    spinDecayTau: 20,
    provenance:
      "Mass/circumference midpoint of the MLB official ball spec (5-5.25 oz, " +
      "9-9.25 in circumference). Cd~0.3 typical value (seam-orientation dependence " +
      "folded into this effective constant) per Adair, The Physics of Baseball, 3rd ed. (2002).",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: 0.45,
    liftCoefficient: "saturating",
    spinDecayTau: 20,
    provenance:
      "Mass/diameter from the ITTF equipment spec (2.7 g, 40 mm diameter). Cd~0.45 " +
      "subcritical smooth-sphere value at the TT ball's characteristic Reynolds number " +
      "per Kensrud, 'Aerodynamics of Sport Balls', PhD thesis, Washington State University (2010).",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.121,
    radius: 0.05,
    dragCoefficient: 0.47,
    provenance:
      "0.1 m diameter solid iron sphere; mass = (4/3)*pi*R^3 * rho_iron with " +
      "rho_iron ~ 7870 kg/m^3 (standard density reference for cast/wrought iron). " +
      "Cd=0.47 smooth-sphere baseline (surface roughness effects neglected).",
  },
  {
    id: "shot-put",
    name: "Shot put",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: 0.47,
    provenance:
      "Mass from the World Athletics men's shot put specification (7.260 kg); " +
      "radius from the mid-range allowed diameter (110-130 mm). Cd=0.47 smooth-sphere " +
      "baseline (drag is negligible at shot-put speeds; this asset is the platform's " +
      "canonical low-Pi, drag-irrelevant regime example, §3.8).",
  },
];

/** Initial projectile data assets (§3.9): smooth sphere, golf, soccer, baseball, TT ball, cannonball, shot put. */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = loadAssetArray(
  ProjectileSpecSchema,
  PROJECTILE_ASSET_FIXTURES,
  "ProjectileSpec",
);
