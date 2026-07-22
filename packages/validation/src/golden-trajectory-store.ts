import { createHash } from "node:crypto";
import {
  BuoyancyForce,
  GravityForce,
  LinearDragForce,
  MagnusForce,
  PRESET_SCENARIOS,
  QuadraticDragForce,
  createEvalContext,
  createPlanarProjectileModel,
  environmentSpecToEnvironment,
  projectileSpecToParams,
  type ForceModel,
  type ScenarioSpec,
} from "@ballista/engine";
import {
  ClassicalRK4Stepper,
  TrajectoryRecorder,
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
  const env = environmentSpecToEnvironment(spec.environment);
  const params = projectileSpecToParams(spec.projectile);
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
