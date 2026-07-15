import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { parseWithSchema } from "./schema.js";

/**
 * How to build the runtime `DragCoefficientModel` for one asset. `constant`
 * covers the sport-specific "Cd in the operating range" values quoted in the
 * literature (§3.3 option 1); `tabulated-smooth-sphere-reynolds` selects the
 * drag-crisis curve (P1.10-13) for the reference smooth sphere. Regime-fitted
 * sport-specific Cd(Re) tables are P4.05's job, not this one.
 */
export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-smooth-sphere-reynolds") }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): $(m, R, C_d\text{-model}, \tau_\omega, \text{provenance})$
 * as a serializable, zod-validated record — distinct from the runtime
 * `ProjectileParams`, which holds live model instances instead of config.
 * `spinDecayTau` is the $\tau_\omega$ slot (§3.6); omitted where no asset yet
 * specifies a spin-decay rate.
 */
export const ProjectileSpecSchema = z.object({
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: DragCoefficientSpecSchema,
  spinDecayTau: z.number().positive().optional(), // s
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

export function resolveDragCoefficientModel(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.cd);
    case "tabulated-smooth-sphere-reynolds":
      return new TabulatedReynoldsCd();
  }
}

/** Builds runtime `ProjectileParams` (spherical) from a validated `ProjectileSpec`. */
export function createProjectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: resolveDragCoefficientModel(spec.dragCoefficient),
  });
}

const RAW_PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    name: "smooth-sphere",
    mass: 0.5,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-smooth-sphere-reynolds" },
    provenance:
      "Reference smooth sphere (0.1 m diameter) for the classical drag-crisis Cd(Re) curve near Re~3e5 (cf. Achenbach 1972).",
  },
  {
    name: "golf-ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", cd: 0.25 },
    provenance:
      "USGA/R&A golf ball rules: mass <= 45.93 g, diameter >= 42.67 mm. Cd~0.25 for a dimpled ball in its operating Reynolds range (Bearman & Harvey 1976).",
  },
  {
    name: "soccer-ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", cd: 0.25 },
    provenance:
      "FIFA size-5 ball: mass 420-450 g, circumference 68-70 cm (radius ~0.11 m). Cd~0.2-0.25 typical (Asai et al. 2007).",
  },
  {
    name: "baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", cd: 0.35 },
    provenance:
      "MLB rules: mass 142-149 g, circumference 22.9-23.5 cm (radius ~0.0365-0.0374 m). Cd~0.3-0.4 for a new ball, seam effects folded in (Adair, The Physics of Baseball).",
  },
  {
    name: "table-tennis-ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", cd: 0.4 },
    provenance:
      "ITTF ball spec: mass 2.67-2.77 g, diameter 40 mm. Cd~0.4-0.5 for a smooth sphere at ball-scale Reynolds numbers (~1e4-1e5).",
  },
  {
    name: "cannonball-iron-0.1m",
    mass: 4.122,
    radius: 0.05,
    dragCoefficient: { kind: "constant", cd: 0.47 },
    provenance:
      "0.1 m diameter solid iron sphere (density ~7870 kg/m^3), historical smoothbore-cannonball scale. Cd~0.47, the standard smooth-sphere subcritical value.",
  },
  {
    name: "shot-put",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", cd: 0.47 },
    provenance:
      "World Athletics men's shot: mass 7.260 kg, diameter 110-130 mm. Cd~0.47 smooth-sphere approximation (surface texture neglected).",
  },
];

/** Data assets (§3.9): validated at import time, so a malformed asset fails immediately, not at first use. */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = RAW_PROJECTILE_ASSETS.map((asset) =>
  parseWithSchema(ProjectileSpecSchema, asset),
);
