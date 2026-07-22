import { describe, expect, it } from "vitest";
import {
  computeAxisTicks,
  computeNiceStep,
  drawAxesLayer,
  formatTickValue,
  visibleWorldBounds,
  type AxesLayerCanvas,
} from "./axes-layer.js";
import {
  IDENTITY_CAMERA,
  screenToWorld,
  worldToScreen,
  type Camera2DState,
  type Viewport,
} from "./camera2d.js";

describe("computeNiceStep", () => {
  it("picks a step on the 1-2-5 progression", () => {
    const allowedNormalized = new Set([1, 2, 5, 10]);
    for (const [min, max] of [
      [0, 100],
      [0, 47],
      [-10, 10],
      [0, 0.0034],
      [1000, 987654],
    ]) {
      const step = computeNiceStep(min!, max!, 6);
      const magnitude = Math.pow(10, Math.floor(Math.log10(step) + 1e-9));
      const normalized = Math.round(step / magnitude);
      expect(allowedNormalized.has(normalized), `step=${step} normalized=${normalized}`).toBe(true);
    }
  });

  it("throws on a degenerate (zero-span) range", () => {
    expect(() => computeNiceStep(5, 5, 6)).toThrow();
    expect(() => computeNiceStep(5, 3, 6)).toThrow();
  });
});

describe("computeAxisTicks (P3.08 validation: tick count 4-8 across 6 zoom decades)", () => {
  it("keeps tick count within [4, 8] across at least 6 zoom decades", () => {
    let minCount = Infinity;
    let maxCount = -Infinity;

    // 6+ decades of span (1e-3 .. 1e6), several fractional widths and
    // several non-zero offsets per decade so this isn't just testing
    // origin-anchored ranges.
    for (let decade = -3; decade <= 6; decade++) {
      for (const frac of [1, 1.3, 2.7, 5.5, 9.2]) {
        const span = frac * 10 ** decade;
        for (const min of [0, -span / 3, 17.3, -100]) {
          const max = min + span;
          const ticks = computeAxisTicks(min, max, 6);
          minCount = Math.min(minCount, ticks.length);
          maxCount = Math.max(maxCount, ticks.length);
          expect(ticks.length, `span=${span} decade=${decade} min=${min}`).toBeGreaterThanOrEqual(
            4,
          );
          expect(ticks.length, `span=${span} decade=${decade} min=${min}`).toBeLessThanOrEqual(8);
        }
      }
    }

    // Sanity: the sweep actually exercised both ends of the band, not a
    // narrower range that happens to trivially satisfy the bound.
    expect(minCount).toBeLessThanOrEqual(6);
    expect(maxCount).toBeGreaterThanOrEqual(6);
  });

  it("all ticks fall within [min, max]", () => {
    const ticks = computeAxisTicks(3.7, 91.2, 6);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(3.7);
      expect(tick).toBeLessThanOrEqual(91.2);
    }
  });

  it("ticks are evenly spaced by the nice step", () => {
    const ticks = computeAxisTicks(0, 100, 6);
    const step = computeNiceStep(0, 100, 6);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(step, 10);
    }
  });

  it("is free of floating-point noise in tick values", () => {
    const ticks = computeAxisTicks(0, 1, 6);
    for (const tick of ticks) {
      expect(tick).toBe(Number(tick.toPrecision(12)));
    }
  });
});

describe("formatTickValue", () => {
  it("chooses decimal precision from the step magnitude", () => {
    expect(formatTickValue(50, 10)).toBe("50");
    expect(formatTickValue(1.5, 0.5)).toBe("1.5");
    expect(formatTickValue(0.25, 0.05)).toBe("0.25");
  });

  it("normalizes negative zero to '0'", () => {
    expect(formatTickValue(-0, 10)).toBe("0");
    expect(formatTickValue(-1e-15, 1)).toBe("0");
  });

  it("appends the unit when given", () => {
    expect(formatTickValue(50, 10, "m")).toBe("50 m");
    expect(formatTickValue(50, 10)).toBe("50");
  });
});

describe("visibleWorldBounds", () => {
  it("is the exact inverse of worldToScreen at the viewport corners", () => {
    const viewport: Viewport = { width: 800, height: 600 };
    const camera: Camera2DState = { centerX: 10, centerY: -5, scaleX: 3, scaleY: 7 };
    const bounds = visibleWorldBounds(camera, viewport);

    const topLeft = screenToWorld(camera, viewport, { x: 0, y: 0 });
    const bottomRight = screenToWorld(camera, viewport, { x: viewport.width, y: viewport.height });
    expect(bounds).toEqual({
      minX: topLeft.x,
      maxX: bottomRight.x,
      minY: bottomRight.y,
      maxY: topLeft.y,
    });

    // Round-trips back through worldToScreen to the viewport edges.
    expect(worldToScreen(camera, viewport, { x: bounds.minX, y: bounds.maxY })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

class RecordingCanvas implements AxesLayerCanvas {
  strokeStyle = "";
  lineWidth = 0;
  fillStyle = "";
  font = "";
  textAlign = "";
  textBaseline = "";
  moveToCalls: Array<[number, number]> = [];
  lineToCalls: Array<[number, number]> = [];
  fillTextCalls: Array<[string, number, number]> = [];
  strokeCalls = 0;
  beginPathCalls = 0;

  beginPath(): void {
    this.beginPathCalls++;
  }
  moveTo(x: number, y: number): void {
    this.moveToCalls.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.lineToCalls.push([x, y]);
  }
  stroke(): void {
    this.strokeCalls++;
  }
  fillText(text: string, x: number, y: number): void {
    this.fillTextCalls.push([text, x, y]);
  }
}

describe("drawAxesLayer", () => {
  const viewport: Viewport = { width: 800, height: 600 };

  it("draws one grid line and one label per computed tick, on each axis", () => {
    const canvas = new RecordingCanvas();
    const camera: Camera2DState = { ...IDENTITY_CAMERA, scaleX: 2, scaleY: 2 };
    drawAxesLayer(canvas, camera, viewport, { xUnit: "m", yUnit: "s" });

    const bounds = visibleWorldBounds(camera, viewport);
    const xTicks = computeAxisTicks(bounds.minX, bounds.maxX, 6);
    const yTicks = computeAxisTicks(bounds.minY, bounds.maxY, 6);

    expect(canvas.moveToCalls.length).toBe(xTicks.length + yTicks.length);
    expect(canvas.lineToCalls.length).toBe(xTicks.length + yTicks.length);
    expect(canvas.fillTextCalls.length).toBe(xTicks.length + yTicks.length);
    // A single batched path + stroke for all grid lines (no per-line allocation/draw call, §6.5).
    expect(canvas.beginPathCalls).toBe(1);
    expect(canvas.strokeCalls).toBe(1);

    expect(canvas.fillTextCalls.some(([text]) => text.endsWith(" m"))).toBe(true);
    expect(canvas.fillTextCalls.some(([text]) => text.endsWith(" s"))).toBe(true);
  });

  it("x grid lines span the full viewport height and y grid lines span the full width", () => {
    const canvas = new RecordingCanvas();
    drawAxesLayer(canvas, IDENTITY_CAMERA, viewport);

    for (const [x, y] of canvas.moveToCalls) {
      expect(y === 0 || x === 0).toBe(true);
    }
    for (const [x, y] of canvas.lineToCalls) {
      expect(y === viewport.height || x === viewport.width).toBe(true);
    }
  });
});
