import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import {
  bestOfMs,
  isIdleEnoughForWallClock,
  measureCalibrationMs,
  type EventRoot,
} from "@ballista/solverkit";
import {
  createSimulationSession,
  DEFAULT_SCENARIO,
  type AnimationFrameScheduler,
  type FrameScheduler,
  type ReducedMotionQuery,
} from "./simulation-session.js";

/** Untimed runs first, so JIT compile and inline-cache effects stay out of the number. */
const COMMIT_WARMUPS = 5;

/** Timed runs to take the minimum over; the minimum is the least-preempted sample. */
const COMMIT_TRIALS = 9;

/**
 * MEASURED, NOT GUESSED, and the first guess was wrong by a factor of eight.
 * Three runs on the development container gave ratios of 0.188, 0.190 and
 * 0.201 -- a default-scenario commit costs ~0.13 ms against a calibration of
 * ~0.62-0.68 ms. The limit of 1 is therefore ~5x the worst observation.
 *
 * The first draft of this constant was 8, reasoned from an assumption that a
 * commit costs a bit more than one calibration. It costs a fifth of one, so 8
 * would have been ~40x the real figure: an assertion that cannot fail is not
 * a weaker check than a flaky one, it is no check at all. The number is in
 * the file because it was printed, not because it was plausible.
 *
 * WHAT IT CATCHES AND WHAT IT DOES NOT. At 5x headroom this fires on a gross
 * per-commit regression and not on a modest one; the raw 16 ms check below --
 * which has ~120x headroom at the current cost -- is looser still in absolute
 * terms, so on an idle machine the ratio is the tighter of the two. Neither
 * detects a 20% regression. That is the trade P0.96 makes knowingly: the
 * assertion this replaces could not detect one either, because it was a
 * single wall-clock sample and its failures were scheduler noise.
 */
const MAX_COMMIT_COST_IN_CALIBRATIONS = 1;

/** `planarProjectileModel`'s `[x, y, vx, vy]` state layout (see planar-projectile-model.ts). */
const VY_CHANNEL = 3;

