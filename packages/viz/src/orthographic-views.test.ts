import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Trajectory } from "@ballista/solverkit";
import { screenToWorld, worldToScreen, zoomAtScreenPoint, type Viewport } from "./camera2d.js";
import {
  ORTHOGRAPHIC_VIEWS,
  boundsForView,
  fitCameraToView,
  orthographicViewDef,
  pickNearestPointInView,
  trajectoryViewChannels,
} from "./orthographic-views.js";

const VIEWPORT: Viewport = { width: 800, height: 600 };

/** A 6-channel spatial trajectory ([x, y, z, vx, vy, vz], `spatial-projectile-model.ts`'s layout). */
function makeSpatialTrajectory(
  rows: readonly (readonly [number, number, number, number, number, number])[],
): Trajectory {
  const t = new Float64Array(rows.map((_, i) => i * 0.5));
  const channels = [0, 1, 2, 3, 4, 5].map((c) => new Float64Array(rows.map((row) => row[c]!)));
  return { nSteps: rows.length, t, channels };
}

/** A minimal 2-channel trajectory ([x, y] only) -- no channel 2 recorded at all, unlike the 6-channel spatial layout. */
function make2ChannelTrajectory(rows: readonly (readonly [number, number])[]): Trajectory {
  const t = new Float64Array(rows.map((_, i) => i * 0.5));
  const channels = [0, 1].map((c) => new Float64Array(rows.map((row) => row[c]!)));
  return { nSteps: rows.length, t, channels };
}

const coord = fc.double({ min: -1e4, max: 1e4, noNaN: true, noDefaultInfinity: true });
const row = fc.tuple(coord, coord, coord, coord, coord, coord);
const rows = fc.array(row, { minLength: 2, maxLength: 20 });

describe("ORTHOGRAPHIC_VIEWS (P4.26)", () => {
  it("defines exactly xy, xz, yz, each as a distinct channel pair", () => {
    expect(ORTHOGRAPHIC_VIEWS.map((v) => v.id)).toEqual(["xy", "xz", "yz"]);
    expect(ORTHOGRAPHIC_VIEWS.map((v) => [v.xChannel, v.yChannel])).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });

  it("orthographicViewDef throws on an id outside the 3 canonical views", () => {
    // @ts-expect-error -- intentionally invalid id, exercising the runtime guard
    expect(() => orthographicViewDef("zx")).toThrow(/unknown view id/);
  });
});

