/**
 * Monte Carlo job (§5.6 Concurrency Architecture, "Job types: ... `mc`
 * (Monte Carlo batches with per-worker RNG substreams -- seed + stream-id,
 * never shared state)"; P6.04). A study is an `UncertainScenarioSpec`
 * (P6.02): a base scenario, an ordered list of distribution overlays, a
 * replicate count and a seed. Each replicate draws a parameter vector
 * (P6.03), integrates the resulting scenario, and is summarized down to a
 * handful of scalars.
 *
 * **The design constraint is what is *not* kept.** `sweep-job.ts` attaches
 * a `TrajectoryRecorder` and reads the finished trajectory, which is
 * affordable for an 11x11 grid. P6.04's criterion -- 1e4 replicates, no
 * retained trajectories, under 50 MB -- rules that out: at a few hundred
 * steps and four channels a single retained trajectory is tens of
 * kilobytes, so 1e4 of them is hundreds of megabytes before any of the
 * summarizing starts. This job therefore attaches an `ObservableSink`
 * (P6.04) instead, whose footprint is O(model.dim) for a whole solve, and
 * reuses one instance across the batch.
 *
 * Deliberately framework/DOM-free in the same way as `sweep-job.ts`:
 * {@link runMcReplicate}/{@link runMcRange} are ordinary functions callable
 * from a unit test, from a worker entry, or from a non-browser batch
 * runner. `worker-pool.ts` is the only piece that knows about
 * postMessage/threads.
 *
 * **Substreams come from P6.03, not from the worker.** A worker is handed
 * an index range and calls `generateReplicate(study, i)`, whose draw for
 * replicate `i` is a pure function of the study seed and `i` -- so how the
 * range is partitioned across workers cannot change any result. §5.6's
 * "never shared state" is a property of the generator, and this job's only
 * obligation is not to introduce state of its own.
 */

import { generateReplicate, type ScenarioSpec, type UncertainScenarioSpec } from "@ballista/engine";
import { ObservableSink, PLANAR_LAYOUT, SPATIAL_LAYOUT } from "@ballista/analysis";
import { HermiteDenseOutputStepper, integrate } from "@ballista/solverkit";
import { resolveModel, resolveSolverConfig, resolveStepper } from "./scenario-resolver.js";

/**
 * Upper bound on one replicate's integration horizon, matching
 * `sweep-job.ts`'s `SWEEP_T_MAX_SECONDS` and `SimulationSession`'s own
 * backstop. A replicate whose drawn parameters produce a flight longer than
 * this is reported with `landed = 0` rather than silently contributing a
 * truncated range to the ensemble.
 */
export const MC_T_MAX_SECONDS = 60;

/** A Monte Carlo study: P6.02's spec is the whole job. */
export interface McJob {
  readonly study: UncertainScenarioSpec;
}

/** One replicate's summary. */
export interface McReplicateResult {
  readonly range: number;
  readonly apexHeight: number;
  readonly timeOfFlight: number;
  readonly impactSpeed: number;
  /**
   * Whether the replicate actually reached the ground inside
   * {@link MC_T_MAX_SECONDS}.
   *
   * This exists because `SolveReport.status` cannot answer it: a solve that
   * merely exhausts its `tspan` concludes `"ok"`, exactly as one that hit
   * the ground does (see `ObservableSink`'s note). The observables of a
   * truncated flight are not wrong so much as meaningless -- its "impact
   * point" is wherever it happened to be at 60 s -- and an estimator that
   * averaged them in alongside real impacts would be biased by an amount
   * nothing in the output would reveal. Reported per replicate so P6.07's
   * convergence check and P6.11's hit probability can decide what to do
   * with them explicitly.
   */
  readonly landed: boolean;
}

/**
 * A batch's results in columnar (structure-of-arrays) form, one entry per
 * replicate: `Float64Array`s so a worker can transfer the buffers back
 * rather than copy them (§5.6 "Results return as transferable
 * `ArrayBuffer`s"), and one column per observable so a consumer that wants
 * only the range column does not pay for the rest.
 *
 * `landed` is a `Uint8Array` rather than a `Float64Array` for the same
 * reason: it is a flag, and eight bytes per replicate to say so is seven
 * too many.
 */
export interface McColumns {
  readonly range: Float64Array;
  readonly apexHeight: Float64Array;
  readonly timeOfFlight: Float64Array;
  readonly impactSpeed: Float64Array;
  readonly landed: Uint8Array;
}

