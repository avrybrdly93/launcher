/**
 * The uniform ensemble job spec (P7.10) and its TypeScript backend.
 *
 * P7.10's criterion is "same job spec runs on both; results within stated FP
 * tolerance", and the first half of that is a design decision rather than a
 * plumbing exercise. The WASM kernel's arena speaks
 * `[mass, area, cd, rho, g, wx, wy]` -- a *lowered* representation, already
 * specialized to one model with its environment sampled and its area derived.
 * A "uniform" spec written in those terms would be the kernel's own
 * representation wearing a neutral name, and "runs on both" would be true only
 * because the TypeScript side had been made to speak WASM.
 *
 * So the spec here names the model: {@link EnsembleJobSpec} carries mass,
 * radius, a constant drag coefficient and an initial state per replicate, plus
 * a job-level gravity and wind. Each backend lowers it. The TypeScript backend
 * lowers it into `Environment` + `createPlanarProjectileModel` +
 * `ClassicalRK4Stepper`; the WASM backend (see `heterogeneous-executor.ts`)
 * lowers it into the arena. `rho` is *sampled* from the environment on the way
 * down rather than supplied by the caller, which is the direction
 * `wasm-ts-equivalence.test.ts` established in P7.07 -- the TypeScript side
 * owns the physical constants, and the kernel is told what they came out as.
 *
 * **The configuration is exactly P7.07's, and that is a constraint rather than
 * a default.** `ConstantAtmosphere`, `UniformGravity`, `UniformWind`,
 * `ConstantCd`, gravity applied before drag, fixed-step classical RK4. The
 * kernel targets that and nothing else, so a spec that could express anything
 * else would be a spec only one backend could run.
 */

import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  UniformWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  type ProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper, createStepResult } from "@ballista/solverkit";

/** State components of the planar projectile model: `[x, y, vx, vy]`. */
export const ENSEMBLE_DIM = 4;

/**
 * Slot order of one replicate's lowered parameter row.
 *
 * This **mirrors `PARAM` in `@ballista/wasm-core`** rather than importing it.
 * The import would have to be a value import, which would put
 * `wasm-rk4-backend.ts` -- and its `node:fs/promises` import -- into every
 * browser bundle that touches `@ballista/runtime`, for seven integers. The
 * mirror is pinned instead: `heterogeneous-executor.test.ts` asserts this
 * object still equals the kernel's own `PARAM` and that
 * {@link ENSEMBLE_PARAM_COUNT} still equals its `param_count()`, so a drift
 * fails a test rather than silently transposing two columns of an arena. Same
 * arrangement `simd-benchmark.test.ts` uses for the constants
 * `measure-simd-speedup.mjs` has to restate.
 */
export const ENSEMBLE_PARAM = {
  mass: 0,
  area: 1,
  cd: 2,
  rho: 3,
  g: 4,
  wx: 5,
  wy: 6,
} as const;

/** `f64` slots per replicate in a lowered parameter row. */
export const ENSEMBLE_PARAM_COUNT = 7;

/**
 * Slot order of one replicate's observables row. Mirrors `OBS` in
 * `@ballista/wasm-core`, pinned by the same test as {@link ENSEMBLE_PARAM}.
 *
 * {@link ENSEMBLE_OBS.maxSampledHeight} is a running maximum over **step
 * boundaries**, the initial state included. It is deliberately not
 * `Observables.apexHeight`, which refines the peak between the two bracketing
 * rows with a Hermite stationary point; the two agree only as `h` shrinks.
 * {@link ENSEMBLE_OBS.x} through `vy` are the state after the final step, not
 * an event-localized impact state -- a job runs a fixed step count and stops.
 */
export const ENSEMBLE_OBS = {
  x: 0,
  y: 1,
  vx: 2,
  vy: 3,
  tFinal: 4,
  maxSampledHeight: 5,
} as const;

/** `f64` slots per replicate in an observables row. */
export const ENSEMBLE_OBS_COUNT = 6;

/** One replicate: what varies across the ensemble. */
export interface EnsembleReplicate {
  readonly mass: number;
  /** Sphere radius, m. The cross-sectional area both backends use is derived from it, never supplied. */
  readonly radius: number;
  /** Constant drag coefficient. The kernel targets `ConstantCd` only (P7.07). */
  readonly dragCoefficient: number;
  readonly x0: number;
  readonly y0: number;
  readonly vx0: number;
  readonly vy0: number;
}

/**
 * One ensemble job: the environment, the integration window, and the
 * replicates.
 *
 * Gravity and wind are job-level rather than per-replicate because they
 * describe the environment, and both backends sample one environment for the
 * whole batch. Making them per-replicate would be expressible in the arena but
 * would mean the TypeScript backend could no longer share an `Environment`,
 * for no case anyone has.
 */
