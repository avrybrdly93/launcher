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
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";
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

describe("ExplicitEulerStepper (P2.06)", () => {
  it("one step of ydot=-y matches 1 + h*(-1) exactly", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = new ExplicitEulerStepper();
    stepper.init(model, ctx);

    const y = new Float64Array([1]);
    const out = createStepResult(1);
    const h = 0.1;

    stepper.step(0, y, h, out);

    expect(out.yNext[0]).toBe(1 + h * -1);
    expect(out.accepted).toBe(true);
    expect(out.h).toBe(h);
    expect(out.nRHS).toBe(1);
  });

  it("declares order 1, non-FSAL, non-symplectic", () => {
    const stepper = new ExplicitEulerStepper();
    expect(stepper.info).toEqual({
      id: "explicit-euler",
      order: 1,
      fsal: false,
      symplectic: false,
    });
  });

  it("throws if step() is called before init()", () => {
    const stepper = new ExplicitEulerStepper();
    expect(() => stepper.step(0, new Float64Array([1]), 0.1, createStepResult(1))).toThrow();
  });

  it("drives integrate() end to end, matching the closed-form Euler product (1-h)^n", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = new ExplicitEulerStepper();
    const cfg: SolverConfig = { stepper: "explicit-euler", h: 0.1, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

    expect(report.status).toBe("ok");
    expect(report.nSteps).toBe(10);
    expect(report.yFinal[0]).toBeCloseTo(0.9 ** 10, 15);
  });
});
