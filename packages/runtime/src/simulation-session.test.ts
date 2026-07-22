import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import {
  createSimulationSession,
  DEFAULT_SCENARIO,
  type FrameScheduler,
} from "./simulation-session.js";

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