describe("SimulationSession", () => {
  it("starts with the default scenario committed and no result published", () => {
    const session = createSimulationSession();
    expect(session.scenario.getState().committed).toBe(DEFAULT_SCENARIO);
    expect(session.scenario.getState().draft).toBe(DEFAULT_SCENARIO);
    expect(session.result.getState().trajectory).toBeNull();
  });

  it("commitScenario updates the scenario store and publishes a trajectory + stats for every preset", () => {
    for (const spec of PRESET_SCENARIOS) {
      const session = createSimulationSession();
      const outcome = session.commitScenario(spec);

      expect(outcome.status).toBe("ok");
      expect(session.scenario.getState().committed).toBe(spec);
      expect(session.scenario.getState().draft).toBe(spec);

      const result = session.result.getState();
      expect(result.trajectory).not.toBeNull();
      expect(result.trajectory!.nSteps).toBeGreaterThan(0);
      expect(result.stats).not.toBeNull();
      expect(result.stats!.nSteps).toBeGreaterThan(0);
    }
  });

  it("terminates at ground impact rather than running to the T_MAX_SECONDS backstop, for an ordinary launch", () => {
    const session = createSimulationSession();
    session.commitScenario(DEFAULT_SCENARIO);
    const trajectory = session.result.getState().trajectory!;
    const finalY = trajectory.channels[1]![trajectory.nSteps - 1]!;
    // ground-impact event is y - h(x) = 0 (flat terrain: h == 0); a small
    // tolerance covers the event root-localization accuracy, not exactness.
    expect(Math.abs(finalY)).toBeLessThan(1e-6);
    const finalT = trajectory.t[trajectory.nSteps - 1]!;
    expect(finalT).toBeLessThan(60);
  });

  it("does not publish a result when the committed spec fails to integrate", () => {
    const session = createSimulationSession();
    session.commitScenario(DEFAULT_SCENARIO);
    const publishedBefore = session.result.getState();

    const brokenSpec: ScenarioSpec = {
      ...DEFAULT_SCENARIO,
      solver: { stepper: "classical-rk4", h: 0.01, maxSteps: 2 }, // far too few steps to reach ground impact
    };
    const outcome = session.commitScenario(brokenSpec);

    expect(outcome.status).toBe("failed");
    // scenario store still reflects the attempted commit (§5.3: commit is unconditional)...
    expect(session.scenario.getState().committed).toBe(brokenSpec);
    // ...but the previously published result is untouched.
    expect(session.result.getState()).toBe(publishedBefore);
  });

  it("a forced h_min underflow fails with the last-good (t, y) state attached (P3.38 validation criterion)", () => {
    const session = createSimulationSession();
    // h < hMin means the very first proposed fixed step already underflows,
    // so the last-good state is exactly the initial condition.
    const underflowSpec: ScenarioSpec = {
      ...DEFAULT_SCENARIO,
      solver: { stepper: "classical-rk4", h: 0.001, hMin: 0.01, maxSteps: 1000 },
    };
    const outcome = session.commitScenario(underflowSpec);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    expect(outcome.reason).toBe("step-size-underflow");
    expect(outcome.t).toBe(0);
    expect(outcome.y[0]).toBe(underflowSpec.initialConditions.x0);
    expect(outcome.y[1]).toBe(underflowSpec.initialConditions.y0);
  });

  it("slider -> result round trip stays inside the 16 ms frame budget in units of the machine's own speed (perf, P3.03 validation criterion)", () => {
    const session = createSimulationSession();

    // WHY THIS IS NOT ONE `performance.now()` PAIR ANY MORE (P0.96). It was:
    // one warm-up, then a single timed `commitScenario` asserted against a
    // raw 16 ms. A single sample is the most load-sensitive form there is --
    // one descheduled timeslice inside a vitest pool running 346 files fails
    // it with nothing having regressed, and the failure then attaches itself
    // to whatever landed alongside it. That is the same defect P0.123 fixed
    // one package over, and the fix is the same: express the budget as a
    // ratio against a calibration taken in this process moments earlier.
    // Contention stretches both halves and leaves the ratio alone; a slower
    // solve stretches only the numerator.
    let outcome: ReturnType<typeof session.commitScenario> | null = null;
    const bestMs = bestOfMs(
      () => {
        outcome = session.commitScenario(DEFAULT_SCENARIO);
      },
      COMMIT_TRIALS,
      COMMIT_WARMUPS,
    );

    // A timing run that did not solve anything would be a fast lie.
    expect(outcome).not.toBeNull();
    expect(outcome!.status).toBe("ok");

    const calibrationMs = measureCalibrationMs();

    // THE LOAD-INVARIANT ASSERTION, and the one that carries the criterion on
    // every machine. See MAX_COMMIT_COST_IN_CALIBRATIONS for where the limit
    // comes from.
    const commitCostInCalibrations = bestMs / calibrationMs;
    // AUDITED BY P0.148 AND KEPT AS IT STANDS. The pairing is a minimum over a
    // minimum, which the filing hoped was symmetric for being two minima;
    // P0.148 measured that what actually matters is whether both sit below
    // the minimum's own preemption boundary, between 3.2 ms and 9.5 ms on
    // this container. Both do, with room to spare: `bestMs` measured 0.145 ms
    // idle and 0.141 ms under 8-way sustained load (0.97x) against a
    // calibration flat at 0.603-0.606 ms, so the ratio moved 0.240 -> 0.234
    // against a limit of 1. See packages/viz/src/impact-scatter.test.ts for
    // the full argument and the caveat: the invariance comes from neither
    // half moving under load, not from contention cancelling, so a numerator
    // that grows past ~3 ms breaks it silently.
    expect(commitCostInCalibrations).toBeLessThan(MAX_COMMIT_COST_IN_CALIBRATIONS);

    // THE BLUEPRINT FIGURE, KEPT AT 16 ms AND CHECKED WHERE IT MEANS
    // SOMETHING. 16 ms is P3.03's own literal validation criterion, so it is
    // neither raised nor deleted -- it is a statement about one animation
    // frame on a machine actually free to run.
    //
    // The gate keys on the CALIBRATION, never on the measurement it guards,
    // so code that got slower cannot cause its own check to be skipped.
    if (isIdleEnoughForWallClock(calibrationMs)) {
      expect(bestMs).toBeLessThan(16);
    } else {
      // Say so rather than passing silently: a skipped check that leaves no
      // trace is indistinguishable from one that never existed.
      console.log(
        `[P0.96] raw 16 ms round-trip check skipped: calibration ${calibrationMs.toFixed(3)} ms ` +
          `exceeds the idle ceiling, so this machine is too busy or too slow for the frame ` +
          `budget to measure the code. The load-invariant ratio assertion ran and passed at ` +
          `${commitCostInCalibrations.toFixed(3)} (limit ${MAX_COMMIT_COST_IN_CALIBRATIONS}); ` +
          `best of ${COMMIT_TRIALS} was ${bestMs.toFixed(3)} ms.`,
      );
    }
  });

  it("coalesces 100 rapid updateDraft calls within a frame into a single commit/solve (P3.04 validation criterion)", () => {
    let scheduledFrame: (() => void) | null = null;
    const frameScheduler: FrameScheduler = (callback) => {
      scheduledFrame = callback;
    };
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, { frameScheduler });
    const commitSpy = vi.spyOn(session, "commitScenario");

    for (let i = 0; i < 100; i++) {
      session.updateDraft({
        ...DEFAULT_SCENARIO,
        initialConditions: { ...DEFAULT_SCENARIO.initialConditions, vx0: 10 + i },
      });
    }

    // draft updates take effect immediately, at input rate...
    expect(session.scenario.getState().draft.initialConditions.vx0).toBe(109);
    // ...but no commit/solve has run yet, and only one frame was scheduled.
    expect(commitSpy).not.toHaveBeenCalled();
    expect(scheduledFrame).not.toBeNull();

    scheduledFrame!();

    // exactly one solve for all 100 rapid events, and it's the latest draft (latest-wins coalescing).
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(session.scenario.getState().committed.initialConditions.vx0).toBe(109);
    expect(session.result.getState().trajectory).not.toBeNull();
  });

  it("schedules only one frame across many updateDraft calls, and commits nothing if the frame fires with no pending draft", () => {
    const frameCallbacks: Array<() => void> = [];
    const frameScheduler: FrameScheduler = (callback) => {
      frameCallbacks.push(callback);
    };
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, { frameScheduler });
    const commitSpy = vi.spyOn(session, "commitScenario");

    session.updateDraft(DEFAULT_SCENARIO);
    session.updateDraft(DEFAULT_SCENARIO);
    expect(frameCallbacks).toHaveLength(1);

    frameCallbacks[0]!();
    expect(commitSpy).toHaveBeenCalledTimes(1);

    // firing a stale/second frame callback (e.g. a scheduler quirk) with no
    // new pending draft must not re-solve.
    frameCallbacks[0]!();
    expect(commitSpy).toHaveBeenCalledTimes(1);

    // a fresh updateDraft after the frame fired schedules a new frame.
    session.updateDraft(DEFAULT_SCENARIO);
    expect(frameCallbacks).toHaveLength(2);
  });
});

