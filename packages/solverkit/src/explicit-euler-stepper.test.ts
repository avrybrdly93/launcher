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

  describe("compensatedSummation (P2.20)", () => {
    it("flattens the Float64 rounding branch of the V-curve, measurably, as h shrinks deep enough to expose it", () => {
      // §4.7's V-shaped total-error curve: truncation error C1*h falls as h
      // shrinks, but rounding error C2*eps/h *rises*, so total error
      // eventually turns around and grows again at small enough h. Reaching
      // that regime in genuine Float64 arithmetic needs step counts in the
      // tens of millions (eps_mach ~ 2e-16 is small); a large y0 and tiny
      // t_f keep the model itself trivial (dim 1, no force/env overhead) so
      // that many steps still runs in a couple of seconds.
      const model = createDecayModel();
      const ctx = createEvalContextFixture();
      const y0 = new Float64Array([1e6]);
      const tspan: readonly [number, number] = [0, 1e-3];
      const exact = y0[0]! * Math.exp(-tspan[1]);

      function errorAt(h: number, compensatedSummation: boolean): number {
        const cfg: SolverConfig = {
          stepper: "explicit-euler",
          h,
          maxSteps: Number.MAX_SAFE_INTEGER,
          compensatedSummation,
        };
        const report = integrate(model, ctx, y0, tspan, cfg, new ExplicitEulerStepper());
        return Math.abs(report.yFinal[0]! - exact);
      }

      const hs = [1e-10, 3e-11];
      for (const h of hs) {
        const uncompensated = errorAt(h, false);
        const compensated = errorAt(h, true);
        // The rounding-dominated regime: compensation measurably shrinks
        // the error at the same h, i.e. flattens the branch that would
        // otherwise rise as h keeps shrinking.
        expect(compensated).toBeLessThan(uncompensated / 2);
      }
    }, 20_000);
  });

  describe("precision: float32 mode (P2.21)", () => {
    it("shifts the §4.7 V-curve minimum to a much larger h under float32 state storage", () => {
      const model = createDecayModel();
      const ctx = createEvalContextFixture();
      const y0 = new Float64Array([1]);
      const tspan: readonly [number, number] = [0, 1e-3];
      const exact = Math.exp(-tspan[1]);

      function errorAt(h: number, precision: "float64" | "float32"): number {
        const cfg: SolverConfig = {
          stepper: "explicit-euler",
          h,
          maxSteps: Number.MAX_SAFE_INTEGER,
          precision,
        };
        const report = integrate(model, ctx, y0, tspan, cfg, new ExplicitEulerStepper());
        return Math.abs(report.yFinal[0]! - exact);
      }

      // Float64: purely truncation-dominated (error falls monotonically as h
      // shrinks) across this whole range -- its own rounding floor sits at a
      // vastly smaller h (eps64 ~ 2.2e-16) than is practical to reach in a
      // fast test.
      const hs64 = [1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3];
      const errors64 = hs64.map((h) => errorAt(h, "float64"));
      for (let i = 1; i < errors64.length; i++) {
        expect(errors64[i]!).toBeGreaterThan(errors64[i - 1]!);
      }

      // Float32: the same span of h exposes a genuine interior V-curve
      // minimum -- error falls approaching h=5e-5, then *rises* again for
      // smaller h as per-step rounding (eps32 ~ 1.19e-7) swamps the
      // shrinking increment, and rises again for larger h as truncation
      // error grows -- the qualitative V shape §4.7 predicts.
      const below = errorAt(2e-5, "float32");
      const atMin = errorAt(5e-5, "float32");
      const above = errorAt(1e-4, "float32");
      expect(atMin).toBeLessThan(below);
      expect(atMin).toBeLessThan(above);

      // The minimum genuinely shifted to a larger h: at h=1e-8, where
      // float64 is still deep in its accurate, rounding-negligible regime,
      // float32 is already deep in its rounding-dominated regime -- many
      // orders of magnitude worse at the same step size.
      expect(errorAt(1e-8, "float32")).toBeGreaterThan(errorAt(1e-8, "float64") * 1e6);
    });
  });
});
