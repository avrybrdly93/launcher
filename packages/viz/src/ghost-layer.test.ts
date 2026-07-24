import { describe, expect, it } from "vitest";
import { applyGhostStyle, type GhostLayerCanvas } from "./ghost-layer.js";

class RecordingCanvas implements GhostLayerCanvas {
  strokeStyle = "";
  lineWidth = 0;
  globalAlpha = 1;
  dashCalls: Array<readonly number[]> = [];
  stroke(): void {}
  setLineDash(segments: readonly number[]): void {
    this.dashCalls.push(segments);
  }
}

describe("applyGhostStyle", () => {
  it("defaults to a faded, dashed gray stroke distinct from a live trajectory's solid style", () => {
    const canvas = new RecordingCanvas();
    applyGhostStyle(canvas);

    expect(canvas.globalAlpha).toBeLessThan(1); // faded
    expect(canvas.globalAlpha).toBeGreaterThan(0); // still visible, not invisible
    expect(canvas.dashCalls).toHaveLength(1);
    expect(canvas.dashCalls[0]!.length).toBeGreaterThan(0); // dashed, not a solid line ([] = solid)
    expect(canvas.strokeStyle).not.toBe("");
    expect(canvas.lineWidth).toBeGreaterThan(0);
  });

  it("honors every explicit option over its default", () => {
    const canvas = new RecordingCanvas();
    applyGhostStyle(canvas, { color: "#123456", lineWidth: 3, alpha: 0.2, dash: [1, 2, 3] });

    expect(canvas.strokeStyle).toBe("#123456");
    expect(canvas.lineWidth).toBe(3);
    expect(canvas.globalAlpha).toBe(0.2);
    expect(canvas.dashCalls).toEqual([[1, 2, 3]]);
  });
});
