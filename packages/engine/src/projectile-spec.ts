import { z } from "zod";
import { parseWithSchema, SchemaValidationError } from "./schema.js";

/** Serializable descriptor for a `DragCoefficientModel` (§3.3), before materialization. */
export const DragCoefficientSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("constant"), value: z.number().positive() }),
  z.object({ type: z.literal("tabulated-reynolds") }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Serializable descriptor for a `LiftCoefficientModel` (§3.6), before materialization. */
export const LiftCoefficientSpecSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("saturating"),
    maxCl: z.number().positive(),
    slope: z.number().positive(),
  }),
]);
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * A projectile's static physical properties + provenance (§3.9): mass,
 * radius, drag/lift coefficient model descriptors, optional spin-decay
 * time constant, and a citation for every numeric datum. Serializable —
 * unlike `ProjectileParams`, which holds live `DragCoefficientModel`/
 * `LiftCoefficientModel` instances, this is plain JSON-safe data suitable
 * for the ScenarioSpec asset library (§2.3); materializing it into
 * `ProjectileParams` is the asset loader's job (P1.26).
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** Spin decay time constant τ_ω, seconds (§3.6). Omit to disable spin decay. */
  spinDecayTau: z.number().positive().optional(),
  /** Citation/source for the numeric data above. */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

export function parseProjectileSpec(data: unknown): ProjectileSpec {
  return parseWithSchema(ProjectileSpecSchema, data);
}

/**
 * Validates a keyed bundle of raw (untyped) fixture data into
 * `ProjectileSpec`s, e.g. loaded from JSON asset files (P1.26). A corrupt
 * fixture throws a `SchemaValidationError` naming the offending asset key
 * alongside the underlying zod issues, rather than surfacing a bare
 * "expected number, got string" with no indication of which asset broke —
 * this is what makes the failure actionable at build time instead of
 * surfacing as a mysterious runtime NaN deep in the physics.
 */
export function loadProjectileAssets(
  raw: Readonly<Record<string, unknown>>,
): Readonly<Record<string, ProjectileSpec>> {
  const loaded: Record<string, ProjectileSpec> = {};
  for (const [key, fixture] of Object.entries(raw)) {
    try {
      loaded[key] = parseProjectileSpec(fixture);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        throw new SchemaValidationError(`Projectile asset "${key}": ${err.message}`, err.issues);
      }
      throw err;
    }
  }
  return loaded;
}

/**
 * Initial projectile data assets (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball (0.1 m iron), shot put.
 * "Custom" is a runtime user-authored spec, not a static asset, and so has
 * no entry here. Declared as raw `unknown` fixture data and validated
 * through `loadProjectileAssets` below (P1.26) — the same path a real
 * corrupt fixture would fail through — rather than pre-typed as
 * `ProjectileSpec`, so this validation is load-bearing, not a formality.
 */
const RAW_PROJECTILE_ASSETS: Readonly<Record<string, unknown>> = {
  sphere: {
    id: "sphere",
    name: "Smooth reference sphere",
    mass: 1,
    radius: 0.05,
    dragCoefficient: { type: "constant", value: 0.47 },
    provenance:
      "Cd=0.47: standard subcritical smooth-sphere drag coefficient (e.g. Munson, Young & Okiishi, Fundamentals of Fluid Mechanics). Mass/radius are round pedagogical defaults, not a specific real object.",
  },
  golf: {
    id: "golf",
    name: "Golf ball",
    mass: 0.0459,
    radius: 0.02135,
    dragCoefficient: { type: "constant", value: 0.25 },
    liftCoefficient: { type: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 25,
    provenance:
      "Mass/diameter: USGA/R&A golf ball rules (mass <= 45.93 g, diameter >= 42.67 mm). Cd~0.25 in operating range: dimpled-ball drag reduction vs. smooth sphere (Bearman & Harvey 1976; Smits & Smith 1994). spinDecayTau in the sport-typical 20-30 s range (blueprint §3.6).",
  },
  soccer: {
    id: "soccer",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { type: "constant", value: 0.25 },
    liftCoefficient: { type: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 25,
    provenance:
      "Mass/circumference: FIFA Laws of the Game (410-450 g, 68-70 cm circumference). Cd~0.2-0.3 in the flight-relevant Reynolds range: Asai et al., 'Fundamental aerodynamics of the soccer ball' (2007).",
  },
  baseball: {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { type: "constant", value: 0.3 },
    liftCoefficient: { type: "saturating", maxCl: 0.6, slope: 1.6 },
    spinDecayTau: 25,
    provenance:
      "Mass/diameter: MLB official rules (5-5.25 oz, 2.86-2.94 in diameter). Cd~0.3-0.4 in typical pitch/batted-ball speed range: Adair, The Physics of Baseball (3rd ed., 2002).",
  },
  tableTennis: {
    id: "tableTennis",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { type: "constant", value: 0.4 },
    provenance:
      "Mass/diameter: ITTF equipment regulations (2.7 g, 40 mm diameter). Cd~0.4 at play-relevant Reynolds numbers (below the smooth-sphere drag crisis): representative of published table-tennis-ball drag measurements (e.g. Kensrud & Smith-type wind-tunnel studies of light plastic spheres).",
  },
  cannonball: {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragCoefficient: { type: "constant", value: 0.5 },
    provenance:
      "0.1 m diameter solid iron sphere, density ~7870 kg/m^3 => mass = rho*(4/3)*pi*r^3 ~ 4.12 kg. Cd~0.5 is the classical subcritical-sphere approximation used in exterior-ballistics treatments (e.g. McCoy, Modern Exterior Ballistics, 1999).",
  },
  shotPut: {
    id: "shotPut",
    name: "Shot put (men's, 7.26 kg)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { type: "constant", value: 0.47 },
    provenance:
      "Mass/diameter: World Athletics Technical Rules, men's shot (7.26 kg, 110-130 mm diameter). Cd=0.47: standard subcritical smooth-sphere value (Munson et al.) — shot-put launch speeds keep Re well below the drag crisis.",
  },
};

/** `RAW_PROJECTILE_ASSETS`, validated once at module load ("build time"). */
export const PROJECTILE_ASSETS: Readonly<Record<string, ProjectileSpec>> =
  loadProjectileAssets(RAW_PROJECTILE_ASSETS);
