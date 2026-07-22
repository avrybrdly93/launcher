import { describe, expect, it } from "vitest";
import {
  buildDecimatedTrajectoryPath,
  DEFAULT_DECIMATION_EPSILON_PX,
  rdpDecimateIndices,
} from "./trajectory-decimation.js";
import { IDENTITY_CAMERA, type Camera2DState, type Viewport } from "./camera2d.js";
import type { PathBuilder } from "./trajectory-layer.js";

class RecordingPath implements PathBuilder {
  points: Array<[number, number]> = [];
  moveTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
}

describe("rdpDecimateIndices", () => {
  it("always keeps the first and last index", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [0, 0, 0, 0, 0];
    const indices = rdpDecimateIndices(xs, ys, 0.5);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(4);
  });

  it("drops every interior point of an exactly colinear run", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i);
    const ys = Array.from({ length: 100 }, (_, i) => 2 * i + 3); // y = 2x + 3, exactly straight
    const indices = rdpDecimateIndices(xs, ys, 0.5);
    expect(Array.from(indices)).toEqual([0, 99]);
  });

  it("keeps everything for fewer than 3 points", () => {
    expect(Array.from(rdpDecimateIndices([1, 2], [1, 2], 0.5))).toEqual([0, 1]);
    expect(Array.from(rdpDecimateIndices([1], [1], 0.5))).toEqual([0]);
    expect(Array.from(rdpDecimateIndices([], [], 0.5))).toEqual([]);
  });

  it("keeps a single sharp spike that exceeds epsilon, on an otherwise straight run", () => {
    const n = 21;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, () => 0);
    ys[10] = 5; // spike at the midpoint, well past epsilon
    const indices = rdpDecimateIndices(xs, ys, 0.5);
    expect(Array.from(indices)).toContain(10);
    expect(indices.length).toBeLessThan(n); // still simplifies the flat parts either side
  });

  it("a smaller epsilon never keeps fewer points than a larger one, on the same input", () => {
    const n = 500;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => Math.sin(i / 17) * 10 + Math.sin(i / 3) * 2);
    const tight = rdpDecimateIndices(xs, ys, 0.1);
    const loose = rdpDecimateIndices(xs, ys, 2);
    expect(tight.length).toBeGreaterThanOrEqual(loose.length);
  });
});

/** Point-to-segment (clamped) Euclidean distance -- used to measure the simplified polyline's deviation from the original, unlike RDP's own line-based error metric. */
function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Max, over every original point, of its distance to the nearest segment of the simplified polyline `(xs[idx], ys[idx])` for `idx in indices`. */
function maxDeviationFromSimplified(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  indices: Uint32Array,
): number {
  let maxDist = 0;
  for (let i = 0; i < xs.length; i++) {
    let best = Infinity;
    for (let s = 0; s < indices.length - 1; s++) {
      const a = indices[s]!;
      const b = indices[s + 1]!;
      const d = pointToSegmentDistance(xs[i]!, ys[i]!, xs[a]!, ys[a]!, xs[b]!, ys[b]!);
      if (d < best) best = d;
    }
    if (best > maxDist) maxDist = best;
  }
  return maxDist;
}

describe("rdpDecimateIndices deviation bound (P3.10 validation: max deviation < 0.5 px)", () => {
  it("stays within epsilon for a noisy synthetic 'stiff run' shaped signal", () => {
    // Mimics a stiff solve's step-size trace: mostly tiny steps (dense,
    // near-flat runs) punctuated by occasional larger jumps -- deterministic
    // (no RNG) so the test is reproducible.
    const n = 5000;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    let x = 0;
    for (let i = 0; i < n; i++) {
      const jump = i % 137 === 0 ? 8 : 0.02;
      x += jump;
      xs[i] = x;
      ys[i] = Math.sin(x * 0.05) * 20 + Math.sin(x * 0.4) * 3;
    }

    const epsilon = DEFAULT_DECIMATION_EPSILON_PX;
    const indices = rdpDecimateIndices(xs, ys, epsilon);
    expect(indices.length).toBeLessThan(n); // meaningfully simplified
    const maxDeviation = maxDeviationFromSimplified(xs, ys, indices);
    expect(maxDeviation).toBeLessThan(epsilon + 1e-9);
  });
});

describe("buildDecimatedTrajectoryPath", () => {
  it("traces the decimated screen-space points, matching rdpDecimateIndices on the same camera-transformed data", () => {
    const viewport: Viewport = { width: 800, height: 600 };
    const camera: Camera2DState = { ...IDENTITY_CAMERA, scaleX: 2, scaleY: 2 };
    const n = 200;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => Math.sin(i / 10) * 5);

    const path = new RecordingPath();
    buildDecimatedTrajectoryPath(path, camera, viewport, xs, ys, 0.5);

    expect(path.points.length).toBeLessThan(n);
    expect(path.points.length).toBeGreaterThanOrEqual(2);
    // First/last screen points match the untransformed endpoints exactly.
    expect(path.points[0]).toEqual([
      viewport.width / 2 + xs[0]! * camera.scaleX,
      viewport.height / 2 - ys[0]! * camera.scaleY,
    ]);
    const lastExpected: [number, number] = [
      viewport.width / 2 + xs[n - 1]! * camera.scaleX,
      viewport.height / 2 - ys[n - 1]! * camera.scaleY,
    ];
    expect(path.points[path.points.length - 1]).toEqual(lastExpected);
  });

  it("draws nothing for fewer than 2 points", () => {
    const path = new RecordingPath();
    buildDecimatedTrajectoryPath(path, IDENTITY_CAMERA, { width: 100, height: 100 }, [], []);
    expect(path.points).toEqual([]);
  });
});

describe("performance (P3.10 validation: 50k-pt stiff run draws < 1 ms)", () => {
  it("decimates and traces a 50,000-point stiff-shaped trajectory in under 1 ms", () => {
    const n = 50_000;
    const worldXs = new Float64Array(n);
    const worldYs = new Float64Array(n);
    // Shaped like an actual stiff solve (e.g. the dust-grain preset's Stokes
    // relaxation, §3.6): a fast transient forces tiny steps early, then the
    // step size relaxes as the solution smooths out -- but the underlying
    // curve itself stays a single smooth decay+drift, not a high-frequency
    // oscillation, matching what a real trajectory (however stiff its
    // *solve* was) looks like on screen.
    let t = 0;
    for (let i = 0; i < n; i++) {
      const h = 1e-5 + 0.02 * (1 - Math.exp(-t / 5));
      t += h;
      worldXs[i] = t;
      worldYs[i] = 3 * Math.exp(-t / 2) + 0.05 * t;
    }

    const camera: Camera2DState = { centerX: t / 2, centerY: 0, scaleX: 3, scaleY: 200 };
    const viewport: Viewport = { width: 1200, height: 800 };

    // Best-of-N after ample warmup, to measure the JIT-steady-state cost
    // (what actually matters for a render loop invoking this every zoom
    // change) rather than one-off interpreter/compile overhead.
    for (let warmup = 0; warmup < 20; warmup++) {
      buildDecimatedTrajectoryPath(new RecordingPath(), camera, viewport, worldXs, worldYs);
    }

    let best = Infinity;
    for (let trial = 0; trial < 15; trial++) {
      const path = new RecordingPath();
      const start = performance.now();
      buildDecimatedTrajectoryPath(path, camera, viewport, worldXs, worldYs);
      const elapsed = performance.now() - start;
      if (elapsed < best) best = elapsed;
    }

    expect(best).toBeLessThan(1);
  });
});