describe("SimulationSession: events (P3.13, §5.4 scrub-bar event ticks)", () => {
  it("commitScenario publishes the apex as a non-terminal event, localized to v_y~=0", () => {
    const session = createSimulationSession();
    session.commitScenario(DEFAULT_SCENARIO);

    const { events } = session.result.getState();
    const apexEvents = events.filter((e) => e.event.name === "apex");
    expect(apexEvents).toHaveLength(1);
    expect(Math.abs(apexEvents[0]!.y[VY_CHANNEL]!)).toBeLessThan(1e-6);

    // Ground impact (terminal) never appears in `events` -- it's the
    // trajectory's own final row.
    expect(events.some((e) => e.event.name === "ground-impact")).toBe(false);
  });

  it("a fresh session with no committed scenario publishes no events", () => {
    const session = createSimulationSession();
    expect(session.result.getState().events).toEqual([]);
  });
});

describe("SimulationSession: playback clock (P3.13)", () => {
  it("scrubToEvent lands playback exactly at the apex tick's time, whose state has v_y~=0 (this task's validation criterion)", () => {
    const session = createSimulationSession();
    session.commitScenario(DEFAULT_SCENARIO);

    const apex = session.result.getState().events.find((e) => e.event.name === "apex")!;
    expect(apex).toBeDefined();

    session.scrubToEvent(apex);

    expect(session.playback.getState().playbackTime).toBe(apex.t);
    expect(Math.abs(apex.y[VY_CHANNEL]!)).toBeLessThan(1e-6);
  });

  it("scrubTo clamps to [0, trajectory duration]", () => {
    const session = createSimulationSession();
    session.commitScenario(DEFAULT_SCENARIO);
    const duration = session.result.getState().trajectory!.t.at(-1)!;

    session.scrubTo(-5);
    expect(session.playback.getState().playbackTime).toBe(0);

    session.scrubTo(duration + 1000);
    expect(session.playback.getState().playbackTime).toBe(duration);

    session.scrubTo(duration / 2);
    expect(session.playback.getState().playbackTime).toBe(duration / 2);
  });

  it("scrubTo clamps to 0 when no trajectory has been published yet", () => {
    const session = createSimulationSession();
    session.scrubTo(5);
    expect(session.playback.getState().playbackTime).toBe(0);
  });

  it("play() advances playbackTime once per animation frame, scaled by dt and speed", () => {
    let scheduledTick: ((nowMs: number) => void) | null = null;
    const animationFrameScheduler: AnimationFrameScheduler = (cb) => {
      scheduledTick = cb;
    };
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, {
      animationFrameScheduler,
    });
    session.commitScenario(DEFAULT_SCENARIO);
    session.playback.setSpeed(2);

    session.play();
    expect(session.playback.getState().playing).toBe(true);
    expect(scheduledTick).not.toBeNull();

    // First frame establishes the baseline timestamp; no elapsed time yet.
    scheduledTick!(1000);
    expect(session.playback.getState().playbackTime).toBe(0);

    // 250ms later, at 2x speed: 0.25s * 2 = 0.5s advanced.
    scheduledTick!(1250);
    expect(session.playback.getState().playbackTime).toBeCloseTo(0.5, 10);

    // Another 250ms: another 0.5s.
    scheduledTick!(1500);
    expect(session.playback.getState().playbackTime).toBeCloseTo(1.0, 10);
  });

  it("pause() stops the clock; a stray already-scheduled tick after pause is a no-op", () => {
    let scheduledTick: ((nowMs: number) => void) | null = null;
    const animationFrameScheduler: AnimationFrameScheduler = (cb) => {
      scheduledTick = cb;
    };
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, {
      animationFrameScheduler,
    });
    session.commitScenario(DEFAULT_SCENARIO);

    session.play();
    scheduledTick!(0);
    scheduledTick!(500);
    const timeAtPause = session.playback.getState().playbackTime;
    expect(timeAtPause).toBeGreaterThan(0);

    const staleTick = scheduledTick!;
    session.pause();
    expect(session.playback.getState().playing).toBe(false);

    staleTick(1000);
    expect(session.playback.getState().playbackTime).toBe(timeAtPause);
  });

  it("stops and clamps to the end without looping by default", () => {
    let scheduledTick: ((nowMs: number) => void) | null = null;
    const animationFrameScheduler: AnimationFrameScheduler = (cb) => {
      scheduledTick = cb;
    };
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, {
      animationFrameScheduler,
    });
    session.commitScenario(DEFAULT_SCENARIO);
    const duration = session.result.getState().trajectory!.t.at(-1)!;

    session.play();
    scheduledTick!(0);
    // One giant frame that overshoots the whole trajectory.
    scheduledTick!((duration + 10) * 1000);

    expect(session.playback.getState().playbackTime).toBe(duration);
    expect(session.playback.getState().playing).toBe(false);
  });

  it("wraps around instead of stopping when loop is enabled", () => {
    let scheduledTick: ((nowMs: number) => void) | null = null;
    const animationFrameScheduler: AnimationFrameScheduler = (cb) => {
      scheduledTick = cb;
    };
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, {
      animationFrameScheduler,
    });
    session.commitScenario(DEFAULT_SCENARIO);
    const duration = session.result.getState().trajectory!.t.at(-1)!;
    session.playback.setLoop(true);

    session.play();
    scheduledTick!(0);
    // Advance 3/4 of the way through, then another 1/2 of a duration --
    // total 1.25 durations, which should wrap to 0.25 * duration.
    scheduledTick!(duration * 0.75 * 1000);
    scheduledTick!((duration * 0.75 + duration * 0.5) * 1000);

    expect(session.playback.getState().playing).toBe(true);
    expect(session.playback.getState().playbackTime).toBeCloseTo(duration * 0.25, 6);
  });

  it("play() restarts from 0 when called again after reaching the end (not looping)", () => {
    let scheduledTick: ((nowMs: number) => void) | null = null;
    const animationFrameScheduler: AnimationFrameScheduler = (cb) => {
      scheduledTick = cb;
    };
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, {
      animationFrameScheduler,
    });
    session.commitScenario(DEFAULT_SCENARIO);
    const duration = session.result.getState().trajectory!.t.at(-1)!;

    session.play();
    scheduledTick!(0);
    scheduledTick!((duration + 10) * 1000);
    expect(session.playback.getState().playbackTime).toBe(duration);
    expect(session.playback.getState().playing).toBe(false);

    session.play();
    expect(session.playback.getState().playbackTime).toBe(0);
    expect(session.playback.getState().playing).toBe(true);
  });

  it("play() is a no-op if already playing", () => {
    let scheduleCount = 0;
    const animationFrameScheduler: AnimationFrameScheduler = () => {
      scheduleCount++;
    };
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, {
      animationFrameScheduler,
    });
    session.commitScenario(DEFAULT_SCENARIO);

    session.play();
    expect(scheduleCount).toBe(1);
    session.play();
    expect(scheduleCount).toBe(1);
  });

  it("uses scrubToEvent as a thin wrapper naming exactly scrubTo(root.t)", () => {
    const session = createSimulationSession();
    session.commitScenario(DEFAULT_SCENARIO);
    const root: EventRoot = session.result.getState().events[0]!;

    session.scrubToEvent(root);
    const viaEvent = session.playback.getState().playbackTime;

    session.scrubTo(0);
    session.scrubTo(root.t);
    expect(session.playback.getState().playbackTime).toBe(viaEvent);
  });
});

