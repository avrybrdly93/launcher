/**
 * Optimize job (§5.6 Concurrency Architecture, "Job types: `sweep`,
 * `mc`, `convergence`, `optimize`"; P5.18). An optimize job runs the P5.06
 * Newton shooting solver against a target and streams each iteration out as
 * it happens.
 *
 * **Why this is a job type and not just a function call.** A shooting solve
 * integrates a full trajectory per residual evaluation, and the Jacobian
 * costs two more per iteration — on the library exhibits that is tens of
 * integrations for one answer, all of it synchronous. Run on the main thread
 * it freezes the frame; run in a worker with only a final result, the UI has
 * nothing to show for several hundred milliseconds. Streaming the iterations
 * is what makes the wait legible, and it is also the whole content of the
 * convergence trace P5.19 plots.
 *
 * Deliberately framework/DOM-free, exactly like `sweep-job.ts`:
 * {@link runOptimizeJob} is an ordinary function, callable from a unit test,
 * from `optimize-worker-entry.ts` inside a real Worker, or from a batch
 * runner. `worker-pool.ts` is the only module that knows about postMessage.
 *
 * **Everything crossing the wire is plain data.** A
 * {@link ShootingProblem} holds a `Model`, an `EvalContext`, a
 * `SolverConfig` and a `Stepper` — live objects with methods, none of them
 * structured-cloneable. So an {@link OptimizeJob} carries a `ScenarioSpec`
 * and the worker resolves it locally through the same
 * `resolveModel`/`resolveStepper`/`resolveSolverConfig` path `runSweepPoint`
 * uses. The same constraint is why {@link OptimizeSolverOptions} re-declares
 * the numeric subset of `NewtonShootingOptions` instead of accepting it
 * whole: that interface also carries `projection`, a function, which would
 * throw a `DataCloneError` at `postMessage` rather than fail to typecheck.
 */

import {
  type Aim,
  type NewtonShootingResult,
  type NewtonShootingStep,
  type Target,
  createShootingResidual,
  newtonShooting,
} from "@ballista/analysis";
import type { ScenarioSpec } from "@ballista/engine";
import { HermiteDenseOutputStepper } from "@ballista/solverkit";
import { resolveModel, resolveSolverConfig, resolveStepper } from "./scenario-resolver.js";

/** Upper bound on one residual evaluation's integration horizon (mirrors `sweep-job.ts`'s `SWEEP_T_MAX_SECONDS`). */
const OPTIMIZE_T_MAX_SECONDS = 60;

/**
 * The structured-cloneable subset of `NewtonShootingOptions` — the numeric
 * tuning knobs, and nothing that is a function. See the module docs.
 */
export interface OptimizeSolverOptions {
  readonly residualTolerance?: number;
  readonly maxIterations?: number;
  readonly rankTolerance?: number;
  readonly armijoC?: number;
  readonly backtrackFactor?: number;
  readonly maxBacktracks?: number;
  readonly stepTolerance?: number;
  readonly thetaScale?: number;
  readonly speedScale?: number;
}

/** A Newton shooting solve against `target`, over `baseScenario`'s dynamics. */
export interface OptimizeJob {
  /**
   * Everything except the aim. `initialConditions.vx0`/`vy0` are ignored —
   * the aim supplies the launch velocity, and `initialAim` is where the
   * iteration starts — while `x0`/`y0` set the launch point and every other
   * field (forces, environment, projectile, solver) is held fixed.
   */
  readonly baseScenario: ScenarioSpec;
  readonly target: Target;
  readonly initialAim: Aim;
  readonly solver?: OptimizeSolverOptions;
}

/**
 * One streamed iteration. This is a {@link NewtonShootingStep} plus the aim
 * the step arrived at, because a trace that plots `‖F‖` against iteration
 * (P5.19) needs the merit and a trace that draws the iterates on the
 * `(θ, v₀)` plane (P5.20) needs the aim, and the step alone carries only the
 * first.
 */
