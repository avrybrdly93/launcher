import { createHash } from "node:crypto";
import {
  BuoyancyForce,
  GravityForce,
  LinearDragForce,
  MagnusForce,
  PRESET_SCENARIOS,
  QuadraticDragForce,
  SCENARIO_LIBRARY,
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
  TrajectoryRecorder,
  createBogackiShampine32Stepper,
  createDormandPrince54Stepper,
  integrate,
  type SolverConfig,
  type Stepper,
  type Trajectory,
} from "@ballista/solverkit";

/**
 * v1 golden-store scope (§8.4, P2.52): one exemplar per regime named in §3.9 -- drag-free
 * reference, low-Π shot put, high-Π table tennis, Magnus-bearing golf drive, stiff dust
 * grain, and one side of the head/tailwind pair (headwind; tailwind shares the same
 * projectile and force composition with only the wind sign flipped, so for a *numerical
 * regression* store it doesn't exercise a materially different code path -- unlike the
 * scenario library itself, §3.9, which ships both for pedagogical contrast). Six entries,
 * matching this task's literal scope; promoting tailwind to a seventh is a natural v2 if a
 * real regression is ever missed there specifically.
 */
export const GOLDEN_PRESET_IDS = [
  "smooth-sphere",
  "shot-put",
  "table-tennis-ball",
  "golf-ball",
  "dust-grain",
  "baseball-headwind",
] as const;

export type GoldenPresetId = (typeof GOLDEN_PRESET_IDS)[number];

function presetById(id: GoldenPresetId): ScenarioSpec {
  if (id === "baseball-headwind") {
    const found = PRESET_SCENARIOS.find(
      (s) =>
        s.projectile.id === "baseball" &&
        s.environment.wind.kind === "uniform" &&
        s.environment.wind.wx < 0,
    );
    if (!found) throw new Error("expected a headwind baseball preset in PRESET_SCENARIOS");
    return found;
  }
  const found = PRESET_SCENARIOS.find((s) => s.projectile.id === id);
  if (!found) throw new Error(`expected a preset with projectile id "${id}" in PRESET_SCENARIOS`);
  return found;
}

/**
 * Stand-in force-id -> live-instance resolver (P1.17 established the registry *pattern*; a
 * spec-id resolver for models/forces/steppers isn't built yet -- SimulationSession/L2
 * territory, P3.03+). Mirrors solverkit's `determinism.test.ts` exactly, since every preset
 * here is drawn from the same `PRESET_SCENARIOS` library and needs the identical resolution.
 */
function forceById(id: string): ForceModel {
  switch (id) {
    case "gravity":
      return new GravityForce();
    case "drag-linear":
      return new LinearDragForce();
    case "drag-quadratic":
      return new QuadraticDragForce();
    case "magnus":
      return new MagnusForce();
    case "buoyancy":
      return new BuoyancyForce();
    default:
      throw new Error(`Unknown force id in golden fixture: ${id}`);
  }
}

/**
 * Fixed-step size RK4 uses per preset (§4.6, eq. 4.12). Most presets are non-stiff and
 * tolerate a coarse step; the dust grain's Stokes drag relaxation time (tau = m/(6*pi*eta*r)
 * ~ 6e-4 s) requires h well under 2*tau for RK4 stability, so it gets a dedicated fine step.
 */
const RK4_STEP_SIZE: Record<GoldenPresetId, number> = {
  "smooth-sphere": 0.005,
  "shot-put": 0.005,
  "table-tennis-ball": 0.005,
  "golf-ball": 0.005,
  "dust-grain": 0.0002,
  "baseball-headwind": 0.005,
};

/**
 * Fixed integration horizon for every golden entry. v1 deliberately records a numerical
 * snapshot rather than a physically-terminated flight: no ground-impact event detection is
 * wired into this store, so every preset just integrates for the same fixed duration.
 */
export const GOLDEN_T_FINAL = 2;

export type GoldenStepperKind = "classical-rk4" | "dopri5";

