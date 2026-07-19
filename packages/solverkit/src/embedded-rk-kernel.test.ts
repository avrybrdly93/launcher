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
} from "@ballista/engine";
import { HEUN_EULER_TABLEAU, EmbeddedRKStepper } from "./embedded-rk-kernel.js";
import { HEUN_TABLEAU, ExplicitRKStepper } from "./explicit-rk-kernel.js";
import { createStepResult, type StepperInfo } from "./types.js";

/** Least-squares slope of y = slope*x + intercept (mirrors convergence-harness.ts's private helper). */
function fitSlope(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    covariance += dx * (ys[i]! - meanY);
    variance += dx * dx;
  }
  return covariance / variance;
}

const HEUN_EULER_INFO: StepperInfo = {
  id: "heun-euler",
  order: 2,
  embeddedOrder: 1,
  fsal: false,
  symplectic: false,
};

describe("stepEmbeddedRK / EmbeddedRKStepper (P2.23)", () => {
  it("matches ExplicitRKStepper's yNext (shared stages, same higher-order weights)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);

    const y0 = new Float64Array([0, 1, 20, 10]);
    const h = 0.05;

    const embedded = new EmbeddedRKStepper(HEUN_EULER_INFO, HEUN_EULER_TABLEAU);
    embedded.init(model, ctx);
    const outEmbedded = createStepResult(4);
    embedded.step(0, y0, h, outEmbedded);

    const plain = new ExplicitRKStepper(
      { id: "heun", order: 2, fsal: false, symplectic: false },
      HEUN_TABLEAU,
    );
    plain.init(model, ctx);
    const outPlain = createStepResult(4);
    plain.step(0, y0, h, outPlain);

    for (let i = 0; i < 4; i++) {
      expect(outEmbedded.yNext[i]).toBe(outPlain.yNext[i]);
    }
  });

  it("δ (out.errorEstimate) scales like O(h^(p̂+1)) = O(h^2) on a smooth nonlinear problem", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);

    const y0 = new Float64Array([0, 1, 20, 10]);
    const hs = [0.05, 0.025, 0.0125, 0.00625, 0.003125];

    const stepper = new EmbeddedRKStepper(HEUN_EULER_INFO, HEUN_EULER_TABLEAU);
    stepper.init(model, ctx);

    const deltas = hs.map((h) => {
      const out = createStepResult(4);
      stepper.step(0, y0, h, out);
      return out.errorEstimate;
    });

    // Local error must shrink monotonically as h shrinks.
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]!).toBeLessThan(deltas[i - 1]!);
    }

    const slope = fitSlope(
      hs.map((h) => Math.log(h)),
      deltas.map((d) => Math.log(d)),
    );
    expect(slope).toBeGreaterThan(1.9);
    expect(slope).toBeLessThan(2.1);
  });

  it("throws if step() is called before init()", () => {
    const stepper = new EmbeddedRKStepper(HEUN_EULER_INFO, HEUN_EULER_TABLEAU);
    expect(() => stepper.step(0, new Float64Array([1]), 0.1, createStepResult(1))).toThrow();
  });
});
