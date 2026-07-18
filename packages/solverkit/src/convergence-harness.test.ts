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
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";

describe("measureConvergence (P2.07)", () => {
  it("harness on Euler + linear-drag analytic (3.6-3.7) reports slope 1.00 +/- 0.05", () => {
    const mass = 1;
    const radius = 0.01;
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    env.sample(0, 0, 0, ctx.env); // populate ctx.env.eta/g used below, matching what rhs() samples internally

    // Linear (Stokes) drag decouples analytically (eq. 3.5-3.7): b = 6*pi*eta*R,
    // tau = m/b, terminal velocity v_T = m*g/b.
    const b = 6 * Math.PI * ctx.env.eta * radius;
    const tau = mass / b;
    const vT = (mass * ctx.env.g) / b;

    const model = createPlanarProjectileModel([new GravityForce(), new LinearDragForce()]);
    const y0 = new Float64Array([0, 100, 20, 5]);
    const tspan: readonly [number, number] = [0, 0.2];

    function yExact(t: number): Float64Array {
      const [x0, yy0, vx0, vy0] = y0 as unknown as [number, number, number, number];
      const decay = Math.exp(-t / tau);
      const vx = vx0 * decay;
      const vy = -vT + (vy0 + vT) * decay;
      const x = x0 + vx0 * tau * (1 - decay);
      const y = yy0 - vT * t + (vy0 + vT) * tau * (1 - decay);
      return new Float64Array([x, y, vx, vy]);
    }

    const hs = [0.02, 0.01, 0.005, 0.0025, 0.00125];
    const result = measureConvergence(
      () => new ExplicitEulerStepper(),
      model,
      ctx,
      y0,
      tspan,
      yExact,
      hs,
    );

    expect(result.errors.length).toBe(hs.length);
    // Errors must shrink monotonically as h shrinks for a well-posed first-order check.
    for (let i = 1; i < result.errors.length; i++) {
      expect(result.errors[i]!).toBeLessThan(result.errors[i - 1]!);
    }
    expect(result.slope).toBeGreaterThan(0.95);
    expect(result.slope).toBeLessThan(1.05);
  });
});
