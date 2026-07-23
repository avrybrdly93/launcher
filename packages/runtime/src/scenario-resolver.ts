import {
  BuoyancyForce,
  GravityForce,
  LinearDragForce,
  MagnusForce,
  QuadraticDragForce,
  createEvalContext,
  createPlanarProjectileModel,
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

/** Builds a fresh Model/EvalContext/initial-state triple from a `ScenarioSpec` (mirrors `golden-trajectory-store.ts`'s pipeline). */
export function resolveModel(spec: ScenarioSpec): ResolvedModel {
  const forces = spec.model.forceIds.map(resolveForce);
  const model = createPlanarProjectileModel(forces);
  const env = environmentSpecToEnvironment(spec.environment);
  const params = projectileSpecToParams(spec.projectile, spec.initialConditions.spin0);
  const ctx = createEvalContext(env, params);

  const ic = spec.initialConditions;
  const y0 = new Float64Array([ic.x0, ic.y0, ic.vx0, ic.vy0]);

  return { model, ctx, y0, forces };
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
