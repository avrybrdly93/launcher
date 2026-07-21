import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";
import { benchmarkStepper } from "./micro-benchmark.js";

function createModelFixture() {
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  return { model, ctx };
}

/**
 * Sanity coverage for the harness itself (deterministic, no baseline
 * comparison -- that lives in scripts/check-benchmark-regression.mjs,
 * which runs as its own soft-warn CI step so a noisy CI runner never
 * fails `pnpm test`).
 */
describe("benchmarkStepper (P2.43 harness)", () => {
  it("reports a finite, positive steps/sec for a cheap explicit method", () => {
    const { model, ctx } = createModelFixture();
    const y0 = new Float64Array([0, 100, 20, 0]);

    const result = benchmarkStepper(new ExplicitEulerStepper(), model, ctx, y0, 0.001, 100, 2000);

    expect(result.id).toBe("explicit-euler");
    expect(result.steps).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(100);
    expect(Number.isFinite(result.stepsPerSec)).toBe(true);
    expect(result.stepsPerSec).toBeGreaterThan(0);
  });

  it("a 4-stage method (RK4) measures a lower steps/sec than 1-stage Euler on the same problem", () => {
    const { model, ctx } = createModelFixture();
    const y0 = new Float64Array([0, 100, 20, 0]);

    // Generous warmup/duration (not the CI script's tighter, best-of-3
    // methodology) since this runs inside vitest's parallelized test-file
    // pool alongside dozens of other files -- CPU contention makes a
    // short wall-clock measurement unreliable, but classical-rk4's 4
    // rhs-evals/step vs explicit-euler's 1 is close to a 4x gap, which
    // comfortably survives that noise once each measurement window is
    // long enough to average over it.
    const euler = benchmarkStepper(new ExplicitEulerStepper(), model, ctx, y0, 0.001, 150, 2000);
    const rk4 = benchmarkStepper(new ClassicalRK4Stepper(), model, ctx, y0, 0.001, 150, 2000);

    // Not a tight ratio assertion (that belongs to the CI regression
    // check against a recorded baseline) -- just proving the harness is
    // discriminating: 4 rhs evals/step must cost measurably more than 1.
    expect(rk4.stepsPerSec).toBeLessThan(euler.stepsPerSec);
  });
});