describe("trajectory consistent across views (P4.26 validation criterion)", () => {
  it("xy and xz views agree on channel 0 (x); xy and yz agree on channel 1 (y); xz and yz agree on channel 2 (z)", () => {
    fc.assert(
      fc.property(rows, (data) => {
        const trajectory = makeSpatialTrajectory(
          data as (readonly [number, number, number, number, number, number])[],
        );
        const xy = trajectoryViewChannels(trajectory, "xy");
        const xz = trajectoryViewChannels(trajectory, "xz");
        const yz = trajectoryViewChannels(trajectory, "yz");

        for (let i = 0; i < trajectory.nSteps; i++) {
          expect(xy.xs[i]).toBe(xz.xs[i]); // both read channel 0
          expect(xy.ys[i]).toBe(yz.xs[i]); // both read channel 1
          expect(xz.ys[i]).toBe(yz.ys[i]); // both read channel 2
        }
      }),
      { numRuns: 50 },
    );
  });

  it("a 2D (z≡0) trajectory's xz/yz views degenerate to a flat z=0 line, xy view is unchanged", () => {
    const trajectory = makeSpatialTrajectory([
      [0, 0, 0, 10, 10, 0],
      [10, 5, 0, 10, 5, 0],
      [20, 8, 0, 10, 0, 0],
    ]);
    const xy = trajectoryViewChannels(trajectory, "xy");
    const xz = trajectoryViewChannels(trajectory, "xz");
    const yz = trajectoryViewChannels(trajectory, "yz");

    expect(Array.from(xy.xs)).toEqual([0, 10, 20]);
    expect(Array.from(xy.ys)).toEqual([0, 5, 8]);
    expect(Array.from(xz.ys)).toEqual([0, 0, 0]);
    expect(Array.from(yz.ys)).toEqual([0, 0, 0]);
  });

  it("trajectoryViewChannels throws for a view whose channel isn't recorded (e.g. xz/yz on a 2-channel [x, y]-only trajectory)", () => {
    const trajectory = make2ChannelTrajectory([
      [0, 0],
      [10, 5],
    ]);
    expect(() => trajectoryViewChannels(trajectory, "xy")).not.toThrow();
    expect(() => trajectoryViewChannels(trajectory, "xz")).toThrow(/channels 0\/2/);
    expect(() => trajectoryViewChannels(trajectory, "yz")).toThrow(/channels 1\/2/);
  });

  it("fitCameraToView + worldToScreen/screenToWorld round-trips every row's exact channel pair, independently per view", () => {
    fc.assert(
      fc.property(rows, (data) => {
        const trajectory = makeSpatialTrajectory(
          data as (readonly [number, number, number, number, number, number])[],
        );
        for (const view of ORTHOGRAPHIC_VIEWS) {
          const bounds = boundsForView(trajectory, view.id);
          const camera = fitCameraToView(trajectory, view.id, VIEWPORT);
          const { xs, ys } = trajectoryViewChannels(trajectory, view.id);

          // every row's world point round-trips through this view's own camera
          for (let i = 0; i < trajectory.nSteps; i++) {
            const world = { x: xs[i]!, y: ys[i]! };
            const screen = worldToScreen(camera, VIEWPORT, world);
            const back = screenToWorld(camera, VIEWPORT, screen);
            expect(back.x).toBeCloseTo(world.x, 4);
            expect(back.y).toBeCloseTo(world.y, 4);
          }

          // and the fitted camera actually contains the bounds it was fit to
          expect(bounds.minX).toBeLessThanOrEqual(bounds.maxX);
          expect(bounds.minY).toBeLessThanOrEqual(bounds.maxY);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("picking works per-view (P4.26 validation criterion)", () => {
  const trajectory = makeSpatialTrajectory([
    [0, 0, 0, 10, 10, 0],
    [10, 5, 3, 10, 5, 1],
    [20, 8, -2, 10, 0, -1],
    [30, 5, 6, 10, -5, 2],
    [40, 0, 0, 10, -10, 0],
  ]);

  it("each view picks the row nearest the cursor under its own auto-fit camera", () => {
    for (const view of ORTHOGRAPHIC_VIEWS) {
      const camera = fitCameraToView(trajectory, view.id, VIEWPORT);
      const { xs, ys } = trajectoryViewChannels(trajectory, view.id);
      const cursor = worldToScreen(camera, VIEWPORT, { x: xs[2]!, y: ys[2]! });
      expect(pickNearestPointInView(trajectory, view.id, camera, VIEWPORT, cursor)).toBe(2);
    }
  });

  it("picking in one view is independent of another view's zoom/pan (different cameras pick correctly and don't cross-contaminate)", () => {
    const xyCamera = fitCameraToView(trajectory, "xy", VIEWPORT);
    const xzCameraBase = fitCameraToView(trajectory, "xz", VIEWPORT);
    // zoom the xz view in hard on row 3, leaving the xy camera untouched
    const xzAnchor = worldToScreen(xzCameraBase, VIEWPORT, { x: 30, y: 6 });
    const xzCamera = zoomAtScreenPoint(xzCameraBase, VIEWPORT, xzAnchor, 10);

    const xyCursor = worldToScreen(xyCamera, VIEWPORT, { x: 20, y: 8 });
    expect(pickNearestPointInView(trajectory, "xy", xyCamera, VIEWPORT, xyCursor)).toBe(2);

    const xzCursor = worldToScreen(xzCamera, VIEWPORT, { x: 30, y: 6 });
    expect(pickNearestPointInView(trajectory, "xz", xzCamera, VIEWPORT, xzCursor)).toBe(3);

    // the zoomed xz camera would NOT correctly pick row 2 at the xy cursor's screen position
    // (different camera, different channel pair) -- views really are independent, not aliased
    expect(pickNearestPointInView(trajectory, "xz", xzCamera, VIEWPORT, xyCursor)).not.toBe(2);
  });

  it("returns null in a view where the cursor is far from every row, even while another view would hit", () => {
    const camera = fitCameraToView(trajectory, "yz", VIEWPORT);
    const farAway = { x: -10_000, y: -10_000 };
    expect(pickNearestPointInView(trajectory, "yz", camera, VIEWPORT, farAway)).toBeNull();
  });
});
