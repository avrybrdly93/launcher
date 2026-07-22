/**
 * `Camera2D` (§6.1 Scene/WorldLayer, §5.5 worked example 3): pan + zoom over
 * an anisotropic world↔screen transform (independent x/y scales -- essential
 * when a trajectory's horizontal range is orders of magnitude larger than
 * its peak height). World coordinates are physics units, y-up; screen
 * coordinates are CSS pixels, y-down, origin top-left -- the two `worldTo*`/
 * `*ToWorld` functions are the one place that y-flip lives, so rendering and
 * hover-picking (§6.1) share exactly the same transform instead of each
 * re-deriving it.
 *
 * All state here is plain, immutable data and all functions are pure --
 * `Camera2DState` in, `Camera2DState` out -- so it composes with the rest of
 * the platform's store-driven architecture (§5.3) without any hidden
 * mutable camera object.
 */

/** World-space point (physics units; y increases upward). */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** Screen-space point (CSS pixels; y increases downward, origin top-left). */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** The CSS-pixel size of the viewport the camera renders into. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * `(centerX, centerY)` is the world point rendered at the viewport's
 * center; `scaleX`/`scaleY` are screen pixels per world unit along each
 * axis (kept independent -- anisotropic zoom -- rather than a single
 * uniform scale).
 */
export interface Camera2DState {
  readonly centerX: number;
  readonly centerY: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** A camera centered on the world origin at 1 screen px per world unit on both axes. */
export const IDENTITY_CAMERA: Camera2DState = { centerX: 0, centerY: 0, scaleX: 1, scaleY: 1 };

/** Maps a world point to its screen position under `camera`/`viewport`. */
export function worldToScreen(
  camera: Camera2DState,
  viewport: Viewport,
  world: WorldPoint,
): ScreenPoint {
  return {
    x: viewport.width / 2 + (world.x - camera.centerX) * camera.scaleX,
    y: viewport.height / 2 - (world.y - camera.centerY) * camera.scaleY,
  };
}

/** Maps a screen point to its world position under `camera`/`viewport` -- the exact inverse of {@link worldToScreen}. */
export function screenToWorld(
  camera: Camera2DState,
  viewport: Viewport,
  screen: ScreenPoint,
): WorldPoint {
  return {
    x: camera.centerX + (screen.x - viewport.width / 2) / camera.scaleX,
    y: camera.centerY - (screen.y - viewport.height / 2) / camera.scaleY,
  };
}

/**
 * Pans the camera so rendered content shifts by `(dxScreen, dyScreen)`
 * screen pixels -- e.g. wire directly to a pointer drag's per-frame delta.
 * Disables nothing itself; callers implement "user pan disables auto-fit"
 * (§6.1, P3.07) by tracking that separately from `Camera2DState`.
 */
export function panByScreenDelta(
  camera: Camera2DState,
  dxScreen: number,
  dyScreen: number,
): Camera2DState {
  return {
    ...camera,
    centerX: camera.centerX - dxScreen / camera.scaleX,
    centerY: camera.centerY + dyScreen / camera.scaleY,
  };
}

/**
 * Zooms both axes by `factor` (>1 zooms in, <1 zooms out, both scales move
 * together so pan/zoom never changes the x:y anisotropy ratio on its own)
 * about `cursor`, keeping the world point currently under the cursor fixed
 * on screen -- the "zoom keeps cursor point fixed" validation criterion.
 * `factor` must be finite and > 0; the camera's scale is always positive by
 * construction and this is the only place that could break that.
 */
export function zoomAtScreenPoint(
  camera: Camera2DState,
  viewport: Viewport,
  cursor: ScreenPoint,
  factor: number,
): Camera2DState {
  const worldAnchor = screenToWorld(camera, viewport, cursor);
  const scaleX = camera.scaleX * factor;
  const scaleY = camera.scaleY * factor;
  return {
    scaleX,
    scaleY,
    centerX: worldAnchor.x - (cursor.x - viewport.width / 2) / scaleX,
    centerY: worldAnchor.y - (viewport.height / 2 - cursor.y) / scaleY,
  };
}
