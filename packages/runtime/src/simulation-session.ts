import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import {
  EventCollector,
  HermiteDenseOutputStepper,
  StatsCollector,
  TrajectoryRecorder,
  integrate,
  type EventRoot,
  type SolveFailureReason,
} from "@ballista/solverkit";
import { createPlaybackStore, type PlaybackStore } from "./playback-store.js";
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

function now(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() : Date.now();
}

/**
 * Schedules `callback` to run on the next animation frame, passing it a
 * millisecond timestamp (P3.13 playback clock: unlike {@link FrameScheduler},
 * which drives draft-commit coalescing and needs no timing information, the
 * playback tick loop needs a timestamp each frame to compute elapsed time).
 * Injectable so tests can drive frames with exact, deterministic deltas
 * instead of racing a real `requestAnimationFrame`.
 */
export type AnimationFrameScheduler = (callback: (nowMs: number) => void) => void;

const defaultAnimationFrameScheduler: AnimationFrameScheduler = (callback) => {
  const raf = (globalThis as { requestAnimationFrame?: (cb: (t: number) => void) => number })
    .requestAnimationFrame;
  if (typeof raf === "function") {
    raf(callback);
  } else {
    setTimeout(() => callback(now()), 16);
  }
};

export interface SimulationSessionOptions {
  readonly frameScheduler?: FrameScheduler;
  readonly animationFrameScheduler?: AnimationFrameScheduler;
}

export interface SimulationSession {
  readonly scenario: ScenarioStore;
  readonly result: ResultStore;
  /** Playback clock state (§5.4); mutate only via {@link play}/{@link pause}/{@link scrubTo}/{@link scrubToEvent}. */
  readonly playback: PlaybackStore;
  /**
   * Commits `spec` (§5.3 draft/committed split -- this always updates both
   * `scenario.draft` and `scenario.committed`) and synchronously
   * re-integrates on the main thread (§5.3 "Controller ... runs
   * `integrate`"). On success, publishes the trajectory/stats/events to
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
  /**
   * Starts advancing `playback.playbackTime` once per animation frame at
   * `playback.speed` (§5.3 command surface, P3.13). If already at (or past)
   * the trajectory's end and not looping, restarts from `t=0` first (the
   * natural "replay" affordance for a finished playback). A no-op if
   * already playing, or if no trajectory has been published yet.
   */
  play(): void;
  /** Stops the per-frame advance loop; `playback.playbackTime` holds wherever it was. */
  pause(): void;
  /**
   * Pure lookup, never a solver interaction (§5.3, §5.4 "scrubbing is pure
   * lookup"): sets `playback.playbackTime` to `t`, clamped to
   * `[0, trajectory duration]` (`0` if no trajectory is published).
   */
  scrubTo(t: number): void;
  /**
   * Scrubs exactly to a localized event's own time (P3.13, e.g. an apex
   * tick on the scrub bar) -- equivalent to `scrubTo(root.t)`, but named for
   * callers reading ticks off `result.events` so they never have to
   * destructure `root.t` themselves.
   */
  scrubToEvent(root: EventRoot): void;
}

export function createSimulationSession(
  initialScenario: ScenarioSpec = DEFAULT_SCENARIO,
  presets: readonly ScenarioSpec[] = PRESET_SCENARIOS,
  options: SimulationSessionOptions = {},
): SimulationSession {
  const scenario = createScenarioStore(initialScenario, presets);
  const result = createResultStore();
  const playback = createPlaybackStore();
  const frameScheduler = options.frameScheduler ?? defaultFrameScheduler;
  const animationFrameScheduler = options.animationFrameScheduler ?? defaultAnimationFrameScheduler;

  let pendingDraft: ScenarioSpec | null = null;
  let frameScheduled = false;
  // `undefined` between frames (paused, or the very first playing frame,
  // where there is no previous timestamp to diff against -- that first
  // frame advances by 0s rather than by a spurious huge delta).
  let lastTickMs: number | undefined;

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
    const events = new EventCollector();
    const report = integrate(model, ctx, y0, [0, T_MAX_SECONDS], cfg, stepper, [
      recorder,
      stats,
      events,
    ]);

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

    result.publish(recorder.trajectory, stats.stats, events.events);
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

  /** The published trajectory's final recorded time, or 0 with no trajectory published (yet). */
  function trajectoryDurationSeconds(): number {
    const trajectory = result.getState().trajectory;
    if (!trajectory || trajectory.nSteps === 0) return 0;
    return trajectory.t[trajectory.nSteps - 1]!;
  }

  function clampToDuration(t: number): number {
    if (!Number.isFinite(t) || t < 0) return 0;
    const duration = trajectoryDurationSeconds();
    return t > duration ? duration : t;
  }

  function scrubTo(t: number): void {
    playback.setPlaybackTime(clampToDuration(t));
  }

  function scrubToEvent(root: EventRoot): void {
    scrubTo(root.t);
  }

  /** One playback-clock advance, scheduled once per animation frame while `playback.playing` (P3.13). */
  function tick(nowMs: number): void {
    if (!playback.getState().playing) {
      lastTickMs = undefined;
      return;
    }

    const dtSeconds = lastTickMs === undefined ? 0 : Math.max(0, (nowMs - lastTickMs) / 1000);
    lastTickMs = nowMs;

    const duration = trajectoryDurationSeconds();
    if (duration <= 0) {
      // Nothing to play (no trajectory yet, or a degenerate zero-length one).
      playback.setPlaybackTime(0);
      playback.pause();
      lastTickMs = undefined;
      return;
    }

    const state = playback.getState();
    let next = state.playbackTime + dtSeconds * state.speed;

    if (next >= duration) {
      if (state.loop) {
        next = next % duration;
      } else {
        playback.setPlaybackTime(duration);
        playback.pause();
        lastTickMs = undefined;
        return;
      }
    }

    playback.setPlaybackTime(next);
    animationFrameScheduler(tick);
  }

  function play(): void {
    if (playback.getState().playing) return;

    const duration = trajectoryDurationSeconds();
    const state = playback.getState();
    if (duration > 0 && !state.loop && state.playbackTime >= duration) {
      playback.setPlaybackTime(0);
    }

    lastTickMs = undefined;
    playback.play();
    animationFrameScheduler(tick);
  }

  function pause(): void {
    playback.pause();
    lastTickMs = undefined;
  }

  const session: SimulationSession = {
    scenario,
    result,
    playback,
    commitScenario,
    updateDraft,
    play,
    pause,
    scrubTo,
    scrubToEvent,
  };
  return session;
}
