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
import { median } from "./benchmark-trend.js";
import {
  IDLE_CALIBRATION_CEILING_MS,
  MAX_IDLE_CALIBRATION_DISPERSION,
  measureIdleGateCalibration,
  LOAD_TRACKING_CALIBRATION_ITERATIONS,
  calibrationWorkload,
  elapsedMs,
  isIdleEnoughForWallClock,
  measureCalibrationMs,
  pairedCost,
} from "./load-calibration.js";
import { createCancellationSource, type CancellationToken } from "./cancellation-token.js";
import { beginIntegration, integrate } from "./integrate.js";
import type { Sink, SolveReport, SolverConfig, Stepper } from "./types.js";

const DECAY_CHANNELS: readonly ChannelMeta[] = [{ name: "y", unit: "1" }];

/**
 * The per-slice budget below is asserted against a same-process calibration
 * rather than as raw wall-clock: under the full parallel suite the old
 * `maxSliceMs < 10` form fired on roughly one run in five with the code
 * beneath it unchanged, and the same bytes both passed and failed on
 * consecutive CI attempts at one commit (P0.123). Dividing a measured slice
 * cost by a reference measured moments earlier in the same process cancels
 * the machine out.
 *
 * The mechanism lived here, file-local, until P0.96 -- whose criterion is
 * about the WHOLE correctness suite, not this one file -- moved it to
 * `load-calibration.ts` so runtime, viz and analysis can import it too. The
 * numbers below are unchanged; only their home moved.
 */

/**
 * RE-DERIVED BY P0.148, NOT TRANSPLANTED. The previous limit of 2 belonged to
 * a denominator ~15x smaller -- a single `measureCalibrationMs()` minimum --
 * and says nothing about the interleaved 3M-iteration median this now divides
 * by. Twelve runs on a 4-core sandbox: idle 1.186 / 1.220 / 1.233 / 1.260 /
 * 1.427; 4-way sustained 1.016 / 1.166; 4-way bursty 1.100; 8-way sustained
 * 1.082 / 1.215 / 1.371 / 1.457. The limit of 2.9 is 1.99x the worst of those,
 * the same ~2x convention the old 2 was set by.
 *
 * WHAT THE SPREAD SAYS, AND IT IS NOT WHAT THE OLD NUMBERS SAID. The old ratio
 * sat in 0.807-0.946 across idle and loaded alike, and that flatness was read
 * as the design working. P0.148 measured why it was flat: BOTH halves were
 * shorter than a scheduler timeslice, so neither moved under load and the
 * ratio was invariant by being blind rather than by cancelling anything. Here
 * both halves do move -- the calibration from ~9.6 ms idle to 17.5-21.7 ms
 * under 8-way load -- so the 1.016-1.457 spread is real cancellation with real
 * residual noise, and it overlaps idle and loaded rather than separating them.
 *
 * ITS SENSITIVITY WAS PREDICTED FROM THE OLD STUDY AND THEN MEASURED, AND THE
 * PREDICTION HELD. The old limit's injected-overhead study (+10 ops 0.891, +40
 * ops 1.366, +120 ops 2.506, +400 ops 6.707) was taken on the old scale. The
 * ratio is linear in per-step cost, so scaling by this scale's idle median
 * over that one's (1.233 / 0.879 = 1.402) predicts 1.249 / 1.915 / 3.513 /
 * 9.402. Re-running the injection here gives 1.323 / 1.844 / 3.409 / 8.735
 * against a +0 baseline of 1.151-1.205 -- within 3-7% of the prediction at
 * every point, so the linearity assumption is checked rather than assumed.
 * +120 fails 2.9 and +40 passes, so the detection floor is still a per-step
 * regression between 1.7x and 2.2x: UNCHANGED by this re-pairing, which is the
 * whole point. The pairing was fixed without paying for it in sensitivity.
 *
 * The injection is not committed. It was a `for` loop of `Math.sqrt` in the
 * mock stepper's `step`, with the op count hoisted to a module constant --
 * reading `process.env` inside the step loop instead costs more than any of
 * the injections and reports 3.48 at +0 ops, which is a measurement of the
 * harness and not of the chunker.
 */
const MAX_SLICE_COST_IN_CALIBRATIONS = 2.9;

/**
 * Slices per measured window, and the number that makes the ratio above
 * mean anything at all.
 *
 * WHY A WINDOW RATHER THAN A SLICE. P0.148 measured, on this container, that a
 * workload shorter than a scheduler timeslice is essentially never descheduled
 * and so does not stretch under load: the median of 0.2M-iteration samples
 * moved 0.99x from idle to 8-way sustained load while 1M-iteration samples
 * moved 2.2-3.5x. One slice here costs ~0.55 ms, which is on the wrong side of
 * that line, so a per-slice numerator cannot stretch and a ratio against a
 * calibration that does stretch simply falls under load -- safe, but it loses
 * the sensitivity that the assertion exists for. Ten slices cost ~5.5 ms,
 * comfortably past the transition, so numerator and denominator now meet the
 * same scheduling and the ratio is invariant for the documented reason rather
 * than by both halves being too short to notice.
 */
