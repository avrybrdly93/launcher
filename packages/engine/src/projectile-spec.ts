import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { parseWithSchema } from "./schema.js";

/** Serializable descriptor resolving to a `DragCoefficientModel` (§3.3). */
export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds") }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Serializable descriptor resolving to a `LiftCoefficientModel` (§3.6). */
export const LiftCoefficientSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * Serializable, citable record of a projectile's physical properties (§3.9):
 * (m, R, Cd-model, CL-model, tau_omega, provenance). This is the on-disk/data-asset
 * form; `projectileParamsFromSpec` resolves it into a runtime `ProjectileParams`.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** Spin decay time constant tau_omega (s), §3.6. Omit to disable spin decay. */
  spinDecayTau: z.number().positive().optional(),
  /** Citation for the numeric data above (source of mass/radius/Cd figures). */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

function resolveDragCoefficient(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.value);
    case "tabulated-reynolds":
      return new TabulatedReynoldsCd();
  }
}

function resolveLiftCoefficient(spec: LiftCoefficientSpec): LiftCoefficientModel {
  return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
}

/** Resolves a validated `ProjectileSpec` into the runtime `ProjectileParams` forces consume. */
export function projectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: resolveDragCoefficient(spec.dragCoefficient),
    liftCoefficient: spec.liftCoefficient
      ? resolveLiftCoefficient(spec.liftCoefficient)
      : undefined,
  });
}

/** Parses+validates raw data against `ProjectileSpecSchema`, throwing a useful error on failure (P1.26). */
export function parseProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, data);
}

const IRON_DENSITY_KG_M3 = 7870;
function sphereMass(radius: number, density: number): number {
  return density * (4 / 3) * Math.PI * radius * radius * radius;
}

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf, soccer, baseball,
 * table-tennis ball, cannonball, shot put. Each numeric figure is approximate,
 * regulation-typical data with its source cited in `provenance` — these are
 * teaching/validation presets, not precision engineering data.
 *
 * Every entry is piped through `parseProjectileSpec` below (P1.26's asset
 * loader), so a corrupt literal here fails as soon as this module loads
 * (i.e. at test/build time) rather than silently propagating into a scenario.
 */
const RAW_PROJECTILE_ASSETS: readonly unknown[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 1,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds" },
    provenance:
      "Generic 1 kg, 5 cm-radius smooth sphere; not a specific real object, used as the drag-free/analytic reference case. Cd(Re) from the smooth-sphere drag-crisis curve.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 15,
    provenance:
      "Mass/diameter at the R&A/USGA regulation maxima (45.93 g, 42.67 mm min diameter). Cd ~0.25 is a typical in-flight value for a dimpled golf ball (dimples delay boundary-layer separation vs. a smooth sphere); spin decay is an order-of-magnitude estimate.",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "Mass 430 g and circumference ~69 cm (radius ~0.11 m) are FIFA Law 2 regulation values. Cd ~0.25 reflects a seamed ball operating near/past the drag crisis at typical kick speeds (matches the P1.16 buoyancy validation preset).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.3 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 20,
    provenance:
      "Mass 145 g and circumference ~22.9-23.5 cm (radius ~0.0366 m) are MLB regulation values. Cd ~0.3 is a commonly cited in-flight figure for a seamed baseball.",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.5 },
    provenance:
      "Mass 2.7 g and diameter 40 mm are ITTF regulation values. Cd ~0.5 is typical for a smooth low-Reynolds-number plastic sphere; this is the platform's canonical high-Pi (drag-dominated) preset.",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: sphereMass(0.05, IRON_DENSITY_KG_M3),
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds" },
    provenance:
      "10 cm-diameter solid iron sphere (density 7870 kg/m^3), mass derived as (4/3)*pi*r^3*rho ~ 3.3 kg. Cd(Re) uses the tabulated smooth-sphere curve — the classic teaching example for how the drag crisis affects a cannonball's range.",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Mass 7.26 kg (16 lb) is the men's World Athletics regulation minimum; radius ~0.06 m is within the regulation diameter range (110-130 mm). Smooth-sphere Cd; this is the platform's canonical low-Pi (gravity-dominated) preset.",
  },
];

export const PROJECTILE_ASSETS: readonly ProjectileSpec[] =
  RAW_PROJECTILE_ASSETS.map(parseProjectileSpec);