export interface OptimizeIteration {
  readonly step: NewtonShootingStep;
  /**
   * The iterate this step ended at — the aim the next iteration starts from,
   * and for the final iteration the solve's answer.
   *
   * On a step that was *not* accepted (`step.alpha === 0`, the blocked and
   * line-search-failed terminal paths) the iterate did not move, so this
   * repeats the previous one. That matches `step.nextMerit === step.merit` on
   * exactly those steps.
   */
  readonly aim: Aim;
}

/** What a completed optimize job produced. */
export interface OptimizeJobResult {
  readonly converged: boolean;
  readonly status: NewtonShootingResult["status"];
  readonly aim: Aim;
  readonly merit: number;
  readonly iterations: number;
  readonly evaluations: number;
  readonly failure?: string;
}

/**
 * Builds the residual function for `job` by resolving its scenario the same
 * way a sweep point does, and pointing it at `job.target`.
 *
 * The stepper is wrapped in a `HermiteDenseOutputStepper` when it has no
 * interpolant of its own — `createShootingResidual` *requires* dense output
 * (it localizes the ground-impact terminal event, and the residual is the
 * impact point) and throws at construction otherwise. `runSweepPoint` does
 * the same wrap for the same reason.
 */
export function createOptimizeResidual(
  job: OptimizeJob,
): ReturnType<typeof createShootingResidual> {
  const { model, ctx } = resolveModel(job.baseScenario);
  const resolved = resolveStepper(job.baseScenario.solver.stepper);
  const stepper = resolved.interpolant ? resolved : new HermiteDenseOutputStepper(resolved);
  const { x0, y0 } = job.baseScenario.initialConditions;
  return createShootingResidual({
    model,
    ctx,
    target: job.target,
    launchPoint: [x0, y0],
    tspan: [0, OPTIMIZE_T_MAX_SECONDS],
    config: resolveSolverConfig(job.baseScenario),
    stepper,
  });
}

/**
 * Runs `job` to completion, calling `onIteration` once per Newton iteration
 * as it happens (not batched at the end).
 *
 * **The iterate is recovered here, because `NewtonShootingStep` does not
 * carry one.** The step records `merit` (before) and `nextMerit` (after) but
 * no aim. The recovery below rests on two facts about the solver's control
 * flow, both load-bearing enough to state: a step is recorded *immediately*
 * after the line search accepts a trial, with no intervening residual
 * evaluation, so the last aim evaluated is the accepted one; and `alpha` is
 * zero on exactly the two paths that record a step without accepting
 * anything, where the iterate has not moved. `optimize-job.test.ts` pins both
 * directions against `newtonShooting`'s own returned `aim`.
 */
export function runOptimizeJob(
  job: OptimizeJob,
  onIteration?: (iteration: OptimizeIteration) => void,
): OptimizeJobResult {
  const residual = createOptimizeResidual(job);

  let lastEvaluatedAim: Aim = job.initialAim;
  const tracked = (aim: Aim): ReturnType<typeof residual> => {
    lastEvaluatedAim = aim;
    return residual(aim);
  };

  // The iterate, as opposed to whatever trial the line search last probed.
  let iterateAim: Aim = job.initialAim;

  const result = newtonShooting(tracked, job.initialAim, {
    ...job.solver,
    onIteration: (step: NewtonShootingStep) => {
      // alpha > 0 means the line search accepted a trial, and that trial is
      // the most recent evaluation. alpha === 0 means it did not, so the
      // iterate stands and the last evaluation was a *rejected* aim, which
      // reporting here would be simply wrong.
      if (step.alpha > 0) iterateAim = lastEvaluatedAim;
      onIteration?.({ step, aim: iterateAim });
    },
  });

  return {
    converged: result.converged,
    status: result.status,
    aim: result.aim,
    merit: result.merit,
    iterations: result.iterations,
    evaluations: result.evaluations,
    ...(result.failure === undefined ? {} : { failure: result.failure }),
  };
}