const SLICES_PER_WINDOW = 20;

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

    // THE COMMENT THAT USED TO SIT HERE SAID "under sustained load every
    // repeat is stretched, so the minimum is stretched too", AND P0.148
    // MEASURED THAT AS FALSE at this size: the 0.2M calibration cost
    // 0.592-0.607 ms under 8-way sustained load against 0.606 ms idle, a
    // stretch of 1.00x. P0.149 took the idle gate off it for exactly that
    // reason -- see measureIdleGateCalibration far below. The assertion is
    // carried by the interleaved load-tracking calibration built underneath.
    const smallCalibrationMs = measureCalibrationMs();
    expect(Number.isFinite(smallCalibrationMs)).toBe(true);

    // Warm the load-tracking workload so the first interleaved sample is not
    // paying JIT compile cost -- the same thing measureCalibrationMs does
    // before its own loop, and what arcs.test.ts does since P0.147.
    calibrationWorkload(LOAD_TRACKING_CALIBRATION_ITERATIONS);

    const sliceMs: number[] = [];
    // The paired series: one calibration and the slice that ran immediately
    // after it, so the two span the same wall-clock window and meet the same
    // scheduling. Subsampled rather than taken on every slice because a 3M
    // calibration costs ~9.6 ms here and there are ~201 slices; one in ten
    // gives 21 pairs for ~200 ms, which is the same order as the measurement
    // itself rather than ten times it.
    const windowMs: number[] = [];
    const windowCalibrationMs: number[] = [];
    let windowAccMs = 0;
    let slicesInWindow = 0;
    let totalStepsRun = 0;
    let slices = 0;
    for (;;) {
      if (slicesInWindow === 0) {
        windowCalibrationMs.push(
          elapsedMs(() => void calibrationWorkload(LOAD_TRACKING_CALIBRATION_ITERATIONS)),
        );
      }

      slices++;
      const before = performance.now();
      const result = continuation.runSlice(stepsPerSlice);
      const thisSliceMs = performance.now() - before;
      sliceMs.push(thisSliceMs);
      windowAccMs += thisSliceMs;
      slicesInWindow++;

      if (slicesInWindow === SLICES_PER_WINDOW) {
        windowMs.push(windowAccMs);
        windowAccMs = 0;
        slicesInWindow = 0;
      }

      if (result.done) {
        totalStepsRun = result.report.nSteps;
        expect(result.report.status).toBe("ok");
        break;
      }
    }
    // Drop the trailing partial window rather than compare it against a full
    // one, and drop its calibration with it so the two series stay paired.
    windowCalibrationMs.length = windowMs.length;

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
    // current speed. Both series are summarised by the SAME statistic and the
    // calibration is long enough to be preempted, which are the two
    // conditions P0.147 measured and P0.148 audited this caller against; a
    // median numerator over a minimum denominator -- what this test did until
    // P0.148 -- compares a process's typical case against a machine's best
    // one and cancels nothing.
    const { costInCalibrations, calibrationMs, tracksLoad } = pairedCost(
      windowMs,
      windowCalibrationMs,
    );
    if (tracksLoad) {
      expect(costInCalibrations).toBeLessThan(MAX_SLICE_COST_IN_CALIBRATIONS);
    } else {
      // The honest outcome when the calibration is too short to have been
      // preempted -- a machine much faster than the one the size was chosen
      // on. Reported rather than failed: this test must never go red as
      // though the chunker regressed when what happened is that it could not
      // measure. The gate keys on the CALIBRATION and never on the
      // measurement it guards, so a slower chunker cannot reach this branch.
      console.warn(
        `[P0.148] per-window ratio not asserted: ${windowCalibrationMs.length} x ` +
          `${LOAD_TRACKING_CALIBRATION_ITERATIONS} iterations came to ` +
          `${calibrationMs.toFixed(3)} ms, too short to track load; ratio was ` +
          `${costInCalibrations.toFixed(3)}. Raise LOAD_TRACKING_CALIBRATION_ITERATIONS.`,
      );
    }

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
    // REWIRED BY P0.149. This used to pass the 0.2M minimum above, which
    // cannot be descheduled and so reported "idle" on a fully contended
    // runner. measureIdleGateCalibration samples a workload long enough to be
    // preempted and reports the dispersion that detects contention.
    const idleGate = measureIdleGateCalibration();
    const machineCanBeHeldToRawBudget = isIdleEnoughForWallClock(idleGate);
    if (machineCanBeHeldToRawBudget) {
      expect(medianSliceMs).toBeLessThan(10);
    } else {
      // Say so rather than passing silently: a skipped check that leaves no
      // trace is indistinguishable from one that never existed.
      console.log(
        `[P0.123] raw 10 ms per-slice check skipped: calibration median ` +
          `${idleGate.medianMs.toFixed(3)} ms (ceiling ${IDLE_CALIBRATION_CEILING_MS}), dispersion ` +
          `${idleGate.dispersion.toFixed(3)} (limit ${MAX_IDLE_CALIBRATION_DISPERSION}), so this ` +
          `machine is too busy or too slow for the blueprint figure to measure the code. The load-invariant ` +
          `ratio assertion ran and passed at ${costInCalibrations.toFixed(3)} ` +
          `(limit ${MAX_SLICE_COST_IN_CALIBRATIONS}); median slice was ` +
          `${medianSliceMs.toFixed(3)} ms and max slice ${maxSliceMs.toFixed(3)} ms against the ` +
          `10 ms figure this branch would have asserted.`,
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
