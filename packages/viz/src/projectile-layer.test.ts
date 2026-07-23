import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { resolveModel } from "@ballista/runtime";
import {
  ClassicalRK4Stepper,
  HermiteDenseOutputStepper,
  TrajectoryRecorder,
  integrate,
  type Sink,
  type SolverConfig,
  type SolveReport,
  type Stepper,
  type StepResult,
} from "@ballista/solverkit";
import {
  bracketStepIndex,
  createProjectileSampleScratch,
  drawProjectileLayer,
  sampleProjectilePosition,
  type ProjectileLayerCanvas,
} from "./projectile-layer.js";
import { IDENTITY_CAMERA, worldToScreen, type Camera2DState, type Viewport } from "./camera2d.js";

describe("bracketStepIndex", () => {
  const t = [0, 1, 2, 3, 5];

  it("finds the bracketing interval for an interior time", () => {
    expect(bracketStepIndex(t, 0.5)).toBe(0);
    expect(bracketStepIndex(t, 2.5)).toBe(2);
    expect(bracketStepIndex(t, 4)).toBe(3);
  });

  it("lands exactly on a recorded sample's own left interval", () => {
    expect(bracketStepIndex(t, 2)).toBe(2);
  });

  it("clamps to the first/last interval outside the recorded span", () => {
    expect(bracketStepIndex(t, -1)).toBe(0);
    expect(bracketStepIndex(t, 10)).toBe(3);
  });

  it("returns 0 for fewer than 2 samples", () => {
    expect(bracketStepIndex([], 0)).toBe(0);
    expect(bracketStepIndex([1], 5)).toBe(0);
  });
});

/** A fixed-h `ClassicalRK4Stepper` + `HermiteDenseOutputStepper` solve of the drag-free preset, plus everything needed to compare a post-hoc `sampleProjectilePosition` reconstruction against the *live* solver interpolant at an arbitrary time. */
function solveDragFreeWithFixedStepRK4(h: number) {
  const dragFree = PRESET_SCENARIOS.find(
    (p) => p.model.forceIds.length === 1 && p.model.forceIds[0] === "gravity",
  );
  expect(dragFree, "expected a drag-free (gravity-only) preset in PRESET_SCENARIOS").toBeDefined();

  const { model, ctx, y0 } = resolveModel(dragFree!);
  const stepper: Stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
  const cfg: SolverConfig = { stepper: "classical-rk4", h, maxSteps: 100_000 };
  const recorder = new TrajectoryRecorder();

  const report = integrate(model, ctx, y0, [0, 60], cfg, stepper, [recorder]);
  expect(report.status).toBe("ok");

  return { trajectory: recorder.trajectory, stepper };
}

/** Captures the *live* solver's own dense-output interpolant at `playbackTime`, by watching for the accepted step whose `[prevT, t]` interval contains it -- ground truth to compare a post-hoc reconstruction from the recorded trajectory against. */
class LiveInterpolantProbe implements Sink {
  readonly id = "live-interpolant-probe";
  private prevT = 0;
  result: Float64Array | undefined;

  constructor(
    private readonly stepper: Stepper,
    private readonly playbackTime: number,
  ) {}

  start(_model: unknown, t0: number): void {
    this.prevT = t0;
  }

  accept(t: number, _y: Float64Array, _step: StepResult): void {
    if (this.result === undefined && this.prevT <= this.playbackTime && this.playbackTime <= t) {
      const theta = t === this.prevT ? 0 : (this.playbackTime - this.prevT) / (t - this.prevT);
      const out = new Float64Array(4);
      this.stepper.interpolant!(theta, out);
      this.result = out;
    }
    this.prevT = t;
  }

  finish(_report: SolveReport): void {}
}

