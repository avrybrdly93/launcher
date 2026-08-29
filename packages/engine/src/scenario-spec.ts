import { z } from "zod";
import {
  ConstantAtmosphere,
  Environment,
  ExponentialAtmosphere,
  FrozenOuGustWind,
  GaussianVortexWind,
  GriddedWindField,
  LogProfileWind,
  OneCosineGustWind,
  SinusoidalGustWind,
  UniformGravity,
  UniformWind,
  ZeroWind,
  type Atmosphere,
  type GravityModel,
  type WindModel,
} from "./environment.js";
import { projectileSpecSchema } from "./projectile-spec.js";
import { PCG32 } from "./random.js";

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
/** Parsed type of {@link atmosphereSpecSchema}. */
export type AtmosphereSpec = z.infer<typeof atmosphereSpecSchema>;

/** Serializable description of a `GravityModel` (§3.2). */
export const gravitySpecSchema = z.object({
  g0: z.number().positive().optional(),
  altitudeDependent: z.boolean().optional(),
});
/** Parsed type of {@link gravitySpecSchema}. */
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
  z.object({
    kind: z.literal("one-cosine-gust"),
    /** Gust start time t0 (s). */
    startTime: z.number(),
    /** Gust duration T (s), i.e. total window length; peak occurs at t0 + T/2. */
    duration: z.number().positive(),
    /** Peak gust magnitude Um (m/s), reached at the window's midpoint. */
    peakMagnitude: z.number(),
    wy: z.number().optional(),
  }),
  z.object({
    kind: z.literal("frozen-ou-gust"),
    /** Correlation time tau (s), §3.5 eq. 3.14. */
    tau: z.number().positive(),
    /** Stationary standard deviation sigma (m/s). */
    sigma: z.number().positive(),
    /** Uniform time-grid spacing (s) the frozen path is precomputed on. */
    dt: z.number().positive(),
    /** Number of grid steps; the frozen path covers t in [0, steps*dt]. */
    steps: z.number().int().positive(),
    wy: z.number().optional(),
  }),
]);
/** Parsed type of {@link windSpecSchema}. */
export type WindSpec = z.infer<typeof windSpecSchema>;

/**
 * The wind kinds whose realization depends on the owning spec's `seed` -- i.e.
 * the ones for which two specs identical but for `seed` describe *different*
 * wind (ADR-011).
 *
 * One entry today. It is a named set rather than an inline `=== "frozen-ou-gust"`
 * because two places outside this module ask the question -- `toWind`'s seed
 * plumbing and P6.16's per-replicate realization check -- and a second
 * stochastic kind added to the union above must not have to be remembered in
 * each of them independently.
 */
export const STOCHASTIC_WIND_KINDS = [
  "frozen-ou-gust",
] as const satisfies readonly WindSpec["kind"][];

/**
 * Whether this wind's realization is a function of the scenario's `seed`.
 *
 * The question P6.16 needs answered: varying `seed` per replicate changes the
 * wind only for these kinds, and silently does nothing for every other one.
 */
export function isStochasticWind(spec: WindSpec): boolean {
  return (STOCHASTIC_WIND_KINDS as readonly string[]).includes(spec.kind);
}

/** Serializable composition of atmosphere + gravity + wind (§2.3, §5.2 registry pattern). */
export const environmentSpecSchema = z.object({
  atmosphere: atmosphereSpecSchema,
  gravity: gravitySpecSchema,
  wind: windSpecSchema,
});
/** Parsed type of {@link environmentSpecSchema}. */
export type EnvironmentSpec = z.infer<typeof environmentSpecSchema>;

/** Planar initial conditions for the state vector (x, y, vx, vy) (§3.7). */
export const initialConditionsSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  vx0: z.number(),
  vy0: z.number(),
  /**
   * Constant launch spin, rad/s (§3.6): positive = backspin for rightward
   * motion. Feeds `ProjectileParams.spin` for scenarios whose `forceIds`
   * include "magnus"; omit (or 0) for spin-free scenarios.
   */
  spin0: z.number().optional(),
  /**
   * Lateral (out-of-plane) launch position, m (P4.23's axis convention:
   * z = lateral, right-handed with e_x x e_y = e_z). Meaningful only when
   * `model.kind` is `"spatial"` (P4.30); `resolveModel`
   * (`@ballista/runtime`) defaults to 0 when omitted, which is also every
   * planar/planar-spin scenario's implicit value (they have no z channel
   * to carry it in at all).
   */
  z0: z.number().optional(),
  /**
   * Lateral launch velocity, m/s -- the `vz0` counterpart to `z0` above.
   * Written as code rather than `{@link z0}` because this comment sits on a
   * property of an anonymous inferred object type: typedoc can resolve the
   * link only where it renders that type as a named page, so any exported
   * function whose signature inlines a `ScenarioSpec` turns the link into a
   * "exists but does not have a link" warning -- and typedoc is configured
   * to fail the build on warnings. P6.02's `uncertain-scenario-spec.ts` was
   * the first such signature.
   * Same "spatial-only, defaults to 0" scope.
   */
  vz0: z.number().optional(),
});
/** Parsed type of {@link initialConditionsSchema}. */
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
/** Parsed type of {@link solverConfigSpecSchema}. */
export type SolverConfigSpec = z.infer<typeof solverConfigSpecSchema>;

