import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

/** Declarative descriptor for a DragCoefficientModel (§3.3), serializable as data. */
export const DragCoefficientSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("constant"), value: z.number().nonnegative() }),
  z.object({
    type: z.literal("tabulated-reynolds"),
    table: z.object({
      re: z.array(z.number().positive()).min(2),
      cd: z.array(z.number().nonnegative()).min(2),
    }),
  }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Declarative descriptor for a LiftCoefficientModel (§3.6), serializable as data. */
export const LiftCoefficientSpecSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("saturating"),
    maxCl: z.number().positive().optional(),
    slope: z.number().positive().optional(),
  }),
]);
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): the serializable record an asset file/db row
 * holds — (m, R, Cd-model, Cl-model, tau_omega, provenance) — as opposed to
 * `ProjectileParams`, the runtime object with live model instances that
 * `createProjectileParamsFromSpec` below builds from it. Every asset must
 * carry a non-empty `provenance` citation (§3.9's "every numeric datum
 * carries a citation field", scoped here to one citation per asset).
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** Spin decay time constant tau_omega, s (§3.6); sport-typical ~20-30s. Not yet consumed by the rhs (spin decay lands in a later phase). */
  spinDecayTau: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/** Builds the runtime `ProjectileParams` (live Cd/Cl model instances) from a validated spec. */
export function createProjectileParamsFromSpec(
  spec: ProjectileSpec,
  spin?: number,
): ProjectileParams {
  const dragCoefficient =
    spec.dragCoefficient.type === "constant"
      ? new ConstantCd(spec.dragCoefficient.value)
      : new TabulatedReynoldsCd(spec.dragCoefficient.table);
  const liftCoefficient = spec.liftCoefficient
    ? new SaturatingLiftCoefficient(spec.liftCoefficient.maxCl, spec.liftCoefficient.slope)
    : undefined;

  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient,
    liftCoefficient,
    spin,
  });
}

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball (0.1 m iron), shot put.
 * Values are representative regulation/reference figures, each with its own
 * provenance citation; sport Cd/Cl figures are approximate operating-range
 * values, not full Cd(Re) curves (those land in P4.05).
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere",
    mass: 0.1,
    radius: 0.05,
    dragCoefficient: { type: "constant", value: 0.47 },
    provenance: "Subcritical smooth-sphere Cd ~= 0.47 (Hoerner, Fluid-Dynamic Drag, 1965).",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.02135,
    dragCoefficient: { type: "constant", value: 0.25 },
    liftCoefficient: { type: "saturating" },
    spinDecayTau: 25,
    provenance:
      "USGA regulation mass (45.93 g) and diameter (42.67 mm); dimpled-ball drive-regime Cd ~= 0.25 (Bearman & Harvey, 1976).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { type: "constant", value: 0.25 },
    provenance:
      "FIFA size-5 regulation mass (430 g) and diameter (220 mm); Cd ~= 0.25 (Asai et al., 2007, soccer ball aerodynamics).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { type: "constant", value: 0.35 },
    spinDecayTau: 20,
    provenance:
      "MLB regulation mass (5.125 oz) and circumference (9.125 in); Cd ~= 0.3-0.5 seam-orientation-dependent, effective value 0.35 (Adair, The Physics of Baseball).",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { type: "constant", value: 0.4 },
    provenance:
      "ITTF regulation mass (2.7 g) and diameter (40 mm); low-Re Cd ~= 0.4-0.5 (Kwak et al., 2010).",
  },
  {
    id: "cannonball-0.1m-iron",
    name: "Cannonball (0.1 m, iron)",
    mass: 4.12,
    radius: 0.05,
    dragCoefficient: { type: "constant", value: 0.5 },
    provenance:
      "0.1 m diameter solid cast-iron sphere, rho_iron = 7870 kg/m^3 (standard reference density); rough-sphere Cd ~= 0.5 (Hoerner, Fluid-Dynamic Drag, 1965).",
  },
  {
    id: "shot-put",
    name: "Shot put",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { type: "constant", value: 0.47 },
    provenance:
      "World Athletics men's regulation mass (7.260 kg) and diameter range (110-130 mm, midpoint 120 mm used).",
  },
];
