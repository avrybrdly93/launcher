/**
 * Streaming observable sink (§5.1 "Sinks, not arrays"; P6.04).
 *
 * `observables.ts` computes every observable from a finished
 * {@link Trajectory}, which is the right shape for a single interactive
 * solve: the trajectory already exists because the UI is going to plot it.
 * A Monte Carlo batch is the opposite case. §5.1 puts it plainly -- "Monte
 * Carlo typically records nothing but event states and observables, which
 * is the difference between 1e3 and 1e5 runs/s" -- and P6.04's criterion
 * makes it a budget: 1e4 replicates under 50 MB. A `TrajectoryRecorder`
 * per replicate cannot meet that, because its cost is O(steps x channels)
 * and nothing downstream ever reads the rows.
 *
 * This sink carries only the running state the observables need: the first
 * row, the previous row, the latest row, and the best apex candidate so
 * far. That is O(model.dim) for the whole solve, independent of step count.
 *
 * **It is not an approximation of `observables.ts`, it is the same
 * arithmetic in a different order**, and {@link ObservableSink.observables}
 * is expected to agree with the corresponding functions there to the last
 * bit on the same solve. Two facts make that reachable rather than
 * aspirational:
 *
 * - `TrajectoryRecorder` records exactly the initial state plus one row per
 *   `accept`, in order, so a sink attached to the same solve sees exactly
 *   the rows the trajectory would have held.
 * - `apex`'s scan is already local: it refines each *consecutive pair* of
 *   rows independently and keeps a running maximum. Only the order in
 *   which candidates are compared has to be reproduced, and that is what
 *   {@link ObservableSink.observables} does below.
 *
 * `observable-sink.test.ts` asserts the agreement with `Object.is` rather
 * than a tolerance, so any drift between the two implementations is a test
 * failure and not a slow divergence.
 */

import type { Sink, SolveReport, StepResult } from "@ballista/solverkit";
import type { Model } from "@ballista/engine";
import {
  PLANAR_LAYOUT,
  hermiteStationaryPoint,
  hermiteValue,
  type TrajectoryLayout,
} from "./observables.js";

/**
 * The scalar summary of one solve: what a Monte Carlo replicate keeps
 * instead of its trajectory.
 *
 * Every field carries {@link ObservableSink}'s inherited caveat, which is
 * `observables.ts`'s caveat unchanged: `timeOfFlight`, `range`,
 * `impactSpeed` and `impactPoint` read the final row, which is the
 * event-localized impact state only for a solve that ended on a terminal
 * event. A solve that ran out of `tspan` or `maxSteps` has an ordinary
 * final row, and these will report it as an impact.
 *
 * **{@link status} does not rescue you from that**, and it is worth saying
 * so rather than leaving it to be discovered: a solve that simply reaches
 * the end of its `tspan` concludes `"ok"`, exactly as one that hit the
 * ground does. `SolveReport` carries no terminal-event flag, so `status`
 * separates a completed solve from a `"failed"` or `"canceled"` one and
 * nothing more. A caller that needs "did this actually land?" has to
 * compare {@link timeOfFlight} against the horizon it passed in — which is
 * why `mc-job.ts` does that itself and reports it per replicate.
 */
export interface Observables {
  /** `t_final - t_0` (§9.1), matching `timeOfFlight`. */
  readonly timeOfFlight: number;
  /** Launch-to-impact distance in the horizontal plane (§9.1), matching `range`. */
  readonly range: number;
  /** Peak height above the datum (§9.1), matching `apexHeight`. */
  readonly apexHeight: number;
  /** Time of the peak, on the trajectory's own clock, matching `apexTime`. */
  readonly apexTime: number;
  /** Speed at the final row (§9.1), matching `impactSpeed`. */
  readonly impactSpeed: number;
  /** Position components at the final row, in layout axis order, matching `impactPoint`. */
  readonly impactPoint: readonly number[];
  /**
   * The solve's own outcome: `"ok"` for any solve that ran to completion,
   * `"failed"` or `"canceled"` otherwise. See this interface's note — `"ok"`
   * is *not* a claim that the final row is an impact.
   */
  readonly status: SolveReport["status"];
}

/**
 * Accumulates {@link Observables} from a solve without retaining it
 * (P6.04). Attach in place of a `TrajectoryRecorder`; read
 * {@link ObservableSink.observables} after the solve concludes.
 *
 * One instance handles one solve. {@link ObservableSink.reset} returns it
 * to its pre-`start` state so a Monte Carlo batch can reuse a single sink
 * across replicates instead of allocating one per replicate -- the reuse
 * that keeps a 1e4-replicate batch's allocation flat.
 */
export class ObservableSink implements Sink {
  readonly id = "observable-sink";

  private readonly layout: TrajectoryLayout;
  private readonly yChannel: number;
  private readonly vyChannel: number;

  /** Row 0. `firstY` is a copy: `integrate` reuses its state buffers between steps. */
  private t0 = 0;
  private firstY: Float64Array | undefined;
  /**
   * The most recent row. Together with the row arriving at `accept` this is
   * the consecutive pair `apex`'s scan refines, which is why the sink needs
   * exactly one row of history and not two.
   */
  private tLast = 0;
  private lastY: Float64Array | undefined;
  private rows = 0;

  /**
   * Best *interior crossing* candidate, kept separately from the endpoint
   * candidates rather than folded into one running maximum. See
   * {@link ObservableSink.observables} for why that separation is what
   * makes the tie-breaking match `apex`.
   */
  private crossingHeight = Number.NEGATIVE_INFINITY;
  private crossingT = 0;

  private report: SolveReport | undefined;

