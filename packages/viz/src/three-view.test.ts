import { describe, expect, it } from "vitest";
import type { Trajectory } from "@ballista/solverkit";
import { worldToScreen, type Viewport } from "./camera2d.js";
import {
  computeBoundsForPlane,
  fitThreeViewCameras,
  pickNearestTrajectoryPointInPlane,
  planeChannels,
  VIEW_PLANES,
  type ViewPlane,
} from "./three-view.js";

const VIEWPORT: Viewport = { width: 800, height: 600 };

/** Builds a dim-6 spatial trajectory (`[x, y, z, vx, vy, vz]`, P4.23 convention) from row tuples. */
function makeSpatialTrajectory(
  rows: readonly (readonly [number, number, number, number, number, number])[],
): Trajectory {
  const t = new Float64Array(rows.map((_, i) => i * 0.5));
  const channels = [0, 1, 2, 3, 4, 5].map((c) => new Float64Array(rows.map((row) => row[c]!)));
  return { nSteps: rows.length, t, channels };
}

describe("VIEW_PLANES / planeChannels", () => {
  it("lists all three planes in blueprint order", () => {
    expect(VIEW_PLANES).toEqual(["xy", "xz", "yz"]);
  });

  it("maps each plane to its channel-index pair against the spatial model's [x, y, z, ...] convention", () => {
    expect(planeChannels("xy")).toEqual({ horizontal: 0, vertical: 1 });
    expect(planeChannels("xz")).toEqual({ horizontal: 0, vertical: 2 });
    expect(planeChannels("yz")).toEqual({ horizontal: 1, vertical: 2 });
  });
});

describe("computeBoundsForPlane", () => {
  const trajectory = makeSpatialTrajectory([
    [0, 0, 0, 0, 0, 0],
    [10, 5, -3, 0, 0, 0],
    [20, 8, 4, 0, 0, 0],
    [30, 5, -1, 0, 0, 0],
  ]);

  it("bounds the xy projection from channels 0/1", () => {
    expect(computeBoundsForPlane(trajectory, "xy")).toEqual({
      minX: 0,
      maxX: 30,
      minY: 0,
      maxY: 8,
    });
  });

  it("bounds the xz projection from channels 0/2", () => {
    expect(computeBoundsForPlane(trajectory, "xz")).toEqual({
      minX: 0,
      maxX: 30,
      minY: -3,
      maxY: 4,
    });
  });

  it("bounds the yz projection from channels 1/2", () => {
    expect(computeBoundsForPlane(trajectory, "yz")).toEqual({
      minX: 0,
      maxX: 8,
      minY: -3,
      maxY: 4,
    });
  });

  it("throws on an empty trajectory (same as computeBounds)", () => {
    const empty = makeSpatialTrajectory([]);
    expect(() => computeBoundsForPlane(empty, "xy")).toThrow();
  });
});

describe("fitThreeViewCameras", () => {
  it("produces an independently-fit camera per plane for an anisotropic trajectory", () => {
    // Wide in x, short in y, moderate in z -- each plane's camera should
    // reflect only that plane's own span, not a shared/averaged one.
    const trajectory = makeSpatialTrajectory([
      [0, 0, 0, 0, 0, 0],
      [1000, 10, 50, 0, 0, 0],
    ]);
    const cameras = fitThreeViewCameras(trajectory, VIEWPORT, { paddingFraction: 0 });

    expect(cameras.xy.scaleX).toBeCloseTo(VIEWPORT.width / 1000, 6);
    expect(cameras.xy.scaleY).toBeCloseTo(VIEWPORT.height / 10, 6);

    expect(cameras.xz.scaleX).toBeCloseTo(VIEWPORT.width / 1000, 6);
    expect(cameras.xz.scaleY).toBeCloseTo(VIEWPORT.height / 50, 6);

    expect(cameras.yz.scaleX).toBeCloseTo(VIEWPORT.width / 10, 6);
    expect(cameras.yz.scaleY).toBeCloseTo(VIEWPORT.height / 50, 6);
  });

  it("centers each camera on that plane's own bounds midpoint", () => {
    const trajectory = makeSpatialTrajectory([
      [0, 0, 0, 0, 0, 0],
      [100, 20, -40, 0, 0, 0],
    ]);
    const cameras = fitThreeViewCameras(trajectory, VIEWPORT);
    expect(cameras.xy.centerX).toBe(50);
    expect(cameras.xy.centerY).toBe(10);
    expect(cameras.xz.centerX).toBe(50);
    expect(cameras.xz.centerY).toBe(-20);
    expect(cameras.yz.centerX).toBe(10);
    expect(cameras.yz.centerY).toBe(-20);
  });
});

describe("pickNearestTrajectoryPointInPlane", () => {
  // A helix-like path where x/y/z all vary independently, so a pick that
  // used the wrong channel pair would resolve to a different row.
  const trajectory = makeSpatialTrajectory([
    [0, 0, 0, 0, 0, 0],
    [10, 5, 20, 0, 0, 0],
    [20, 8, 10, 0, 0, 0],
    [30, 5, 30, 0, 0, 0],
    [40, 0, 5, 0, 0, 0],
  ]);
  const cameras = fitThreeViewCameras(trajectory, VIEWPORT, { paddingFraction: 0 });

  it.each<ViewPlane>(VIEW_PLANES)(
    "picks the exact row under the identity-ish camera for plane %s",
    (plane) => {
      const camera = cameras[plane];
      const { horizontal, vertical } = planeChannels(plane);
      const targetRow = 2;
      const cursor = worldToScreen(camera, VIEWPORT, {
        x: trajectory.channels[horizontal]![targetRow]!,
        y: trajectory.channels[vertical]![targetRow]!,
      });
      const index = pickNearestTrajectoryPointInPlane(camera, VIEWPORT, trajectory, plane, cursor);
      expect(index).toBe(targetRow);
    },
  );

  it("returns null when the cursor is farther than maxDistancePx from every row", () => {
    const index = pickNearestTrajectoryPointInPlane(cameras.xy, VIEWPORT, trajectory, "xy", {
      x: -10_000,
      y: -10_000,
    });
    expect(index).toBeNull();
  });

  it("a pick made in one view identifies the same row an equivalent pick in another view would (trajectory consistency)", () => {
    const targetRow = 3;
    const xyCursor = worldToScreen(cameras.xy, VIEWPORT, {
      x: trajectory.channels[0]![targetRow]!,
      y: trajectory.channels[1]![targetRow]!,
    });
    const xzCursor = worldToScreen(cameras.xz, VIEWPORT, {
      x: trajectory.channels[0]![targetRow]!,
      y: trajectory.channels[2]![targetRow]!,
    });

    const xyIndex = pickNearestTrajectoryPointInPlane(
      cameras.xy,
      VIEWPORT,
      trajectory,
      "xy",
      xyCursor,
    );
    const xzIndex = pickNearestTrajectoryPointInPlane(
      cameras.xz,
      VIEWPORT,
      trajectory,
      "xz",
      xzCursor,
    );

    expect(xyIndex).toBe(targetRow);
    expect(xzIndex).toBe(targetRow);
    expect(xyIndex).toBe(xzIndex);
  });
});
