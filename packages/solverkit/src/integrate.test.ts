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
import type { Sink, SolverConfig, Stepper } from "./types.js";

const DECAY_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];

/** ydot = -y, dim 1: an rhs simple enough that explicit Euler's closed form is exact arithmetic. */
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

/** A minimal explicit-Euler Stepper, standing in for a real registered method (P2.06). */
function createMockEulerStepper(): Stepper {
  let model: Model | undefined;
  let ctx: EvalContext | undefined;
  let scratch: Float64Array | undefined;

  return {
    info: { id: "mock-euler", order: 1, fsal: false, symplectic: false },
    init(m: Model, c: EvalContext): void {
      model = m;
      ctx = c;
      scratch = new Float64Array(m.dim);
    },
    step(t, y, h, out): void {
      model!.rhs(t, y, scratch!, ctx!);
      for (let i = 0; i < y.length; i++) {
        out.yNext[i] = y[i]! + h * scratch![i]!;
      }
      out.accepted = true;
      out.h = h;
      out.errorEstimate = 0;
      out.nRHS = 1;
    },
  };
}

function createRecordingSink(): {
  sink: Sink;
  counts: () => { starts: number; accepts: number; finishes: number };
} {
  let starts = 0;
  let accepts = 0;
  let finishes = 0;
  const sink: Sink = {
    id: "recorder",
    start: () => {
      starts++;
    },
    accept: () => {
      accepts++;
    },
    finish: () => {
      finishes++;
    },
  };
  return { sink, counts: () => ({ starts, accepts, finishes }) };
}

describe("integrate (P2.01 skeleton)", () => {
  it("drives a mock stepper through a fixed-step loop, dispatching every accepted step to sinks", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createMockEulerStepper();
    const { sink, counts } = createRecordingSink();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, [sink]);

    expect(report.status).toBe("ok");
    expect(report.tFinal).toBe(1);
    expect(report.nSteps).toBe(10);
    expect(report.nRHS).toBe(10);
    expect(report.yFinal[0]).toBeCloseTo(0.9 ** 10, 12);
    expect(counts()).toEqual({ starts: 1, accepts: 10, finishes: 1 });
  });

  it("clamps the final step so t lands exactly on t_f even when h does not evenly divide the span", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createMockEulerStepper();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.3, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

    expect(report.tFinal).toBe(1);
    expect(report.nSteps).toBe(4); // 0.3, 0.3, 0.3, clamped 0.1
  });

  it("runs with no sinks attached at all", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createMockEulerStepper();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.5, maxSteps: 1000 };

    expect(() => integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper)).not.toThrow();
  });
});
