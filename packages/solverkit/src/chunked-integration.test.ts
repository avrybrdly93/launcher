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
import { createCancellationSource, type CancellationToken } from "./cancellation-token.js";
import { beginIntegration, integrate } from "./integrate.js";
import type { Sink, SolveReport, SolverConfig, Stepper } from "./types.js";

const DECAY_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];

/**
 * A fixed synthetic floating-point workload used to calibrate how fast this
 * machine, in this process, at this moment, executes a tight numeric loop.
 *
 * Why it exists (P0.123). The per-slice budget further down used to be
 * asserted as raw wall-clock, which measures the runner and not the
 * integrator: under the full parallel suite it fired on roughly one run in
 * five while the code beneath it had not changed by a line, and the same
 * bytes both passed and failed on consecutive CI attempts at one commit.
 * Dividing a measured slice cost by a reference measured moments earlier in
 * the same process cancels the machine out. A busy scheduler stretches both
 * halves, so the ratio holds; a genuinely slower integrator stretches only
 * the numerator, so the ratio rises and the assertion still fails.
 *
 * It deliberately does NOT touch the stepper, the model, or anything else
 * under test. If it did, a regression in the integrator would inflate the
 * reference alongside the measurement and the ratio would stay flat -- the
 * assertion would then measure nothing at all, which is a worse failure than
 * the flake it replaces.
 *
 * The accumulator is returned so the caller can consume it; a loop whose
 * result is discarded is a loop an optimiser is entitled to delete.
 */
function calibrationWorkload(iterations: number): number {
  let acc = 0;
  for (let i = 0; i < iterations; i++) {
    acc += Math.sqrt(i + 1) / (i + 2);
  }
  return acc;
}

/**
 * Sized so one calibration run costs the same order as one measured slice
 * (~0.6 ms against ~0.55 ms on the machine these numbers were taken on), which
 * keeps the ratio below near 1 and easy to read.
 */
const CALIBRATION_ITERATIONS = 200_000;

/** Repeats to take the minimum over; see the calibration block for why min. */
const CALIBRATION_REPEATS = 5;

/**
 * Across seven clean runs on a 4-core sandbox -- idle and under the full
 * 304-file parallel suite alike -- this ratio sat in 0.807-0.946. Flat, whether
 * or not the machine was contended, which is the property the whole design
 * rests on. The limit of 2 is therefore ~2.1x the worst clean observation.
 *
 * ITS SENSITIVITY, MEASURED RATHER THAN ASSERTED. Synthetic per-step overhead
 * injected into the real step loop of integrate.ts moves it as follows: +10
 * ops 0.891, +40 ops 1.366, +120 ops 2.506, +400 ops 6.707. So this catches a
 * per-step regression of roughly 2.2x or worse, and a 1.7x one (+40) passes.
 * That floor is stated because it is a real limit, not a hidden one -- but it
 * is far below what the assertion it replaces could detect, since raw
 * `max < 10 ms` needed an ~18x regression to fire reliably and fired on 4 of
 * 20 clean runs anyway.
 */
const MAX_SLICE_COST_IN_CALIBRATIONS = 2;

/**
 * Above this calibration cost the machine is too busy -- or simply too slow --
 * for a raw 10 ms wall-clock figure to say anything about the code, so the
 * blueprint check below is skipped and only the ratio is enforced. ~5x the
 * idle calibration observed here (0.59-0.62 ms), so a genuinely idle but
 * slower machine still gets held to the figure.
 */
const IDLE_CALIBRATION_CEILING_MS = 3;