describe("sampleProjectilePosition (P3.12 validation: marker position matches interpolant to sub-pixel)", () => {
  it("reconstructs the live solver's own dense-output position from the recorded trajectory alone", () => {
    const h = 0.05;
    const playbackTime = 1.234;

    // First solve: build the recorded Trajectory the same way SimulationSession does.
    const { trajectory } = solveDragFreeWithFixedStepRK4(h);

    // Second, identical solve (same model/stepper/h -- deterministic, P2.44),
    // this time watching for the live interpolant at `playbackTime` directly
    // from the stepper mid-solve, which the recorded Trajectory alone never exposes.
    const dragFree = PRESET_SCENARIOS.find(
      (p) => p.model.forceIds.length === 1 && p.model.forceIds[0] === "gravity",
    )!;
    const { model, ctx, y0 } = resolveModel(dragFree);
    const stepper: Stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    const cfg: SolverConfig = { stepper: "classical-rk4", h, maxSteps: 100_000 };
    const probe = new LiveInterpolantProbe(stepper, playbackTime);
    const report = integrate(model, ctx, y0, [0, 60], cfg, stepper, [probe]);
    expect(report.status).toBe("ok");
    expect(probe.result, "playbackTime should fall inside the solved span").toBeDefined();

    const scratch = createProjectileSampleScratch();
    const reconstructed = new Float64Array(2);
    sampleProjectilePosition(trajectory, playbackTime, scratch, reconstructed);

    // Both interpolants are the exact same cubic Hermite basis over the exact
    // same recorded (y, dy/dt) endpoints, so this should match to floating-
    // point precision, comfortably inside the validation criterion's
    // "sub-pixel" bound (checked in screen space separately below).
    expect(reconstructed[0]).toBeCloseTo(probe.result![0]!, 10);
    expect(reconstructed[1]).toBeCloseTo(probe.result![1]!, 10);
  });

  it("exactly reproduces a recorded sample's own position at its own time (theta = 0)", () => {
    const { trajectory } = solveDragFreeWithFixedStepRK4(0.05);
    const scratch = createProjectileSampleScratch();
    const out = new Float64Array(2);

    const i = 10;
    sampleProjectilePosition(trajectory, trajectory.t[i]!, scratch, out);
    expect(out[0]).toBeCloseTo(trajectory.channels[0]![i]!, 12);
    expect(out[1]).toBeCloseTo(trajectory.channels[1]![i]!, 12);
  });

  it("clamps to the first/last recorded position outside the trajectory's time span", () => {
    const { trajectory } = solveDragFreeWithFixedStepRK4(0.05);
    const scratch = createProjectileSampleScratch();
    const out = new Float64Array(2);

    sampleProjectilePosition(trajectory, -5, scratch, out);
    expect(out[0]).toBeCloseTo(trajectory.channels[0]![0]!, 12);
    expect(out[1]).toBeCloseTo(trajectory.channels[1]![0]!, 12);

    const lastIdx = trajectory.nSteps - 1;
    sampleProjectilePosition(trajectory, trajectory.t[lastIdx]! + 100, scratch, out);
    expect(out[0]).toBeCloseTo(trajectory.channels[0]![lastIdx]!, 12);
    expect(out[1]).toBeCloseTo(trajectory.channels[1]![lastIdx]!, 12);
  });
});

class RecordingCanvas implements ProjectileLayerCanvas {
  fillStyle = "";
  arcCalls: Array<{ x: number; y: number; radius: number }> = [];
  beginPathCalls = 0;
  fillCalls = 0;
  beginPath(): void {
    this.beginPathCalls++;
  }
  arc(x: number, y: number, radius: number): void {
    this.arcCalls.push({ x, y, radius });
  }
  fill(): void {
    this.fillCalls++;
  }
}

const VIEWPORT: Viewport = { width: 800, height: 600 };

describe("drawProjectileLayer", () => {
  it("draws exactly one marker, at the camera-projected interpolated position", () => {
    const { trajectory } = solveDragFreeWithFixedStepRK4(0.05);
    const camera: Camera2DState = { ...IDENTITY_CAMERA, scaleX: 4, scaleY: 6 };
    const scratch = createProjectileSampleScratch();
    const worldOut = new Float64Array(2);
    const ctx = new RecordingCanvas();

    drawProjectileLayer(ctx, camera, VIEWPORT, trajectory, 1.234, scratch, worldOut, {});

    expect(ctx.beginPathCalls).toBe(1);
    expect(ctx.fillCalls).toBe(1);
    expect(ctx.arcCalls).toHaveLength(1);

    const expectedScreen = worldToScreen(camera, VIEWPORT, { x: worldOut[0]!, y: worldOut[1]! });
    expect(ctx.arcCalls[0]!.x).toBeCloseTo(expectedScreen.x, 10);
    expect(ctx.arcCalls[0]!.y).toBeCloseTo(expectedScreen.y, 10);
  });
});