/**
 * The three P4.30 "model registry" entries a `ScenarioSpec` can resolve to
 * (`scenario-resolver.ts`'s `resolveModel`, `@ballista/runtime`): the dim-4
 * planar workhorse, the dim-5 planar-with-decaying-spin variant (P4.07), and
 * the dim-6 spatial (3D) model (P4.23+).
 */
export const MODEL_KIND_VALUES = ["planar", "planar-spin", "spatial"] as const;

/**
 * Serializable description of which physics `Model` a scenario resolves to
 * (§5.2 registry pattern) plus that model's own extra construction params
 * (§3.7's "variable-dimension design"). `kind` is optional and defaults to
 * `"planar"` (`resolveModel`) -- an additive field, not a `schemaVersion`
 * bump, the same precedent each new `windSpecSchema` variant was added
 * under (P4.16-P4.18): every scenario spec written before this field
 * existed (every `PRESET_SCENARIOS` entry, every golden-trajectory fixture)
 * still resolves to exactly the model it always did, with no migration
 * step needed.
 */
export const modelSpecSchema = z.object({
  id: z.string().min(1),
  forceIds: z.array(z.string().min(1)).min(1),
  kind: z.enum(MODEL_KIND_VALUES).optional(),
  /**
   * Spin-decay time constant tau_omega, s (`createPlanarProjectileSpinModel`'s
   * omega_dot = -omega/tauOmega, P4.07) -- meaningful only when `kind` is
   * `"planar-spin"`. `resolveModel` defaults to its own `DEFAULT_TAU_OMEGA`
   * when omitted.
   */
  tauOmega: z.number().positive().optional(),
});
/** Parsed type of {@link modelSpecSchema}. */
export type ModelSpec = z.infer<typeof modelSpecSchema>;

/**
 * The single source of truth for a scenario (§2.3): physics model + force
 * composition, projectile, initial conditions, environment, solver config,
 * and RNG seed. `schemaVersion` is a literal so a mismatched version fails
 * validation immediately rather than silently misinterpreting an old shape;
 * P1.35 adds the migration chain that upgrades older versions to this one.
 */
export const scenarioSpecSchema = z.object({
  schemaVersion: z.literal(1),
  model: modelSpecSchema,
  projectile: projectileSpecSchema,
  initialConditions: initialConditionsSchema,
  environment: environmentSpecSchema,
  solver: solverConfigSpecSchema,
  seed: z.number().int().nonnegative(),
});
/** Parsed type of {@link scenarioSpecSchema}. */
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

/**
 * Fixed PCG32 substream id reserved for the frozen-realization wind path
 * (P4.17 per ADR-011). A `ScenarioSpec` currently has exactly one
 * stochastic element -- the wind -- so a single reserved id is sufficient;
 * a future stochastic element (e.g. P6.16 Monte Carlo replicate variation)
 * must claim its own distinct substream id rather than reusing this one,
 * per `random.ts`'s non-overlapping-substream discipline.
 */
const WIND_SUBSTREAM_ID = 1n;

function toWind(spec: WindSpec, seed: number): WindModel {
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
    case "one-cosine-gust":
      return new OneCosineGustWind(spec.startTime, spec.duration, spec.peakMagnitude, spec.wy);
    case "frozen-ou-gust": {
      const rng = new PCG32(BigInt(seed)).substream(WIND_SUBSTREAM_ID);
      return new FrozenOuGustWind(
        rng,
        { tau: spec.tau, sigma: spec.sigma },
        spec.dt,
        spec.steps,
        spec.wy,
      );
    }
  }
}

/**
 * Instantiates the runtime `Environment` (live model instances) described by
 * an `EnvironmentSpec`. `seed` is the owning `ScenarioSpec`'s seed (P0.11);
 * it only matters for stochastic wind kinds (`"frozen-ou-gust"`, P4.17) --
 * every other wind/atmosphere/gravity variant is a pure function of its own
 * parameters and ignores it. Defaults to 0 for callers that only have an
 * `EnvironmentSpec` on hand (no stochastic wind in scope there).
 */
export function environmentSpecToEnvironment(spec: EnvironmentSpec, seed = 0): Environment {
  return new Environment(
    toAtmosphere(spec.atmosphere),
    toGravity(spec.gravity),
    toWind(spec.wind, seed),
  );
}