function buildStepperAndConfig(
  kind: GoldenStepperKind,
  presetId: GoldenPresetId,
): { stepper: Stepper; cfg: SolverConfig } {
  if (kind === "classical-rk4") {
    return {
      stepper: new ClassicalRK4Stepper(),
      cfg: { stepper: "classical-rk4", h: RK4_STEP_SIZE[presetId], maxSteps: 200_000 },
    };
  }
  return {
    stepper: createDormandPrince54Stepper(),
    cfg: { stepper: "dopri5", rtol: 1e-10, atol: 1e-12, controller: "PI", maxSteps: 200_000 },
  };
}

/**
 * Integrates one golden preset/stepper combination to a frozen {@link Trajectory}. Builds a
 * fresh Model/EvalContext/Stepper/initial-state/SolverConfig each call, sharing nothing
 * across calls (mirrors solverkit's `determinism.test.ts` `runScenarioToTrajectory`).
 */
export function runGoldenTrajectory(
  presetId: GoldenPresetId,
  stepperKind: GoldenStepperKind,
): Trajectory {
  const spec = presetById(presetId);
  const forces = spec.model.forceIds.map(forceById);
  const model = createPlanarProjectileModel(forces);
  const env = environmentSpecToEnvironment(spec.environment, spec.seed);
  const params = projectileSpecToParams(spec.projectile, spec.initialConditions.spin0);
  const ctx = createEvalContext(env, params);

  const ic = spec.initialConditions;
  const y0 = new Float64Array([ic.x0, ic.y0, ic.vx0, ic.vy0]);

  const { stepper, cfg } = buildStepperAndConfig(stepperKind, presetId);
  const recorder = new TrajectoryRecorder();
  const report = integrate(model, ctx, y0, [0, GOLDEN_T_FINAL], cfg, stepper, [recorder]);
  if (report.status !== "ok") {
    throw new Error(
      `golden trajectory ${presetId}/${stepperKind} failed to integrate: ${report.status}`,
    );
  }
  return recorder.trajectory;
}

