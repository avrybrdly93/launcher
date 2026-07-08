import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

/**
 * Serializable description of a drag-coefficient model (§3.3). Only the two
 * models implemented so far (P1.10, P1.12) are representable; adding a new
 * `DragCoefficientModel` requires extending this union and
 * `createDragCoefficientModel` below.
 */
export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds-smooth-sphere") }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

export function createDragCoefficientModel(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.value);
    case "tabulated-reynolds-smooth-sphere":
      return new TabulatedReynoldsCd();
  }
}

/**
 * `ProjectileSpec` (§3.9): the static physical properties of a projectile
 * asset, validated at build/load time (P1.26). Every numeric datum's source
 * is recorded in `provenance` so the asset library stays auditable.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: DragCoefficientSpecSchema,
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/** Builds the physics-engine `ProjectileParams` this asset describes (spherical geometry). */
export function projectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: createDragCoefficientModel(spec.dragCoefficient),
  });
}

/**
 * Initial projectile asset library (§3.9). Values are representative
 * regulation/typical figures, not measurements of a specific ball — each
 * `provenance` string names its source so a reader can judge fidelity.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.1,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds-smooth-sphere" },
    provenance:
      "Generic 10cm smooth sphere used as the platform's teaching reference; Cd(Re) drag-crisis " +
      "curve per Hoerner, Fluid-Dynamic Drag (1965), digitized in drag-coefficient.ts's SMOOTH_SPHERE_CD_TABLE.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.0459,
    radius: 0.02135,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "USGA/R&A Rules of Golf, Appendix III: mass <=45.93 g, diameter >=42.67 mm. Cd~0.25 is " +
      "typical for a dimpled ball in its turbulent flight regime (Bearman & Harvey, Aeronautical Quarterly, 1976).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball (size 5)",
    mass: 0.43,
    radius: 0.1114,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "FIFA Laws of the Game, Law 2: size-5 ball circumference 68-70 cm, mass 410-450 g " +
      "(radius derived from 69 cm circumference). Cd~0.2-0.3 typical at match speeds (Asai et al., " +
      "Sports Engineering, 2007).",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.3 },
    provenance:
      "MLB Official Baseball Rule 3.01: mass 5-5.25 oz (~0.142-0.149 kg), circumference " +
      "9-9.25 in. Cd~0.3-0.35 per Adair, The Physics of Baseball, 3rd ed. (2002).",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.4 },
    provenance:
      "ITTF Equipment Regulations: mass 2.7 g, diameter 40 mm. Cd~0.4-0.5 typical for a smooth " +
      "sphere in the subcritical Reynolds regime at table-tennis speeds.",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1m iron)",
    mass: 4.1207,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds-smooth-sphere" },
    provenance:
      "0.1 m diameter solid iron sphere; density of iron 7870 kg/m^3 (CRC Handbook of Chemistry " +
      "and Physics) gives mass = density * (4/3)*pi*r^3 ~= 4.12 kg. Cd(Re) per the same smooth-sphere " +
      "fit as the generic sphere asset (Hoerner, 1965).",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "World Athletics Rule 187: men's shot mass 7.260 kg, diameter 110-130 mm. Cd~0.47 is the " +
      "standard smooth-sphere approximation; aerodynamics are a minor effect at shot-put speeds.",
  },
];
