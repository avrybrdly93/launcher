import { z } from "zod";
import type { Schema } from "./schema.js";
import { loadAssets } from "./asset-loader.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

/**
 * Serializable projectile data asset (§3.9): `(m, R, Cd-model, provenance)`.
 * Kept plain data (no class instances) so it round-trips through JSON for
 * scenario save/load and shareable URLs (P1.34/P3.31/P3.32); `dragCoefficient`
 * is a constant Cd for now — sport-specific Re-dependent tables with their
 * own provenance land in P4.05.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: z.number().positive(),
  /** Citation/derivation note for the numeric data above (e.g. rulebook, textbook Cd value). */
  provenance: z.string().min(1),
}) satisfies Schema<{
  id: string;
  label: string;
  mass: number;
  radius: number;
  dragCoefficient: number;
  provenance: string;
}>;

export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/** Converts a validated asset into the runtime `ProjectileParams` the engine's forces consume. */
export function projectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: new ConstantCd(spec.dragCoefficient),
  });
}

/**
 * The initial projectile asset library (§3.9): smooth sphere, golf, soccer,
 * baseball, table-tennis, cannonball, shot put. Every value below is a
 * published rule/reference figure, not a fit to this platform's behavior.
 * Passed through `loadAssets` so a corrupted entry fails at import/build
 * time (P1.26) instead of shipping.
 */
const RAW_PROJECTILE_ASSETS: readonly unknown[] = [
  {
    id: "smooth-sphere",
    label: "Smooth sphere (reference)",
    mass: 0.5,
    radius: 0.05,
    dragCoefficient: 0.47,
    provenance:
      "Idealized teaching reference, not a specific object. Cd=0.47 is the standard subcritical smooth-sphere drag coefficient (e.g. White, Fluid Mechanics).",
  },
  {
    id: "golf-ball",
    label: "Golf ball",
    mass: 0.0459,
    radius: 0.02135,
    dragCoefficient: 0.25,
    provenance:
      "USGA/R&A Rules of Golf: mass <= 45.93 g, diameter >= 42.67 mm. Cd~0.25 is the typical dimpled-ball drag coefficient in the operating Reynolds-number range (blueprint SS3.3; cf. Bearman & Harvey 1976).",
  },
  {
    id: "soccer-ball",
    label: "Soccer ball (size 5)",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: 0.25,
    provenance:
      "FIFA size-5 ball: mass 410-450 g, circumference 68-70 cm (radius ~0.11 m). Cd~0.25 reflects the ball's surface roughness relative to a smooth sphere at match speeds.",
  },
  {
    id: "baseball",
    label: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: 0.3,
    provenance:
      "MLB rule: mass 5.00-5.25 oz (~141.7-148.8 g), circumference 9-9.25 in (radius ~0.0366 m). Cd~0.3 accounts for seam-induced early transition relative to a smooth sphere (blueprint SS3.3).",
  },
  {
    id: "table-tennis-ball",
    label: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: 0.47,
    provenance:
      "ITTF rule: mass 2.7 g, diameter 40 mm. Smooth plastic sphere at subcritical Re (typical rally speeds), so the standard smooth-sphere Cd=0.47 applies (blueprint SS3.8 notes this preset's benign drag timescale).",
  },
  {
    id: "cannonball",
    label: "Cannonball (0.1 m iron)",
    mass: 3.77,
    radius: 0.05,
    dragCoefficient: 0.47,
    provenance:
      "0.1 m diameter solid cast-iron sphere, density ~7200 kg/m^3 => mass = density * (4/3)*pi*r^3 ~ 3.77 kg. Smooth-sphere Cd=0.47.",
  },
  {
    id: "shot-put",
    label: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: 0.47,
    provenance:
      "World Athletics rule: men's shot mass 7.26 kg (16 lb), diameter 110-130 mm (radius ~0.06 m). Smooth-sphere Cd=0.47.",
  },
];

export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = loadAssets(
  ProjectileSpecSchema,
  RAW_PROJECTILE_ASSETS,
  "projectile-spec.ts built-in assets",
);
