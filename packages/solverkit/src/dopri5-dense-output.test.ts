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
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { createStepResult } from "./types.js";

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

describe("DOPRI5 dense-output interpolant (P2.30, §4.9)", () => {
  it("info.denseOrder is 4 and a fresh stepper exposes interpolant (feature-detectable)", () => {
    const stepper = createDormandPrince54Stepper();
    expect(stepper.info.denseOrder).toBe(4);
    expect(typeof stepper.interpolant).toBe("function");
  });

  it("interpolant(0, .) reproduces the pre-step state y_k exactly", () => {
    const { model, ctx } = makeDragModel();
    const stepper = createDormandPrince54Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 100, 20, 5]);
    const out = createStepResult(4);
    stepper.step(0, y, 0.1, out);

    const sample = new Float64Array(4);
    stepper.interpolant!(0, sample);

    expect(sample).toEqual(y);
  });

  it("interpolant(1, .) reproduces the accepted state y_{k+1} to floating-point roundoff", () => {
    const { model, ctx } = makeDragModel();
    const stepper = createDormandPrince54Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 100, 20, 5]);
    const out = createStepResult(4);
    stepper.step(0, y, 0.1, out);

    const sample = new Float64Array(4);
    stepper.interpolant!(1, sample);

    // Mathematically each row of DOPRI5_DENSE_OUTPUT_COEFFICIENTS sums to
    // exactly DOPRI5_TABLEAU.b at theta=1 (verified against exact rational
    // arithmetic when the table was built), so the interpolant reduces to
    // the same y_{k+1} formula as the step itself -- but the two evaluate
    // that sum in a different floating-point order, so they agree only to
    // ~1e-13 relative, not bit-for-bit.
    for (let i = 0; i < 4; i++) {
      expect(sample[i]).toBeCloseTo(out.yNext[i]!, 10);
    }
  });

  it("throws a clear error when called before init()/step()", () => {
    const stepper = createDormandPrince54Stepper();
    expect(() => stepper.interpolant!(0.5, new Float64Array(4))).toThrow(/before init/);
  });

  /**
   * Order-of-accuracy measurement (this task's literal validation criterion):
   * take a single DOPRI5 step of size h against a problem with a known
   * closed-form solution, sample the interpolant at 10 interior theta, and
   * compare against the exact state at t0+theta*h. Repeating at h/2 and
   * taking the max-error ratio estimates the interpolant's order via
   * log2(errorH / errorHalfH) -- expected ~4 for a genuine 4th-order
   * interpolant, not just C1-continuous.
   *
   * Uses the same tiny-mass linear-drag benchmark as the stepper's own
   * order-5 fixed-h test (dormand-prince-54.test.ts): a drag-free (or
   * quadratic-drag) trajectory's true solution is itself at most a degree-2
   * polynomial in t, which DOPRI5's stages reproduce exactly regardless of h
   * -- the interpolant would then also come out exact to machine precision
   * at every h, making the order unmeasurable (0/0 noise, not a real O(h^4)
   * signal). The exponential linear-drag solution has no such degeneracy.
   */
  it("interpolant error at 10 interior theta shrinks as O(h^4): measured order >= 3.8", () => {
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

    const thetas = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];

    function maxInterpolantError(h: number): number {
      const stepper = createDormandPrince54Stepper();
      stepper.init(model, ctx);
      const out = createStepResult(4);
      stepper.step(0, y0, h, out);

      let maxErr = 0;
      const sample = new Float64Array(4);
      for (const theta of thetas) {
        stepper.interpolant!(theta, sample);
        const exact = yExact(theta * h);
        for (let i = 0; i < 4; i++) {
          const err = Math.abs(sample[i]! - exact[i]!);
          if (err > maxErr) maxErr = err;
        }
      }
      return maxErr;
    }

    const h = 0.02;
    const errH = maxInterpolantError(h);
    const errHalf = maxInterpolantError(h / 2);

    expect(errH).toBeGreaterThan(0);
    expect(errHalf).toBeGreaterThan(0);
    expect(errHalf).toBeLessThan(errH);

    const order = Math.log2(errH / errHalf);
    expect(order).toBeGreaterThan(3.8);
  });
});
