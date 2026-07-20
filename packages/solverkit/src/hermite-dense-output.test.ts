import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createSphericalProjectileParams,
  type ChannelMeta,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { hermiteInterpolant, HermiteDenseOutputStepper } from "./hermite-dense-output.js";
import { integrate } from "./integrate.js";
import { createStepResult, type SolverConfig } from "./types.js";

function createEvalContextFixture(): EvalContext {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  return createEvalContext(env, params);
}

const CUBIC_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];

/**
 * y(t) = a + b*t + c*t^2 + d*t^3, an explicitly t-dependent (non-autonomous)
 * rhs whose true solution is a cubic polynomial. RK4's stages reduce to
 * Simpson's rule for a rhs depending only on t, which integrates any cubic
 * exactly -- so both the stepper's endpoints (y_k, y_{k+1}) and their
 * derivatives (f_k, f_{k+1}) come out exact to machine precision, letting
 * the Hermite interpolant's own exactness-on-cubics property be isolated
 * and tested cleanly (this task's literal validation criterion).
 */
function createCubicModel(a: number, b: number, c: number, d: number): Model {
  return {
    dim: 1,
    channels: CUBIC_CHANNELS,
    rhs(t: number, _y: Float64Array, out: Float64Array): void {
      out[0] = b + 2 * c * t + 3 * d * t * t;
    },
  };
}

function cubicExact(a: number, b: number, c: number, d: number, t: number): number {
  return a + b * t + c * t * t + d * t * t * t;
}

describe("hermiteInterpolant (P2.31, §4.9)", () => {
  it("reproduces the endpoints exactly at theta=0 and theta=1", () => {
    const y0 = new Float64Array([1, -2]);
    const f0 = new Float64Array([0.5, 3]);
    const y1 = new Float64Array([4, 7]);
    const f1 = new Float64Array([-1, 0.2]);
    const h = 0.3;
    const out = new Float64Array(2);

    hermiteInterpolant(0, y0, f0, y1, f1, h, out);
    expect(out).toEqual(y0);

    hermiteInterpolant(1, y0, f0, y1, f1, h, out);
    expect(out).toEqual(y1);
  });

  it("cubic reproduces a cubic polynomial exactly (validation criterion): y(t)=a+bt+ct^2+dt^3", () => {
    const [a, b, c, d] = [1, 2, 3, 4];
    const t0 = 0.7;
    const h = 0.4;
    const y0 = new Float64Array([cubicExact(a, b, c, d, t0)]);
    const y1 = new Float64Array([cubicExact(a, b, c, d, t0 + h)]);
    // Exact derivative y'(t) = b + 2c*t + 3d*t^2 at each endpoint.
    const f0 = new Float64Array([b + 2 * c * t0 + 3 * d * t0 * t0]);
    const f1 = new Float64Array([b + 2 * c * (t0 + h) + 3 * d * (t0 + h) * (t0 + h)]);

    const out = new Float64Array(1);
    for (const theta of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      hermiteInterpolant(theta, y0, f0, y1, f1, h, out);
      const exact = cubicExact(a, b, c, d, t0 + theta * h);
      expect(out[0]).toBeCloseTo(exact, 12);
    }
  });
});

describe("HermiteDenseOutputStepper (P2.31)", () => {
  it("wraps ClassicalRK4Stepper: info.denseOrder=3, exposes interpolant", () => {
    const stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    expect(stepper.info.denseOrder).toBe(3);
    expect(stepper.info.order).toBe(4); // inherited from the wrapped RK4
    expect(typeof stepper.interpolant).toBe("function");
  });

  it("interpolant(0,.) = y_k and interpolant(1,.) = y_{k+1} for a single step", () => {
    const model = createCubicModel(1, 2, 3, 4);
    const ctx = createEvalContextFixture();
    const stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    stepper.init(model, ctx);

    const y = new Float64Array([cubicExact(1, 2, 3, 4, 0)]);
    const out = createStepResult(1);
    stepper.step(0, y, 0.5, out);

    const sample = new Float64Array(1);
    stepper.interpolant(0, sample);
    expect(sample[0]).toBeCloseTo(y[0]!, 13);

    stepper.interpolant(1, sample);
    expect(sample[0]).toBeCloseTo(out.yNext[0]!, 13);
  });

  it("interior samples reproduce the cubic trajectory to near machine precision", () => {
    const [a, b, c, d] = [1, 2, 3, 4];
    const model = createCubicModel(a, b, c, d);
    const ctx = createEvalContextFixture();
    const stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    stepper.init(model, ctx);

    const t0 = 0;
    const h = 0.5;
    const y = new Float64Array([cubicExact(a, b, c, d, t0)]);
    const out = createStepResult(1);
    stepper.step(t0, y, h, out);

    const sample = new Float64Array(1);
    for (const theta of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      stepper.interpolant(theta, sample);
      const exact = cubicExact(a, b, c, d, t0 + theta * h);
      expect(Math.abs(sample[0]! - exact)).toBeLessThan(1e-9);
    }
  });

  it("throws a clear error when called before init()/step()", () => {
    const stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    expect(() => stepper.interpolant(0.5, new Float64Array(1))).toThrow(/before init/);
  });

  it("nRHS accounting: 2 extra rhs calls on the first step, 1 extra on each subsequent step (f_k reuse)", () => {
    const model = createCubicModel(1, 2, 3, 4);
    const ctx = createEvalContextFixture();
    const stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    const bareInnerStages = 4; // RK4: 4 stages/step, no FSAL

    const y0 = new Float64Array([cubicExact(1, 2, 3, 4, 0)]);
    const h = 0.1;
    const nSteps = 3;
    const cfg: SolverConfig = { stepper: "hermite-rk4", h, maxSteps: nSteps + 1 };

    const report = integrate(model, ctx, y0, [0, h * nSteps], cfg, stepper);

    expect(report.status).toBe("ok");
    expect(report.nSteps).toBe(nSteps);
    // step 1: 4 (inner) + 2 (f_k, f_{k+1}); steps 2-3: 4 (inner) + 1 (f_{k+1} only, f_k reused).
    const expectedRHS = bareInnerStages + 2 + (bareInnerStages + 1) * (nSteps - 1);
    expect(report.nRHS).toBe(expectedRHS);
  });

  it("without step-chaining (fresh y each call) the f_k reuse never fires -- always 2 extra rhs calls", () => {
    const model = createCubicModel(1, 2, 3, 4);
    const ctx = createEvalContextFixture();
    const stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    stepper.init(model, ctx);

    const h = 0.1;
    const out = createStepResult(1);
    let y = new Float64Array([cubicExact(1, 2, 3, 4, 0)]);

    stepper.step(0, y, h, out);
    expect(out.nRHS).toBe(6); // 4 + f_k + f_{k+1}

    // A perturbed copy, not the same buffer/content as the previous yNext.
    y = Float64Array.from([out.yNext[0]! + 1e-3]);
    stepper.step(h, y, h, out);
    expect(out.nRHS).toBe(6); // reuse check fails (different y) -> f_k recomputed
  });
});
