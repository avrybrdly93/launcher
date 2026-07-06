import { z } from "zod";
import { loadAssets } from "./asset-loader.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

/** Data-only descriptor for a `DragCoefficientModel` choice (§3.3), serializable in a `ProjectileSpec`. */
export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds") }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Data-only descriptor for a `LiftCoefficientModel` choice (§3.6). */
export const LiftCoefficientSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * `(m, R, Cd-model, CL-model, tau_omega, provenance)` per §3.9 — the
 * serializable record an asset ships as data; `resolveProjectileSpec` turns
 * it into the live `ProjectileParams` the engine actually integrates with.
 * Every numeric datum's source is required in `provenance` (no silent
 * unsourced constants in the asset library).
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** Spin decay time constant tau_omega (§3.6), seconds. Omit if spin isn't modeled. */
  spinDecayTau: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/** Instantiates the live drag/lift models a `ProjectileSpec`'s descriptors name. */
function resolveDragCoefficient(spec: DragCoefficientSpec): ConstantCd | TabulatedReynoldsCd {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.value);
    case "tabulated-reynolds":
      return new TabulatedReynoldsCd();
  }
}

function resolveLiftCoefficient(spec: LiftCoefficientSpec): SaturatingLiftCoefficient {
  return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
}

/** Builds runtime `ProjectileParams` from a validated `ProjectileSpec` (spin omitted: it's an initial condition, not a projectile property). */
export function resolveProjectileSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: resolveDragCoefficient(spec.dragCoefficient),
    ...(spec.liftCoefficient !== undefined
      ? { liftCoefficient: resolveLiftCoefficient(spec.liftCoefficient) }
      : {}),
  });
}

const IRON_DENSITY_KG_M3 = 7874;
const CANNONBALL_RADIUS_M = 0.05; // "0.1 m iron" (§3.9) => 0.1 m diameter
const cannonballMass = IRON_DENSITY_KG_M3 * ((4 / 3) * Math.PI * CANNONBALL_RADIUS_M ** 3);

/**
 * Raw projectile asset fixtures (§3.9): smooth sphere, golf, soccer,
 * baseball, table-tennis, cannonball, shot put, spanning the regime groups
 * (Pi, Re, spin) the preset scenarios (P1.36) will draw from. Untyped (as if
 * sourced from a JSON data file) so `loadAssets` below actually exercises
 * schema validation rather than relying on TS structural typing alone.
 */
const PROJECTILE_ASSET_FIXTURES: readonly unknown[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.1,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Idealized smooth sphere, subcritical drag regime: Cd=0.47 is the standard textbook constant for a sphere (also the ConstantCd default, P1.10). Mass (100 g) and radius (5 cm) are an arbitrary convenient reference, not a specific real object.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 25,
    provenance:
      "Mass <= 45.93 g, diameter >= 42.67 mm per USGA/R&A rules of golf equipment. Cd~0.25 dimpled sphere in typical drive-speed operating range (blueprint §3.3). Spin decay tau_omega ~20-30 s is the blueprint's sport-typical range (§3.6); 25 s taken as the midpoint.",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 25,
    provenance:
      "FIFA regulation ball: mass 410-450 g, circumference 68-70 cm (=> radius ~11 cm). Cd~0.2-0.25 typical for a soccer ball in flight; 0.25 chosen for consistency with the existing buoyancy validation fixture (forces.test.ts, P1.16). Spin decay uses the blueprint's generic sport-typical midpoint (§3.6).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.3 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 25,
    provenance:
      "Official MLB spec: mass 5.00-5.25 oz (141.7-148.8 g, 145 g used), circumference 9-9.25 in (=> radius ~3.66 cm). Cd~0.3-0.35 with seam effects folded into an effective constant (blueprint §3.3); 0.3 chosen mid-range. Spin decay uses the blueprint's generic sport-typical midpoint (§3.6).",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "tabulated-reynolds" },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 20,
    provenance:
      "Official ITTF spec: mass 2.7 g, diameter 40 mm. Smooth (non-dimpled) sphere, so the tabulated smooth-sphere Cd(Re) curve (P1.12, including the drag crisis) applies directly rather than a sport-specific constant. Spin decay taken at the low end of the blueprint's sport-typical range (§3.6) given the ball's low mass/high drag.",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: cannonballMass,
    radius: CANNONBALL_RADIUS_M,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "0.1 m diameter solid iron sphere (density 7874 kg/m^3 for wrought iron); mass derived from volume x density. A classic long-range ballistics teaching case (blueprint §3.9). Smooth-sphere Cd=0.47.",
  },
  {
    id: "shot-put",
    name: "Shot put (men's outdoor)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "World Athletics rules, men's outdoor shot: mass >= 7.260 kg, diameter 110-130 mm; radius taken as the rule range's midpoint (60 mm). Smooth-sphere Cd=0.47 — the blueprint's canonical low-Pi (drag-negligible) regime example (§3.8).",
  },
];

/**
 * The validated asset library (P1.26): every fixture above is schema-checked
 * as soon as this module is imported, so a corrupt fixture fails at
 * build/import time with a useful error rather than shipping.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = loadAssets(
  ProjectileSpecSchema,
  PROJECTILE_ASSET_FIXTURES,
  "projectile",
);
