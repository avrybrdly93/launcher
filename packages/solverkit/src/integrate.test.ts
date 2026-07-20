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
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
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

/** Wraps a Stepper, overwriting yNext[0] with `value` on the call'th invocation of step (1-indexed). */
function createNonFiniteInjectingStepper(
  base: Stepper,
  failOnCall: number,
  value: number,
): Stepper {
  let calls = 0;
  return {
    info: base.info,
    init: (model, ctx) => base.init(model, ctx),
    step: (t, y, h, out) => {
      base.step(t, y, h, out);
      calls++;
      if (calls === failOnCall) out.yNext[0] = value;
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

  it("P2.02: integrates ydot=-y with a mock Euler stepper; final t is exactly t_f", () => {
    // Traceability test for P2.02's literal validation criterion -- the
    // driver itself (loop, t_f clamp, sink dispatch) was built as part of
    // P2.01's skeleton and is already exercised above; this test just names
    // the exact scenario the roadmap asks for.
    const model = createDecayModel(); // ydot = -y
    const ctx = createEvalContextFixture();
    const stepper = createMockEulerStepper();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.25, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

    expect(report.tFinal).toBe(1);
    expect(report.yFinal[0]).toBeCloseTo(0.75 ** 4, 15);
  });

  it("runs with no sinks attached at all", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createMockEulerStepper();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.5, maxSteps: 1000 };

    expect(() => integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper)).not.toThrow();
  });
});

describe("integrate (P2.03: non-finite-state guard)", () => {
  it("a NaN state on an accepted step produces a typed non-finite-state failure carrying the last-good (t, y)", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    // Fails on the 3rd step; two good Euler steps of h=0.1 from y0=1 land at t=0.2, y=0.9^2.
    const stepper = createNonFiniteInjectingStepper(createMockEulerStepper(), 3, NaN);
    const { sink, counts } = createRecordingSink();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, [sink]);

    expect(report.status).toBe("failed");
    expect(report.failure).toBeDefined();
    expect(report.failure?.reason).toBe("non-finite-state");
    expect(report.failure?.t).toBeCloseTo(0.2, 15);
    expect(report.failure?.y[0]).toBeCloseTo(0.9 ** 2, 15);
    expect(report.tFinal).toBeCloseTo(0.2, 15);
    expect(report.yFinal[0]).toBeCloseTo(0.9 ** 2, 15);
    // The failing step's own state must never reach a sink as an accepted step.
    expect(counts()).toEqual({ starts: 1, accepts: 2, finishes: 1 });
  });

  it("an Infinity state is caught by the same guard", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createNonFiniteInjectingStepper(createMockEulerStepper(), 1, Infinity);
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

    expect(report.status).toBe("failed");
    expect(report.failure?.reason).toBe("non-finite-state");
    expect(report.failure?.t).toBe(0);
    expect(report.failure?.y[0]).toBe(1);
  });
});

/** An embedded-pair stepper whose scaled error is always astronomically large, so every attempt is rejected. */
function createAlwaysRejectingStepper(): Stepper {
  return {
    info: { id: "always-reject", order: 2, embeddedOrder: 1, fsal: false, symplectic: false },
    init(): void {},
    step(_t, y, h, out): void {
      out.yNext[0] = y[0]! + h;
      out.delta[0] = 1e6;
      out.errorEstimate = 1e6;
      out.accepted = false;
      out.h = h;
      out.nRHS = 1;
    },
  };
}

describe("integrate (P2.29: maxSteps / hMin typed failures, t_f-clamp)", () => {
  it("stops with a typed max-steps-exceeded failure, carrying the last-good (t, y), instead of looping past the budget", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createMockEulerStepper();
    const { sink, counts } = createRecordingSink();
    // h=0.1 over [0,1] needs 10 steps; budget only 3.
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 3 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, [sink]);

    expect(report.status).toBe("failed");
    expect(report.failure?.reason).toBe("max-steps-exceeded");
    expect(report.nSteps).toBe(3);
    expect(report.failure?.t).toBeCloseTo(0.3, 15);
    expect(report.failure?.y[0]).toBeCloseTo(0.9 ** 3, 15);
    expect(report.tFinal).toBeCloseTo(0.3, 15);
    // The 4th (would-be) step never reaches a sink; finish still fires once.
    expect(counts()).toEqual({ starts: 1, accepts: 3, finishes: 1 });
  });

  it("does not fail when exactly maxSteps steps reach t_f", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createMockEulerStepper();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 10 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

    expect(report.status).toBe("ok");
    expect(report.nSteps).toBe(10);
  });

  it("an adaptive step that must shrink below cfg.hMin fails with a typed step-size-underflow, not a thrown exception", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createAlwaysRejectingStepper();
    const { sink, counts } = createRecordingSink();
    // Every attempt is rejected, clamped to the default minFactor=0.2 shrink
    // per retry: h=1 -> 0.2 on the very first rejection, already < hMin=0.5.
    const cfg: SolverConfig = {
      stepper: "always-reject",
      h: 1,
      rtol: 1e-3,
      atol: 1e-6,
      hMin: 0.5,
      maxSteps: 1000,
    };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, [sink]);

    expect(report.status).toBe("failed");
    expect(report.failure?.reason).toBe("step-size-underflow");
    expect(report.failure?.t).toBe(0);
    expect(report.failure?.y[0]).toBe(1);
    // Never accepted -- the underflow is caught before any step reaches a sink.
    expect(counts()).toEqual({ starts: 1, accepts: 0, finishes: 1 });
  });

  it("a persistently tiny proposed h (below hMin) on the fixed-step path also fails as step-size-underflow", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createMockEulerStepper();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.01, hMin: 0.05, maxSteps: 1000 };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

    expect(report.status).toBe("failed");
    expect(report.failure?.reason).toBe("step-size-underflow");
    expect(report.failure?.t).toBe(0);
  });

  it("t_f-clamp: an adaptive solve (real DOPRI5, not a mock) also lands its final t bit-exactly on t_f", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const stepper = createDormandPrince54Stepper();
    const cfg: SolverConfig = {
      stepper: stepper.info.id,
      h: 0.3,
      rtol: 1e-6,
      atol: 1e-9,
      maxSteps: 1000,
    };

    const report = integrate(model, ctx, new Float64Array([1]), [0, 1], cfg, stepper, []);

    expect(report.status).toBe("ok");
    expect(report.tFinal).toBe(1);
  });
});
