import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  LinearDragForce,
  QuadraticDragForce,
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
import { HeunRK2Stepper } from "./heun-rk2-stepper.js";
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

describe("HeunRK2Stepper (P2.11)", () => {
  it("one step of ydot=-y matches the closed-form quadratic Taylor truncation y0*(1-h+h^2/2)", () => {
    // b1=b2=1/2 and c2=a21=1 make this coincide with midpoint's formula for
    // this scalar linear rhs (both satisfy the same order-2 conditions
    // b2*c2=b2*a21=1/2); they diverge starting at the h^3 term, which is
    // exactly the LTE-constant difference the convergence test below probes.
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = new HeunRK2Stepper();
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
    const stepper = new HeunRK2Stepper();
    expect(stepper.info).toEqual({
      id: "heun-rk2",
      order: 2,
      fsal: false,
      symplectic: false,
    });
  });

  it("throws if step() is called before init()", () => {
    const stepper = new HeunRK2Stepper();
    expect(() => stepper.step(0, new Float64Array([1]), 0.1, createStepResult(1))).toThrow();
  });

  it("drives integrate() end to end without accumulating error on a linear rhs", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = new HeunRK2Stepper();
    const cfg: SolverConfig = { stepper: "heun-rk2", h: 0.1, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

    expect(report.status).toBe("ok");
    expect(report.nSteps).toBe(10);
    expect(report.yFinal[0]).toBeCloseTo((1 - 0.1 + 0.005) ** 10, 12);
  });

  it("slope 2.00 +/- 0.05 on linear-drag benchmark (3.6-3.7), same scenario as P2.10", () => {
    // Same tuned scenario as MidpointRK2Stepper's convergence test (tau ~
    // 0.1s comparable to tspan, expm1 for the exact solution's own
    // precision) -- see that test's comment for why P2.07's mass=1 Euler
    // benchmark doesn't resolve a second-order method's truncation term.
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
      () => new HeunRK2Stepper(),
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

  it("differs from midpoint by intercept, not slope, on a genuinely nonlinear rhs", async () => {
    // The linear-drag benchmark above can't show this: for an affine rhs
    // f(y)=Ay+c, k2's dependence on the tableau collapses to k2 = (I + h
    // a21 A) k1, so the single-step map depends only on the *product*
    // b2*a21 (fixed at 1/2 by the order-2 conditions for both midpoint and
    // Heun) -- the two methods produce bit-identical output on any linear
    // ODE, not just the same asymptotic order. The LTE-constant difference
    // §4.3 describes comes from f's curvature (f_yy), so demonstrating it
    // needs quadratic drag: a body dropped from rest under gravity +
    // quadratic drag has closed form v(t) = -v_T tanh(g t/v_T), y(t) = y0 -
    // (v_T^2/g) ln(cosh(g t/v_T)) (from du/dt = g - (g/v_T^2) u^2, u=-v).
    const { MidpointRK2Stepper } = await import("./midpoint-rk2-stepper.js");
    const mass = 0.145;
    const radius = 0.0366;
    const cd = 0.35;
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(cd),
    });
    const ctx = createEvalContext(env, params);
    env.sample(0, 0, 0, ctx.env);
    const g = ctx.env.g;
    const vT = Math.sqrt((2 * mass * g) / (ctx.env.rho * cd * params.area));

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const y0 = new Float64Array([0, 1000, 0, 0]);
    const tspan: readonly [number, number] = [0, 1];

    function yExact(t: number): Float64Array {
      const u = vT * Math.tanh((g * t) / vT);
      const y = 1000 - ((vT * vT) / g) * Math.log(Math.cosh((g * t) / vT));
      return new Float64Array([0, y, 0, -u]);
    }

    const hs = [0.01, 0.005, 0.0025, 0.00125, 0.000625];
    const heun = measureConvergence(() => new HeunRK2Stepper(), model, ctx, y0, tspan, yExact, hs);
    const midpoint = measureConvergence(
      () => new MidpointRK2Stepper(),
      model,
      ctx,
      y0,
      tspan,
      yExact,
      hs,
    );

    // Same order (slope), but the LTE constants differ, so the two error
    // curves are not numerically identical at any shared h.
    expect(heun.slope).toBeGreaterThan(1.95);
    expect(heun.slope).toBeLessThan(2.05);
    expect(midpoint.slope).toBeGreaterThan(1.95);
    expect(midpoint.slope).toBeLessThan(2.05);
    for (let i = 0; i < hs.length; i++) {
      const relDiff = Math.abs(heun.errors[i]! - midpoint.errors[i]!) / midpoint.errors[i]!;
      expect(relDiff).toBeGreaterThan(0.01);
    }
  });
});