/** Allocates a {@link McColumns} sized for `count` replicates. */
export function createMcColumns(count: number): McColumns {
  return {
    range: new Float64Array(count),
    apexHeight: new Float64Array(count),
    timeOfFlight: new Float64Array(count),
    impactSpeed: new Float64Array(count),
    landed: new Uint8Array(count),
  };
}

/**
 * The observable layout matching a spec's model kind.
 *
 * `planar-spin`'s spin channel sits after the four planar ones, so the
 * planar layout indexes it correctly and simply ignores the extra channel;
 * only `spatial` needs the three-axis layout. Getting this wrong is a
 * silent error -- `PLANAR_LAYOUT` on a spatial solve would call the `z`
 * channel a velocity -- which is why it is derived from the spec rather
 * than left as a caller-supplied option with a default.
 */
function layoutFor(spec: ScenarioSpec): typeof PLANAR_LAYOUT {
  return (spec.model.kind ?? "planar") === "spatial" ? SPATIAL_LAYOUT : PLANAR_LAYOUT;
}

/**
 * Runs replicate `index` of `job.study` and returns its summary.
 *
 * `sink`, when supplied, is reused instead of allocating one -- the reuse
 * {@link runMcRange} relies on to keep a 1e4-replicate batch's allocation
 * flat. Passing a sink whose layout does not match the drawn spec's model
 * kind is a caller error; omit it and the right one is built.
 */
export function runMcReplicate(
  job: McJob,
  index: number,
  sink?: ObservableSink,
): McReplicateResult {
  const { spec } = generateReplicate(job.study, index);

  const { model, ctx, y0 } = resolveModel(spec);
  const resolvedStepper = resolveStepper(spec.solver.stepper);
  // Terminal event localization (ground impact) needs dense output (§5.1),
  // and the impact observables read the localized final row -- so this is
  // not optional here even though nothing plots the interpolant. Mirrors
  // sweep-job.ts and SimulationSession.commitScenario.
  const stepper = resolvedStepper.interpolant
    ? resolvedStepper
    : new HermiteDenseOutputStepper(resolvedStepper);
  const cfg = resolveSolverConfig(spec);

  const observableSink = sink ?? new ObservableSink(layoutFor(spec));
  const report = integrate(model, ctx, y0, [0, MC_T_MAX_SECONDS], cfg, stepper, [observableSink]);
  const observables = observableSink.observables;

  return {
    range: observables.range,
    apexHeight: observables.apexHeight,
    timeOfFlight: observables.timeOfFlight,
    impactSpeed: observables.impactSpeed,
    // A solve that ended on the ground event stops strictly before the
    // horizon; one that ran out of tspan ends exactly at it. Compared
    // against tFinal rather than the sink's timeOfFlight so that this stays
    // correct if a future study ever launches at a non-zero epoch.
    landed: report.status === "ok" && report.tFinal < MC_T_MAX_SECONDS,
  };
}

/**
 * Runs replicates `[startIndex, endIndex)` of `job`, writing each one's
 * observables into `out` at the *chunk-local* index `i - startIndex` -- so
 * the worker pool can hand a worker a right-sized chunk-local buffer to
 * fill and transfer back, exactly as `runSweepRange` does. `onProgress`, if
 * given, is called after every replicate with the chunk-local count
 * completed so far; throttling it into actual posted messages is
 * `worker-pool.ts`'s concern.
 *
 * **One sink for the whole range.** Allocating one per replicate would be
 * 1e4 short-lived objects whose size never changes, and while a generational
 * collector handles that cheaply it is exactly the per-replicate cost the
 * criterion is about. `ObservableSink.start` resets the accumulators, so
 * reuse cannot leak one replicate's apex into the next; a test asserts that
 * directly rather than trusting the reading.
 */
export function runMcRange(
  job: McJob,
  startIndex: number,
  endIndex: number,
  out: McColumns,
  onProgress?: (completed: number) => void,
): void {
  // Built from the base spec: every replicate writes numbers into a copy of
  // that same base, so the model kind -- and therefore the layout -- is
  // fixed for the whole study and cannot vary replicate to replicate.
  const sink = new ObservableSink(layoutFor(job.study.base));

  for (let i = startIndex; i < endIndex; i++) {
    const result = runMcReplicate(job, i, sink);
    const local = i - startIndex;
    out.range[local] = result.range;
    out.apexHeight[local] = result.apexHeight;
    out.timeOfFlight[local] = result.timeOfFlight;
    out.impactSpeed[local] = result.impactSpeed;
    out.landed[local] = result.landed ? 1 : 0;
    onProgress?.(local + 1);
  }
}
