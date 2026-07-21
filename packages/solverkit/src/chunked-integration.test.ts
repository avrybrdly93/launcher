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
import { beginIntegration, integrate } from "./integrate.js";
import type { Sink, SolveReport, SolverConfig, Stepper } from "./types.js";

const DECAY_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];

/** ydot = -y, dim 1: cheap enough to run 1e6 fixed steps in a test. */
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

/** Drains a fresh continuation in slices of `maxStepsPerSlice`, returning the final report and slice count. */
function runChunked(
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  tspan: readonly [number, number],
  cfg: SolverConfig,
  stepper: Stepper,
  sinks: readonly Sink[],
  maxStepsPerSlice: number,
): { report: SolveReport; slices: number } {
  const continuation = beginIntegration(model, ctx, y0, tspan, cfg, stepper, sinks);
  let slices = 0;
  for (;;) {
    slices++;
    const result = continuation.runSlice(maxStepsPerSlice);
    if (result.done) return { report: result.report, slices };
  }
}

describe("chunked cooperative integration (P2.40)", () => {
  it("a single big slice finishes a short solve in one runSlice call, matching integrate() bit-exactly", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 1000 };

    const direct = integrate(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [],
    );

    const continuation = beginIntegration(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [],
    );
    const result = continuation.runSlice(1000);

    expect(result.done).toBe(true);
    if (!result.done) throw new Error("unreachable");
    expect(result.report).toEqual(direct);
  });

  it("chunking into many small slices reproduces the exact same SolveReport as one unchunked call", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.001, maxSteps: 10_000 };

    const direct = integrate(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [],
    );

    const { report: chunked, slices } = runChunked(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [],
      7, // deliberately not a divisor of 1000 steps, so the last slice is partial
    );

    expect(slices).toBeGreaterThan(1);
    expect(chunked).toEqual(direct);
    // Bit-exact, not just close: same sequential float ops regardless of
    // where the caller chose to pause, per generator-based resumability.
    expect(chunked.yFinal[0]).toBe(direct.yFinal[0]);
  });

  it("sinks see exactly one start/finish and one accept per step, identically to an unchunked call, regardless of chunk boundaries", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 1000 };
    const { sink, counts } = createRecordingSink();

    const { report, slices } = runChunked(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [sink],
      3,
    );

    expect(report.status).toBe("ok");
    expect(report.nSteps).toBe(10);
    expect(slices).toBeGreaterThan(1);
    expect(counts()).toEqual({ starts: 1, accepts: 10, finishes: 1 });
  });

  it("runSlice keeps returning the same cached report once the solve is done, without re-running the generator", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 1000 };
    const { sink, counts } = createRecordingSink();

    const continuation = beginIntegration(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [sink],
    );

    const first = continuation.runSlice(1000);
    const second = continuation.runSlice(1000);

    expect(first.done).toBe(true);
    expect(second.done).toBe(true);
    if (!first.done || !second.done) throw new Error("unreachable");
    expect(second.report).toBe(first.report); // same object, not just equal
    expect(counts().finishes).toBe(1); // sink.finish never fires twice
  });

  it("a failing solve (max-steps-exceeded) also resolves to done:true with the typed failure, not an infinite slice loop", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    // h=0.1 over [0,1] needs 10 steps; budget only 3.
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 3 };

    const { report, slices } = runChunked(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [],
      2,
    );

    expect(report.status).toBe("failed");
    expect(report.failure?.reason).toBe("max-steps-exceeded");
    expect(report.nSteps).toBe(3);
    expect(slices).toBeGreaterThan(1);
  });

  it("a 1e6-step run stays within a small, bounded wall-clock budget per slice (cooperative-yield target: 10 ms)", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const totalSteps = 1_000_000;
    const cfg: SolverConfig = {
      stepper: "mock-euler",
      h: 1 / totalSteps,
      maxSteps: totalSteps + 1,
    };
    // A modest per-slice budget: even a slow CI machine finishes this many
    // trivial dim-1 Euler steps in microseconds, well inside the 10 ms
    // cooperative-yield target this task exists to satisfy -- the chunking
    // mechanism (not this specific number) is what actually guarantees
    // boundedness; a real host picks its own budget from measured
    // steps/sec (P2.43).
    const stepsPerSlice = 5000;

    // Warm up the JIT on the same code path before measuring (same
    // rationale as P1.21's rhs-allocation harness): an un-warmed first
    // call's compile/deopt cost is real but irrelevant to the steady-state
    // per-slice cost that actually determines whether a long solve keeps
    // yielding often enough.
    const warmup = beginIntegration(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      { stepper: "mock-euler", h: 1 / 50_000, maxSteps: 50_001 },
      createMockEulerStepper(),
      [],
    );
    for (let r = warmup.runSlice(stepsPerSlice); !r.done; r = warmup.runSlice(stepsPerSlice));

    const continuation = beginIntegration(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [],
    );

    let maxSliceMs = 0;
    let totalStepsRun = 0;
    let slices = 0;
    for (;;) {
      slices++;
      const before = performance.now();
      const result = continuation.runSlice(stepsPerSlice);
      const elapsedMs = performance.now() - before;
      if (elapsedMs > maxSliceMs) maxSliceMs = elapsedMs;

      if (result.done) {
        totalStepsRun = result.report.nSteps;
        expect(result.report.status).toBe("ok");
        break;
      }
    }

    expect(totalStepsRun).toBe(totalSteps);
    // Exactly ceil(totalSteps / stepsPerSlice), plus possibly one more: a
    // generator's `done: true` transition is only observable on the
    // `.next()` call *after* its last `yield`, so when totalSteps lands on
    // an exact slice-size multiple (as here), completion is detected by
    // one extra, otherwise-empty slice rather than folded into the last
    // full one -- itself trivially fast, not a correctness or performance
    // concern.
    const expectedFullSlices = Math.ceil(totalSteps / stepsPerSlice);
    expect(slices).toBeGreaterThanOrEqual(expectedFullSlices);
    expect(slices).toBeLessThanOrEqual(expectedFullSlices + 1);
    expect(maxSliceMs).toBeLessThan(10);
  });
});
