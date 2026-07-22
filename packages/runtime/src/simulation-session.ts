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

/**
 * Schedules `callback` to run on the next animation frame (§5.3
 * draft/committed split: "commits ... are scheduled per animation frame").
 * Injectable so tests can drive frame boundaries deterministically instead
 * of racing a real `requestAnimationFrame`/timer.
 */
export type FrameScheduler = (callback: () => void) => void;

const defaultFrameScheduler: FrameScheduler = (callback) => {
  // `lib: ["ES2022"]` (no "dom") means `requestAnimationFrame` isn't a known
  // global here even in a browser bundle; probe it dynamically instead.
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number })
    .requestAnimationFrame;
  if (typeof raf === "function") {
    raf(callback);
  } else {
    // Non-browser main-thread fallback (§5.6 places SimulationSession on the
    // main thread, but SSR/tooling contexts have no rAF); ~1 frame at 60 Hz.
    setTimeout(callback, 16);
  }
};

export interface SimulationSessionOptions {
  readonly frameScheduler?: FrameScheduler;
}

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
  /**
   * Mutates `scenario.draft` immediately (input rate -- e.g. a slider drag)
   * without re-integrating. At most one commit is scheduled per animation
   * frame; repeated calls before that frame fires only move which spec it
   * commits ("latest-wins coalescing", §5.3), so N rapid calls within a
   * frame produce a single `commitScenario`/solve.
   */
  updateDraft(spec: ScenarioSpec): void;
}

export function createSimulationSession(
  initialScenario: ScenarioSpec = DEFAULT_SCENARIO,
  presets: readonly ScenarioSpec[] = PRESET_SCENARIOS,
  options: SimulationSessionOptions = {},
): SimulationSession {
  const scenario = createScenarioStore(initialScenario, presets);
  const result = createResultStore();
  const frameScheduler = options.frameScheduler ?? defaultFrameScheduler;

  let pendingDraft: ScenarioSpec | null = null;
  let frameScheduled = false;

  function commitScenario(spec: ScenarioSpec): CommitOutcome {
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
  }

  function updateDraft(spec: ScenarioSpec): void {
    scenario.setDraft(spec);
    pendingDraft = spec;

    if (frameScheduled) return;
    frameScheduled = true;
    frameScheduler(() => {
      frameScheduled = false;
      const toCommit = pendingDraft;
      pendingDraft = null;
      if (toCommit) session.commitScenario(toCommit);
    });
  }

  const session: SimulationSession = { scenario, result, commitScenario, updateDraft };
  return session;
}