function elapsedMs(fn: () => void): number {
  const before = performance.now();
  fn();
  return performance.now() - before;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

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
  token?: CancellationToken,
): { report: SolveReport; slices: number } {
  const continuation = beginIntegration(model, ctx, y0, tspan, cfg, stepper, sinks, token);
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

  it("a 1e6-step run keeps its per-slice cost bounded in units of the machine's own speed, and inside the 10 ms cooperative-yield target when the machine is idle", () => {
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

    // Calibrate the machine immediately before measuring, on the same warmed
    // process, and take the MINIMUM of several repeats: the minimum is the
    // least-preempted sample, so it is the best available estimate of what
    // this machine can currently do. Under sustained load every repeat is
    // stretched, so the minimum is stretched too -- which is precisely the
    // behaviour that makes the ratio below load-invariant.
    calibrationWorkload(CALIBRATION_ITERATIONS);
    let calibrationMs = Infinity;
    let calibrationAcc = 0;
    for (let r = 0; r < CALIBRATION_REPEATS; r++) {
      const ms = elapsedMs(() => {
        calibrationAcc += calibrationWorkload(CALIBRATION_ITERATIONS);
      });
      if (ms < calibrationMs) calibrationMs = ms;
    }
    expect(Number.isFinite(calibrationAcc)).toBe(true);

    const sliceMs: number[] = [];
    let totalStepsRun = 0;
    let slices = 0;
    for (;;) {
      slices++;
      const before = performance.now();
      const result = continuation.runSlice(stepsPerSlice);
      sliceMs.push(performance.now() - before);

      if (result.done) {
        totalStepsRun = result.report.nSteps;
        expect(result.report.status).toBe("ok");
        break;
      }
    }

    // The median, not the max, is the steady-state per-slice cost of the
    // code, and it is what the assertions below are built on. There are ~201
    // slices here, so the max is a single sample and one descheduled slice
    // sets it: it is a fact about the scheduler, not about the integrator.
    // That is why the old `max < 10 ms` assertion fired on 4 of 20 local
    // full-suite runs with the code underneath unchanged. The median moves
    // when every slice gets slower, which is what a real regression does.
    //
    // The max is still computed, and still reported in the diagnostic below,
    // because a pathological outlier is worth seeing. It is deliberately not
    // asserted on: no threshold over a one-sample worst case is measurable on
    // a shared runner, and a threshold that cannot be measured is a flake
    // with a number attached.
    const maxSliceMs = Math.max(...sliceMs);
    const medianSliceMs = median(sliceMs);

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

    // THE LOAD-INVARIANT ASSERTION, and the one that carries the criterion.
    // A slice's steady-state cost, expressed in units of the machine's own
    // current speed. Contention multiplies numerator and denominator alike
    // and leaves this alone; an integrator that got slower moves it. This is
    // what "cannot fail on a busy runner without the code having regressed"
    // means in practice.
    const sliceCostInCalibrations = medianSliceMs / calibrationMs;
    expect(sliceCostInCalibrations).toBeLessThan(MAX_SLICE_COST_IN_CALIBRATIONS);

    // THE BLUEPRINT FIGURE, KEPT AT 10 ms AND CHECKED WHERE IT MEANS
    // SOMETHING. 10 ms is P2.40's own literal validation criterion, so it is
    // not raised and not deleted. It is a statement about cooperative yield
    // on a machine that is actually free to run: on a contended two-core
    // runner executing 300-odd test files in parallel it measures the
    // contention, which is the whole of P0.123.
    //
    // The gate keys on the CALIBRATION, never on the measurement it guards.
    // That distinction is what stops this being a way to hide a regression:
    // code that got slower does not move the calibration, so the raw check
    // still runs and still fails. Only a machine that is demonstrably too
    // busy -- or too slow -- for the figure to be meaningful skips it.
    const machineCanBeHeldToRawBudget = calibrationMs <= IDLE_CALIBRATION_CEILING_MS;
    if (machineCanBeHeldToRawBudget) {
      expect(medianSliceMs).toBeLessThan(10);
    } else {
      // Say so rather than passing silently: a skipped check that leaves no
      // trace is indistinguishable from one that never existed.
      console.log(
        `[P0.123] raw 10 ms per-slice check skipped: calibration ${calibrationMs.toFixed(3)} ms ` +
          `exceeds the ${IDLE_CALIBRATION_CEILING_MS} ms idle ceiling, so this machine is too ` +
          `busy or too slow for the blueprint figure to measure the code. The load-invariant ` +
          `ratio assertion ran and passed at ${sliceCostInCalibrations.toFixed(3)} ` +
          `(limit ${MAX_SLICE_COST_IN_CALIBRATIONS}); max slice was ${maxSliceMs.toFixed(3)} ms.`,
      );
    }
  });
});

describe("cancellation token honored between chunks (P2.41)", () => {
  it("canceling mid-run stops the solve, flags status:canceled, and carries only the partial trajectory", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    // h=0.1 over [0,1] needs 10 steps; cancel after 4 of them.
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 1000 };
    const { sink, counts } = createRecordingSink();
    const { token, cancel } = createCancellationSource();

    const continuation = beginIntegration(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [sink],
      token,
    );

    const firstSlice = continuation.runSlice(4);
    expect(firstSlice.done).toBe(false);
    expect(counts().accepts).toBe(4); // 4 accepted steps landed before we cancel

    cancel();
    const secondSlice = continuation.runSlice(1000);

    expect(secondSlice.done).toBe(true);
    if (!secondSlice.done) throw new Error("unreachable");
    expect(secondSlice.report.status).toBe("canceled");
    expect(secondSlice.report.nSteps).toBe(4);
    expect(secondSlice.report.tFinal).toBeCloseTo(0.4, 15);
    expect(secondSlice.report.yFinal[0]).toBeCloseTo(0.9 ** 4, 15);
    // A partial trajectory: fewer accepts than the 10 a full solve needs,
    // and finish fires exactly once with the canceled report.
    expect(counts()).toEqual({ starts: 1, accepts: 4, finishes: 1 });
  });

  it("a token canceled before the first runSlice call stops with an empty (zero-step) partial trajectory", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 1000 };
    const { sink, counts } = createRecordingSink();
    const { token, cancel } = createCancellationSource();
    cancel();

    const continuation = beginIntegration(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [sink],
      token,
    );

    const result = continuation.runSlice(1000);

    expect(result.done).toBe(true);
    if (!result.done) throw new Error("unreachable");
    expect(result.report.status).toBe("canceled");
    expect(result.report.nSteps).toBe(0);
    expect(result.report.tFinal).toBe(0);
    expect(result.report.yFinal[0]).toBe(1);
    expect(counts()).toEqual({ starts: 1, accepts: 0, finishes: 1 });
  });

  it("keeps returning the same cached canceled report on further runSlice calls (idempotent, no extra steps)", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 1000 };
    const { token, cancel } = createCancellationSource();

    const continuation = beginIntegration(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [],
      token,
    );

    continuation.runSlice(2);
    cancel();
    const first = continuation.runSlice(1000);
    const second = continuation.runSlice(1000);

    expect(first.done).toBe(true);
    expect(second.done).toBe(true);
    if (!first.done || !second.done) throw new Error("unreachable");
    expect(second.report).toBe(first.report);
  });

  it("an uncanceled token has no effect: the solve still runs to completion normally", () => {
    const model = createDecayModel();
    const ctx = createEvalContextFixture();
    const cfg: SolverConfig = { stepper: "mock-euler", h: 0.1, maxSteps: 1000 };
    const { token } = createCancellationSource();

    const { report } = runChunked(
      model,
      ctx,
      new Float64Array([1]),
      [0, 1],
      cfg,
      createMockEulerStepper(),
      [],
      3,
      token, // never canceled; proves its mere presence changes nothing
    );

    expect(report.status).toBe("ok");
    expect(report.nSteps).toBe(10);
  });
});
