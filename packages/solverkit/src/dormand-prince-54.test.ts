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
} from "@ballista/engine";
import { measureConvergence } from "./convergence-harness.js";
import { DOPRI5_TABLEAU, createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { verifiesOrder } from "./order-condition-checker.js";
import { integrate } from "./integrate.js";

describe("DOPRI5_TABLEAU (P2.24)", () => {
  it("both weight vectors satisfy every order<=4 rooted-tree condition (P2.14)", () => {
    // b is nominally order 5 -- satisfying order<=4 is necessary (not
    // sufficient) for that, and is as far as the P2.14 checker goes (order-5
    // conditions are out of its documented scope). bHat is nominally order 4.
    expect(verifiesOrder(DOPRI5_TABLEAU, 4)).toBe(true);
    expect(verifiesOrder({ ...DOPRI5_TABLEAU, b: DOPRI5_TABLEAU.bHat }, 4)).toBe(true);
  });

  it("b equals a's last row (with a trailing 0) -- the FSAL structural property", () => {
    const lastRow = DOPRI5_TABLEAU.a[DOPRI5_TABLEAU.a.length - 1]!;
    expect(DOPRI5_TABLEAU.c[DOPRI5_TABLEAU.c.length - 1]).toBe(1);
    for (let i = 0; i < lastRow.length; i++) {
      expect(DOPRI5_TABLEAU.b[i]).toBe(lastRow[i]);
    }
    expect(DOPRI5_TABLEAU.b[DOPRI5_TABLEAU.b.length - 1]).toBe(0);
  });
});

describe("DormandPrince54Stepper (P2.24)", () => {
  it("slope 5.00 +/- 0.1 (fixed-h mode) on the linear-drag benchmark (3.6-3.7)", () => {
    // Mirrors classical-rk4-stepper.test.ts's benchmark exactly: a tiny mass
    // (comparable tau to t_f, avoiding 1-e^-x catastrophic cancellation) and
    // expm1 for the (1 - decay) term -- both necessary at DOPRI5's 5th-order
    // precision, where a naive `1 - Math.exp(...)` floors the measured error
    // at ~1e-5 regardless of h (that cancellation, not truncation, would
    // otherwise dominate).
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

    // Narrower window than the other steppers' benchmarks: coarser h hasn't
    // reached the asymptotic h^5 regime yet, and h below ~0.00125 approaches
    // the double-precision floor for this problem's state magnitude (~100),
    // so both ends would bias the fitted slope away from 5.
    const hs = [0.01, 0.005, 0.0025, 0.00125];
    const result = measureConvergence(
      createDormandPrince54Stepper,
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
    expect(result.slope).toBeGreaterThan(4.9);
    expect(result.slope).toBeLessThan(5.1);
  });

  it("FSAL saves 1 rhs eval/step after the first (nRHS accounting)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce(), new LinearDragForce()]);

    const y0 = new Float64Array([0, 1, 20, 10]);
    const h = 0.01;
    const nSteps = 5;
    const stepper = createDormandPrince54Stepper();

    const report = integrate(
      model,
      ctx,
      y0,
      [0, h * nSteps],
      { stepper: stepper.info.id, h, maxSteps: nSteps + 1 },
      stepper,
    );

    expect(report.status).toBe("ok");
    expect(report.nSteps).toBe(nSteps);
    // Full 7 evals on step 1, then 6 (FSAL-reused stage 0) on each subsequent step.
    const stages = DOPRI5_TABLEAU.c.length;
    expect(report.nRHS).toBe(stages + (stages - 1) * (nSteps - 1));
  });

  it("without FSAL reuse (fresh stepper per step) every step costs the full stage count", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce(), new LinearDragForce()]);

    const y0 = new Float64Array([0, 1, 20, 10]);
    const h = 0.01;
    const stages = DOPRI5_TABLEAU.c.length;

    let totalRHS = 0;
    let y: Float64Array = y0;
    for (let i = 0; i < 5; i++) {
      const stepper = createDormandPrince54Stepper();
      const report = integrate(
        model,
        ctx,
        y,
        [0, h],
        { stepper: stepper.info.id, h, maxSteps: 2 },
        stepper,
      );
      totalRHS += report.nRHS;
      y = report.yFinal;
    }

    expect(totalRHS).toBe(stages * 5);
  });
});
