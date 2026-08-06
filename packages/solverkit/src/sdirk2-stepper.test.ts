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
import { BackwardEulerStepper } from "./backward-euler-stepper.js";
import { measureConvergence } from "./convergence-harness.js";
import { integrate } from "./integrate.js";
import { SDIRK2_GAMMA, Sdirk2Stepper, sdirk2StabilityFunction } from "./sdirk2-stepper.js";
import { createStepResult, type SolverConfig } from "./types.js";

const DECAY_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];

/** ydot = lambda*y, dim 1 -- the Dahlquist test equation, the only problem R(z) is defined by. */
function createDahlquistModel(lambda: number): Model {
  return {
    dim: 1,
    channels: DECAY_CHANNELS,
    rhs(_t: number, y: Float64Array, out: Float64Array): void {
      out[0] = lambda * y[0]!;
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

/** The trapezoidal rule's R(z) -- A-stable, NOT L-stable. The contrast case, not a stepper. */
function trapezoidalStabilityFunction(z: number): number {
  return (1 + z / 2) / (1 - z / 2);
}

/** One step of the Dahlquist equation from y0 = 1, i.e. the stepper's own measured R(z). */
function measuredAmplification(z: number, h: number): number {
  const lambda = z / h;
  const model = createDahlquistModel(lambda);
  const stepper = new Sdirk2Stepper();
  stepper.init(model, createEvalContextFixture());
  const out = createStepResult(1);
  stepper.step(0, new Float64Array([1]), h, out);
  expect(out.accepted).toBe(true);
  return out.yNext[0]!;
}

describe("Sdirk2Stepper (P4.38)", () => {
  it("declares order 2, non-FSAL, non-symplectic", () => {
    expect(new Sdirk2Stepper().info).toEqual({
      id: "sdirk2",
      order: 2,
      fsal: false,
      symplectic: false,
    });
  });

  it("throws if step() is called before init()", () => {
    const stepper = new Sdirk2Stepper();
    expect(() => stepper.step(0, new Float64Array([1]), 0.1, createStepResult(1))).toThrow();
  });

  describe("the tableau is the one the derivation claims", () => {
    it("gamma is the root of gamma^2 - 2*gamma + 1/2 in (0,1)", () => {
      expect(SDIRK2_GAMMA ** 2 - 2 * SDIRK2_GAMMA + 0.5).toBeCloseTo(0, 15);
      expect(SDIRK2_GAMMA).toBeGreaterThan(0);
      expect(SDIRK2_GAMMA).toBeLessThan(1);
    });

    it("satisfies both order-2 conditions but not the order-3 one", () => {
      const g = SDIRK2_GAMMA;
      const b = [1 - g, g];
      const c = [g, 1];
      expect(b[0]! + b[1]!).toBeCloseTo(1, 15); // sum b_i = 1
      expect(b[0]! * c[0]! + b[1]! * c[1]!).toBeCloseTo(0.5, 15); // sum b_i c_i = 1/2
      // Order 3 would need 1/3; it is not met, which is why `info.order` is 2.
      expect(b[0]! * c[0]! ** 2 + b[1]! * c[1]! ** 2).not.toBeCloseTo(1 / 3, 6);
    });

    it("is stiffly accurate: the step output equals stage 2, which equals the b-weighted sum", () => {
      // b = last row of A means y_{k+1} = Y_2 *and* y_{k+1} = y_k +
      // h*(b1*f1 + b2*f2) are the same number. Both are computed here from
      // an independent closed-form solve of the two stage equations on
      // ydot = lambda*y (linear, so each stage is one division) and compared
      // against what the stepper actually produced.
      const g = SDIRK2_GAMMA;
      const lambda = -3;
      const h = 0.25;
      const z = h * lambda;
      const y0 = 1;

      const stageY1 = y0 / (1 - g * z); // Y1 = y0 + h*g*lambda*Y1
      const f1 = lambda * stageY1;
      const stageY2 = (y0 + h * (1 - g) * f1) / (1 - g * z);
      const f2 = lambda * stageY2;
      const weightedSum = y0 + h * ((1 - g) * f1 + g * f2);

      expect(stageY2).toBeCloseTo(weightedSum, 15); // the stiff-accuracy identity

      const model = createDahlquistModel(lambda);
      const stepper = new Sdirk2Stepper();
      stepper.init(model, createEvalContextFixture());
      const out = createStepResult(1);
      stepper.step(0, new Float64Array([y0]), h, out);

      expect(out.accepted).toBe(true);
      expect(out.yNext[0]!).toBeCloseTo(stageY2, 12);
    });
  });

  describe("stability function", () => {
    it("the stepper's own one-step amplification matches R(z) = (1+(1-2g)z)/(1-gz)^2", () => {
      // Measured from the stepper, not asserted about the formula alone: if
      // the implemented tableau ever drifts from the derived one, this fails.
      for (const z of [-0.5, -1, -5, -50, -1e3, -1e6, 0.5, 1]) {
        const h = 0.01;
        expect(measuredAmplification(z, h)).toBeCloseTo(sdirk2StabilityFunction(z), 10);
      }
    });

    it("is A-stable: |R(z)| <= 1 across a grid of the closed left half-plane", () => {
      const gamma = SDIRK2_GAMMA;
      for (let re = 0; re >= -60; re -= 0.25) {
        for (let im = 0; im <= 60; im += 0.25) {
          // Complex R(z) evaluated directly; sdirk2StabilityFunction is the
          // real-axis restriction, so the complex arithmetic is done here.
          const numRe = 1 + (1 - 2 * gamma) * re;
          const numIm = (1 - 2 * gamma) * im;
          const dRe = 1 - gamma * re;
          const dIm = -gamma * im;
          const denRe = dRe * dRe - dIm * dIm;
          const denIm = 2 * dRe * dIm;
          const magnitude = Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
          expect(magnitude).toBeLessThanOrEqual(1 + 1e-12);
        }
      }
    });

    it("is L-stable: R(z) -> 0 as z -> -infinity, where the trapezoidal rule -> -1", () => {
      const zs = [-1e2, -1e4, -1e6, -1e8, -1e10];
      const sdirk = zs.map((z) => Math.abs(sdirk2StabilityFunction(z)));
      const trapezoid = zs.map((z) => Math.abs(trapezoidalStabilityFunction(z)));

      // Monotone decay to zero, at the predicted 1/|z| rate...
      for (let i = 1; i < sdirk.length; i++) {
        expect(sdirk[i]!).toBeLessThan(sdirk[i - 1]!);
      }
      expect(sdirk.at(-1)!).toBeLessThan(1e-9);
      // |R(z)| ~ (1-2g)/(g^2 |z|) for large |z| -- the decay follows the
      // predicted asymptote, not merely "gets small". The ratio to that
      // asymptote climbs monotonically to 1 (0.9125 at z=-1e2, 1 to within
      // 1e-7 at z=-1e10), the residual being the O(1/|z|) correction.
      const asymptoteRatios = zs.map(
        (z) =>
          Math.abs(sdirk2StabilityFunction(z)) /
          ((1 - 2 * SDIRK2_GAMMA) / (SDIRK2_GAMMA ** 2 * Math.abs(z))),
      );
      for (let i = 1; i < asymptoteRatios.length; i++) {
        expect(asymptoteRatios[i]!).toBeGreaterThan(asymptoteRatios[i - 1]!);
        expect(asymptoteRatios[i]!).toBeLessThanOrEqual(1);
      }
      expect(asymptoteRatios.at(-1)!).toBeCloseTo(1, 7);

      // ...while the A-stable-but-not-L-stable trapezoidal rule climbs TOWARD
      // magnitude 1 instead of away from it: 0.9608 at z=-1e2, 0.9999999996
      // at z=-1e10. This contrast is the whole reason SDIRK2 is preferred
      // over the other obvious second-order A-stable method, so it is
      // asserted rather than described.
      for (let i = 1; i < trapezoid.length; i++) {
        expect(trapezoid[i]!).toBeGreaterThan(trapezoid[i - 1]!);
      }
      expect(trapezoid[0]!).toBeGreaterThan(0.96);
      expect(trapezoid.at(-1)!).toBeGreaterThan(1 - 1e-9);

      // Both are negative in the stiff limit -- SDIRK2 does NOT avoid the
      // sign flip, and a test claiming it did would be wrong. What it avoids
      // is the flipped component keeping its magnitude.
      expect(sdirk2StabilityFunction(-1e4)).toBeLessThan(0);
      expect(trapezoidalStabilityFunction(-1e4)).toBeLessThan(0);
    });
  });

  describe("L-stability demo: a stiff transient is annihilated, not rung", () => {
    it("damps a stiff mode by 4000x in ONE step at h = 1e4 * h_crit(explicit Euler)", () => {
      // lambda = -1e4 => explicit Euler needs h < 2/1e4 = 2e-4 to be stable.
      // Take h four decades larger: h = 2, z = h*lambda = -2e4. Explicit
      // Euler's amplification there would be |1 + z| = 2e4 -- growth by four
      // decades per step.
      const lambda = -1e4;
      const hCritExplicit = 2 / Math.abs(lambda);
      const h = 1e4 * hCritExplicit;
      const z = h * lambda;

      const yAfterOneStep = measuredAmplification(z, h);

      // Measured 2.4131e-4: damping by a factor of ~4100 in a single step at
      // a step size that makes every explicit method diverge. The bound is
      // stated against the analytic R(z) rather than a hand-picked constant.
      expect(Math.abs(yAfterOneStep)).toBeCloseTo(Math.abs(sdirk2StabilityFunction(z)), 12);
      expect(Math.abs(yAfterOneStep)).toBeLessThan(2.5e-4);
      expect(Math.abs(1 + z)).toBeGreaterThan(1e4); // explicit Euler would diverge here

      // Backward Euler is L-stable too, so it also damps -- the point of the
      // comparison is that SDIRK2 buys the same damping at second order, not
      // that backward Euler fails here.
      const beStepper = new BackwardEulerStepper();
      beStepper.init(createDahlquistModel(lambda), createEvalContextFixture());
      const beOut = createStepResult(1);
      beStepper.step(0, new Float64Array([1]), h, beOut);
      expect(Math.abs(beOut.yNext[0]!)).toBeLessThan(1e-3);
    });

    it("decays as R(z)^n over 5 stiff steps, where the trapezoidal rule would not decay at all", () => {
      const lambda = -1e4;
      const h = 0.01; // z = -100, well inside the stiff regime
      const nSteps = 5;
      const model = createDahlquistModel(lambda);
      const stepper = new Sdirk2Stepper();
      const cfg: SolverConfig = { stepper: "sdirk2", h, maxSteps: 100 };

      const report = integrate(
        model,
        createEvalContextFixture(),
        new Float64Array([1]),
        [0, nSteps * h],
        cfg,
        stepper,
        [],
      );

      expect(report.status).toBe("ok");
      expect(report.nSteps).toBe(nSteps);

      // R(-100) = -0.0440587..., so after 5 steps y = R^5 = -1.66019e-7.
      // Asserted against the analytic power, not a magic literal.
      const expected = sdirk2StabilityFunction(-100) ** nSteps;
      expect(report.yFinal[0]!).toBeCloseTo(expected, 15);
      expect(Math.abs(report.yFinal[0]!)).toBeLessThan(1e-6);

      // Same h, trapezoidal rule: |R^5| = 0.8187, i.e. an 18% reduction
      // rather than seven decades. Asserted on its R(z) because SolverKit has
      // no trapezoidal stepper -- the claim being pinned is about the choice
      // of method, not about untested code.
      const trapezoidAfterN = Math.abs(trapezoidalStabilityFunction(-100) ** nSteps);
      expect(trapezoidAfterN).toBeGreaterThan(0.8);
    });

    it("the Newton convergence criterion floors the decay at ~newtonAtol (pre-existing, shared with backward Euler)", () => {
      // Discovered while writing the test above, and pinned here so it is not
      // later mistaken for an SDIRK2 bug. `scaledErrorNorm`'s absolute term
      // means a stage's INITIAL residual already scores <= 1 once |y| falls
      // to roughly `newtonAtol`: Newton then exits at iteration 0 and returns
      // its initial guess, so the step becomes a no-op and the solution stops
      // decaying. The criterion is shared with BackwardEulerStepper, so this
      // is a property of the platform's Newton stopping rule, not of this
      // tableau -- and it only bites on a solution decaying toward zero in
      // absolute terms, which is exactly the Dahlquist test problem and not a
      // trajectory.
      const lambda = -1e4;
      const h = 0.5; // z = -5000
      const run = (newtonAtol: number): number => {
        const stepper = new Sdirk2Stepper({ newtonAtol });
        stepper.init(createDahlquistModel(lambda), createEvalContextFixture());
        const out = createStepResult(1);
        const y = new Float64Array([1]);
        for (let k = 0; k < 20; k++) {
          stepper.step(k * h, y, h, out);
          y.set(out.yNext);
        }
        return y[0]!;
      };

      const floored = run(1e-10); // the default
      const unfloored = run(1e-300);

      // With the default atol the decay stalls around 1e-16; with the floor
      // removed it continues to R^20 ~ 4.8e-61.
      expect(Math.abs(floored)).toBeGreaterThan(1e-20);
      expect(Math.abs(unfloored)).toBeCloseTo(sdirk2StabilityFunction(-5000) ** 20, 70);
      expect(Math.abs(unfloored)).toBeLessThan(Math.abs(floored) / 1e40);
    });
  });

  describe("accuracy", () => {
    it("matches the exact solution of ydot=-y far better than backward Euler at the same h", () => {
      const model = createDahlquistModel(-1);
      const ctx = createEvalContextFixture();
      const h = 0.1;
      const exact = Math.exp(-1);

      const sdirk = new Sdirk2Stepper();
      const sdirkReport = integrate(
        model,
        ctx,
        new Float64Array([1]),
        [0, 1],
        { stepper: "sdirk2", h, maxSteps: 1000 },
        sdirk,
        [],
      );

      const be = new BackwardEulerStepper();
      const beReport = integrate(
        model,
        ctx,
        new Float64Array([1]),
        [0, 1],
        { stepper: "backward-euler", h, maxSteps: 1000 },
        be,
        [],
      );

      const sdirkError = Math.abs(sdirkReport.yFinal[0]! - exact);
      const beError = Math.abs(beReport.yFinal[0]! - exact);
      expect(sdirkError).toBeLessThan(beError / 10);
    });

    it("slope 2.00 +/- 0.1 on the linear-drag benchmark (3.6-3.7)", () => {
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

      const hs = [0.02, 0.01, 0.005, 0.0025, 0.00125];
      const result = measureConvergence(
        () => new Sdirk2Stepper(),
        model,
        ctx,
        y0,
        tspan,
        yExact,
        hs,
      );

      expect(result.slope).toBeGreaterThan(1.9);
      expect(result.slope).toBeLessThan(2.1);
    });
  });

  describe("Newton machinery", () => {
    it("FD-fallback jacobian path matches the analytic-jacobian path on gravity+quadratic-drag", () => {
      const params = createSphericalProjectileParams({
        mass: 0.1,
        radius: 0.05,
        dragCoefficient: new ConstantCd(0.47),
      });
      const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const ctx = createEvalContext(env, params);

      const withAnalyticJacobian = createPlanarProjectileModel([
        new GravityForce(),
        new QuadraticDragForce(),
      ]);
      expect(withAnalyticJacobian.jacobian).toBeDefined();

      const withoutJacobian: Model = {
        dim: withAnalyticJacobian.dim,
        channels: withAnalyticJacobian.channels,
        rhs: withAnalyticJacobian.rhs,
      };

      const y0 = new Float64Array([0, 50, 20, -5]);
      const h = 0.05;

      const analyticStepper = new Sdirk2Stepper();
      analyticStepper.init(withAnalyticJacobian, ctx);
      const outAnalytic = createStepResult(4);
      analyticStepper.step(0, y0, h, outAnalytic);

      const fdStepper = new Sdirk2Stepper();
      fdStepper.init(withoutJacobian, ctx);
      const outFD = createStepResult(4);
      fdStepper.step(0, y0, h, outFD);

      expect(outAnalytic.accepted).toBe(true);
      expect(outFD.accepted).toBe(true);
      for (let i = 0; i < 4; i++) {
        expect(outFD.yNext[i]).toBeCloseTo(outAnalytic.yNext[i]!, 6);
      }
    });

    it("reports a typed failure reason and NaN state when the iteration budget is zero", () => {
      const model = createDahlquistModel(-1);
      const stepper = new Sdirk2Stepper({ maxNewtonIterations: 0 });
      stepper.init(model, createEvalContextFixture());
      const out = createStepResult(1);

      stepper.step(0, new Float64Array([1]), 1, out);

      expect(out.accepted).toBe(false);
      expect(out.newtonFailureReason).toBe("max-iterations");
      expect(Number.isNaN(out.yNext[0]!)).toBe(true);
    });

    it("counts Newton iterations across both stages and reports rhs evaluations", () => {
      const model = createDahlquistModel(-1);
      const stepper = new Sdirk2Stepper();
      stepper.init(model, createEvalContextFixture());
      const out = createStepResult(1);

      stepper.step(0, new Float64Array([1]), 0.5, out);

      expect(out.accepted).toBe(true);
      expect(out.newtonFailureReason).toBeUndefined();
      expect(out.newtonIterations).toBeGreaterThan(0);
      // Two stages, each at least one rhs for its initial residual.
      expect(out.nRHS).toBeGreaterThanOrEqual(2);
      expect(out.errorEstimate).toBe(0); // fixed-step: no embedded pair
      expect(out.h).toBe(0.5);
    });
  });
});
