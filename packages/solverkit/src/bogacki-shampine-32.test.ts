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
import { BS32_TABLEAU, createBogackiShampine32Stepper } from "./bogacki-shampine-32.js";
import { measureConvergence } from "./convergence-harness.js";
import { integrate } from "./integrate.js";
import { verifiesOrder } from "./order-condition-checker.js";

describe("BS32_TABLEAU (P2.25)", () => {
  it("b satisfies every order<=3 condition and bHat every order<=2 condition (P2.14)", () => {
    expect(verifiesOrder(BS32_TABLEAU, 3)).toBe(true);
    expect(verifiesOrder({ ...BS32_TABLEAU, b: BS32_TABLEAU.bHat }, 2)).toBe(true);
  });

  it("b equals a's last row (with a trailing 0) -- the FSAL structural property", () => {
    const lastRow = BS32_TABLEAU.a[BS32_TABLEAU.a.length - 1]!;
    expect(BS32_TABLEAU.c[BS32_TABLEAU.c.length - 1]).toBe(1);
    for (let i = 0; i < lastRow.length; i++) {
      expect(BS32_TABLEAU.b[i]).toBe(lastRow[i]);
    }
    expect(BS32_TABLEAU.b[BS32_TABLEAU.b.length - 1]).toBe(0);
  });
});

describe("BogackiShampine32Stepper (P2.25)", () => {
  it("slope 3.00 +/- 0.1 (fixed-h mode) on the linear-drag benchmark (3.6-3.7)", () => {
    // Same tiny-mass/expm1 formula as P2.24's DOPRI5 benchmark, avoiding the
    // 1-e^-x cancellation that would otherwise floor the measured error
    // regardless of h (see dormand-prince-54.test.ts for the derivation).
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
      createBogackiShampine32Stepper,
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
    expect(result.slope).toBeGreaterThan(2.9);
    expect(result.slope).toBeLessThan(3.1);
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
    const stepper = createBogackiShampine32Stepper();

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
    // Full 4 evals on step 1, then 3 (FSAL-reused stage 0) on each subsequent step.
    const stages = BS32_TABLEAU.c.length;
    expect(report.nRHS).toBe(stages + (stages - 1) * (nSteps - 1));
  });
});
