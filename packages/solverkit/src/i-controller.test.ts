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
} from "@ballista/engine";
import { createBogackiShampine32Stepper } from "./bogacki-shampine-32.js";
import { l2Error } from "./convergence-harness.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { attemptAdaptiveStep, DEFAULT_I_CONTROLLER, iControllerFactor } from "./i-controller.js";
import { integrate } from "./integrate.js";
import { createStepResult, type SolverConfig } from "./types.js";

describe("iControllerFactor (P2.27, eq. 4.10)", () => {
  it("matches the hand-computed formula at err=1 (raw factor, no clamp)", () => {
    // raw = 0.9 * 1^(-1/5) = 0.9, inside [0.2, 5] so unclamped.
    expect(iControllerFactor(1, 4, false)).toBeCloseTo(0.9, 15);
  });

  it("matches the hand-computed formula for a small err (growth, unclamped)", () => {
    // raw = 0.9 * 0.001^(-1/5) = 0.9 * 1000^0.2 ~= 3.5829645349814756
    expect(iControllerFactor(0.001, 4, false)).toBeCloseTo(3.5829645349814756, 12);
  });

  it("clamps a large err's shrink to minFactor", () => {
    // raw = 0.9 * (1e6)^(-1/5) ~= 0.0568, below minFactor=0.2.
    expect(iControllerFactor(1e6, 4, false)).toBeCloseTo(0.2, 15);
  });

  it("clamps growth to maxFactor=5 after an acceptance but to maxFactorAfterRejection=1 after a rejection", () => {
    // Same small err (raw ~3.58, which is < 5 but > 1).
    expect(iControllerFactor(0.001, 4, false)).toBeGreaterThan(1);
    expect(iControllerFactor(0.001, 4, true)).toBe(1);
  });

  it("still clamps to minFactor after a rejection when the raw factor is below it", () => {
    expect(iControllerFactor(1e6, 4, true)).toBeCloseTo(0.2, 15);
  });

  it("resolves a perfect step (err=0, raw=Infinity) to the growth cap, not NaN", () => {
    expect(iControllerFactor(0, 4, false)).toBe(DEFAULT_I_CONTROLLER.maxFactor);
    expect(iControllerFactor(0, 4, true)).toBe(DEFAULT_I_CONTROLLER.maxFactorAfterRejection);
  });
});

function makeDragModel() {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  return { model, ctx };
}

describe("attemptAdaptiveStep (P2.27)", () => {
  it("accepts a loose-tolerance step in a single attempt (rejections=0) and proposes a larger next h", () => {
    const { model, ctx } = makeDragModel();
    const stepper = createBogackiShampine32Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 1, 20, 10]);
    const out = createStepResult(4);
    const outcome = attemptAdaptiveStep(stepper, 2, 0, y, 0.01, 1e-3, 1e-6, out);

    expect(outcome.rejections).toBe(0);
    expect(outcome.h).toBe(0.01);
    expect(outcome.hNext).toBeGreaterThan(0);
    expect(outcome.nRHS).toBeGreaterThan(0);
    expect(out.accepted).toBe(true);
  });

  it("rejects an oversized step, shrinks h, and eventually accepts a smaller one", () => {
    const { model, ctx } = makeDragModel();
    const stepper = createBogackiShampine32Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 1, 20, 10]);
    const out = createStepResult(4);
    // A deliberately huge initial h against a tight tolerance forces at least one rejection.
    const outcome = attemptAdaptiveStep(stepper, 2, 0, y, 5, 1e-8, 1e-10, out);

    expect(outcome.rejections).toBeGreaterThan(0);
    expect(outcome.h).toBeLessThan(5);
    expect(out.accepted).toBe(true);
  });

  it("never advances y on a rejected attempt -- each retry starts from the same (t, y)", () => {
    const { model, ctx } = makeDragModel();
    const stepper = createBogackiShampine32Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 1, 20, 10]);
    const yBefore = Float64Array.from(y);
    const out = createStepResult(4);
    attemptAdaptiveStep(stepper, 2, 0, y, 5, 1e-8, 1e-10, out);

    // The caller's y buffer itself is never mutated by attemptAdaptiveStep;
    // only out.yNext (the accepted result) is written.
    expect(y).toEqual(yBefore);
  });
});

describe("integrate() adaptive path (P2.27)", () => {
  it("tolerance sweep: achieved global error tracks rtol over 4 decades on the linear-drag benchmark", () => {
    // Same tiny-mass/expm1 linear-drag setup as the DOPRI5 (P2.24) and BS32
    // (P2.25) fixed-h convergence tests, avoiding the 1-e^-x cancellation
    // that would otherwise floor the measured error regardless of tolerance.
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

    // Four decades of requested tolerance.
    const rtols = [1e-3, 1e-4, 1e-5, 1e-6, 1e-7];
    const exact = yExact(tspan[1]);

    const errors = rtols.map((rtol) => {
      const stepper = createDormandPrince54Stepper();
      const cfg: SolverConfig = {
        stepper: stepper.info.id,
        rtol,
        atol: 1e-12,
        maxSteps: Number.MAX_SAFE_INTEGER,
      };
      const report = integrate(model, ctx, y0, tspan, cfg, stepper);
      expect(report.status).toBe("ok");
      return l2Error(report.yFinal, exact);
    });

    // Achieved error shrinks monotonically as the requested tolerance tightens.
    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]!).toBeLessThan(errors[i - 1]!);
    }

    // "Tracks rtol" -- global error isn't bounded by rtol (§4.5: "rtol/atol
    // control local error per step; global error is related but not
    // bounded by tolerance"), but four decades of tighter tolerance must
    // buy a substantial (not negligible) accuracy improvement.
    expect(errors[0]! / errors[errors.length - 1]!).toBeGreaterThan(100);
  });
});
