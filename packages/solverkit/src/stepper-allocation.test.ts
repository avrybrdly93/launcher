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
  type EvalContext,
  type Model,
} from "@ballista/engine";
import { createBogackiShampine32Stepper } from "./bogacki-shampine-32.js";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";
import { HeunRK2Stepper } from "./heun-rk2-stepper.js";
import { MidpointRK2Stepper } from "./midpoint-rk2-stepper.js";
import { SemiImplicitEulerStepper } from "./semi-implicit-euler-stepper.js";
import { createStepResult, type Stepper } from "./types.js";
import { VerletStepper } from "./verlet-stepper.js";

const WARMUP = 5_000;
const ITERS = 20_000;
const BYTES_PER_ITER_THRESHOLD = 5;

function createModelFixture(): { model: Model; ctx: EvalContext } {
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
 * Same warmup-then-measure methodology as P1.21's rhs-allocation harness
 * (rhs-allocation.test.ts): forcing a full GC both immediately before *and*
 * after the measured loop discriminates genuinely retained per-call
 * allocations from transient temporaries V8 scalar-replaces once the loop
 * is JIT-hot. `h` is small enough, and `ITERS` short enough, that the
 * ballistic state (falling under gravity+quadratic-drag) never approaches
 * a magnitude that could destabilize the measurement.
 */
function measureBytesPerStep(stepper: Stepper): number {
  expect(typeof global.gc).toBe("function");

  const { model, ctx } = createModelFixture();
  stepper.init(model, ctx);

  const y = new Float64Array([0, 100, 20, 0]);
  const out = createStepResult(model.dim);
  const h = 0.001;

  const runSteps = (n: number): void => {
    for (let i = 0; i < n; i++) {
      stepper.step(i * h, y, h, out);
      y.set(out.yNext);
    }
  };

  runSteps(WARMUP);

  global.gc!();
  const before = process.memoryUsage().heapUsed;
  runSteps(ITERS);
  global.gc!();
  const after = process.memoryUsage().heapUsed;

  return (after - before) / ITERS;
}

/**
 * P2.42: extends P1.21's zero-allocation audit from the rhs hot path alone
 * to every registered stepper's `step()` call, Euler through DOPRI5
 * (P2.06-P2.24) -- the ordered range P2.42's own validation criterion
 * names. `BackwardEulerStepper` (P2.38) is out of that named range and not
 * included here: its damped-Newton loop is a fundamentally different hot
 * path (variable iteration count, an FD-Jacobian fallback branch) that
 * would need its own dedicated audit, not a mechanical extension of this
 * one.
 */
describe("stepper zero-allocation audit (P2.42, extends P1.21)", () => {
  it("ExplicitEulerStepper allocates ~0 bytes/step after warmup", () => {
    expect(measureBytesPerStep(new ExplicitEulerStepper())).toBeLessThan(BYTES_PER_ITER_THRESHOLD);
  });

  it("MidpointRK2Stepper allocates ~0 bytes/step after warmup", () => {
    expect(measureBytesPerStep(new MidpointRK2Stepper())).toBeLessThan(BYTES_PER_ITER_THRESHOLD);
  });

  it("HeunRK2Stepper allocates ~0 bytes/step after warmup", () => {
    expect(measureBytesPerStep(new HeunRK2Stepper())).toBeLessThan(BYTES_PER_ITER_THRESHOLD);
  });

  it("ClassicalRK4Stepper allocates ~0 bytes/step after warmup", () => {
    expect(measureBytesPerStep(new ClassicalRK4Stepper())).toBeLessThan(BYTES_PER_ITER_THRESHOLD);
  });

  it("SemiImplicitEulerStepper allocates ~0 bytes/step after warmup", () => {
    expect(measureBytesPerStep(new SemiImplicitEulerStepper())).toBeLessThan(
      BYTES_PER_ITER_THRESHOLD,
    );
  });

  it('VerletStepper ("velocity" variant) allocates ~0 bytes/step after warmup', () => {
    expect(measureBytesPerStep(new VerletStepper("velocity"))).toBeLessThan(
      BYTES_PER_ITER_THRESHOLD,
    );
  });

  it('VerletStepper ("position" variant) allocates ~0 bytes/step after warmup', () => {
    expect(measureBytesPerStep(new VerletStepper("position"))).toBeLessThan(
      BYTES_PER_ITER_THRESHOLD,
    );
  });

  it("BogackiShampine32Stepper (embedded-pair, FSAL) allocates ~0 bytes/step after warmup", () => {
    expect(measureBytesPerStep(createBogackiShampine32Stepper())).toBeLessThan(
      BYTES_PER_ITER_THRESHOLD,
    );
  });

  it("DormandPrince54Stepper (embedded-pair, FSAL, dense output) allocates ~0 bytes/step after warmup", () => {
    expect(measureBytesPerStep(createDormandPrince54Stepper())).toBeLessThan(
      BYTES_PER_ITER_THRESHOLD,
    );
  });
});