/** SHA-256 over every buffer backing a Trajectory (same recipe as solverkit's `determinism.test.ts`). */
export function hashTrajectory(trajectory: Trajectory): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(trajectory.t.buffer, trajectory.t.byteOffset, trajectory.t.byteLength));
  for (const channel of trajectory.channels) {
    hash.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Golden store v2 (P4.37)
// ---------------------------------------------------------------------------

/**
 * v2 scope (§8.4, P4.37). v1 (P2.52) froze six `PRESET_SCENARIOS` against two steppers, and
 * every one of those twelve entries is *kept unchanged* here -- they are the ratchet proving
 * Phase 4 did not silently move pre-existing numerics. What v1 could not cover is the physics
 * that did not exist when it was recorded: the ISA atmosphere (P4.01), altitude-dependent
 * gravity (P4.02), the temperature-aware η(T)/c(T) wiring that makes Re and M altitude-aware
 * (P4.03), the Mach-dependent C_d(M) transonic rise (P4.04), the dim-5 planar-spin model
 * (P4.07), the dim-6 spatial model (P4.23), and the wind kinds added across P4.16-P4.19.
 *
 * Rather than invent scenarios for this, v2 draws its entries from the P4.36 curated library,
 * which was built to span exactly those axes and is already validated (every spec parses,
 * resolves and integrates). The library supplies the *physics* -- model kind, forces,
 * projectile, environment, seed; the solver each entry is recorded with is
 * {@link GOLDEN_V2_SOLVER}, not the one the spec carries, for the measured reason documented
 * there. One entry, `energy-drift-gravity-only`, keeps its library solver because being
 * fixed-step is the entry's whole subject.
 *
 * Selection rule: one entry per capability v1 cannot reach, not "as many as possible". A
 * regression store earns its keep by failing for a reason someone can name.
 */
export const GOLDEN_V2_SCENARIO_IDS = [
  // ISA atmosphere (P4.01) + the Mach-dependent C_d(M) transonic rise (P4.04): this is the
  // library's fastest entry (Mach ~0.735), the only one that climbs the C_d(M) curve at all.
  "cannonball-muzzle",
  // The C_d(Re) drag-crisis band -- a steep, narrow feature in the RHS that makes this the
  // store's most sensitive entry by construction (see the tolerance review below).
  "smooth-sphere-drag-crisis",
  // dim-5 planar-spin model (P4.07): the extra state channel with omega-dot = -omega/tau.
  "table-tennis-topspin-decay",
  // dim-6 spatial model (P4.23): 3D state, with drag coupling the out-of-plane and in-plane
  // motion through |v|.
  "lateral-launch-3d",
  // Height-varying wind (shear), as opposed to v1's uniform head/tailwind.
  "log-profile-boundary-layer",
  // Deterministic time-windowed gust (P4.18).
  "one-cosine-gust",
  // Seeded frozen OU realisation (P4.16/P4.17, ADR-011). The store's only stochastic entry:
  // its hash is what proves "frozen realisation" actually means reproducible under a fixed seed.
  "frozen-ou-gust",
  // Spatially varying wind field (Lamb-Oseen vortex) -- wind that depends on position, not
  // just on height or time.
  "vortex-crossing",
  // Exponential atmosphere *plus* altitude-dependent gravity (P4.02), the only library entry
  // that turns the latter on.
  "density-altitude-2000m",
  // Buoyancy wired on under the ISA atmosphere (P4.20). v1's buoyancy coverage, if any, rides
  // on preset composition; here it is the point of the entry.
  "buoyancy-visible",
  // Fixed-step RK4 from the library's own solver spec, on conservative gravity-only dynamics.
  "energy-drift-gravity-only",
] as const;

export type GoldenV2ScenarioId = (typeof GOLDEN_V2_SCENARIO_IDS)[number];

/**
 * Model-kind -> live `Model` resolver, mirroring `@ballista/runtime`'s `resolveModel`. The
 * duplication is structural, not an oversight: dependency-cruiser forbids `validation` from
 * importing `runtime` (and forbids anything importing `validation`), so this dev-only package
 * cannot reuse that resolver -- the same reason `forceById` above duplicates `resolveForce`.
 * Kept deliberately minimal: it resolves what the library's specs actually declare.
 */
function buildFromSpec(spec: ScenarioSpec): { model: Model; ctx: EvalContext; y0: Float64Array } {
  const forces = spec.model.forceIds.map(forceById);
  const env = environmentSpecToEnvironment(spec.environment, spec.seed);
  const params = projectileSpecToParams(spec.projectile, spec.initialConditions.spin0);
  const ctx = createEvalContext(env, params);
  const ic = spec.initialConditions;
  const kind = spec.model.kind ?? "planar";

  switch (kind) {
    case "planar":
      return {
        model: createPlanarProjectileModel(forces),
        ctx,
        y0: new Float64Array([ic.x0, ic.y0, ic.vx0, ic.vy0]),
      };
    case "planar-spin":
      return {
        model: createPlanarProjectileSpinModel(forces, spec.model.tauOmega ?? DEFAULT_TAU_OMEGA),
        ctx,
        y0: new Float64Array([ic.x0, ic.y0, ic.vx0, ic.vy0, ic.spin0 ?? 0]),
      };
    case "spatial":
      return {
        model: createSpatialProjectileModel(forces),
        ctx,
        y0: new Float64Array([ic.x0, ic.y0, ic.z0 ?? 0, ic.vx0, ic.vy0, ic.vz0 ?? 0]),
      };
  }
}

/**
 * Spin-decay constant used when a `"planar-spin"` spec omits `tauOmega`. Must match
 * `@ballista/runtime`'s `DEFAULT_TAU_OMEGA` or a library spin scenario would integrate
 * differently here than in the app; `golden-trajectories.test.ts` pins the only library entry
 * that exercises this path to an explicit `tauOmega`, so the default is a fallback, not a
 * silent physics choice this store makes on the library's behalf.
 */
const DEFAULT_TAU_OMEGA = 25;

/** Stepper-id -> live instance, mirroring `@ballista/runtime`'s `resolveStepper` (same duplication rationale as `buildFromSpec`). */
function stepperById(id: string): Stepper {
  switch (id) {
    case "explicit-euler":
      return new ExplicitEulerStepper();
    case "midpoint-rk2":
      return new MidpointRK2Stepper();
    case "heun-rk2":
      return new HeunRK2Stepper();
    case "classical-rk4":
      return new ClassicalRK4Stepper();
    case "bogacki-shampine-32":
      return createBogackiShampine32Stepper();
    case "dopri5":
    case "rk45":
      return createDormandPrince54Stepper();
    default:
      throw new Error(`Unknown stepper id in golden fixture: ${id}`);
  }
}

/** Serializable `SolverConfigSpec` -> live `SolverConfig` (mirrors `@ballista/runtime`'s `resolveSolverConfig`). */
function solverConfigFromSpec(spec: ScenarioSpec): SolverConfig {
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

function librarySpec(id: GoldenV2ScenarioId): ScenarioSpec {
  const found = SCENARIO_LIBRARY.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown scenario library id in golden v2 store: ${id}`);
  return found.spec;
}

/**
 * The solver v2 entries are *recorded* with, which is deliberately not the one their library
 * spec carries.
 *
 * Nearly every library entry uses `scenario-presets.ts`'s `REFERENCE_SOLVER` -- DOPRI5 at
 * rtol=1e-6, atol=1e-9. That is the right working tolerance for an interactive app, and the
 * wrong one for a regression store, for a reason the tolerance review below measured directly:
 * at rtol=1e-6 an adaptive step sequence is itself sensitive to a one-ulp change in the initial
 * state, so two honest runs of the *same physics* can land ~1e-5 apart on an entry whose
 * right-hand side varies quickly (the frozen-OU gust: a 7e-15 change in vx0 moved the final
 * state by 8e-5, an amplification of 3.6e11). A golden recorded that way cannot detect a
 * physics regression smaller than its own solver noise, which is most of what a golden is for.
 *
 * So v2 keeps the library's *scenario* -- the model, forces, projectile, environment and seed,
 * which is the Phase-4 physics this task exists to cover -- and pairs it with v1's own
 * regression-grade DOPRI5 configuration. This follows v1's precedent exactly: P2.52 also took
 * `PRESET_SCENARIOS` for the physics and chose its own solver settings rather than the presets'.
 */
const GOLDEN_V2_SOLVER: SolverConfig = {
  stepper: "dopri5",
  rtol: 1e-10,
  atol: 1e-12,
  controller: "PI",
  maxSteps: 200_000,
};

/**
 * The one v2 entry recorded with its library solver spec instead of {@link GOLDEN_V2_SOLVER}.
 * `energy-drift-gravity-only` is fixed-step *on purpose* -- its library note says an adaptive
 * controller would shrink the step until the energy drift the entry exists to expose vanished.
 * Overriding its solver would not just change its numbers, it would delete its subject.
 */
const V2_USES_LIBRARY_SOLVER: ReadonlySet<string> = new Set(["energy-drift-gravity-only"]);

/**
 * Integrates one v2 library scenario over the shared {@link GOLDEN_T_FINAL} horizon, from a
 * freshly built Model/EvalContext/Stepper (sharing nothing across calls, same contract as
 * {@link runGoldenTrajectory}). The horizon is v1's, not the scenario's: the store records a
 * numerical snapshot, not a physically-terminated flight -- no ground-impact event is wired in.
 *
 * `y0Override` exists for the tolerance review ({@link measureFinalStateSensitivity}) and is
 * not used when recording; passing it changes nothing else about the run.
 */
export function runGoldenScenario(id: GoldenV2ScenarioId, y0Override?: Float64Array): Trajectory {
  const spec = librarySpec(id);
  const { model, ctx, y0 } = buildFromSpec(spec);
  const useLibrarySolver = V2_USES_LIBRARY_SOLVER.has(id);
  const cfg = useLibrarySolver ? solverConfigFromSpec(spec) : GOLDEN_V2_SOLVER;
  const stepper = stepperById(useLibrarySolver ? spec.solver.stepper : GOLDEN_V2_SOLVER.stepper);
  const recorder = new TrajectoryRecorder();
  const report = integrate(model, ctx, y0Override ?? y0, [0, GOLDEN_T_FINAL], cfg, stepper, [
    recorder,
  ]);
  if (report.status !== "ok") {
    throw new Error(`golden v2 scenario ${id} failed to integrate: ${report.status}`);
  }
  return recorder.trajectory;
}

// ---------------------------------------------------------------------------
// Tolerance review (P4.37, second half)
// ---------------------------------------------------------------------------

/**
 * §8.4's documented cross-platform relative tolerance, and v1's single global value: every
 * entry's final state had to agree to 1e-13 relative. v2 keeps this as the *floor* rather than
 * the universal answer -- see {@link measureFinalStateSensitivity} for why one number cannot be
 * right for every entry.
 */
export const GOLDEN_BASE_RELATIVE_TOLERANCE = 1e-13;

/** Double-precision unit roundoff, the smallest perturbation this measurement can inject. */
const EPS = Number.EPSILON;

/**
 * Empirical conditioning of one entry's final state.
 *
 * The question a golden tolerance answers is: *how far apart may two honest evaluations of this
 * same trajectory land before the difference stops being roundoff and starts being a
 * regression?* v1 answered it with one number (1e-13) for all twelve entries. That is defensible
 * only if every entry amplifies roundoff about equally, which is exactly what this measures --
 * and, for the drag-crisis and adaptive-stepper entries, disproves.
 *
 * Method: perturb each non-zero component of `y0` by one relative `EPS` -- the smallest change
 * a different-but-equally-correct platform could plausibly produce in the initial state -- and
 * re-integrate. The amplification factor is the largest resulting relative change in the final
 * state, divided by `EPS`. A well-conditioned entry returns O(1)-O(100); an entry whose
 * right-hand side has a steep feature, or whose adaptive controller reorders its step sequence
 * under the perturbation, returns far more.
 *
 * Zero components are skipped, not perturbed by an absolute epsilon: there is no scale-free
 * "one ulp" for an exact zero, and inventing one would make the number an artefact of the
 * chosen scale rather than a property of the dynamics.
 *
 * This measures *conditioning*, not correctness. A large amplification does not mean the
 * trajectory is wrong; it means bit-exactness is the only meaningful same-platform check and
 * that a cross-platform comparison of this entry must be correspondingly looser.
 */
export function measureFinalStateSensitivity(id: GoldenV2ScenarioId): {
  readonly amplification: number;
  readonly nStepsVaried: boolean;
} {
  const spec = librarySpec(id);
  const { y0 } = buildFromSpec(spec);
  const base = runGoldenScenario(id);
  const baseLast = base.nSteps - 1;
  const baseFinal = Array.from(base.channels, (channel) => channel[baseLast]!);

  let worst = 0;
  let nStepsVaried = false;

  for (let i = 0; i < y0.length; i++) {
    const original = y0[i]!;
    if (original === 0) continue;
    const perturbed = Float64Array.from(y0);
    perturbed[i] = original * (1 + EPS);
    // A perturbation smaller than one ulp rounds back to the original value and would measure
    // nothing; skip rather than report a spurious zero.
    if (perturbed[i] === original) continue;

    const run = runGoldenScenario(id, perturbed);
    if (run.nSteps !== base.nSteps) nStepsVaried = true;
    const last = run.nSteps - 1;
    for (let c = 0; c < baseFinal.length; c++) {
      const value = run.channels[c]![last]!;
      const reference = baseFinal[c]!;
      const scale = Math.max(Math.abs(value), Math.abs(reference), 1);
      worst = Math.max(worst, Math.abs(value - reference) / scale);
    }
  }

  return { amplification: worst / EPS, nStepsVaried };
}

/**
 * Turns a measured amplification into the tolerance actually recorded for an entry: the
 * measured requirement (`amplification * EPS`) rounded *up* to the next power of ten, floored
 * at {@link GOLDEN_BASE_RELATIVE_TOLERANCE}.
 *
 * Rounding to a decade rather than recording the raw measurement is deliberate. The measurement
 * is itself platform-dependent -- it is a property of this machine's libm and this build's
 * instruction selection as much as of the dynamics -- so pinning a tolerance to its exact value
 * would produce a fixture that fails on the next runner for no physical reason. A decade of
 * headroom is enough to absorb that while still being a real, derived bound rather than a
 * number chosen to make the suite pass.
 */
export function toleranceForAmplification(amplification: number): number {
  const required = amplification * EPS;
  if (!(required > GOLDEN_BASE_RELATIVE_TOLERANCE)) return GOLDEN_BASE_RELATIVE_TOLERANCE;
  return Math.pow(10, Math.ceil(Math.log10(required)));
}
