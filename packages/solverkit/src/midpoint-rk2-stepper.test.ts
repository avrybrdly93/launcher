import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  LinearDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  type ChannelMeta,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import { measureConvergence } from "./convergence-harness.js";
import { MidpointRK2Stepper } from "./midpoint-rk2-stepper.js";
import { integrate } from "./integrate.js";
import { createStepResult, type SolverConfig } from "./types.js";

const DECAY_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];

/** ydot = -y, dim 1. */
function createDecayModel(): Model {
  return {
    dim: 1,
    channels: DECAY_CHANNELS,
    rhs(_t: number, y: Float64Array, out: Float64Array): void {
      out[0] = -y[0]!;
    },
  };
}

function createEvalContextFixture(): EvalContext {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  return createEvalContext(env, params);
}

describe("MidpointRK2Stepper (P2.10)", () => {
  it("one step of ydot=-y matches the closed-form quadratic Taylor truncation y0*(1-h+h^2/2)", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = new MidpointRK2Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([1]);
    const out = createStepResult(1);
    const h = 0.1;

    stepper.step(0, y, h, out);

    expect(out.yNext[0]).toBeCloseTo(1 - h + (h * h) / 2, 15);
    expect(out.accepted).toBe(true);
    expect(out.h).toBe(h);
    expect(out.nRHS).toBe(2);
  });

  it("declares order 2, non-FSAL, non-symplectic", () => {
    const stepper = new MidpointRK2Stepper();
    expect(stepper.info).toEqual({
      id: "midpoint-rk2",
      order: 2,
      fsal: false,
      symplectic: false,
    });
  });

  it("throws if step() is called before init()", () => {
    const stepper = new MidpointRK2Stepper();
    expect(() => stepper.step(0, new Float64Array([1]), 0.1, createStepResult(1))).toThrow();
  });

  it("drives integrate() end to end without accumulating error on a linear rhs", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = new MidpointRK2Stepper();
    const cfg: SolverConfig = { stepper: "midpoint-rk2", h: 0.1, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

    expect(report.status).toBe("ok");
    expect(report.nSteps).toBe(10);
    // Compounding the per-step quadratic Taylor truncation ten times.
    expect(report.yFinal[0]).toBeCloseTo((1 - 0.1 + 0.005) ** 10, 12);
  });

  it("slope 2.00 +/- 0.05 on linear-drag benchmark (3.6-3.7)", () => {
    // A much smaller mass than P2.07's Euler benchmark: with mass=1 there
    // (tau ~ 3e5 s against a tau=0.2s tspan), drag is so weak relative to
    // gravity that RK2's O(h^2) truncation term is swamped by floating-point
    // noise before the h-ladder even starts, and (1 - exp(-t/tau)) below
    // would itself lose ~6 digits to cancellation since t/tau ~ 1e-6. Euler's
    // larger O(h) error hid both issues; a second-order method needs a tau
    // comparable to tspan (here ~0.1s) so the curvature RK2's error depends
    // on is actually resolvable, plus expm1 for the exact solution's own
    // precision so it doesn't become the error floor.
    const mass = 3.372e-7;
    const radius = 0.01;
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    env.sample(0, 0, 0, ctx.env);

    const b = 6 * Math.PI * ctx.env.eta * radius;
    const tau = mass / b;
    const vT = (mass * ctx.env.g) / b;

    const model = createPlanarProjectileModel([new GravityForce(), new LinearDragForce()]);
    const y0 = new Float64Array([0, 100, 20, 5]);
    const tspan: readonly [number, number] = [0, 0.2];

    function yExact(t: number): Float64Array {
      const [x0, yy0, vx0, vy0] = y0 as unknown as [number, number, number, number];
      const decay = Math.exp(-t / tau);
      const oneMinusDecay = -Math.expm1(-t / tau);
      const vx = vx0 * decay;
      const vy = -vT + (vy0 + vT) * decay;
      const x = x0 + vx0 * tau * oneMinusDecay;
      const y = yy0 - vT * t + (vy0 + vT) * tau * oneMinusDecay;
      return new Float64Array([x, y, vx, vy]);
    }

    const hs = [0.01, 0.005, 0.0025, 0.00125, 0.000625];
    const result = measureConvergence(
      () => new MidpointRK2Stepper(),
      model,
      ctx,
      y0,
      tspan,
      yExact,
      hs,
    );

    expect(result.errors.length).toBe(hs.length);
    for (let i = 1; i < result.errors.length; i++) {
      expect(result.errors[i]!).toBeLessThan(result.errors[i - 1]!);
    }
    expect(result.slope).toBeGreaterThan(1.95);
    expect(result.slope).toBeLessThan(2.05);
  });
});
