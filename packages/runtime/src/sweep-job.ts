/**
 * Sweep job (§5.6 Concurrency Architecture, "Worker pool (L2): ... Job
 * types: `sweep` (parameter grids)"; P3.39). A sweep varies launch speed
 * `v0` and angle `theta` over a grid, holding everything else in a base
 * `ScenarioSpec` fixed, and summarizes each grid point down to two scalars
 * (range, apex height) rather than a full trajectory -- an 11x11 grid's
 * worth of full `Trajectory` objects would dwarf the summary any exhibit
 * actually plots (a range-vs-angle or apex-vs-speed heatmap).
 *
 * Deliberately framework/DOM-free: {@link runSweepPoint}/{@link
 * runSweepRange} are ordinary functions callable directly (unit tests,
 * this file), from `sweep-worker-entry.ts` inside a real Worker, or
 * (in principle) a future non-browser batch runner -- `worker-pool.ts` is
 * the only piece that knows about postMessage/threads at all.
 */

import { degToRad, type ScenarioSpec } from "@ballista/engine";
import {
  EventCollector,
  HermiteDenseOutputStepper,
  TrajectoryRecorder,
  integrate,
} from "@ballista/solverkit";
import { resolveModel, resolveSolverConfig, resolveStepper } from "./scenario-resolver.js";

/** Upper bound on one grid point's integration horizon (mirrors `SimulationSession`'s own `T_MAX_SECONDS` backstop, simulation-session.ts). */
const SWEEP_T_MAX_SECONDS = 60;

/** `planarProjectileModel`'s `[x, y, vx, vy]` state layout (shared convention, see e.g. hud-readout.ts). */
const X_CHANNEL = 0;
const Y_CHANNEL = 1;

/** A (theta, v0) parameter sweep over `baseScenario` (every other field -- forces, environment, projectile, solver -- held fixed). */
export interface SweepJob {
  readonly baseScenario: ScenarioSpec;
  /** Launch angles, degrees. */
  readonly thetaDegGrid: readonly number[];
  /** Launch speeds, m/s. */
  readonly v0Grid: readonly number[];
}

/** One grid point's summary: horizontal range at trajectory end, and the peak height reached. */
export interface SweepPoint {
  readonly range: number;
  readonly apexHeight: number;
}

/** A full sweep's results, flattened row-major: index `thetaIndex * v0Grid.length + v0Index`. */
export interface SweepResult {
  readonly thetaDegGrid: readonly number[];
  readonly v0Grid: readonly number[];
  readonly range: Float64Array;
  readonly apexHeight: Float64Array;
}

/** Total grid points a job covers -- `thetaDegGrid.length * v0Grid.length`, and the length {@link runSweepPoint}'s `index` ranges over. */
export function sweepPointCount(job: SweepJob): number {
  return job.thetaDegGrid.length * job.v0Grid.length;
}

/**
 * Runs one grid point: `index` decodes to `(thetaIndex, v0Index)` per
 * {@link sweepPointCount}'s row-major order, `vx0`/`vy0` are derived from
 * that point's angle/speed, and everything else (forces, environment,
 * projectile, solver, `y0`/`spin0`) comes straight from
 * `job.baseScenario`. Builds a fresh model/context per call -- a sweep
 * runs off-main in a worker (P3.39) precisely so this cost never has to be
 * shared-mutable-state-safe across points.
 */
export function runSweepPoint(job: SweepJob, index: number): SweepPoint {
  const v0Count = job.v0Grid.length;
  const thetaIndex = Math.floor(index / v0Count);
  const v0Index = index % v0Count;
  const thetaDeg = job.thetaDegGrid[thetaIndex]!;
  const v0 = job.v0Grid[v0Index]!;
  const thetaRad = degToRad(thetaDeg);

  const spec: ScenarioSpec = {
    ...job.baseScenario,
    initialConditions: {
      ...job.baseScenario.initialConditions,
      vx0: v0 * Math.cos(thetaRad),
      vy0: v0 * Math.sin(thetaRad),
    },
  };

  const { model, ctx, y0 } = resolveModel(spec);
  const resolvedStepper = resolveStepper(spec.solver.stepper);
  // Terminal event localization (ground impact) needs dense output (§5.1,
  // integrate.ts) -- mirrors SimulationSession.commitScenario exactly.
  const stepper = resolvedStepper.interpolant
    ? resolvedStepper
    : new HermiteDenseOutputStepper(resolvedStepper);
  const cfg = resolveSolverConfig(spec);

  const recorder = new TrajectoryRecorder();
  // The apex is an interior extremum of the flight, not (generally) an
  // *accepted step boundary* -- an adaptive solve can cover a whole short
  // flight in a single big step, recording only its two endpoints, so
  // scanning recorded rows for the max height would silently miss it. The
  // model's own declared "apex" event (P1.40, v_y falling through zero) is
  // localized precisely regardless of step size (§4.9); that's what this
  // reads instead.
  const events = new EventCollector();
  integrate(model, ctx, y0, [0, SWEEP_T_MAX_SECONDS], cfg, stepper, [recorder, events]);

  const { trajectory } = recorder;
  const nSteps = trajectory.nSteps;
  if (nSteps === 0) return { range: 0, apexHeight: y0[Y_CHANNEL]! };

  const xChannel = trajectory.channels[X_CHANNEL]!;
  let apexHeight = y0[Y_CHANNEL]!;
  for (const root of events.events) {
    const y = root.y[Y_CHANNEL]!;
    if (y > apexHeight) apexHeight = y;
  }

  return { range: xChannel[nSteps - 1]! - xChannel[0]!, apexHeight };
}

/**
 * Runs grid points `[startIndex, endIndex)` of `job`, writing each point's
 * `range`/`apexHeight` into `outRange`/`outApexHeight` at the *chunk-local*
 * index `i - startIndex` -- so a caller (the worker pool) can hand a
 * worker a right-sized chunk-local buffer to fill and transfer back,
 * rather than the full sweep's arrays. `onProgress`, if given, is called
 * after every point with the chunk-local count completed so far (P3.40);
 * this function calls it unconditionally on every point -- deciding how
 * often that actually turns into a posted message (the "throttled" part of
 * §5.6's "progress via streamed messages (throttled)") is `worker-pool.ts`'s
 * concern, not this pure computation's.
 */
export function runSweepRange(
  job: SweepJob,
  startIndex: number,
  endIndex: number,
  outRange: Float64Array,
  outApexHeight: Float64Array,
  onProgress?: (completed: number) => void,
): void {
  for (let i = startIndex; i < endIndex; i++) {
    const point = runSweepPoint(job, i);
    const local = i - startIndex;
    outRange[local] = point.range;
    outApexHeight[local] = point.apexHeight;
    onProgress?.(local + 1);
  }
}
