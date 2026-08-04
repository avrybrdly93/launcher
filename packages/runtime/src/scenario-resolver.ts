import {
  BuoyancyForce,
  GravityForce,
  LinearDragForce,
  MagnusForce,
  QuadraticDragForce,
  createEvalContext,
  createPlanarProjectileModel,
  createPlanarProjectileSpinModel,
  createSpatialProjectileModel,
  environmentSpecToEnvironment,
  projectileSpecToParams,
  type EvalContext,
  type ForceModel,
  type Model,
  type ScenarioSpec,
} from "@ballista/engine";
import {
  ClassicalRK4Stepper,
  ExplicitEulerStepper,
  HeunRK2Stepper,
  MidpointRK2Stepper,
  createBogackiShampine32Stepper,
  createDormandPrince54Stepper,
  type SolverConfig,
  type Stepper,
} from "@ballista/solverkit";

/**
 * Force-id -> live-instance resolver (§5.2 registry pattern). This is the
 * first real consumer of `ScenarioSpec.model.forceIds`/`.solver.stepper` as
 * *resolvable* ids -- until `SimulationSession` (P3.03), nothing ever turned
 * those strings into live objects (`golden-trajectory-store.ts` carries its
 * own copy for the same reason, predating this one, and can't import it:
 * dependency-cruiser forbids anything importing the dev-only `validation`
 * package, not the other way around, but `validation` also can't reach
 * `runtime`, so the duplication there is structural, not an oversight).
 */
const FORCE_FACTORIES: Readonly<Record<string, () => ForceModel>> = {
  gravity: () => new GravityForce(),
  "drag-linear": () => new LinearDragForce(),
  "drag-quadratic": () => new QuadraticDragForce(),
  magnus: () => new MagnusForce(),
  buoyancy: () => new BuoyancyForce(),
};

export function resolveForce(id: string): ForceModel {
  const factory = FORCE_FACTORIES[id];
  if (!factory) throw new Error(`Unknown force id "${id}"`);
  return factory();
}

/**
 * Every force id `resolveForce` knows how to build, in this registry's own
 * declared order -- the canonical list a Forces panel (P3.22) enumerates
 * toggles from, rather than a separately maintained id list drifting out of
 * sync with `FORCE_FACTORIES`.
 */
export const KNOWN_FORCE_IDS: readonly string[] = Object.keys(FORCE_FACTORIES);

export interface ResolvedModel {
  readonly model: Model;
  readonly ctx: EvalContext;
  readonly y0: Float64Array;
  /**
   * The live force instances wired into `model`, in registration order (not
   * `model`'s own id-sorted internal registry order, P1.17) -- `Model`
   * itself never exposes its closed-over force list, so any consumer
   * needing per-force introspection (e.g. `@ballista/viz`'s force glyphs,
   * P3.14, or the eventual Forces panel, P3.22) reads it from here instead
   * of re-deriving it from `spec.model.forceIds`.
   */
  readonly forces: readonly ForceModel[];
}

/**
 * Spin-decay time constant seeded when `spec.model.tauOmega` is omitted for
 * a `"planar-spin"` model (P4.30) -- matches the value
 * `planar-projectile-spin-model.test.ts` exercises throughout as its own
 * representative decay rate, not a physically-derived default (this dim-5
 * model's own doc comments don't prescribe one).
 */
export const DEFAULT_TAU_OMEGA = 25;

/**
 * Model-kind -> live-`Model`-instance resolver (§5.2 registry pattern,
 * P4.30 "model registry UI"): the counterpart to `resolveForce`/
 * `resolveStepper` above, one level up the pipeline. `spec.model.kind`
 * (optional, defaults to `"planar"` -- see `scenario-spec.ts`'s own doc
 * comment on why this is safe for every pre-P4.30 spec) selects which of
 * the three P4.30-registered model constructors builds `model`, and which
 * shape `y0` takes (dim 4/5/6 respectively) -- this is the mechanism behind
 * this task's "switching model regenerates channels/controls" validation
 * criterion: a different `kind` means a genuinely different `Model`
 * instance with its own `channels`/`partitions`, not a UI-side relabeling
 * of the same dim-4 state.
 *
 * `createSpatialProjectileModel` throws a descriptive error (naming the
 * offending force id) for any force id outside its own `SUPPORTED_FORCE_IDS`
 * (`spatial-projectile-model.ts`) -- deliberately left uncaught here, the
 * same "let the already-descriptive throw propagate" choice `resolveForce`/
 * `resolveStepper` make for their own unknown-id cases, rather than
 * swallowing it into a vaguer error. In practice this resolver's own
 * `FORCE_FACTORIES` registry is currently a strict subset of
 * `SUPPORTED_FORCE_IDS` (gravity/drag-linear/drag-quadratic/magnus/buoyancy
 * all generalize to 3D; only "coriolis", not resolvable via `resolveForce`
 * at all yet, does not), so no `forceIds` combination reachable through
 * this resolver today can actually trigger that throw -- it is preserved as
 * forward-compatible failure behavior (documented, not exercised by a test
 * that would have to bypass `resolveForce` to construct one) for whenever a
 * future 2D-only force is registered.
 */
