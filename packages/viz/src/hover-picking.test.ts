import { describe, expect, it } from "vitest";
import type { ChannelMeta } from "@ballista/engine";
import type { Trajectory } from "@ballista/solverkit";
import { IDENTITY_CAMERA, worldToScreen, zoomAtScreenPoint, type Viewport } from "./camera2d.js";
import {
  DEFAULT_MAX_PICK_DISTANCE_PX,
  pickNearestTrajectoryPoint,
  trajectoryPointTooltip,
} from "./hover-picking.js";

const VIEWPORT: Viewport = { width: 800, height: 600 };

function makeTrajectory(rows: readonly (readonly [number, number, number, number])[]): Trajectory {
  const t = new Float64Array(rows.map((_, i) => i * 0.5));
  const channels = [0, 1, 2, 3].map((c) => new Float64Array(rows.map((row) => row[c]!)));
  return { nSteps: rows.length, t, channels };
}

const CHANNEL_META: readonly ChannelMeta[] = [
  { name: "x", unit: "m" },
  { name: "y", unit: "m" },
  { name: "vx", unit: "m/s" },
  { name: "vy", unit: "m/s" },
];

describe("pickNearestTrajectoryPoint", () => {
  const trajectory = makeTrajectory([
    [0, 0, 10, 10],
    [10, 5, 10, 5],
    [20, 8, 10, 0],
    [30, 5, 10, -5],
    [40, 0, 10, -10],
  ]);

  it("picks the row whose world position is screen-nearest the cursor at the identity camera", () => {
    const cursor = worldToScreen(IDENTITY_CAMERA, VIEWPORT, { x: 20, y: 8 });
    const index = pickNearestTrajectoryPoint(IDENTITY_CAMERA, VIEWPORT, trajectory, cursor);
    expect(index).toBe(2);
  });

  it("a cursor offset by a few px from a row still resolves to that row (within default tolerance)", () => {
    const exact = worldToScreen(IDENTITY_CAMERA, VIEWPORT, { x: 30, y: 5 });
    const nudged = { x: exact.x + 3, y: exact.y - 2 };
    const index = pickNearestTrajectoryPoint(IDENTITY_CAMERA, VIEWPORT, trajectory, nudged);
    expect(index).toBe(3);
  });

  it("returns null when every row is farther than maxDistancePx", () => {
    const farAway = { x: -10_000, y: -10_000 };
    const index = pickNearestTrajectoryPoint(IDENTITY_CAMERA, VIEWPORT, trajectory, farAway);
    expect(index).toBeNull();
  });

  it("returns null for an empty trajectory", () => {
    const index = pickNearestTrajectoryPoint(IDENTITY_CAMERA, VIEWPORT, makeTrajectory([]), {
      x: 0,
      y: 0,
    });
    expect(index).toBeNull();
  });

  it("picked index stays correct after zooming (P3.17 validation criterion: picked index correct under zoom)", () => {
    // Zoom in 8x centered on row 1's world position (10, 5): its screen
    // position is now the exact zoom anchor (viewport center), while every
    // other row has been pushed proportionally farther away on screen --
    // the anisotropic-scaling scenario this function exists to handle
    // correctly (world-space "nearest" would not match here).
    const anchorScreen = worldToScreen(IDENTITY_CAMERA, VIEWPORT, { x: 10, y: 5 });
    const zoomed = zoomAtScreenPoint(IDENTITY_CAMERA, VIEWPORT, anchorScreen, 8);

    const cursor = worldToScreen(zoomed, VIEWPORT, { x: 10, y: 5 });
    const index = pickNearestTrajectoryPoint(zoomed, VIEWPORT, trajectory, cursor);
    expect(index).toBe(1);

    // A synthetic click a few pixels off the zoomed marker still resolves
    // to the same row, at a distance that would have picked a neighboring
    // row before zooming in.
    const nudged = { x: cursor.x + 5, y: cursor.y - 3 };
    expect(pickNearestTrajectoryPoint(zoomed, VIEWPORT, trajectory, nudged)).toBe(1);
  });

  it("a synthetic click nearer to a neighboring row under the same zoom picks that row instead", () => {
    const anchorScreen = worldToScreen(IDENTITY_CAMERA, VIEWPORT, { x: 10, y: 5 });
    const zoomed = zoomAtScreenPoint(IDENTITY_CAMERA, VIEWPORT, anchorScreen, 8);

    const rowTwoScreen = worldToScreen(zoomed, VIEWPORT, { x: 20, y: 8 });
    const index = pickNearestTrajectoryPoint(zoomed, VIEWPORT, trajectory, rowTwoScreen);
    expect(index).toBe(2);
  });

  it("honors a custom maxDistancePx tighter than the default", () => {
    // A single isolated row (nothing else within thousands of world units)
    // so the only question being tested is the threshold itself, not which
    // row is nearer.
    const isolated = makeTrajectory([[0, 0, 0, 0]]);
    const exact = worldToScreen(IDENTITY_CAMERA, VIEWPORT, { x: 0, y: 0 });
    const nudged = { x: exact.x + 15, y: exact.y };

    expect(pickNearestTrajectoryPoint(IDENTITY_CAMERA, VIEWPORT, isolated, nudged)).toBe(0);
    expect(DEFAULT_MAX_PICK_DISTANCE_PX).toBeGreaterThanOrEqual(15);
    expect(pickNearestTrajectoryPoint(IDENTITY_CAMERA, VIEWPORT, isolated, nudged, 10)).toBeNull();
  });
});

describe("trajectoryPointTooltip", () => {
  const trajectory = makeTrajectory([
    [0, 0, 10, 10],
    [10, 5, 10, 5],
    [20, 8, 10, 0],
  ]);

  it("lists every channel's exact recorded value at the picked index, labeled by name/unit", () => {
    const tooltip = trajectoryPointTooltip(trajectory, CHANNEL_META, 1);

    expect(tooltip.t).toBe(0.5);
    expect(tooltip.channels).toEqual([
      { name: "x", unit: "m", value: 10 },
      { name: "y", unit: "m", value: 5 },
      { name: "vx", unit: "m/s", value: 10 },
      { name: "vy", unit: "m/s", value: 5 },
    ]);
  });
});
