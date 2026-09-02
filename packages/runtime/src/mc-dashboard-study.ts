/**
 * The one study behind P6.24's Monte Carlo dashboard: an
 * `UncertainScenarioSpec` in, and the four output families the task names --
 * a range column to histogram, a trajectory ensemble fan, a hit probability,
 * and the summary statistics that carry `N` alongside every estimate.
 *
 * **Why this lives in `runtime` and not in `analysis`.** Every piece it
 * assembles is already written and already tested: `mc-job.ts` runs the
 * replicates, `mcStats` reduces them (P6.05/P6.06), `buildEnsembleFan`
 * (P6.10) makes the bands, `hitProbability` (P6.11) scores the impacts.
 * None of them knows what progress or cancellation is, and none of them
 * should. What a dashboard needs is the orchestration around them, which is
 * the concern `sensitivity-study.ts` already owns for P6.20 -- this module is
 * its counterpart for the ensemble half, and follows its shape deliberately:
 * a synchronous function, an optional `onProgress`, a cooperative `signal`,
 * and a cost that is arithmetic rather than an estimate.
 *
 * **The fan is a sub-sample of the same ensemble, not a second study, and
 * that is the load-bearing design decision here.** P6.04's batch retains no
 * trajectories on purpose -- 1e4 of them is hundreds of megabytes -- so a fan,
 * which needs whole trajectories, cannot be built from it. The obvious repair
 * is to run a second, smaller study for the fan; it is also wrong, because two
 * studies are two ensembles and the picture would then show bands drawn from
 * replicates the histogram beside it never saw. Since P6.03 derives replicate
 * `i`'s draw from the study seed and `i` alone, running indices
 * `[0, fanReplicates)` a second time reproduces *those same replicates*
 * exactly. The fan is therefore the first `fanReplicates` members of the very
 * ensemble the histogram summarizes, and `mc-dashboard-study.test.ts` asserts
 * that by checking a retained trajectory's range against the batch's own
 * `range` column rather than by trusting this paragraph.
 *
 * **What it does not do: workers, and streaming.** This is a synchronous
 * reduction that a caller runs wherever it likes -- a test, a worker entry, a
 * batch script. P6.25 is the task that moves it off the UI thread and makes
 * the estimates tighten live; until then a caller on the main thread should
 * keep `replicates` modest, which is why {@link DEFAULT_DASHBOARD_REPLICATES}
 * is 512 rather than the 1e4 P6.04 sized its columns for.
 */

import {
  buildCommonGrid,
  buildEnsembleFan,
  hitProbability,
  mcStats,
  ObservableSink,
  type EnsembleFan,
  type HitProbability,
  type McObservableColumns,
  type McStats,
  type Target,
} from "@ballista/analysis";
import { generateReplicate, type UncertainScenarioSpec } from "@ballista/engine";
import { HermiteDenseOutputStepper, integrate, TrajectoryRecorder } from "@ballista/solverkit";
import type { Trajectory } from "@ballista/solverkit";
import { createMcColumns, MC_T_MAX_SECONDS, mcObservableLayout, runMcReplicate } from "./mc-job.js";
import { resolveModel, resolveSolverConfig, resolveStepper } from "./scenario-resolver.js";

/**
 * Replicates a dashboard study runs when the caller does not say.
 *
 * **Far below the 1e4 P6.04's columns were sized for, and deliberately.**
 * Until P6.25 moves this to a worker it runs on whichever thread called it,
 * and a study that blocks a UI thread for ten seconds is not a dashboard. 512
 * planar replicates put the range standard error at roughly `sigma/22`, which
 * is enough for the histogram to have a shape and for the Wilson interval to
 * be narrow enough to read.
 */
export const DEFAULT_DASHBOARD_REPLICATES = 512;

/**
 * Replicates whose whole trajectory is retained for the fan.
 *
 * The fan's cost is *memory*, not time -- these replicates are integrated
 * either way -- so the bound exists to stop a dashboard holding an unbounded
 * number of full trajectories. 32 is enough for a 5/25/50/75/95 envelope to
 * be a curve rather than a staircase: at 32 samples the 5% band is
 * interpolated between the first and second order statistics, which is the
 * lowest count at which the outer levels are estimated from more than one
 * point.
 */
export const DEFAULT_FAN_REPLICATES = 32;

/** Grid points the fan is sampled on when the caller does not say. */
export const DEFAULT_FAN_GRID_POINTS = 64;

/** Thrown out of a dashboard study whose signal aborted. Carries how far it got. */
export class McDashboardStudyCancelled extends Error {
  /** Replicates completed before the stop, across both stages. */
  readonly completed: number;

  constructor(completed: number) {
    super(`Monte Carlo dashboard study cancelled after ${completed} replicate(s)`);
    this.name = "McDashboardStudyCancelled";
    this.completed = completed;
  }
}

