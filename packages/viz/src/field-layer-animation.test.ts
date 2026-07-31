import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EnvSample,
  OneCosineGustWind,
  PRESET_SCENARIOS,
  SinusoidalGustWind,
  type ScenarioSpec,
  type WindModel,
} from "@ballista/engine";
import { resolveModel, resolveSolverConfig, resolveStepper } from "@ballista/runtime";
import { integrate, TrajectoryRecorder, type Trajectory } from "@ballista/solverkit";
import { IDENTITY_CAMERA, type Viewport } from "./camera2d.js";
import {
  createFieldAnimationTicker,
  DEFAULT_FIELD_ANIMATION_TICK_HZ,
  quantizeFieldAnimationTime,
} from "./field-layer-animation.js";
import { sampleFieldArrows } from "./field-layer.js";

const VIEWPORT: Viewport = { width: 480, height: 320 };

describe("quantizeFieldAnimationTime", () => {
  it("floors to the most recent 10 Hz tick boundary by default", () => {
    expect(quantizeFieldAnimationTime(0)).toBe(0);
    expect(quantizeFieldAnimationTime(0.05)).toBeCloseTo(0, 12);
    expect(quantizeFieldAnimationTime(0.34)).toBeCloseTo(0.3, 12);
    expect(quantizeFieldAnimationTime(0.39999)).toBeCloseTo(0.3, 12);
    expect(quantizeFieldAnimationTime(0.4)).toBeCloseTo(0.4, 12);
    expect(quantizeFieldAnimationTime(1.999)).toBeCloseTo(1.9, 12);
  });

  it("honors an explicit tickHz", () => {
    // 4 Hz -> 0.25 s buckets.
    expect(quantizeFieldAnimationTime(0.3, 4)).toBeCloseTo(0.25, 12);
    expect(quantizeFieldAnimationTime(0.24, 4)).toBeCloseTo(0, 12);
    expect(quantizeFieldAnimationTime(0.5, 4)).toBeCloseTo(0.5, 12);

    // 30 Hz (a plausible "animate at full render rate" comparison point for
    // the determinism-guard test below).
    expect(quantizeFieldAnimationTime(1 / 30, 30)).toBeCloseTo(1 / 30, 12);
  });

  it("clamps non-positive/non-finite displayTimeSeconds and tickHz to 0", () => {
    expect(quantizeFieldAnimationTime(-1)).toBe(0);
    expect(quantizeFieldAnimationTime(NaN)).toBe(0);
    expect(quantizeFieldAnimationTime(-Infinity)).toBe(0);
    expect(quantizeFieldAnimationTime(1, 0)).toBe(0);
    expect(quantizeFieldAnimationTime(1, -5)).toBe(0);
    expect(quantizeFieldAnimationTime(1, NaN)).toBe(0);
  });

  it("defaults tickHz to the blueprint's 10 Hz", () => {
    expect(DEFAULT_FIELD_ANIMATION_TICK_HZ).toBe(10);
  });
});

