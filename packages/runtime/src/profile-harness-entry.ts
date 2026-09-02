/**
 * The surface `scripts/profile-hotspots.mjs` needs, in one entry point for
 * esbuild to bundle (P7.01).
 *
 * Same reason `batch-throughput-harness-entry.ts` exists: the script cannot
 * import `packages/runtime/dist/*.js` directly, because those files import
 * bare workspace specifiers whose package `main` is a `.ts` file and Node's
 * resolver cannot follow that. Bundling is the answer
 * `measure-cross-engine-drift.mjs` and `measure-batch-throughput.mjs`
 * already give to the same problem.
 *
 * **The two workloads are defined here rather than in the script**, for the
 * reason `batch-throughput.ts` gives about the benchmark's definition: what
 * is being profiled is a claim the test suite should be able to check, while
 * the profiler, the clock and the artifact are the script's business. A
 * profile of the wrong workload is worse than no profile, because it names
 * hotspots that are real and irrelevant.
 */

import {
  HermiteDenseOutputStepper,
  StatsCollector,
  EventCollector,
  TrajectoryRecorder,
  integrate,
} from "@ballista/solverkit";
import { benchmarkStudy } from "./batch-throughput.js";
import { createMcColumns, type McColumns, runMcRange } from "./mc-job.js";
import { resolveModel, resolveSolverConfig, resolveStepper } from "./scenario-resolver.js";
import { DEFAULT_SCENARIO } from "./simulation-session.js";

/**
 * Horizon for the interactive workload, matching `simulation-session.ts`'s
 * own `T_MAX_SECONDS`. Duplicated rather than exported from there because
 * that module's copy is a private backstop constant and widening its API to
 * satisfy a profiler would be the profiler changing the thing it measures.
 */
const INTERACTIVE_T_MAX_SECONDS = 60;

/**
 * One interactive solve, reproducing what `SimulationSession.commitScenario`
 * does between receiving a committed spec and publishing a result: resolve
 * the model, stepper and config, then integrate with the three sinks the
 * UI needs -- a {@link TrajectoryRecorder} (the plotted path), a
 * {@link StatsCollector} and an {@link EventCollector}.
 *
 * **The recorder is the point of the distinction from the batch workload.**
 * The MC path deliberately attaches only an `ObservableSink`; the
 * interactive path must keep every accepted row because something draws it.
 * Profiling one and reporting it as the other would hide exactly the cost
 * that separates them.
 *
 * The stores, the frame scheduler and the draft/committed machinery are
 * *not* included: they are per-commit constant work that no amount of
 * trajectory makes bigger, and including them would put `SimulationSession`
 * bookkeeping in a profile whose subject is the solve.
 */
export function interactiveSolveOnce(): number {
  const spec = DEFAULT_SCENARIO;
  const { model, ctx, y0 } = resolveModel(spec);
  const resolved = resolveStepper(spec.solver.stepper);
  const stepper = resolved.interpolant ? resolved : new HermiteDenseOutputStepper(resolved);
  const cfg = resolveSolverConfig(spec);

  // No explicit capacity, exactly as `SimulationSession.commitScenario`
  // constructs it -- the recorder's growth from its 64-row default is part
  // of the interactive cost and pre-sizing it here would profile a solve the
  // application never runs.
  const recorder = new TrajectoryRecorder();
  const stats = new StatsCollector();
  const events = new EventCollector();

  const report = integrate(model, ctx, y0, [0, INTERACTIVE_T_MAX_SECONDS], cfg, stepper, [
    recorder,
    stats,
    events,
  ]);
  if (report.status !== "ok") {
    throw new Error(`interactive profile solve did not succeed: status "${report.status}"`);
  }
  // Returned so the caller can checksum it. Without a value crossing back,
  // nothing observes the solve and a runtime is entitled to elide work the
  // profile is supposed to include -- the same guard
  // `measure-batch-throughput.mjs` applies to its worker chunks.
  return recorder.trajectory.nSteps;
}

/**
 * The MC batch workload, single-threaded on purpose.
 *
 * P6.26 measured parallel efficiency at 90% of ideal on four threads and
 * concluded the gap is per-trajectory cost rather than scheduling (P0.120).
 * A profile taken across four workers would spread that cost over four
 * profiles and add thread bookkeeping that is measurably *not* where the
 * time goes. One thread profiles the trajectory, which is the subject.
 *
 * `stepSize` is a parameter with no default for the same reason
 * `batch-throughput.ts` refuses to have one: fixed-step RK4 cost is nearly
 * inversely proportional to the step, so the caller must state which rung it
 * profiled and the artifact must record it.
 */
export function profileMcBatch(replicates: number, stepSize: number): McColumns {
  const study = benchmarkStudy(stepSize, replicates);
  const out = createMcColumns(replicates);
  runMcRange({ study }, 0, replicates, out);
  return out;
}

export { benchmarkStudy, THROUGHPUT_STEP_LADDER, verdictRung } from "./batch-throughput.js";