  constructor(layout: TrajectoryLayout = PLANAR_LAYOUT) {
    this.layout = layout;
    this.yChannel = layout.position[layout.vertical]!;
    this.vyChannel = layout.velocity[layout.vertical]!;
    if (layout.vertical < 0 || layout.vertical >= layout.position.length) {
      throw new Error(
        `ObservableSink: layout vertical axis ${layout.vertical} is outside its ${layout.position.length} position axes`,
      );
    }
  }

  /** @inheritDoc */
  start(model: Model, t0: number, y0: Float64Array): void {
    // Checked here rather than at read time so that pairing SPATIAL_LAYOUT
    // with a planar solve fails at the start of the solve that cannot
    // answer it, not 1e4 replicates later with a NaN column. Mirrors
    // observables.ts's requireLayout, which exists for the same mistake.
    const needed = Math.max(...this.layout.position, ...this.layout.velocity) + 1;
    if (model.dim < needed) {
      throw new Error(
        `ObservableSink: layout spans ${needed} channel(s), but the model has only ${model.dim}`,
      );
    }

    this.reset();
    // Allocated on first use and reused across replicates by `reset`, which
    // keeps them: a fresh Float64Array per solve would be 3 allocations x
    // 1e4 replicates for buffers whose size never changes.
    if (this.firstY === undefined || this.firstY.length !== y0.length) {
      this.firstY = new Float64Array(y0.length);
      this.lastY = new Float64Array(y0.length);
    }
    this.firstY.set(y0);
    this.lastY!.set(y0);
    this.t0 = t0;
    this.tLast = t0;
    this.rows = 1;
  }

  /** @inheritDoc */
  accept(t: number, y: Float64Array, _step: StepResult): void {
    if (this.lastY === undefined) return;

    // (last recorded row, this row) is exactly one iteration of `apex`'s
    // interior scan, so run that iteration now and then overwrite the
    // history. Downward crossings only: v_y >= 0 -> v_y < 0 is a maximum of
    // y, while the upward crossing on a bouncing arc is a minimum and would
    // drag the scan toward the ground.
    const vy0 = this.lastY[this.vyChannel]!;
    const vy1 = y[this.vyChannel]!;
    if (vy0 >= 0 && vy1 < 0) {
      const h = t - this.tLast;
      if (h > 0) {
        const yStart = this.lastY[this.yChannel]!;
        const yEnd = y[this.yChannel]!;
        const theta = hermiteStationaryPoint(yStart, vy0, yEnd, vy1, h);
        if (theta !== undefined) {
          const height = hermiteValue(yStart, vy0, yEnd, vy1, h, theta);
          if (height > this.crossingHeight) {
            this.crossingHeight = height;
            this.crossingT = this.tLast + theta * h;
          }
        }
      }
    }

    this.lastY.set(y);
    this.tLast = t;
    this.rows++;
  }

  /** @inheritDoc */
  finish(report: SolveReport): void {
    this.report = report;
  }

  /**
   * Clears every accumulator, keeping the state buffers, so this instance
   * can take another solve. Called automatically by `start`; exposed so a
   * caller can drop a failed solve's partial state without waiting for the
   * next one.
   */
  reset(): void {
    this.rows = 0;
    this.report = undefined;
    this.crossingHeight = Number.NEGATIVE_INFINITY;
    this.crossingT = 0;
  }

  /**
   * The finished summary; only valid once the solve has concluded, mirroring
   * `TrajectoryRecorder.trajectory` and `EventCollector.events`.
   *
   * **Apex candidate order is load-bearing.** `apex` considers row 0 first,
   * then the final row, then each interior crossing in time order, keeping a
   * running maximum that only moves on a *strict* increase -- so equal
   * heights resolve to the earliest candidate considered, not the earliest in
   * time. Streaming sees the crossings before the final row, so folding them
   * into one running maximum would break ties the other way on a trajectory
   * whose apex height is matched exactly by its final row. Keeping the
   * crossing maximum separate and comparing it *after* the two endpoints
   * reproduces the original order exactly: a running maximum is associative,
   * and first-wins tie-breaking survives being computed in two stages.
   */
  get observables(): Observables {
    if (this.report === undefined) {
      throw new Error("ObservableSink.observables read before finish()");
    }
    if (this.rows < 1 || this.lastY === undefined || this.firstY === undefined) {
      throw new Error("ObservableSink.observables: the solve recorded no rows");
    }

    const { position, velocity, vertical } = this.layout;
    const first = this.firstY;
    const last = this.lastY;

    let apexTime = this.t0;
    let apexHeight = first[this.yChannel]!;
    const consider = (t: number, height: number): void => {
      if (height > apexHeight) {
        apexHeight = height;
        apexTime = t;
      }
    };
    consider(this.tLast, last[this.yChannel]!);
    if (this.crossingHeight !== Number.NEGATIVE_INFINITY) {
      consider(this.crossingT, this.crossingHeight);
    }

    let rangeSq = 0;
    for (let axis = 0; axis < position.length; axis++) {
      if (axis === vertical) continue;
      const channel = position[axis]!;
      const d = last[channel]! - first[channel]!;
      rangeSq += d * d;
    }

    let speedSq = 0;
    for (const channel of velocity) {
      const v = last[channel]!;
      speedSq += v * v;
    }

    return {
      timeOfFlight: this.tLast - this.t0,
      range: Math.sqrt(rangeSq),
      apexHeight,
      apexTime,
      impactSpeed: Math.sqrt(speedSq),
      impactPoint: position.map((channel) => last[channel]!),
      status: this.report.status,
    };
  }
}