describe("createFieldAnimationTicker", () => {
  it("ticks (changed: true) only when the quantized time advances, at most 10x per second of display time", () => {
    const ticker = createFieldAnimationTicker();
    const frameHz = 60;
    const durationSeconds = 2;
    const frameCount = durationSeconds * frameHz; // 120 frames of "render" activity

    const expectedDistinctTicks = new Set<number>();
    let changedCount = 0;
    let lastReportedTime = -1;

    for (let frame = 0; frame < frameCount; frame++) {
      const displayTime = frame / frameHz;
      expectedDistinctTicks.add(quantizeFieldAnimationTime(displayTime));

      const result = ticker.tick(displayTime);
      expect(result.time).toBeCloseTo(quantizeFieldAnimationTime(displayTime), 12);

      if (result.changed) {
        changedCount++;
        // Every "changed" tick must actually be a new quantized value.
        expect(result.time).not.toBe(lastReportedTime);
        lastReportedTime = result.time;
      } else {
        // Unchanged ticks must repeat the last reported value.
        expect(result.time).toBe(lastReportedTime);
      }
    }

    // 2 seconds of display time at the default 10 Hz tick rate => exactly 20
    // distinct buckets (0.0, 0.1, ..., 1.9) -- far fewer than the 120 render
    // frames that were fed in, proving the throttle actually throttles.
    expect(expectedDistinctTicks.size).toBe(20);
    expect(changedCount).toBe(20);
    expect(ticker.tickCount).toBe(20);
    expect(changedCount).toBeLessThan(frameCount);
  });

  it("the first tick always reports changed: true, even at t=0", () => {
    const ticker = createFieldAnimationTicker();
    const first = ticker.tick(0);
    expect(first.changed).toBe(true);
    expect(ticker.tickCount).toBe(1);
  });

  it("repeated calls within the same tick window report changed: false and keep tickCount flat", () => {
    const ticker = createFieldAnimationTicker();
    ticker.tick(0.31);
    expect(ticker.tickCount).toBe(1);

    const second = ticker.tick(0.35);
    const third = ticker.tick(0.399);
    expect(second.changed).toBe(false);
    expect(third.changed).toBe(false);
    expect(ticker.tickCount).toBe(1);

    const fourth = ticker.tick(0.4);
    expect(fourth.changed).toBe(true);
    expect(ticker.tickCount).toBe(2);
  });

  it("independent tickers never share throttle state", () => {
    const a = createFieldAnimationTicker();
    const b = createFieldAnimationTicker();

    a.tick(0.35);
    a.tick(0.36);
    expect(a.tickCount).toBe(1);
    expect(b.tickCount).toBe(0);

    b.tick(0.05);
    expect(b.tickCount).toBe(1);
    expect(a.tickCount).toBe(1);
  });

  it("supports a custom tickHz", () => {
    const ticker = createFieldAnimationTicker(4); // 0.25 s buckets
    expect(ticker.tick(0).changed).toBe(true);
    expect(ticker.tick(0.2).changed).toBe(false);
    expect(ticker.tick(0.25).changed).toBe(true);
    expect(ticker.tickCount).toBe(2);
  });
});

describe("field animation actually animates a time-varying wind (sanity check the throttle isn't hiding a frozen field)", () => {
  it("sampled arrows at successive 10 Hz ticks trace out the sinusoidal gust's variation over time", () => {
    const wind: WindModel = new SinusoidalGustWind(2, 6, Math.PI, 0, 0); // period 2s
    const scratch = new EnvSample();
    const ticker = createFieldAnimationTicker();

    const sampledWx: number[] = [];
    for (let frame = 0; frame < 20 * 6; frame++) {
      // 20 render frames per tick window (well above 10 Hz), 6 tick windows total.
      const displayTime = frame / (20 * 10);
      const { time, changed } = ticker.tick(displayTime);
      if (changed) {
        const arrows = sampleFieldArrows(wind, time, IDENTITY_CAMERA, VIEWPORT, scratch, {
          cols: 2,
          rows: 2,
          marginPx: 10,
        });
        sampledWx.push(arrows[0]!.wx);
      }
    }

    // 6 distinct tick windows sampled, and the wind actually varies across
    // them (not every ticked sample reads the same frozen value).
    expect(sampledWx.length).toBe(6);
    expect(new Set(sampledWx.map((v) => v.toFixed(6))).size).toBeGreaterThan(1);
  });
});

/**
 * Determinism guard (P4.19's own validation criterion): "animation does not
 * affect physics hash". Mirrors `solverkit/determinism.test.ts`'s
 * `runScenarioToTrajectory`/`hashTrajectory` pattern exactly, but the point
 * here is different -- proving that *this module* (the field-layer
 * animation ticker, plus sampling a `WindModel` directly for display, as a
 * future scene driver would to feed `FieldLayer`) never touches, mutates, or
 * otherwise perturbs the `integrate()` pipeline, regardless of whether the
 * field animation is "on" (ticked at some rate) or "off" (never touched) in
 * between two runs of the same scenario.
 */
