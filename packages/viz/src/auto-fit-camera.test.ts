import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { createSimulationSession } from "@ballista/runtime";
import {
  applyManualCamera,
  computeBounds,
  fitCameraToBounds,
  fitToView,
  followBoundsIfAutoFitting,
  type Bounds,
} from "./auto-fit-camera.js";
import { worldToScreen, type Camera2DState, type Viewport } from "./camera2d.js";

const VIEWPORT: Viewport = { width: 800, height: 600 };

describe("computeBounds", () => {
  it("finds the axis-aligned min/max of parallel x/y arrays", () => {
    const xs = [3, -1, 5, 2];
    const ys = [10, 20, -5, 0];
    expect(computeBounds(xs, ys)).toEqual({ minX: -1, maxX: 5, minY: -5, maxY: 20 });
  });

  it("throws on empty input", () => {
    expect(() => computeBounds([], [])).toThrow();
  });

  it("handles a single point (zero-span bounds)", () => {
    expect(computeBounds([7], [3])).toEqual({ minX: 7, maxX: 7, minY: 3, maxY: 3 });
  });
});

describe("fitCameraToBounds (P3.07)", () => {
  it("centers the camera on the bounds' midpoint", () => {
    const bounds: Bounds = { minX: 0, maxX: 100, minY: 0, maxY: 20 };
    const camera = fitCameraToBounds(bounds, VIEWPORT);
    expect(camera.centerX).toBe(50);
    expect(camera.centerY).toBe(10);
  });

  it("scales x and y independently (anisotropic) to fit a wide, short trajectory", () => {
    const bounds: Bounds = { minX: 0, maxX: 1000, minY: 0, maxY: 10 };
    const camera = fitCameraToBounds(bounds, VIEWPORT, { paddingFraction: 0 });
    expect(camera.scaleX).toBeCloseTo(VIEWPORT.width / 1000, 10);
    expect(camera.scaleY).toBeCloseTo(VIEWPORT.height / 10, 10);
    expect(camera.scaleX).not.toBeCloseTo(camera.scaleY, 2);
  });

  it("padding shrinks the effective scale so the bounds don't touch the viewport edge", () => {
    const bounds: Bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    const unpadded = fitCameraToBounds(bounds, VIEWPORT, { paddingFraction: 0 });
    const padded = fitCameraToBounds(bounds, VIEWPORT, { paddingFraction: 0.1 });
    expect(padded.scaleX).toBeLessThan(unpadded.scaleX);
    expect(padded.scaleY).toBeLessThan(unpadded.scaleY);
  });

  it("falls back to minSpan on a degenerate (zero-width) axis instead of an infinite scale", () => {
    const bounds: Bounds = { minX: 5, maxX: 5, minY: 0, maxY: 50 };
    const camera = fitCameraToBounds(bounds, VIEWPORT, { minSpan: 2 });
    expect(camera.scaleX).toBeCloseTo(VIEWPORT.width / 2, 10);
    expect(Number.isFinite(camera.scaleX)).toBe(true);
  });

  it("the whole padded bounding box maps inside the viewport", () => {
    const bounds: Bounds = { minX: -20, maxX: 340, minY: 0, maxY: 55 };
    const camera = fitCameraToBounds(bounds, VIEWPORT, { paddingFraction: 0.1 });
    for (const [x, y] of [
      [bounds.minX, bounds.minY],
      [bounds.minX, bounds.maxY],
      [bounds.maxX, bounds.minY],
      [bounds.maxX, bounds.maxY],
    ]) {
      const p = worldToScreen(camera, VIEWPORT, { x: x!, y: y! });
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(VIEWPORT.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  it("full trajectory visible for all presets (validation criterion)", () => {
    for (const preset of PRESET_SCENARIOS) {
      const session = createSimulationSession(preset, [preset]);
      const outcome = session.commitScenario(preset);
      expect(outcome.status, `${preset.model.id} failed to integrate`).toBe("ok");

      const trajectory = session.result.getState().trajectory!;
      const xs = trajectory.channels[0]!;
      const ys = trajectory.channels[1]!;
      const bounds = computeBounds(xs, ys);
      const camera = fitCameraToBounds(bounds, VIEWPORT);

      for (let i = 0; i < trajectory.nSteps; i++) {
        const p = worldToScreen(camera, VIEWPORT, { x: xs[i]!, y: ys[i]! });
        expect(p.x, `preset=${preset.model.id} step=${i} x`).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x, `preset=${preset.model.id} step=${i} x`).toBeLessThanOrEqual(
          VIEWPORT.width + 1e-6,
        );
        expect(p.y, `preset=${preset.model.id} step=${i} y`).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y, `preset=${preset.model.id} step=${i} y`).toBeLessThanOrEqual(
          VIEWPORT.height + 1e-6,
        );
      }
    }
  });
});

describe("auto-fit / reset view state machine (P3.07)", () => {
  const bounds: Bounds = { minX: 0, maxX: 200, minY: 0, maxY: 40 };

  it("fitToView starts (or resets to) an auto-fitting camera", () => {
    const view = fitToView(bounds, VIEWPORT);
    expect(view.autoFit).toBe(true);
    expect(view.camera).toEqual(fitCameraToBounds(bounds, VIEWPORT));
  });

  it("applyManualCamera installs the given camera and disables auto-fit", () => {
    const manualCamera: Camera2DState = { centerX: 1, centerY: 2, scaleX: 3, scaleY: 4 };
    const view = applyManualCamera(manualCamera);
    expect(view.autoFit).toBe(false);
    expect(view.camera).toBe(manualCamera);
  });

  it("followBoundsIfAutoFitting re-fits while auto-fit is on", () => {
    const initial = fitToView(bounds, VIEWPORT);
    const grownBounds: Bounds = { minX: 0, maxX: 400, minY: 0, maxY: 80 };
    const followed = followBoundsIfAutoFitting(initial, grownBounds, VIEWPORT);
    expect(followed.autoFit).toBe(true);
    expect(followed.camera).toEqual(fitCameraToBounds(grownBounds, VIEWPORT));
    expect(followed.camera).not.toEqual(initial.camera);
  });

  it("followBoundsIfAutoFitting is a no-op once the user has taken over (auto-fit disabled)", () => {
    const manualCamera: Camera2DState = { centerX: 1, centerY: 2, scaleX: 3, scaleY: 4 };
    const manual = applyManualCamera(manualCamera);
    const grownBounds: Bounds = { minX: 0, maxX: 400, minY: 0, maxY: 80 };
    const followed = followBoundsIfAutoFitting(manual, grownBounds, VIEWPORT);
    expect(followed).toBe(manual);
    expect(followed.camera).toBe(manualCamera);
  });

  it("reset (fitToView again) re-enables auto-fit after a manual pan/zoom", () => {
    const manual = applyManualCamera({ centerX: 1, centerY: 2, scaleX: 3, scaleY: 4 });
    expect(manual.autoFit).toBe(false);

    const reset = fitToView(bounds, VIEWPORT);
    expect(reset.autoFit).toBe(true);
    expect(reset.camera).toEqual(fitCameraToBounds(bounds, VIEWPORT));
  });
});
