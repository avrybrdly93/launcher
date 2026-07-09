import { z } from "zod";
import type { Schema } from "./schema.js";
import { parseWithSchema } from "./schema.js";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";

/** Serializable descriptor for a `DragCoefficientModel` (§3.9 asset schema). */
export type DragCoefficientSpec =
  { readonly kind: "constant"; readonly cd: number } | { readonly kind: "tabulated-reynolds" };

const dragCoefficientSpecSchema: Schema<DragCoefficientSpec> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds") }),
]);

/** Serializable descriptor for a `LiftCoefficientModel`, eq. (3.16) parameters. */
export interface LiftCoefficientSpec {
  readonly kind: "saturating";
  readonly maxCl?: number | undefined;
  readonly slope?: number | undefined;
}

const liftCoefficientSpecSchema: Schema<LiftCoefficientSpec> = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});

/**
 * A projectile asset (§3.9): $(m, R, C_d\text{-model}, C_L\text{-model},
 * \tau_\omega, \text{provenance})$. Serializable and zod-validated so assets
 * can live as data (JSON) rather than code; the loader validates every
 * numeric datum's schema at build time. `provenance` is mandatory — every
 * asset must cite where its numbers come from.
 */
export interface ProjectileSpec {
  readonly id: string;
  readonly label: string;
  readonly mass: number; // kg
  readonly radius: number; // m
  readonly dragCoefficient: DragCoefficientSpec;
  readonly liftCoefficient?: LiftCoefficientSpec | undefined;
  /** Spin-decay time constant tau_omega, s (§3.6); omitted where spin decay isn't modeled. */
  readonly spinDecayTau?: number | undefined;
  readonly provenance: string;
}

export const projectileSpecSchema: Schema<ProjectileSpec> = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: dragCoefficientSpecSchema,
  liftCoefficient: liftCoefficientSpecSchema.optional(),
  spinDecayTau: z.number().positive().optional(),
  provenance: z.string().min(1),
});

export function resolveDragCoefficient(spec: DragCoefficientSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.cd);
    case "tabulated-reynolds":
      return new TabulatedReynoldsCd();
  }
}

export function resolveLiftCoefficient(spec: LiftCoefficientSpec): LiftCoefficientModel {
  return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
}

/** Resolves a validated `ProjectileSpec` asset into the concrete `ProjectileParams` the engine consumes. */
export function projectileParamsFromSpec(spec: ProjectileSpec): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: resolveDragCoefficient(spec.dragCoefficient),
    ...(spec.liftCoefficient !== undefined
      ? { liftCoefficient: resolveLiftCoefficient(spec.liftCoefficient) }
      : {}),
  });
}

/**
 * Initial projectile asset library (§3.9): smooth sphere, golf, soccer,
 * baseball, table-tennis, cannonball, shot put. Cd values here are constant
 * baselines appropriate to each ball's typical flight-speed regime; sport-
 * specific Cd(Re)/CL(S) tables with full literature provenance are P4.05.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "sphere",
    label: "Smooth sphere",
    mass: 0.1,
    radius: 0.05,
    dragCoefficient: { kind: "constant", cd: 0.47 },
    provenance:
      "Generic reference sphere: Cd=0.47 is the standard subcritical smooth-sphere drag " +
      "coefficient (e.g. Munson, Young & Okiishi, Fundamentals of Fluid Mechanics); mass/radius " +
      "are arbitrary round numbers, not a real object.",
  },
  {
    id: "golf",
    label: "Golf ball",
    mass: 0.0459,
    radius: 0.02133,
    dragCoefficient: { kind: "constant", cd: 0.25 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 25,
    provenance:
      "USGA/R&A Rules of Golf, Equipment Rules: mass <= 45.93 g, diameter >= 42.67 mm. " +
      "Cd approx 0.25 for a dimpled ball in its typical flight-speed operating range " +
      "(Bearman & Harvey 1976, 'Golf ball aerodynamics'). Spin decay tau_omega ~ 25 s, " +
      "sport-typical order of magnitude (§3.6).",
  },
  {
    id: "soccer",
    label: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", cd: 0.25 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 20,
    provenance:
      "FIFA Laws of the Game, Law 2 (Size 5 ball): mass 410-450 g, circumference 68-70 cm " +
      "(radius approx 0.11 m). Cd approx 0.2-0.25 in the turbulent-regime speeds typical of play " +
      "(Asai, Seo, Kobayashi & Sakashita 2007, 'Fundamental aerodynamics of the soccer ball').",
  },
  {
    id: "baseball",
    label: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", cd: 0.35 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 30,
    provenance:
      "Official MLB baseball: mass 5.00-5.25 oz (0.142-0.149 kg), circumference 9.00-9.25 in " +
      "(radius approx 0.0366 m). Cd approx 0.3-0.4, seam effects folded into an effective constant " +
      "(Adair, The Physics of Baseball, 3rd ed.).",
  },
  {
    id: "table-tennis",
    label: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", cd: 0.4 },
    liftCoefficient: { kind: "saturating" },
    spinDecayTau: 20,
    provenance:
      "ITTF Table Tennis Equipment Regulations: mass 2.67-2.77 g, diameter 40 mm. " +
      "Cd approx 0.4, low-Re smooth-sphere regime typical of table-tennis flight speeds " +
      "(Kondo 2016, 'Effect of ball material on table tennis ball aerodynamics'). This is the " +
      "platform's canonical high-Pi (drag-dominated) reference case (§3.8).",
  },
  {
    id: "cannonball",
    label: "Cannonball (0.1 m, iron)",
    mass: 4.084,
    radius: 0.05,
    dragCoefficient: { kind: "constant", cd: 0.47 },
    provenance:
      "Historical 0.1 m diameter cast-iron round shot; mass from volume x cast-iron density " +
      "~7800 kg/m^3 ((4/3)*pi*0.05^3*7800 approx 4.08 kg). Cd=0.47 smooth-sphere baseline, the " +
      "classic textbook treatment of projectile-with-drag problems.",
  },
  {
    id: "shot-put",
    label: "Shot put",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", cd: 0.47 },
    provenance:
      "World Athletics Technical Rules, men's shot: mass 7.260 kg, diameter 110-130 mm " +
      "(radius approx 0.06 m at midrange). Cd=0.47 smooth-sphere baseline; drag is negligible for " +
      "this mass/area ratio, the platform's canonical low-Pi reference case (§3.8, §3.9).",
  },
] as const;

/** Validates every asset in `PROJECTILE_ASSETS` against `projectileSpecSchema`, throwing on the first failure. */
export function validateProjectileAssets(): readonly ProjectileSpec[] {
  return PROJECTILE_ASSETS.map((asset) => parseWithSchema(projectileSpecSchema, asset));
}