function runScenarioToTrajectory(spec: ScenarioSpec): Trajectory {
  const { model, ctx, y0 } = resolveModel(spec);
  const stepper = resolveStepper(spec.solver.stepper);
  const cfg = resolveSolverConfig(spec);

  const recorder = new TrajectoryRecorder();
  const report = integrate(model, ctx, y0, [0, 3], cfg, stepper, [recorder]);
  expect(report.status).toBe("ok");
  return recorder.trajectory;
}

function hashTrajectory(trajectory: Trajectory): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(trajectory.t.buffer, trajectory.t.byteOffset, trajectory.t.byteLength));
  for (const channel of trajectory.channels) {
    hash.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
  }
  return hash.digest("hex");
}

describe("determinism guard: field-layer animation does not affect the physics hash (P4.19 validation criterion)", () => {
  const headwind = PRESET_SCENARIOS.find(
    (s) => s.environment.wind.kind === "uniform" && s.environment.wind.wx < 0,
  );
  if (!headwind) throw new Error("expected a headwind preset in PRESET_SCENARIOS");

  const gustSpec: ScenarioSpec = {
    ...headwind,
    environment: {
      ...headwind.environment,
      wind: { kind: "one-cosine-gust", startTime: 0.4, duration: 0.6, peakMagnitude: 12, wy: 0 },
    },
  };

  /**
   * Runs `sampleFieldArrows` against a *separately constructed* `WindModel`
   * matching `gustSpec.environment.wind` at every 10 Hz-and-faster tick over
   * `[0, 3]` seconds of display time -- standing in for a scene's field
   * layer animating away in the background while `integrate()` runs (or has
   * already run) on the exact same scenario. Nothing here is passed back
   * into, or shares any object/state with, `runScenarioToTrajectory`.
   */
  function driveFieldAnimation(tickHz: number): void {
    const wind: WindModel = new OneCosineGustWind(0.4, 0.6, 12, 0);
    const scratch = new EnvSample();
    const ticker = createFieldAnimationTicker(tickHz);
    const renderFrameHz = 60;
    const totalFrames = 3 * renderFrameHz;

    for (let frame = 0; frame < totalFrames; frame++) {
      const displayTime = frame / renderFrameHz;
      const { time, changed } = ticker.tick(displayTime);
      if (changed) {
        // Exercise the exact call the real field layer would make -- pure
        // read of the wind model, no write-back anywhere.
        sampleFieldArrows(wind, time, IDENTITY_CAMERA, VIEWPORT, scratch);
      }
    }
  }

  it("baseline: the gust scenario is itself reproducible (sanity check before comparing against animated runs)", () => {
    const first = runScenarioToTrajectory(gustSpec);
    const second = runScenarioToTrajectory(gustSpec);
    expect(first.nSteps).toBeGreaterThan(1);
    expect(hashTrajectory(first)).toBe(hashTrajectory(second));
  });

  it("animation OFF vs. animation ON (10 Hz) produce bit-identical trajectory hashes", () => {
    const withoutAnimation = runScenarioToTrajectory(gustSpec);

    driveFieldAnimation(10);
    const withAnimation = runScenarioToTrajectory(gustSpec);

    expect(hashTrajectory(withAnimation)).toBe(hashTrajectory(withoutAnimation));
    for (let c = 0; c < withoutAnimation.channels.length; c++) {
      expect(withAnimation.channels[c]).toEqual(withoutAnimation.channels[c]);
    }
    expect(withAnimation.t).toEqual(withoutAnimation.t);
  });

  it("driving the animation ticker at different rates (5 Hz, 10 Hz, 30 Hz, 60 Hz) never changes the physics hash", () => {
    const baseline = runScenarioToTrajectory(gustSpec);
    const baselineHash = hashTrajectory(baseline);

    for (const tickHz of [5, 10, 30, 60]) {
      driveFieldAnimation(tickHz);
      const afterAnimation = runScenarioToTrajectory(gustSpec);
      expect(hashTrajectory(afterAnimation)).toBe(baselineHash);
    }
  });

  it("interleaving animation ticks between successive integrate() calls still yields identical hashes", () => {
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      driveFieldAnimation(10);
      results.push(hashTrajectory(runScenarioToTrajectory(gustSpec)));
      driveFieldAnimation(30);
    }
    expect(new Set(results).size).toBe(1);
  });
});