export interface EnsembleJobSpec {
  /** Start time. Stage times are `t0 + i*h`, computed by multiplication so they do not drift with `steps`. */
  readonly t0: number;
  /** Fixed step size. */
  readonly h: number;
  /** Number of RK4 steps. Zero is legal and reports the initial state. */
  readonly steps: number;
  /** `g0` handed to `UniformGravity`, m/s^2. Altitude dependence is off: the kernel has no equivalent. */
  readonly gravity: number;
  readonly windX: number;
  readonly windY: number;
  readonly replicates: readonly EnsembleReplicate[];
}

/**
 * Rejects a spec neither backend could run, or that only one of them could.
 *
 * Called once by the executor before anything is dispatched, rather than per
 * chunk: a spec is valid or it is not, and validating per chunk would report
 * the same defect once per backend.
 *
 * The point of the non-finite checks is not defensiveness. A `NaN` step size
 * produces `NaN` observables on *both* sides, and a bit-identity assertion over
 * two `NaN` rows passes under `Object.is` -- so an equivalence suite fed a
 * degenerate spec reports a green that means nothing. Rejecting at submit time
 * is what stops that.
 */
export function validateEnsembleJob(job: EnsembleJobSpec): void {
  if (!Number.isFinite(job.t0)) {
    throw new Error(`ensemble job: t0 must be finite, got ${job.t0}`);
  }
  if (!Number.isFinite(job.h) || job.h <= 0) {
    throw new Error(`ensemble job: h must be finite and positive, got ${job.h}`);
  }
  if (!Number.isInteger(job.steps) || job.steps < 0) {
    throw new Error(`ensemble job: steps must be a non-negative integer, got ${job.steps}`);
  }
  if (!Number.isFinite(job.gravity)) {
    throw new Error(`ensemble job: gravity must be finite, got ${job.gravity}`);
  }
  if (!Number.isFinite(job.windX) || !Number.isFinite(job.windY)) {
    throw new Error(`ensemble job: wind must be finite, got (${job.windX}, ${job.windY})`);
  }
  for (let r = 0; r < job.replicates.length; r++) {
    const rep = job.replicates[r]!;
    if (!Number.isFinite(rep.mass) || rep.mass <= 0) {
      throw new Error(`ensemble job: replicate ${r} mass must be finite and positive`);
    }
    if (!Number.isFinite(rep.radius) || rep.radius <= 0) {
      throw new Error(`ensemble job: replicate ${r} radius must be finite and positive`);
    }
    if (!Number.isFinite(rep.dragCoefficient) || rep.dragCoefficient < 0) {
      throw new Error(`ensemble job: replicate ${r} dragCoefficient must be finite and >= 0`);
    }
    if (
      !Number.isFinite(rep.x0) ||
      !Number.isFinite(rep.y0) ||
      !Number.isFinite(rep.vx0) ||
      !Number.isFinite(rep.vy0)
    ) {
      throw new Error(`ensemble job: replicate ${r} initial state must be finite`);
    }
  }
}

/** Derives one replicate's `ProjectileParams`, the single place area is computed. */
export function ensembleReplicateParams(replicate: EnsembleReplicate): ProjectileParams {
  return createSphericalProjectileParams({
    mass: replicate.mass,
    radius: replicate.radius,
    dragCoefficient: new ConstantCd(replicate.dragCoefficient),
  });
}

/** The one `Environment` a job describes: constant atmosphere, uniform gravity, uniform wind. */
export function ensembleEnvironment(job: EnsembleJobSpec): Environment {
  return new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(job.gravity),
    new UniformWind(job.windX, job.windY),
  );
}

/**
 * The environment's `(rho, g)` as the TypeScript side sees them.
 *
 * Sampled at the origin at `t = 0`, which is exact here rather than
 * approximate: `ConstantAtmosphere` ignores position and `UniformGravity` with
 * altitude dependence off ignores it too, so one sample is the value every
 * stage of every step will read. That is precisely the property that lets the
 * kernel take `rho` and `g` as two numbers instead of an atmosphere model, and
 * it is why {@link EnsembleJobSpec} cannot express an exponential atmosphere.
 */
export function ensembleEnvironmentConstants(job: EnsembleJobSpec): {
  readonly rho: number;
  readonly g: number;
} {
  const environment = ensembleEnvironment(job);
  const ctx = createEvalContext(
    environment,
    ensembleReplicateParams(job.replicates[0] ?? FALLBACK_REPLICATE),
  );
  environment.sample(0, 0, 0, ctx.env);
  return { rho: ctx.env.rho, g: ctx.env.g };
}

/**
 * Stands in for a replicate when a job has none, purely so
 * {@link ensembleEnvironmentConstants} can build an `EvalContext` to sample
 * into. Its numbers cannot reach a result: an empty job integrates nothing.
 */
const FALLBACK_REPLICATE: EnsembleReplicate = {
  mass: 1,
  radius: 1,
  dragCoefficient: 0,
  x0: 0,
  y0: 0,
  vx0: 0,
  vy0: 0,
};