export function resolveModel(spec: ScenarioSpec): ResolvedModel {
  const forces = spec.model.forceIds.map(resolveForce);
  const kind = spec.model.kind ?? "planar";
  const env = environmentSpecToEnvironment(spec.environment, spec.seed);
  const params = projectileSpecToParams(spec.projectile, spec.initialConditions.spin0);
  const ctx = createEvalContext(env, params);
  const ic = spec.initialConditions;

  switch (kind) {
    case "planar": {
      const model = createPlanarProjectileModel(forces);
      const y0 = new Float64Array([ic.x0, ic.y0, ic.vx0, ic.vy0]);
      return { model, ctx, y0, forces };
    }
    case "planar-spin": {
      const tauOmega = spec.model.tauOmega ?? DEFAULT_TAU_OMEGA;
      const model = createPlanarProjectileSpinModel(forces, tauOmega);
      const y0 = new Float64Array([ic.x0, ic.y0, ic.vx0, ic.vy0, ic.spin0 ?? 0]);
      return { model, ctx, y0, forces };
    }
    case "spatial": {
      const model = createSpatialProjectileModel(forces);
      const y0 = new Float64Array([ic.x0, ic.y0, ic.z0 ?? 0, ic.vx0, ic.vy0, ic.vz0 ?? 0]);
      return { model, ctx, y0, forces };
    }
  }
}

/**
 * Stepper-id -> live-instance resolver, v1 scope: the fully generic
 * explicit steppers, every one of which runs unmodified against any
 * `planarProjectileModel` regardless of which forces are wired. Symplectic
 * (Verlet, needs `model.partitions` wired to a *velocity-independent* rhs
 * to stay exact) and implicit (backward-Euler, needs an analytic or
 * finite-difference Jacobian) methods are deliberately out of scope here --
 * they're method-appropriate for specific Solver Lab exhibits (Phase 4/5),
 * not a safe universal default for "whatever scenario the user committed".
 * `"rk45"` is accepted as an alias for `"dopri5"`: `scenario-presets.ts`'s
 * `REFERENCE_SOLVER` (every preset's default) was authored before any
 * consumer resolved `.solver.stepper` into a real `Stepper` and used the
 * generic textbook name for the Dormand-Prince 4(5) pair this package
 * implements as `dopri5`.
 */
const STEPPER_FACTORIES: Readonly<Record<string, () => Stepper>> = {
  "explicit-euler": () => new ExplicitEulerStepper(),
  "midpoint-rk2": () => new MidpointRK2Stepper(),
  "heun-rk2": () => new HeunRK2Stepper(),
  "classical-rk4": () => new ClassicalRK4Stepper(),
  "bogacki-shampine-32": () => createBogackiShampine32Stepper(),
  dopri5: () => createDormandPrince54Stepper(),
  rk45: () => createDormandPrince54Stepper(),
};

export function resolveStepper(id: string): Stepper {
  const factory = STEPPER_FACTORIES[id];
  if (!factory) throw new Error(`Unknown stepper id "${id}"`);
  return factory();
}

/** Converts the serializable `SolverConfigSpec` into a live `SolverConfig` (only shape difference: `atol` as a plain array vs. `Float64Array`). */
export function resolveSolverConfig(spec: ScenarioSpec): SolverConfig {
  const s = spec.solver;
  return {
    stepper: s.stepper,
    maxSteps: s.maxSteps,
    ...(s.h !== undefined && { h: s.h }),
    ...(s.rtol !== undefined && { rtol: s.rtol }),
    ...(s.atol !== undefined && {
      atol: Array.isArray(s.atol) ? new Float64Array(s.atol) : s.atol,
    }),
    ...(s.controller !== undefined && { controller: s.controller }),
    ...(s.hMin !== undefined && { hMin: s.hMin }),
  };
}
