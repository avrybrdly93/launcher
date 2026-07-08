import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { parseWithSchema } from "./schema.js";

/**
 * Serializable drag-coefficient choice for a `ProjectileSpec` data asset.
 * Assets stay plain data (zod-validatable, no class instances) so they can
 * be loaded from JSON at build time (P1.26); `createProjectileParamsFromSpec`
 * resolves each variant to the live `DragCoefficientModel` it names.
 */
export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-smooth-sphere") }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Serializable lift-coefficient choice; "none" disables Magnus for this projectile. */
export const LiftCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("saturating") }),
]);
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): $(m, R, C_d\text{-model}, C_L\text{-model},
 * \tau_\omega, \text{provenance})$ for one entry of the projectile database.
 * Every numeric datum carries a `provenance` citation (§3.9's requirement);
 * `tauOmega` is spin-decay's time constant and is optional/unused until the
 * spin-decay model lands (P4.07) -- present now so the schema doesn't need a
 * breaking migration later.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema,
  tauOmega: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

function dragCoefficientFromSpec(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.value);
    case "tabulated-smooth-sphere":
      return new TabulatedReynoldsCd();
  }
}

function liftCoefficientFromSpec(spec: LiftCoefficientSpec): LiftCoefficientModel | undefined {
  return spec.kind === "saturating" ? new SaturatingLiftCoefficient() : undefined;
}

/** Resolves a validated `ProjectileSpec` asset into the runtime `ProjectileParams` a Model consumes. */
export function createProjectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: dragCoefficientFromSpec(spec.dragCoefficient),
    liftCoefficient: liftCoefficientFromSpec(spec.liftCoefficient),
  });
}

/**
 * Initial projectile database (§3.9): smooth sphere, golf ball, soccer ball,
 * baseball, table-tennis ball, cannonball (0.1 m iron), shot put. Sport-
 * specific Cd/CL *tables* (vs. the constants used here) are a later, more
 * data-heavy asset (P4.05) -- these use `ConstantCd`/the smooth-sphere curve
 * already available in Phase 1.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.1,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-smooth-sphere" },
    liftCoefficient: { kind: "none" },
    provenance:
      "Generic 10 cm reference sphere for Cd(Re) validation; smooth-sphere drag curve per the Achenbach (1972)/Morrison-type correlation implemented in TabulatedReynoldsCd.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.0459,
    radius: 0.02135,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating" },
    provenance:
      "USGA/R&A specification: mass ≤ 45.93 g, diameter ≥ 42.67 mm (1.68 in); Cd≈0.25 for a dimpled ball in its typical flight-speed operating range (Bearman & Harvey, 1976, 'Golf ball aerodynamics').",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "none" },
    provenance:
      "FIFA Law 2 specification: mass 410-450 g, circumference 68-70 cm (⇒ D≈21.8-22.3 cm); Cd≈0.25 in the typical match-speed range (Asai et al., 2007, 'Fundamental aerodynamics of the soccer ball').",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.35 },
    liftCoefficient: { kind: "saturating" },
    provenance:
      "MLB specification: mass 5.00-5.25 oz (141.7-148.8 g), circumference 9.00-9.25 in (⇒ D≈7.3 cm); Cd≈0.3-0.4 depending on seam orientation, folded into one effective constant here (Adair, 2002, 'The Physics of Baseball').",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.4 },
    liftCoefficient: { kind: "saturating" },
    provenance:
      "ITTF specification: mass 2.7 g, diameter 40 mm; Cd≈0.4, smooth-sphere subcritical regime at typical rally speeds (low Re).",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.121,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-smooth-sphere" },
    liftCoefficient: { kind: "none" },
    provenance:
      "0.1 m diameter solid iron sphere (historical smoothbore round-shot dimension), ρ_iron=7870 kg/m^3 ⇒ m=ρ·(4/3)πR^3≈4.121 kg; smooth-sphere Cd(Re) curve (Achenbach, 1972).",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", value: 0.47 },
    liftCoefficient: { kind: "none" },
    provenance:
      "World Athletics men's shot specification: mass 7.260 kg, diameter 110-130 mm (nominal 120 mm used here); approximated as a smooth sphere, Cd≈0.47 (subcritical; drag is negligible at typical ~13-14 m/s release speeds).",
  },
];

/** Validates one asset's raw (e.g. JSON-parsed) data against `ProjectileSpecSchema` (P1.26). */
export function loadProjectileAsset(data: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, data);
}
