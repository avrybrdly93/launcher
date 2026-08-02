import { describe, expect, it } from "vitest";
import type { Trajectory } from "@ballista/solverkit";
import { IDENTITY_CAMERA, worldToScreen, type Camera2DState, type Viewport } from "./camera2d.js";
import { buildTrajectoryPath, type PathBuilder } from "./trajectory-layer.js";
import { pickNearestTrajectoryPoint } from "./hover-picking.js";
import {
  ORTHOGRAPHIC_VIEW_IDS,
  ORTHOGRAPHIC_VIEWS,
  type OrthographicViewId,
} from "./orthographic-view.js";

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
const CAMERA: Camera2DState = { ...IDENTITY_CAMERA, scaleX: 2, scaleY: 3 };

// [x, y, z, vx, vy, vz] rows -- SPATIAL_CHANNELS convention (x=downrange, y=up, z=lateral;
// spatial-projectile-model.ts, P4.23). Values chosen distinct on every axis so a bug that
// silently swaps or reuses a channel across views would move a point in the test.
const ROWS: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 0, 30, 20, 5],
  [10, 8, 3, 30, 12, 5],
  [20, 12, 6, 30, 4, 5],
  [30, 8, 9, 30, -4, 5],
  [40, 0, 12, 30, -12, 5],
];

function makeSpatialTrajectory(): Trajectory {
  const t = new Float64Array(ROWS.map((_, i) => i * 0.5));
  const channels = [0, 1, 2, 3, 4, 5].map((c) => new Float64Array(ROWS.map((row) => row[c]!)));
  return { nSteps: ROWS.length, t, channels };
}

describe("ORTHOGRAPHIC_VIEWS", () => {
  it("covers exactly xy, xz, yz, each pairing two distinct position channels (0=x, 1=y, 2=z)", () => {
    expect(ORTHOGRAPHIC_VIEW_IDS).toEqual(["xy", "xz", "yz"]);
    for (const id of ORTHOGRAPHIC_VIEW_IDS) {
      const view = ORTHOGRAPHIC_VIEWS[id];
      expect(view.id).toBe(id);
      expect([0, 1, 2]).toContain(view.horizontalChannel);
      expect([0, 1, 2]).toContain(view.verticalChannel);
      expect(view.horizontalChannel).not.toBe(view.verticalChannel);
    }
  });

  it("xy matches the pre-3D [x, y] convention trajectory-layer.ts/hover-picking.ts already assume", () => {
    expect(ORTHOGRAPHIC_VIEWS.xy.horizontalChannel).toBe(0);
    expect(ORTHOGRAPHIC_VIEWS.xy.verticalChannel).toBe(1);
  });
});

describe("P4.26 validation: trajectory consistent across views", () => {
  const trajectory = makeSpatialTrajectory();

  it.each(ORTHOGRAPHIC_VIEW_IDS)("%s traces the same rows via its own channel pair", (id) => {
    const view = ORTHOGRAPHIC_VIEWS[id];
    const path = new RecordingPath();
    buildTrajectoryPath(
      path,
      CAMERA,
      VIEWPORT,
      trajectory.channels[view.horizontalChannel]!,
      trajectory.channels[view.verticalChannel]!,
    );

    expect(path.calls).toHaveLength(ROWS.length);
    for (let i = 0; i < ROWS.length; i++) {
      const expected = worldToScreen(CAMERA, VIEWPORT, {
        x: ROWS[i]![view.horizontalChannel]!,
        y: ROWS[i]![view.verticalChannel]!,
      });
      expect(path.calls[i]!.x).toBeCloseTo(expected.x, 10);
      expect(path.calls[i]!.y).toBeCloseTo(expected.y, 10);
    }
  });

  it("the three views render genuinely different screen paths for the same trajectory (not accidentally all xy)", () => {
    const pathsByView = new Map<OrthographicViewId, RecordingPath>();
    for (const id of ORTHOGRAPHIC_VIEW_IDS) {
      const view = ORTHOGRAPHIC_VIEWS[id];
      const path = new RecordingPath();
      buildTrajectoryPath(
        path,
        CAMERA,
        VIEWPORT,
        trajectory.channels[view.horizontalChannel]!,
        trajectory.channels[view.verticalChannel]!,
      );
      pathsByView.set(id, path);
    }

    const xy = pathsByView.get("xy")!.calls;
    const xz = pathsByView.get("xz")!.calls;
    const yz = pathsByView.get("yz")!.calls;
    expect(xy).not.toEqual(xz);
    expect(xy).not.toEqual(yz);
    expect(xz).not.toEqual(yz);
  });
});

describe("P4.26 validation: picking works per-view", () => {
  const trajectory = makeSpatialTrajectory();

  it.each(ORTHOGRAPHIC_VIEW_IDS)(
    "%s: a cursor at a row's own projected position picks that row",
    (id) => {
      const view = ORTHOGRAPHIC_VIEWS[id];
      const targetIndex = 2;
      const cursor = worldToScreen(CAMERA, VIEWPORT, {
        x: ROWS[targetIndex]![view.horizontalChannel]!,
        y: ROWS[targetIndex]![view.verticalChannel]!,
      });

      const picked = pickNearestTrajectoryPoint(
        CAMERA,
        VIEWPORT,
        trajectory,
        cursor,
        20,
        view.horizontalChannel,
        view.verticalChannel,
      );

      expect(picked).toBe(targetIndex);
    },
  );

  it("picking against the wrong view's channel pair can disagree with the right one (proves per-view picking isn't a no-op)", () => {
    // Row 4's xy position (40, 0) and xz position (40, 12) are far apart on screen at this
    // camera's anisotropic scale, so a cursor placed at row 4's xz position should not resolve
    // to the same row under the (wrong) xy channel pair within the default pick tolerance.
    const xzView = ORTHOGRAPHIC_VIEWS.xz;
    const cursorAtRow4Xz = worldToScreen(CAMERA, VIEWPORT, {
      x: ROWS[4]![xzView.horizontalChannel]!,
      y: ROWS[4]![xzView.verticalChannel]!,
    });

    const pickedAsXz = pickNearestTrajectoryPoint(
      CAMERA,
      VIEWPORT,
      trajectory,
      cursorAtRow4Xz,
      20,
      xzView.horizontalChannel,
      xzView.verticalChannel,
    );
    const pickedAsXy = pickNearestTrajectoryPoint(CAMERA, VIEWPORT, trajectory, cursorAtRow4Xz, 20);

    expect(pickedAsXz).toBe(4);
    expect(pickedAsXy).not.toBe(4);
  });
});
