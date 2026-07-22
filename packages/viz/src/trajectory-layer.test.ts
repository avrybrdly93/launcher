import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { createSimulationSession } from "@ballista/runtime";
import { buildTrajectoryPath, type PathBuilder } from "./trajectory-layer.js";
import { IDENTITY_CAMERA, worldToScreen, type Camera2DState, type Viewport } from "./camera2d.js";

class RecordingPath implements PathBuilder {
  calls: Array<{ op: "moveTo" | "lineTo"; x: number; y: number }> = [];
  moveTo(x: number, y: number): void {
    this.calls.push({ op: "moveTo", x, y });
  }
  lineTo(x: number, y: number): void {
    this.calls.push({ op: "lineTo", x, y });
  }
}

const VIEWPORT: Viewport = { width: 800, height: 600 };

describe("buildTrajectoryPath", () => {
  it("traces one moveTo followed by one lineTo per remaining point, through the camera transform", () => {
    const path = new RecordingPath();
    const camera: Camera2DState = { ...IDENTITY_CAMERA, scaleX: 2, scaleY: 3 };
    const xs = [0, 1, 2, 3];
    const ys = [0, 1, 0, -1];

    buildTrajectoryPath(path, camera, VIEWPORT, xs, ys);

    expect(path.calls.map((c) => c.op)).toEqual(["moveTo", "lineTo", "lineTo", "lineTo"]);
    for (let i = 0; i < xs.length; i++) {
      const expected = worldToScreen(camera, VIEWPORT, { x: xs[i]!, y: ys[i]! });
      expect(path.calls[i]!.x).toBeCloseTo(expected.x, 10);
      expect(path.calls[i]!.y).toBeCloseTo(expected.y, 10);
    }
  });

  it("draws nothing for fewer than 2 points", () => {
    const path = new RecordingPath();
    buildTrajectoryPath(path, IDENTITY_CAMERA, VIEWPORT, [], []);
    expect(path.calls).toEqual([]);

    buildTrajectoryPath(path, IDENTITY_CAMERA, VIEWPORT, [5], [5]);
    expect(path.calls).toEqual([]);
  });
});

/** Least-squares fit of y = a*x^2 + b*x + c via the normal equations (3x3 solve by Cramer's rule). */
function fitQuadratic(xs: number[], ys: number[]): { a: number; b: number; c: number } {
  let s0 = 0,
    s1 = 0,
    s2 = 0,
    s3 = 0,
    s4 = 0,
    t0 = 0,
    t1 = 0,
    t2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    const x2 = x * x;
    s0 += 1;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    t0 += y;
    t1 += x * y;
    t2 += x2 * y;
  }
  // | s2 s3 s4 | |a|   |t2|
  // | s1 s2 s3 | |b| = |t1|
  // | s0 s1 s2 | |c|   |t0|
  const A = [
    [s4, s3, s2],
    [s3, s2, s1],
    [s2, s1, s0],
  ];
  const rhs = [t2, t1, t0];
  const det3 = (m: number[][]) =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const detA = det3(A);
  const withCol = (col: number) => A.map((row, i) => row.map((v, j) => (j === col ? rhs[i]! : v)));
  return { a: det3(withCol(0)) / detA, b: det3(withCol(1)) / detA, c: det3(withCol(2)) / detA };
}

describe("TrajectoryLayer renders a parabola for the drag-free preset (P3.09 validation)", () => {
  it("the traced screen-space polyline fits a quadratic curve to near-zero residual", () => {
    const dragFree = PRESET_SCENARIOS.find(
      (p) => p.model.forceIds.length === 1 && p.model.forceIds[0] === "gravity",
    );
    expect(
      dragFree,
      "expected a drag-free (gravity-only) preset in PRESET_SCENARIOS",
    ).toBeDefined();

    const session = createSimulationSession(dragFree!, [dragFree!]);
    const outcome = session.commitScenario(dragFree!);
    expect(outcome.status).toBe("ok");

    const trajectory = session.result.getState().trajectory!;
    const worldXs = trajectory.channels[0]!;
    const worldYs = trajectory.channels[1]!;
    // A smooth drag-free parabola needs very few adaptive steps at rtol
    // 1e-6 -- just enough points to make the quadratic fit meaningful (a
    // quadratic trivially fits any <=3 points).
    expect(trajectory.nSteps).toBeGreaterThan(3);

    const camera: Camera2DState = { centerX: 20, centerY: 5, scaleX: 4, scaleY: 6 };
    const path = new RecordingPath();
    buildTrajectoryPath(path, camera, VIEWPORT, worldXs, worldYs);

    const screenXs = path.calls.map((c) => c.x);
    const screenYs = path.calls.map((c) => c.y);
    const { a, b, c } = fitQuadratic(screenXs, screenYs);

    let sumSqResidual = 0;
    let sumSqY = 0;
    const meanY = screenYs.reduce((s, y) => s + y, 0) / screenYs.length;
    for (let i = 0; i < screenXs.length; i++) {
      const predicted = a * screenXs[i]! * screenXs[i]! + b * screenXs[i]! + c;
      sumSqResidual += (screenYs[i]! - predicted) ** 2;
      sumSqY += (screenYs[i]! - meanY) ** 2;
    }
    // R^2 of the quadratic fit -- an affine (camera) transform of a true
    // world-space parabola is still exactly a parabola in screen space, so
    // this should be a near-perfect fit (floating-point/integration noise
    // only), not just "roughly curved."
    const rSquared = 1 - sumSqResidual / sumSqY;
    expect(rSquared).toBeGreaterThan(1 - 1e-6);

    // Confirms it's actually curved (a parabola), not a degenerate line
    // that a quadratic fit would also satisfy trivially.
    expect(Math.abs(a)).toBeGreaterThan(1e-6);
  });
});