/**
 * Writes replicates `[startIndex, endIndex)` of `job` as lowered parameter and
 * initial-state rows into `paramsOut` / `statesOut`, starting at row 0 of each.
 *
 * Shared by the WASM backend (which writes straight into the arena views) and
 * by the tests that check the lowering, so there is one definition of how a
 * spec becomes seven numbers.
 */
export function lowerEnsembleRange(
  job: EnsembleJobSpec,
  startIndex: number,
  endIndex: number,
  paramsOut: Float64Array,
  statesOut: Float64Array,
): void {
  const { rho, g } = ensembleEnvironmentConstants(job);
  for (let r = startIndex; r < endIndex; r++) {
    const rep = job.replicates[r]!;
    const params = ensembleReplicateParams(rep);
    const p = (r - startIndex) * ENSEMBLE_PARAM_COUNT;
    paramsOut[p + ENSEMBLE_PARAM.mass] = params.mass;
    paramsOut[p + ENSEMBLE_PARAM.area] = params.area;
    paramsOut[p + ENSEMBLE_PARAM.cd] = rep.dragCoefficient;
    paramsOut[p + ENSEMBLE_PARAM.rho] = rho;
    paramsOut[p + ENSEMBLE_PARAM.g] = g;
    paramsOut[p + ENSEMBLE_PARAM.wx] = job.windX;
    paramsOut[p + ENSEMBLE_PARAM.wy] = job.windY;

    const s = (r - startIndex) * ENSEMBLE_DIM;
    statesOut[s] = rep.x0;
    statesOut[s + 1] = rep.y0;
    statesOut[s + 2] = rep.vx0;
    statesOut[s + 3] = rep.vy0;
  }
}

/**
 * Integrates replicates `[startIndex, endIndex)` of `job` in TypeScript,
 * returning their observables rows.
 *
 * This is the reference side of P7.10's equivalence, so every detail that the
 * bit-identity depends on is fixed here rather than left to a caller:
 * `[GravityForce, QuadraticDragForce]` in that order (`specializeForces`
 * applies them in array order and the kernel reproduces gravity-then-drag),
 * `ClassicalRK4Stepper`, and stage times formed as `t0 + i*h` by multiplication
 * -- the kernel's `run_one_replicate` does the same, and an accumulated `t`
 * would drift from it after a few thousand steps.
 *
 * **One `EvalContext` and one stepper `init` per replicate.** Mass, radius and
 * `Cd` are per-replicate and live in `ctx.params`, which a stepper binds at
 * `init`, so sharing one context across the ensemble would silently run every
 * replicate with the first one's projectile. Reusing the `Model` is safe and is
 * done -- it reads `ctx.params` at `rhs` time and holds no per-replicate state.
 * The per-replicate `init` reallocates the stepper's stage buffers, which is
 * allocation this loop does not need; it is left alone deliberately, because
 * P7.10 is a correctness task and a measured allocation reduction belongs to a
 * perf task with a number attached.
 */
export function runTsEnsembleRange(
  job: EnsembleJobSpec,
  startIndex: number,
  endIndex: number,
): Float64Array {
  const rows = new Float64Array(Math.max(0, endIndex - startIndex) * ENSEMBLE_OBS_COUNT);
  if (endIndex <= startIndex) return rows;

  const environment = ensembleEnvironment(job);
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const stepper = new ClassicalRK4Stepper();
  const out = createStepResult(model.dim);
  const y = new Float64Array(ENSEMBLE_DIM);

  for (let r = startIndex; r < endIndex; r++) {
    const rep = job.replicates[r]!;
    const ctx = createEvalContext(environment, ensembleReplicateParams(rep));
    stepper.init(model, ctx);

    y[0] = rep.x0;
    y[1] = rep.y0;
    y[2] = rep.vx0;
    y[3] = rep.vy0;
    // The initial state counts as a sample, so a replicate that only ever
    // falls still reports its launch height rather than its final one.
    let maxSampledHeight = y[1]!;

    for (let i = 0; i < job.steps; i++) {
      stepper.step(job.t0 + i * job.h, y, job.h, out);
      y.set(out.yNext);
      if (y[1]! > maxSampledHeight) maxSampledHeight = y[1]!;
    }

    const o = (r - startIndex) * ENSEMBLE_OBS_COUNT;
    rows[o + ENSEMBLE_OBS.x] = y[0]!;
    rows[o + ENSEMBLE_OBS.y] = y[1]!;
    rows[o + ENSEMBLE_OBS.vx] = y[2]!;
    rows[o + ENSEMBLE_OBS.vy] = y[3]!;
    rows[o + ENSEMBLE_OBS.tFinal] = job.t0 + job.steps * job.h;
    rows[o + ENSEMBLE_OBS.maxSampledHeight] = maxSampledHeight;
  }

  return rows;
}