/**
 * Which half of the study a replicate belongs to.
 *
 * `"ensemble"` is the full `N`-replicate batch that produces the columns;
 * `"fan"` re-runs its first {@link McDashboardOptions.fanReplicates} indices
 * with a recorder attached. The stages are reported separately because they
 * cost the same per replicate but produce different things, and a progress
 * bar that merged them would appear to stall at the handover.
 */
export type McDashboardStage = "ensemble" | "fan";

/** One progress report. */
export interface McDashboardProgress {
  readonly stage: McDashboardStage;
  /** Replicates completed across the whole study, both stages. */
  readonly completed: number;
  /** Replicates the whole study will take, known before it starts. */
  readonly total: number;
}

/** Just enough of `AbortSignal` to be cancelled, so a test need not build one. */
export interface McDashboardSignal {
  readonly aborted: boolean;
}

/** The study, and what its impacts are scored against. */
export interface McDashboardStudySpec {
  /** The uncertain scenario (P6.02). Its `replicates` field is `N`. */
  readonly study: UncertainScenarioSpec;
  /**
   * Target the hit probability is scored against (P6.11).
   *
   * Required rather than optional: a dashboard section headed "hit
   * probability" with no target would either have to invent one or render a
   * blank, and inventing a target invents the answer.
   */
  readonly target: Target;
}

/** Knobs. */
export interface McDashboardOptions {
  /** Trajectories retained for the fan. Default {@link DEFAULT_FAN_REPLICATES}. */
  readonly fanReplicates?: number;
  /** Fan grid points. Default {@link DEFAULT_FAN_GRID_POINTS}. */
  readonly fanGridPoints?: number;
  /** Fan levels, ascending in `[0, 1]`. Defaults to `buildEnsembleFan`'s own. */
  readonly fanLevels?: readonly number[];
}

/** Progress and cancellation, kept apart from the knobs as `runSensitivityStudy` does. */
export interface McDashboardCallbacks {
  readonly onProgress?: (progress: McDashboardProgress) => void;
  readonly signal?: McDashboardSignal;
}

/** What a study will cost, per stage and in total, before it starts. */
export interface McDashboardCost {
  /** `N` -- one integration per replicate. */
  readonly ensemble: number;
  /** `fanReplicates` -- the same replicates again, this time recorded. */
  readonly fan: number;
  readonly total: number;
}

/** Everything the dashboard needs from one study. */
export interface McDashboardResult {
  /**
   * The full `N`-replicate columns, in canonical replicate-index order. The
   * histogram is built from `range` by the presentation layer, which is where
   * `@ballista/viz` -- and therefore `buildImpactHistogram` -- is reachable
   * from; `runtime` may not import `viz` without closing a dependency cycle.
   */
  readonly columns: McObservableColumns;
  /** P6.05/P6.06's reduction over the landed subset. */
  readonly stats: McStats;
  /**
   * `P(hit)` with its Wilson interval, over the **landed** replicates only.
   *
   * A replicate that ran out of horizon has a final row but not an impact
   * point, and scoring "wherever it happened to be at 60 s" against the target
   * would be a coin flip dressed as evidence. Excluding them makes this
   * estimate conditional on landing, which is why {@link unlandedCount} is
   * reported beside it rather than left for the reader to infer: at
   * `unlandedCount = 0` -- the case for every study whose flights finish --
   * the conditioning is vacuous and `hit.shots` equals `stats.count`.
   */
  readonly hit: HitProbability;
  /** Replicates that did not reach the ground inside the horizon. */
  readonly unlandedCount: number;
  /** P6.10's quantile envelope over the retained sub-ensemble. */
  readonly fan: EnsembleFan;
  /** Trajectories actually retained -- `min(fanReplicates, N)`. */
  readonly fanReplicates: number;
  /** What the run cost, matching {@link mcDashboardCost} for the same inputs. */
  readonly cost: McDashboardCost;
}

/**
 * What {@link runMcDashboardStudy} will cost for these inputs.
 *
 * Arithmetic, not an estimate: the ensemble stage integrates each of the `N`
 * replicates once and the fan stage integrates the first `fanReplicates` of
 * them once more. A caller can therefore size a progress bar before starting,
 * and the total cannot drift out of step with the loops below without this
 * function changing too.
 */
export function mcDashboardCost(replicates: number, fanReplicates: number): McDashboardCost {
  const fan = Math.min(fanReplicates, replicates);
  return { ensemble: replicates, fan, total: replicates + fan };
}

