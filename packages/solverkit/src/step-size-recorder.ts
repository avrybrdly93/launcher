import type { Sink, SolveReport, StepResult } from "./types.js";

/** Frozen (t, h) step-size trace produced by {@link StepSizeRecorder.trace} (§5.1, P2.46). */
export interface StepSizeTrace {
  readonly nSteps: number;
  /** Time at the *end* of each accepted step (matches `Trajectory.t`'s convention). */
  readonly t: Float64Array;
  /** Step size actually used to reach that `t` (`StepResult.h`, post-controller). */
  readonly h: Float64Array;
}

const DEFAULT_INITIAL_CAPACITY = 64;

/**
 * Records the accepted step-size trace h(t) without retaining the state
 * trajectory (§5.1, P2.46's "stiff-scenario telemetry"): every accepted
 * step's `(t, h)` pair, in a growing columnar store (same doubling-array
 * pattern as {@link TrajectoryRecorder}). This is what exposes an adaptive
 * controller's step-size *collapse* during a stiff transient (e.g. the
 * dust-grain preset's initial high-speed Stokes-drag relaxation, §3.8) as
 * an inspectable time series, ahead of P3.29's PlotPane rendering it.
 * Rejected attempts are not recorded -- only what the controller actually
 * used to advance the solution, matching `TrajectoryRecorder`'s "one row
 * per accepted step" convention.
 */
export class StepSizeRecorder implements Sink {
  readonly id = "step-size-recorder";

  private t: Float64Array;
  private hBuf: Float64Array;
  private count = 0;
  private traceSnapshot: StepSizeTrace | undefined;

  constructor(initialCapacity: number = DEFAULT_INITIAL_CAPACITY) {
    this.t = new Float64Array(Math.max(1, initialCapacity));
    this.hBuf = new Float64Array(this.t.length);
  }

  /** @inheritDoc */
  accept(t: number, _y: Float64Array, step: StepResult): void {
    if (this.count === this.t.length) this.grow();
    this.t[this.count] = t;
    this.hBuf[this.count] = step.h;
    this.count++;
  }

  /** @inheritDoc */
  finish(_report: SolveReport): void {
    this.traceSnapshot = Object.freeze({
      nSteps: this.count,
      t: this.t.subarray(0, this.count),
      h: this.hBuf.subarray(0, this.count),
    });
  }

  /** The frozen recorded step-size trace; only valid after `finish` has run. */
  get trace(): StepSizeTrace {
    if (!this.traceSnapshot) {
      throw new Error("StepSizeRecorder.trace read before finish()");
    }
    return this.traceSnapshot;
  }

  private grow(): void {
    const newCapacity = this.t.length * 2;
    const grownT = new Float64Array(newCapacity);
    grownT.set(this.t);
    this.t = grownT;
    const grownH = new Float64Array(newCapacity);
    grownH.set(this.hBuf);
    this.hBuf = grownH;
  }
}
