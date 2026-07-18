import type { Model } from "@ballista/engine";
import type { Sink, SolveReport, StepResult } from "./types.js";

/**
 * Immutable columnar (structure-of-arrays) trajectory produced by
 * {@link TrajectoryRecorder.trajectory} (§5.1, §5.4).
 */
export interface Trajectory {
  readonly nSteps: number;
  readonly t: Float64Array;
  readonly channels: readonly Float64Array[];
}

const DEFAULT_INITIAL_CAPACITY = 64;

/**
 * Records every accepted state (plus the initial state) as a row in a
 * growing columnar (SoA) store (§5.1): one `Float64Array` per model channel
 * rather than an array of row objects, so downstream consumers (Viz,
 * analysis) get zero-copy typed-array access per channel. Storage grows by
 * doubling -- amortized O(1) per recorded row, no per-row allocation once
 * warmed up. `finish` freezes the recorder and exposes `subarray` views
 * trimmed to the actual row count: windows over the same backing buffers,
 * not fresh copies (§5.4 "Immutability of results is enforced by
 * construction").
 */
export class TrajectoryRecorder implements Sink {
  readonly id = "trajectory-recorder";

  private t: Float64Array;
  private channelBufs: Float64Array[] = [];
  private count = 0;
  private trajectorySnapshot: Trajectory | undefined;

  constructor(initialCapacity: number = DEFAULT_INITIAL_CAPACITY) {
    this.t = new Float64Array(Math.max(1, initialCapacity));
  }

  /** @inheritDoc */
  start(model: Model, t0: number, y0: Float64Array): void {
    this.channelBufs = Array.from({ length: model.dim }, () => new Float64Array(this.t.length));
    this.recordRow(t0, y0);
  }

  /** @inheritDoc */
  accept(t: number, y: Float64Array, _step: StepResult): void {
    this.recordRow(t, y);
  }

  /** @inheritDoc */
  finish(_report: SolveReport): void {
    this.trajectorySnapshot = Object.freeze({
      nSteps: this.count,
      t: this.t.subarray(0, this.count),
      channels: Object.freeze(this.channelBufs.map((buf) => buf.subarray(0, this.count))),
    });
  }

  /** The frozen recorded trajectory; only valid after `finish` has run. */
  get trajectory(): Trajectory {
    if (!this.trajectorySnapshot) {
      throw new Error("TrajectoryRecorder.trajectory read before finish()");
    }
    return this.trajectorySnapshot;
  }

  private recordRow(t: number, y: Float64Array): void {
    if (this.count === this.t.length) this.grow();
    this.t[this.count] = t;
    for (let i = 0; i < y.length; i++) {
      this.channelBufs[i]![this.count] = y[i]!;
    }
    this.count++;
  }

  private grow(): void {
    const newCapacity = this.t.length * 2;

    const grownT = new Float64Array(newCapacity);
    grownT.set(this.t);
    this.t = grownT;

    this.channelBufs = this.channelBufs.map((buf) => {
      const grown = new Float64Array(newCapacity);
      grown.set(buf);
      return grown;
    });
  }
}