/**
 * Integrates replicate `index` of `study` with a recorder attached and returns
 * its trajectory.
 *
 * Mirrors `runMcReplicate`'s resolution steps exactly -- same drawn spec, same
 * dense-output promotion, same horizon -- because the fan must describe the
 * same flights the columns summarize. Any divergence here would show up as a
 * fan whose median disagrees with the histogram's centre for reasons no chart
 * could explain.
 */
function recordReplicate(study: UncertainScenarioSpec, index: number): Trajectory {
  const { spec } = generateReplicate(study, index);
  const { model, ctx, y0 } = resolveModel(spec);
  const resolvedStepper = resolveStepper(spec.solver.stepper);
  const stepper = resolvedStepper.interpolant
    ? resolvedStepper
    : new HermiteDenseOutputStepper(resolvedStepper);
  const cfg = resolveSolverConfig(spec);

  const recorder = new TrajectoryRecorder();
  integrate(model, ctx, y0, [0, MC_T_MAX_SECONDS], cfg, stepper, [recorder]);
  return recorder.trajectory;
}

/**
 * Runs one dashboard study.
 *
 * @throws {McDashboardStudyCancelled} If the signal aborts mid-run.
 * @throws RangeError via `hitProbability` if no replicate landed -- an
 *   ensemble with nothing in it cannot be scored, and reporting `p̂ = 0` for
 *   "we never found out" would be a fabricated answer rather than an absent
 *   one.
 */
export function runMcDashboardStudy(
  spec: McDashboardStudySpec,
  options: McDashboardOptions = {},
  callbacks: McDashboardCallbacks = {},
): McDashboardResult {
  const { study, target } = spec;
  const replicates = study.replicates;
  const requestedFan = options.fanReplicates ?? DEFAULT_FAN_REPLICATES;
  if (!Number.isInteger(requestedFan) || requestedFan < 2) {
    throw new RangeError(
      `fanReplicates must be an integer >= 2, got ${requestedFan}; a fan over fewer ` +
        "replicates than that has no quantiles to speak of",
    );
  }
  const gridPoints = options.fanGridPoints ?? DEFAULT_FAN_GRID_POINTS;
  const cost = mcDashboardCost(replicates, requestedFan);
  const { onProgress, signal } = callbacks;

  const layout = mcObservableLayout(study.base);
  const verticalAxis = layout.vertical;

  let completed = 0;
  const report = (stage: McDashboardStage): void => {
    completed += 1;
    onProgress?.({ stage, completed, total: cost.total });
  };
  const checkSignal = (): void => {
    if (signal?.aborted === true) throw new McDashboardStudyCancelled(completed);
  };

  // --- stage 1: the ensemble ------------------------------------------- //
  //
  // A sink built here rather than left to runMcReplicate, because this loop
  // reads `impactPoint` off it after every call. That observable is not in
  // McColumns -- P6.04 keeps four scalars and a flag -- and adding it there
  // would change a data contract three other consumers already depend on, for
  // one caller's benefit. Reading the sink we own costs nothing and changes
  // nothing.
  const sink = new ObservableSink(layout);
  const columns = createMcColumns(replicates);
  const landedImpacts: number[][] = [];

  for (let i = 0; i < replicates; i += 1) {
    checkSignal();
    const result = runMcReplicate({ study }, i, sink);
    columns.range[i] = result.range;
    columns.apexHeight[i] = result.apexHeight;
    columns.timeOfFlight[i] = result.timeOfFlight;
    columns.impactSpeed[i] = result.impactSpeed;
    columns.landed[i] = result.landed ? 1 : 0;
    if (result.landed) landedImpacts.push([...sink.observables.impactPoint]);
    report("ensemble");
  }

  const stats = mcStats(columns);
  const unlandedCount = stats.count - stats.landedCount;
  const hit = hitProbability(landedImpacts, target, { layout });

  // --- stage 2: the fan ------------------------------------------------ //
  const fanReplicates = cost.fan;
  const trajectories: Trajectory[] = [];
  for (let i = 0; i < fanReplicates; i += 1) {
    checkSignal();
    trajectories.push(recordReplicate(study, i));
    report("fan");
  }

  const grid = buildCommonGrid(trajectories, gridPoints);
  const fan = buildEnsembleFan(trajectories, grid, {
    // Height against time, with the vertical velocity as its derivative so the
    // resampling is cubic Hermite rather than linear -- the same interpolant
    // the solve itself carried. `resampleOnGrid` refuses to guess this, and it
    // is right to: a wrong derivative channel draws a smooth curve that is not
    // the solution.
    valueChannel: layout.position[verticalAxis] as number,
    derivativeChannel: layout.velocity[verticalAxis] as number,
    ...(options.fanLevels === undefined ? {} : { levels: options.fanLevels }),
  });

  return {
    columns,
    stats,
    hit,
    unlandedCount,
    fan,
    fanReplicates,
    cost,
  };
}
