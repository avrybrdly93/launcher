import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
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
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { integrate } from "./integrate.js";
import { TrajectoryRecorder, type Trajectory } from "./trajectory-recorder.js";
import type { SolverConfig } from "./types.js";

/**
 * Stand-in for a force-id -> live-instance lookup (P1.17 established the
 * registry *pattern*; a spec-id resolver for models/forces/steppers isn't
 * built yet -- that's SimulationSession/L2 territory, P3.03+). Mirrors
 * exactly what a `ScenarioSpec.model.forceIds` entry is expected to
 * resolve to.
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
      throw new Error(`Unknown force id in test fixture: ${id}`);
  }
}

/**
 * Builds a fresh Model/EvalContext/Stepper/initial-state/SolverConfig from
 * a `ScenarioSpec` and integrates it to a frozen `Trajectory`, sharing
 * *nothing* across calls -- every object below is newly constructed inside
 * this function each time it's called. That's the closest proxy available
 * today to "same spec run on a worker vs. on main" (P2.44's literal
 * validation text): there is no worker pool yet (P3.39+), so the property
 * this actually tests is that the pipeline depends on nothing but the
 * spec's own values -- no shared mutable state, no reliance on object
 * identity or call ordering across independent runs, which is exactly
 * what would break first if it were ever run cross-thread.
 */
function runScenarioToTrajectory(spec: ScenarioSpec): Trajectory {
  const forces = spec.model.forceIds.map(forceById);
  const model = createPlanarProjectileModel(forces);
  const env = environmentSpecToEnvironment(spec.environment);
  const params = projectileSpecToParams(spec.projectile);
  const ctx = createEvalContext(env, params);

  const ic = spec.initialConditions;
  const y0 = new Float64Array([ic.x0, ic.y0, ic.vx0, ic.vy0]);

  const cfg: SolverConfig = {
    stepper: "dopri5",
    maxSteps: spec.solver.maxSteps,
    ...(spec.solver.rtol !== undefined ? { rtol: spec.solver.rtol } : {}),
    ...(spec.solver.atol !== undefined
      ? {
          atol: Array.isArray(spec.solver.atol)
            ? Float64Array.from(spec.solver.atol)
            : spec.solver.atol,
        }
      : {}),
    ...(spec.solver.controller !== undefined ? { controller: spec.solver.controller } : {}),
  };

  const recorder = new TrajectoryRecorder();
  const stepper = createDormandPrince54Stepper();
  const report = integrate(model, ctx, y0, [0, 3], cfg, stepper, [recorder]);
  expect(report.status).toBe("ok");
  return recorder.trajectory;
}

/** SHA-256 over every buffer backing a `Trajectory` (§2.6's determinism contract, P2.44). */
function hashTrajectory(trajectory: Trajectory): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(trajectory.t.buffer, trajectory.t.byteOffset, trajectory.t.byteLength));
  for (const channel of trajectory.channels) {
    hash.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
  }
  return hash.digest("hex");
}

describe("determinism: same ScenarioSpec => bit-identical trajectory (P2.44)", () => {
  const headwind = PRESET_SCENARIOS.find(
    (s) => s.environment.wind.kind === "uniform" && s.environment.wind.wx < 0,
  );
  if (!headwind) throw new Error("expected a headwind preset in PRESET_SCENARIOS");

  it("two fully independent runs of the same scenario produce identical SHA-256 trajectory hashes", () => {
    const first = runScenarioToTrajectory(headwind);
    const second = runScenarioToTrajectory(headwind);

    expect(first.nSteps).toBeGreaterThan(1);
    expect(first.nSteps).toBe(second.nSteps);
    expect(hashTrajectory(first)).toBe(hashTrajectory(second));

    // Bit-exact, not just hash-equal-by-luck: every recorded state matches
    // to the last representable bit, per channel.
    for (let c = 0; c < first.channels.length; c++) {
      expect(second.channels[c]).toEqual(first.channels[c]);
    }
    expect(second.t).toEqual(first.t);
  });

  it("every preset in the library is independently reproducible across two runs", () => {
    for (const spec of PRESET_SCENARIOS) {
      const first = runScenarioToTrajectory(spec);
      const second = runScenarioToTrajectory(spec);
      expect(hashTrajectory(second)).toBe(hashTrajectory(first));
    }
  });

  it("a different initial condition changes the hash (the harness is discriminating, not vacuously equal)", () => {
    const perturbed: ScenarioSpec = {
      ...headwind,
      initialConditions: { ...headwind.initialConditions, vx0: headwind.initialConditions.vx0 + 1 },
    };

    const original = runScenarioToTrajectory(headwind);
    const changed = runScenarioToTrajectory(perturbed);

    expect(hashTrajectory(changed)).not.toBe(hashTrajectory(original));
  });
});
