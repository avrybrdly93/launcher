import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import type { EventRoot } from "@ballista/solverkit";
import {
  createSimulationSession,
  DEFAULT_SCENARIO,
  type AnimationFrameScheduler,
  type FrameScheduler,
} from "./simulation-session.js";

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

  it("slider -> result round trip completes in under 16 ms for the default scenario (perf, P3.03 validation criterion)", () => {
    const session = createSimulationSession();

    // one warm-up run so JIT/inline-cache effects don't inflate the measured sample
    session.commitScenario(DEFAULT_SCENARIO);

    const start = performance.now();
    const outcome = session.commitScenario(DEFAULT_SCENARIO);
    const elapsedMs = performance.now() - start;

    expect(outcome.status).toBe("ok");
    expect(elapsedMs).toBeLessThan(16);
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
