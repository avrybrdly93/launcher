import { z } from "zod";
import { parseWithSchema, type Schema } from "./schema.js";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

/** Serializable description of a drag-coefficient model (§3.3), resolved to a concrete `DragCoefficientModel` by `resolveProjectileSpec`. */
export const DragCoefficientSpecSchema: Schema<
  { readonly kind: "constant"; readonly value: number } | { readonly kind: "tabulatedReynolds" }
> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().positive() }),
  z.object({ kind: z.literal("tabulatedReynolds") }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Serializable description of a lift-coefficient model (§3.6), resolved to a concrete `LiftCoefficientModel`. */
export const LiftCoefficientSpecSchema: Schema<{
  readonly kind: "saturating";
  readonly maxCl?: number | undefined;
  readonly slope?: number | undefined;
}> = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * Serializable projectile record (§3.9): (m, R, Cd-model, Cl-model, tau_omega,
 * provenance). `spinDecayTau` records the spin-decay time constant tau_omega
 * (§3.6) for future wiring into the state-augmented model; it is not yet
 * consumed by `ProjectileParams`, which only supports constant spin.
 */
export const ProjectileSpecSchema: Schema<{
  readonly id: string;
  readonly name: string;
  readonly mass: number;
  readonly radius: number;
  readonly dragCoefficient: DragCoefficientSpec;
  readonly liftCoefficient?: LiftCoefficientSpec | undefined;
  readonly spinDecayTau?: number | undefined;
  readonly provenance: string;
}> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  spinDecayTau: z.number().positive().optional(), // s (tau_omega, §3.6)
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

function resolveDragCoefficient(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.value);
    case "tabulatedReynolds":
      return new TabulatedReynoldsCd();
  }
}

function resolveLiftCoefficient(spec: LiftCoefficientSpec): LiftCoefficientModel {
  return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
}

/**
 * The asset loader (P1.26): validates arbitrary input -- a parsed JSON
 * fixture, a hand-authored literal, anything from outside the type system --
 * against `ProjectileSpecSchema`, throwing `SchemaValidationError` (with the
 * offending field path and reason) on anything malformed rather than letting
 * a bad asset surface later as a silent physics bug.
 */
export function loadProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, data);
}

/** Resolves a schema-validated `ProjectileSpec` asset into the runtime `ProjectileParams` the engine consumes. */
export function resolveProjectileSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: resolveDragCoefficient(spec.dragCoefficient),
    liftCoefficient: spec.liftCoefficient
      ? resolveLiftCoefficient(spec.liftCoefficient)
      : undefined,
  });
}

/**
 * Initial projectile data assets (§3.9). Every numeric datum's source is
 * recorded in `provenance`; each entry is validated against
 * `ProjectileSpecSchema` at module load so a malformed asset fails
 * immediately rather than surfacing as a downstream physics bug.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.1,
    radius: 0.05,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "Cd=0.47 is the standard subcritical smooth-sphere drag coefficient (e.g. Munson et al., Fundamentals of Fluid Mechanics); mass/radius are an arbitrary round reference, not a regulated object.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.0459,
    radius: 0.02135,
    dragCoefficient: { kind: "constant", value: 0.25 },
    liftCoefficient: { kind: "saturating" },
    provenance:
      "USGA/R&A Rules of Golf: mass <= 45.93 g, diameter >= 42.67 mm. Cd ~ 0.25 (dimpled, operating range) per blueprint §3.3 option 3.",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", value: 0.25 },
    provenance:
      "FIFA Laws of the Game: mass 410-450 g, circumference 68-70 cm (diameter ~21.6-22.3 cm); Cd ~ 0.25 per blueprint §3.3 option 3. Matches the mass/radius/Cd used in the P1.16 buoyancy validation fixture.",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", value: 0.35 },
    liftCoefficient: { kind: "saturating" },
    provenance:
      "MLB Rule 3.01: mass 5-5.25 oz (141.7-148.8 g), circumference 9-9.25 in (diameter ~73.2 mm). Cd ~ 0.3-0.5, seam-orientation-dependent, effective value 0.35 per Adair, The Physics of Baseball.",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "ITTF regulation: mass 2.7 g, diameter 40 mm. Cd ~ 0.47, smooth-sphere subcritical estimate (low Re at typical play speeds).",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.123,
    radius: 0.05,
    dragCoefficient: { kind: "tabulatedReynolds" },
    provenance:
      "0.1 m diameter solid sphere, density 7874 kg/m^3 (iron); mass = (4/3)*pi*r^3*rho ~= 4.123 kg. High-Re flight regime, so Cd(Re) uses the tabulated smooth-sphere drag-crisis curve (§3.3 option 2) rather than a fixed subcritical value.",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance:
      "World Athletics men's shot: mass 7.260 kg, diameter 110-130 mm (using 120 mm, radius 0.06 m). Cd ~ 0.47 smooth-sphere estimate.",
  },
] as const;

// Build-time validation (P1.26): run the loader over every built-in asset as
// soon as this module is imported, so a malformed roster entry fails loudly
// wherever the engine is first loaded (tests, dev server, app build) instead
// of surfacing later as a silent physics bug.
PROJECTILE_ASSETS.forEach(loadProjectileSpec);

/** Validates every entry in `PROJECTILE_ASSETS` and returns them typed; throws `SchemaValidationError` on the first invalid asset. */
export function validateProjectileAssets(): readonly ProjectileSpec[] {
  return PROJECTILE_ASSETS.map(loadProjectileSpec);
}
