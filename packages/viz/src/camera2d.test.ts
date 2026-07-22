import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  IDENTITY_CAMERA,
  panByScreenDelta,
  screenToWorld,
  worldToScreen,
  zoomAtScreenPoint,
  type Camera2DState,
  type Viewport,
} from "./camera2d.js";

const scale = fc.double({ min: 0.01, max: 200, noNaN: true, noDefaultInfinity: true });
const coord = fc.double({ min: -1e4, max: 1e4, noNaN: true, noDefaultInfinity: true });
const dimension = fc.double({ min: 1, max: 4000, noNaN: true, noDefaultInfinity: true });

const camera = fc.record({ centerX: coord, centerY: coord, scaleX: scale, scaleY: scale });
const viewport = fc.record({ width: dimension, height: dimension });

describe("Camera2D world<->screen transforms (P3.06)", () => {
  it("maps the camera center to the viewport center", () => {
    const cam: Camera2DState = { centerX: 12.5, centerY: -3, scaleX: 10, scaleY: 20 };
    const vp: Viewport = { width: 800, height: 600 };
    expect(worldToScreen(cam, vp, { x: cam.centerX, y: cam.centerY })).toEqual({ x: 400, y: 300 });
  });

  it("flips y: increasing world y (up) decreases screen y", () => {
    const cam = IDENTITY_CAMERA;
    const vp: Viewport = { width: 100, height: 100 };
    const lowScreen = worldToScreen(cam, vp, { x: 0, y: 1 });
    const highScreen = worldToScreen(cam, vp, { x: 0, y: 10 });
    expect(highScreen.y).toBeLessThan(lowScreen.y);
  });

  it("scales x and y independently (anisotropic)", () => {
    const cam: Camera2DState = { centerX: 0, centerY: 0, scaleX: 2, scaleY: 5 };
    const vp: Viewport = { width: 100, height: 100 };
    const p = worldToScreen(cam, vp, { x: 3, y: 3 });
    expect(p.x - 50).toBeCloseTo(3 * 2, 10);
    expect(50 - p.y).toBeCloseTo(3 * 5, 10);
  });

  it("screenToWorld is the exact inverse of worldToScreen (round-trip property, 1e3 cases)", () => {
    fc.assert(
      fc.property(camera, viewport, coord, coord, (cam, vp, x, y) => {
        const world = { x, y };
        const screen = worldToScreen(cam, vp, world);
        const roundTripped = screenToWorld(cam, vp, screen);
        expect(roundTripped.x).toBeCloseTo(world.x, 6);
        expect(roundTripped.y).toBeCloseTo(world.y, 6);
      }),
      { numRuns: 1000 },
    );
  });

  it("worldToScreen is the exact inverse of screenToWorld (round-trip property, 1e3 cases)", () => {
    fc.assert(
      fc.property(camera, viewport, coord, coord, (cam, vp, sx, sy) => {
        const screen = { x: sx, y: sy };
        const world = screenToWorld(cam, vp, screen);
        const roundTripped = worldToScreen(cam, vp, world);
        expect(roundTripped.x).toBeCloseTo(screen.x, 6);
        expect(roundTripped.y).toBeCloseTo(screen.y, 6);
      }),
      { numRuns: 1000 },
    );
  });

  it("panByScreenDelta shifts every rendered point's screen position by exactly the drag delta", () => {
    fc.assert(
      fc.property(
        camera,
        viewport,
        coord,
        coord,
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (cam, vp, worldX, worldY, dx, dy) => {
          const world = { x: worldX, y: worldY };
          const before = worldToScreen(cam, vp, world);
          const panned = panByScreenDelta(cam, dx, dy);
          const after = worldToScreen(panned, vp, world);
          expect(after.x - before.x).toBeCloseTo(dx, 6);
          expect(after.y - before.y).toBeCloseTo(dy, 6);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("panByScreenDelta leaves scale unchanged", () => {
    const cam: Camera2DState = { centerX: 1, centerY: 2, scaleX: 3, scaleY: 4 };
    const panned = panByScreenDelta(cam, 10, -10);
    expect(panned.scaleX).toBe(cam.scaleX);
    expect(panned.scaleY).toBe(cam.scaleY);
  });

  it("zoomAtScreenPoint keeps the cursor's world point fixed on screen (validation criterion, 1e3 cases)", () => {
    fc.assert(
      fc.property(
        camera,
        viewport,
        fc.double({ min: 0.25, max: 4, noNaN: true, noDefaultInfinity: true }),
        (cam, vp, factor) => {
          const cursor = { x: vp.width * 0.3, y: vp.height * 0.7 };
          const worldAnchorBefore = screenToWorld(cam, vp, cursor);
          const zoomed = zoomAtScreenPoint(cam, vp, cursor, factor);
          const screenAfter = worldToScreen(zoomed, vp, worldAnchorBefore);
          expect(screenAfter.x).toBeCloseTo(cursor.x, 6);
          expect(screenAfter.y).toBeCloseTo(cursor.y, 6);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("zoomAtScreenPoint scales both axes by the same factor, preserving anisotropy ratio", () => {
    const cam: Camera2DState = { centerX: 0, centerY: 0, scaleX: 2, scaleY: 8 };
    const vp: Viewport = { width: 400, height: 300 };
    const zoomed = zoomAtScreenPoint(cam, vp, { x: 100, y: 50 }, 3);
    expect(zoomed.scaleX).toBeCloseTo(6, 10);
    expect(zoomed.scaleY).toBeCloseTo(24, 10);
    expect(zoomed.scaleX / zoomed.scaleY).toBeCloseTo(cam.scaleX / cam.scaleY, 10);
  });

  it("zooming in (factor>1) at the viewport center leaves the center fixed and shrinks apparent distances outward", () => {
    const cam = IDENTITY_CAMERA;
    const vp: Viewport = { width: 200, height: 200 };
    const cursor = { x: 100, y: 100 }; // viewport center
    const zoomed = zoomAtScreenPoint(cam, vp, cursor, 2);
    expect(zoomed.centerX).toBeCloseTo(cam.centerX, 10);
    expect(zoomed.centerY).toBeCloseTo(cam.centerY, 10);

    const farWorldPoint = { x: 50, y: 0 };
    const before = worldToScreen(cam, vp, farWorldPoint);
    const after = worldToScreen(zoomed, vp, farWorldPoint);
    // zooming in about the center pushes points further from center outward on screen
    expect(Math.abs(after.x - cursor.x)).toBeGreaterThan(Math.abs(before.x - cursor.x));
  });
});