describe("SimulationSession: prefers-reduced-motion disables auto-play/animation (P3.35 validation criterion, emulated media query)", () => {
  it("with reduced motion preferred, play() never schedules the animation loop and jumps straight to the end", () => {
    let scheduleCount = 0;
    const animationFrameScheduler: AnimationFrameScheduler = () => {
      scheduleCount++;
    };
    const reducedMotionQuery: ReducedMotionQuery = () => true;
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, {
      animationFrameScheduler,
      reducedMotionQuery,
    });
    session.commitScenario(DEFAULT_SCENARIO);
    const duration = session.result.getState().trajectory!.t.at(-1)!;

    session.play();

    expect(scheduleCount).toBe(0);
    expect(session.playback.getState().playing).toBe(false);
    expect(session.playback.getState().playbackTime).toBe(duration);
  });

  it("with reduced motion NOT preferred (the default), play() behaves exactly as before -- schedules the animation loop", () => {
    let scheduleCount = 0;
    const animationFrameScheduler: AnimationFrameScheduler = () => {
      scheduleCount++;
    };
    const reducedMotionQuery: ReducedMotionQuery = () => false;
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, {
      animationFrameScheduler,
      reducedMotionQuery,
    });
    session.commitScenario(DEFAULT_SCENARIO);

    session.play();

    expect(scheduleCount).toBe(1);
    expect(session.playback.getState().playing).toBe(true);
    expect(session.playback.getState().playbackTime).toBe(0);
  });

  it("with no trajectory published yet, reduced-motion play() is a harmless no-op (playbackTime stays 0)", () => {
    const reducedMotionQuery: ReducedMotionQuery = () => true;
    const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, {
      reducedMotionQuery,
    });

    session.play();

    expect(session.playback.getState().playing).toBe(false);
    expect(session.playback.getState().playbackTime).toBe(0);
  });

  it("defaults to honoring a real window.matchMedia('(prefers-reduced-motion: reduce)') when no override is supplied", () => {
    const matches = vi.fn().mockReturnValue({ matches: true });
    (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia = matches;

    try {
      let scheduleCount = 0;
      const session = createSimulationSession(DEFAULT_SCENARIO, PRESET_SCENARIOS, {
        animationFrameScheduler: () => {
          scheduleCount++;
        },
      });
      session.commitScenario(DEFAULT_SCENARIO);

      session.play();

      expect(matches).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
      expect(scheduleCount).toBe(0);
      expect(session.playback.getState().playing).toBe(false);
    } finally {
      delete (globalThis as { matchMedia?: unknown }).matchMedia;
    }
  });
});
