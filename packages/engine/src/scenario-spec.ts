import { z } from "zod";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
  GaussianVortexWind,
  GriddedWindField,
  LogProfileWind,
  SinusoidalGustWind,
  UniformGravity,
  UniformWind,
  ZeroWind,
  type Atmosphere,
  type GravityModel,
  type WindModel,
} from "./environment.js";
import { projectileSpecSchema } from "./projectile-spec.js";

/** Serializable description of an `Atmosphere` (§3.4). */
export const atmosphereSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant") }),
  z.object({
    kind: z.literal("exponential"),
    rho0: z.number().positive().optional(),
    T0: z.number().positive().optional(),
    p0: z.number().positive().optional(),
    scaleHeight: z.number().positive().optional(),
  }),
]);
export type AtmosphereSpec = z.infer<typeof atmosphereSpecSchema>;

/** Serializable description of a `GravityModel` (§3.2). */
export const gravitySpecSchema = z.object({
  g0: z.number().positive().optional(),
  altitudeDependent: z.boolean().optional(),
});
export type GravitySpec = z.infer<typeof gravitySpecSchema>;

/** Serializable description of a `WindModel` (§3.5). */
export const windSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("zero") }),
  z.object({ kind: z.literal("uniform"), wx: z.number(), wy: z.number().optional() }),
  z.object({
    kind: z.literal("log-profile"),
    frictionVelocity: z.number(),
    roughnessLength: z.number().positive().optional(),
    wy: z.number().optional(),
  }),
  z.object({
    kind: z.literal("sinusoidal-gust"),
    mean: z.number(),
    amplitude: z.number(),
    angularFrequency: z.number(),
    phase: z.number().optional(),
    wy: z.number().optional(),
  }),
  z.object({
    kind: z.literal("gaussian-vortex"),
    circulation: z.number(),
    coreRadius: z.number().positive(),
    centerX: z.number().optional(),
    centerY: z.number().optional(),
  }),
  z.object({
    kind: z.literal("gridded"),
    grid: z.object({
      x0: z.number(),
      y0: z.number(),
      dx: z.number().positive(),
      dy: z.number().positive(),
      nx: z.number().int().positive(),
      ny: z.number().int().positive(),
      wx: z.array(z.number()),
      wy: z.array(z.number()),
    }),
  }),
]);
export type WindSpec = z.infer<typeof windSpecSchema>;

/** Serializable composition of atmosphere + gravity + wind (§2.3, §5.2 registry pattern). */
export const environmentSpecSchema = z.object({
  atmosphere: atmosphereSpecSchema,
  gravity: gravitySpecSchema,
  wind: windSpecSchema,
});
export type EnvironmentSpec = z.infer<typeof environmentSpecSchema>;

/** Planar initial conditions for the state vector (x, y, vx, vy) (§3.7). */
export const initialConditionsSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  vx0: z.number(),
  vy0: z.number(),
});
export type InitialConditions = z.infer<typeof initialConditionsSchema>;

/** Serializable `SolverConfig` (§5.1): stepper choice + step/tolerance controls. */
export const solverConfigSpecSchema = z.object({
  stepper: z.string().min(1),
  h: z.number().positive().optional(),
  rtol: z.number().positive().optional(),
  atol: z.union([z.number().positive(), z.array(z.number().positive())]).optional(),
  controller: z.enum(["I", "PI"]).optional(),
  maxSteps: z.number().int().positive(),
  hMin: z.number().positive().optional(),
});
export type SolverConfigSpec = z.infer<typeof solverConfigSpecSchema>;

/**
 * The single source of truth for a scenario (§2.3): physics model + force
 * composition, projectile, initial conditions, environment, solver config,
 * and RNG seed. `schemaVersion` is a literal so a mismatched version fails
 * validation immediately rather than silently misinterpreting an old shape;
 * P1.35 adds the migration chain that upgrades older versions to this one.
 */
export const scenarioSpecSchema = z.object({
  schemaVersion: z.literal(1),
  model: z.object({
    id: z.string().min(1),
    forceIds: z.array(z.string().min(1)).min(1),
  }),
  projectile: projectileSpecSchema,
  initialConditions: initialConditionsSchema,
  environment: environmentSpecSchema,
  solver: solverConfigSpecSchema,
  seed: z.number().int().nonnegative(),
});
export type ScenarioSpec = z.infer<typeof scenarioSpecSchema>;

function toAtmosphere(spec: AtmosphereSpec): Atmosphere {
  switch (spec.kind) {
    case "constant":
      return new ConstantAtmosphere();
    case "exponential":
      return new ExponentialAtmosphere(spec.rho0, spec.T0, spec.p0, spec.scaleHeight);
  }
}

function toGravity(spec: GravitySpec): GravityModel {
  return new UniformGravity(spec.g0, spec.altitudeDependent);
}

function toWind(spec: WindSpec): WindModel {
  switch (spec.kind) {
    case "zero":
      return new ZeroWind();
    case "uniform":
      return new UniformWind(spec.wx, spec.wy);
    case "log-profile":
      return new LogProfileWind(spec.frictionVelocity, spec.roughnessLength, spec.wy);
    case "sinusoidal-gust":
      return new SinusoidalGustWind(
        spec.mean,
        spec.amplitude,
        spec.angularFrequency,
        spec.phase,
        spec.wy,
      );
    case "gaussian-vortex":
      return new GaussianVortexWind(spec.circulation, spec.coreRadius, spec.centerX, spec.centerY);
    case "gridded":
      return new GriddedWindField(spec.grid);
  }
}

/** Instantiates the runtime `Environment` (live model instances) described by an `EnvironmentSpec`. */
export function environmentSpecToEnvironment(spec: EnvironmentSpec): Environment {
  return new Environment(toAtmosphere(spec.atmosphere), toGravity(spec.gravity), toWind(spec.wind));
}
