import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import {
  HermiteDenseOutputStepper,
  StatsCollector,
  TrajectoryRecorder,
  integrate,
  type SolveFailureReason,
} from "@ballista/solverkit";
import { createResultStore, type ResultStore } from "./result-store.js";
import { resolveModel, resolveSolverConfig, resolveStepper } from "./scenario-resolver.js";
import { createScenarioStore, type ScenarioStore } from "./scenario-store.js";

/** The scenario a fresh `SimulationSession` starts committed to, absent an explicit choice. */
export const DEFAULT_SCENARIO: ScenarioSpec = PRESET_SCENARIOS[0]!;

/**
 * v1 upper bound on the integration horizon. `resolveModel`'s
 * `planarProjectileModel` always declares a terminal ground-impact event,
 * so every physically sane scenario (launched above the ground, gravity
 * pulling it back down) ends there long before this -- it exists purely as
 * a backstop against a scenario that never returns to y=0 (e.g. a
 * horizontal shot from y0 <= 0), where `cfg.maxSteps` would otherwise be
 * the only thing standing between a commit and a hung main thread.
 */
const T_MAX_SECONDS = 60;

export type CommitOutcome =
  | { readonly status: "ok" }
  | { readonly status: "failed"; readonly reason: SolveFailureReason; readonly message: string };

export interface SimulationSession {
  readonly scenario: ScenarioStore;
  readonly result: ResultStore;
  /**
   * Commits `spec` (§5.3 draft/committed split -- this always updates both
   * `scenario.draft` and `scenario.committed`) and synchronously
   * re-integrates on the main thread (§5.3 "Controller ... runs
   * `integrate`"). On success, publishes the trajectory/stats to
   * `result` and returns `{status: "ok"}`; on failure, `result` is left
   * unpublished (whatever it held before this call) and the failure is
   * returned for the caller to surface.
   */
  commitScenario(spec: ScenarioSpec): CommitOutcome;
}

export function createSimulationSession(
  initialScenario: ScenarioSpec = DEFAULT_SCENARIO,
  presets: readonly ScenarioSpec[] = PRESET_SCENARIOS,
): SimulationSession {
  const scenario = createScenarioStore(initialScenario, presets);
  const result = createResultStore();

  return {
    scenario,
    result,
    commitScenario(spec) {
      scenario.commit(spec);

      const { model, ctx, y0 } = resolveModel(spec);
      const resolvedStepper = resolveStepper(spec.solver.stepper);
      // Every v1 stepper is fixed/embedded-explicit (see scenario-resolver.ts);
      // none carries its own dense-output interpolant except dopri5, so
      // anything else needs this decorator to support the terminal
      // ground-impact event truncation above.
      const stepper = resolvedStepper.interpolant
        ? resolvedStepper
        : new HermiteDenseOutputStepper(resolvedStepper);
      const cfg = resolveSolverConfig(spec);

      const recorder = new TrajectoryRecorder();
      const stats = new StatsCollector();
      const report = integrate(model, ctx, y0, [0, T_MAX_SECONDS], cfg, stepper, [recorder, stats]);

      if (report.status !== "ok") {
        // commitScenario never passes integrate() a cancellation token, so
        // "canceled" (and thus a missing `failure`) shouldn't occur in
        // practice; the fallback below is a defensive backstop, not a path
        // this session actually exercises.
        return {
          status: "failed",
          reason: report.failure?.reason ?? "max-steps-exceeded",
          message:
            report.failure?.message ??
            `solve ended with status "${report.status}" and no failure detail`,
        };
      }

      result.publish(recorder.trajectory, stats.stats);
      return { status: "ok" };
    },
  };
}
