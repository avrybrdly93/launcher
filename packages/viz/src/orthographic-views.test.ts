import { describe, expect, it } from "vitest";
import type { Trajectory } from "@ballista/solverkit";
import { worldToScreen, type Viewport } from "./camera2d.js";
import {
  VIEW_PLANE_CHANNELS,
  VIEW_PLANE_LABELS,
  VIEW_PLANES,
  boundsForPlane,
  channelsForPlane,
  followThreeViewBounds,
  initThreeView,
  pickInView,
  setViewCamera,
  type ViewPlane,
} from "./orthographic-views.js";

const VIEWPORT: Viewport = { width: 800, height: 600 };

/** SPATIAL_CHANNELS order: [x, y, z, vx, vy, vz] (spatial-projectile-model.ts). */
function makeSpatialTrajectory(
  rows: readonly (readonly [number, number, number, number, number, number])[],
): Trajectory {
  const t = new Float64Array(rows.map((_, i) => i * 0.5));
  const channels = [0, 1, 2, 3, 4, 5].map((c) => new Float64Array(rows.map((row) => row[c]!)));
  return { nSteps: rows.length, t, channels };
}

// A trajectory that varies differently on each axis, so xy/xz/yz projections
// are genuinely distinct (not accidentally coincident) -- x sweeps widest,
// z sweeps a small lateral range, y is a simple arc.
const TRAJECTORY = makeSpatialTrajectory([
  [0, 0, 0, 50, 20, 1],
  [25, 8, 1, 50, 15, 1],
  [50, 12, 2, 50, 10, 1],
  [75, 8, 1, 50, 5, 1],
  [100, 0, 0, 50, 0, 1],
]);

describe("orthographic-views", () => {
  it("VIEW_PLANE_CHANNELS/VIEW_PLANE_LABELS agree on the SPATIAL_CHANNELS [x,y,z] convention", () => {
    expect(VIEW_PLANE_CHANNELS.xy).toEqual([0, 1]);
    expect(VIEW_PLANE_CHANNELS.xz).toEqual([0, 2]);
    expect(VIEW_PLANE_CHANNELS.yz).toEqual([1, 2]);
    expect(VIEW_PLANE_LABELS.xy).toEqual(["x", "y"]);
    expect(VIEW_PLANE_LABELS.xz).toEqual(["x", "z"]);
    expect(VIEW_PLANE_LABELS.yz).toEqual(["y", "z"]);
  });

  it("channelsForPlane reads the right pair of columnar channels per view", () => {
    const xy = channelsForPlane(TRAJECTORY, "xy");
    expect(Array.from(xy.a)).toEqual([0, 25, 50, 75, 100]);
    expect(Array.from(xy.b)).toEqual([0, 8, 12, 8, 0]);

    const xz = channelsForPlane(TRAJECTORY, "xz");
    expect(Array.from(xz.a)).toEqual([0, 25, 50, 75, 100]);
    expect(Array.from(xz.b)).toEqual([0, 1, 2, 1, 0]);
  });

  it("channelsForPlane throws for a plane the trajectory has no channels for (2D-model trajectory has no z)", () => {
    const flat2D: Trajectory = {
      nSteps: 2,
      t: new Float64Array([0, 1]),
      channels: [new Float64Array([0, 1]), new Float64Array([0, 1])],
    };
    expect(() => channelsForPlane(flat2D, "xz")).toThrow(/no channel/);
  });

  it("boundsForPlane differs per view (each plane genuinely projects different data)", () => {
    const xy = boundsForPlane(TRAJECTORY, "xy");
    const xz = boundsForPlane(TRAJECTORY, "xz");
    const yz = boundsForPlane(TRAJECTORY, "yz");

    expect(xy).toEqual({ minX: 0, maxX: 100, minY: 0, maxY: 12 });
    expect(xz).toEqual({ minX: 0, maxX: 100, minY: 0, maxY: 2 });
    expect(yz).toEqual({ minX: 0, maxX: 12, minY: 0, maxY: 2 });
  });

  it("initThreeView auto-fits all three views independently from the same trajectory", () => {
    const state = initThreeView(TRAJECTORY, VIEWPORT);
    for (const plane of VIEW_PLANES) {
      expect(state[plane].autoFit).toBe(true);
    }
    // Different bounds per view (see previous test) -> different fitted cameras.
    expect(state.xy.camera).not.toEqual(state.xz.camera);
    expect(state.xz.camera).not.toEqual(state.yz.camera);
  });

  it("setViewCamera changes only the targeted view, leaving the other two untouched", () => {
    const before = initThreeView(TRAJECTORY, VIEWPORT);
    const customCamera = { centerX: 1, centerY: 2, scaleX: 3, scaleY: 4 };
    const after = setViewCamera(before, "xz", customCamera);

    expect(after.xz).toEqual({ camera: customCamera, autoFit: false });
    expect(after.xy).toEqual(before.xy);
    expect(after.yz).toEqual(before.yz);
  });

  it("followThreeViewBounds re-fits only still-auto-fitting views, leaving a manually-set view alone", () => {
    const initial = initThreeView(TRAJECTORY, VIEWPORT);
    const manualCamera = { centerX: 0, centerY: 0, scaleX: 1, scaleY: 1 };
    const withManualXy = setViewCamera(initial, "xy", manualCamera);

    // A new, wider trajectory is published.
    const widerTrajectory = makeSpatialTrajectory([
      [0, 0, 0, 50, 20, 1],
      [200, 40, 5, 50, 0, 1],
    ]);
    const followed = followThreeViewBounds(withManualXy, widerTrajectory, VIEWPORT);

    // xy was manually set -> untouched.
    expect(followed.xy).toEqual(withManualXy.xy);
    // xz/yz were still auto-fitting -> re-fit to the new (wider) bounds.
    expect(followed.xz.autoFit).toBe(true);
    expect(followed.xz.camera).not.toEqual(withManualXy.xz.camera);
  });

  it("picking works per-view (P4.26 validation criterion) and stays consistent with the same trajectory row across all three views", () => {
    const state = initThreeView(TRAJECTORY, VIEWPORT);
    const rowIndex = 2; // [50, 12, 2, 50, 10, 1]

    const planeChecks: Record<ViewPlane, readonly [number, number]> = {
      xy: [50, 12],
      xz: [50, 2],
      yz: [12, 2],
    };

    for (const plane of VIEW_PLANES) {
      const [worldA, worldB] = planeChecks[plane];
      const cursor = worldToScreen(state[plane].camera, VIEWPORT, { x: worldA, y: worldB });
      expect(pickInView(state, plane, VIEWPORT, TRAJECTORY, cursor)).toBe(rowIndex);
    }
  });

  it("a pick far from every row in one view returns null without affecting the others", () => {
    const state = initThreeView(TRAJECTORY, VIEWPORT);
    const farAway = { x: -10_000, y: -10_000 };
    expect(pickInView(state, "yz", VIEWPORT, TRAJECTORY, farAway)).toBeNull();
    // A well-placed cursor in another view still picks correctly.
    const xyCursor = worldToScreen(state.xy.camera, VIEWPORT, { x: 0, y: 0 });
    expect(pickInView(state, "xy", VIEWPORT, TRAJECTORY, xyCursor)).toBe(0);
  });
});
