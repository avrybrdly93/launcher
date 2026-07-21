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
import { integrate } from "./integrate.js";
import { StepSizeRecorder } from "./step-size-recorder.js";
import type { SolverConfig, Stepper } from "./types.js";

const DECAY_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];

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

/** Fixed-step mock reporting exactly the h it was asked to take, the same contract every non-adaptive stepper in this repo honors. */
function createFixedStepMock(): Stepper {
  return {
    info: { id: "instrumented-mock", order: 1, fsal: false, symplectic: false },
    init(): void {},
    step(_t, y, h, out): void {
      for (let i = 0; i < y.length; i++) out.yNext[i] = y[i]!;
      out.accepted = true;
      out.h = h;
      out.errorEstimate = 0;
      out.nRHS = 1;
    },
  };
}

describe("StepSizeRecorder (P2.46)", () => {
  it("records one (t, h) row per accepted step, including the driver's clamped final step", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createFixedStepMock();
    const recorder = new StepSizeRecorder(2); // small initial capacity to exercise growth
    const cfg: SolverConfig = { stepper: "instrumented-mock", h: 0.3, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, [recorder]);

    expect(report.nSteps).toBe(4); // 0.3, 0.3, 0.3, clamped 0.1
    expect(recorder.trace.nSteps).toBe(4);
    expect(Array.from(recorder.trace.h)).toEqual([0.3, 0.3, 0.3, expect.closeTo(0.1, 10)]);
    expect(Array.from(recorder.trace.t)).toEqual([
      expect.closeTo(0.3, 10),
      expect.closeTo(0.6, 10),
      expect.closeTo(0.9, 10),
      1,
    ]);
  });

  it("trace access before finish() throws", () => {
    expect(() => new StepSizeRecorder().trace).toThrow();
  });
});
