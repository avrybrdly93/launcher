/**
 * Offscreen-canvas caching for the world scene's *static* layers -- axes
 * grid + trajectory polyline -- with dirty-flag invalidation (§6.1 frame
 * loop discipline: "redraw only invalidated layers ... static trajectory
 * geometry is cached to an offscreen canvas and blitted, so steady-state
 * cost is marker + HUD only"; P3.11).
 *
 * Those layers only change when the camera pans/zooms, the viewport
 * resizes, or the trajectory itself changes (a new solve, a pin/unpin).
 * Playback -- advancing the marker, HUD readouts -- never touches them. So
 * instead of re-stroking a polyline that can run to tens of thousands of
 * points (P3.10) and re-walking the tick grid on every animation frame,
 * `StaticLayerCache` redraws into an offscreen surface only when its cache
 * key changes, and the caller blits that surface onto the visible canvas
 * every frame -- a single `drawImage`, independent of trajectory size
 * (P3.11 validation: steady-state frame cost < 4 ms).
 *
 * The key is compared field-by-field rather than by allocating and hashing
 * a composite value every frame (per §6.5's no-per-frame-allocation
 * invariant). `CacheSurface`/`CacheContext` are the minimal subset of
 * `OffscreenCanvas`/`CanvasRenderingContext2D` this module needs, matching
 * the pattern in `canvas-bootstrap.ts`/`axes-layer.ts`/`trajectory-layer.ts`
 * of depending on the smallest interface required -- so the cache itself is
 * unit-testable in Node against a recording mock, and only the real
 * `OffscreenCanvas`-backed factory is browser-only.
 */

import type { Camera2DState, Viewport } from "./camera2d.js";

/** Everything that determines what the cached static layers look like -- an unchanged key means nothing needs to be redrawn. */
export interface StaticLayerCacheKey {
  readonly centerX: number;
  readonly centerY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /**
   * Bumped by the caller whenever the underlying trajectory/overlay data
   * changes (a new solve, a pin added/removed, etc.) -- the key has no way
   * to see into that data itself, so it relies on the caller to signal it.
   */
  readonly dataRevision: number;
}

/** Builds a {@link StaticLayerCacheKey} from the current camera/viewport/data-revision -- one call site, so every caller compares the same fields. */
export function staticLayerCacheKey(
  camera: Camera2DState,
  viewport: Viewport,
  dataRevision: number,
): StaticLayerCacheKey {
  return {
    centerX: camera.centerX,
    centerY: camera.centerY,
    scaleX: camera.scaleX,
    scaleY: camera.scaleY,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    dataRevision,
  };
}

/** Field-by-field comparison -- avoids allocating/hashing a composite value every frame just to detect "nothing changed." */
export function sameStaticLayerCacheKey(
  a: StaticLayerCacheKey | undefined,
  b: StaticLayerCacheKey,
): boolean {
  return (
    a !== undefined &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY &&
    a.viewportWidth === b.viewportWidth &&
    a.viewportHeight === b.viewportHeight &&
    a.dataRevision === b.dataRevision
  );
}

/** The minimal 2D context surface this module needs to clear a surface before redrawing it -- both `CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D` satisfy this. */
export interface CacheContext {
  clearRect(x: number, y: number, w: number, h: number): void;
}

/** The minimal `OffscreenCanvas`/`HTMLCanvasElement` surface this module needs -- real code passes one of those (see {@link createOffscreenSurface}); tests pass a recording mock. */
export interface CacheSurface<Ctx extends CacheContext> {
  width: number;
  height: number;
  getContext(contextId: "2d"): Ctx | null;
}

export interface StaticLayerCache<Ctx extends CacheContext> {
  /**
   * Returns the cached surface for `width`/`height`/`key`, redrawing via
   * `draw(ctx)` first only if the surface just changed size or `key`
   * differs from the last redraw (a resize always redraws: the previous
   * bitmap's content no longer matches the new pixel dimensions, so it
   * can't be reused regardless of what the key says).
   */
  render(
    width: number,
    height: number,
    key: StaticLayerCacheKey,
    draw: (ctx: Ctx) => void,
  ): CacheSurface<Ctx>;
  /** Number of `render()` calls that actually invoked `draw` (i.e. cache misses) -- exposed for the P3.11 perf probe and any future telemetry. */
  readonly redrawCount: number;
  /** Forces the next `render()` call to redraw regardless of key, e.g. after an external mutation the key doesn't capture. */
  invalidate(): void;
}

/**
 * Wraps a surface factory (`(width, height) => CacheSurface`) with the
 * dirty-flag bookkeeping described above. Each `StaticLayerCache` owns
 * exactly one surface at a time, recreated (via `createSurface`) whenever
 * `render()` is asked for a different `width`/`height`.
 */
export function createStaticLayerCache<Ctx extends CacheContext>(
  createSurface: (width: number, height: number) => CacheSurface<Ctx>,
): StaticLayerCache<Ctx> {
  let surface: CacheSurface<Ctx> | undefined;
  let lastKey: StaticLayerCacheKey | undefined;
  let redrawCount = 0;

  return {
    render(width, height, key, draw) {
      const resized = !surface || surface.width !== width || surface.height !== height;
      if (resized) surface = createSurface(width, height);
      const dirty = resized || !sameStaticLayerCacheKey(lastKey, key);
      if (dirty) {
        const ctx = surface!.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, width, height);
          draw(ctx);
        }
        lastKey = key;
        redrawCount++;
      }
      return surface!;
    },
    get redrawCount() {
      return redrawCount;
    },
    invalidate() {
      lastKey = undefined;
    },
  };
}

/** The subset of `CanvasRenderingContext2D` needed to blit a cached surface onto the visible canvas every frame. */
export interface BlitTarget {
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
}

/** Blits `surface` onto `target` at the origin -- the one draw call a steady-state frame needs for the static layers. */
export function blitStaticLayerCache(target: BlitTarget, surface: CanvasImageSource): void {
  target.drawImage(surface, 0, 0);
}

/**
 * Browser-only surface factory: prefers a real `OffscreenCanvas` (can be
 * drawn to off the main thread and is never attached to the DOM), falling
 * back to a detached `<canvas>` in environments without it (e.g. older
 * WebViews). Not exercised under Node -- like `drawTrajectoryLayer`'s use
 * of `Path2D`, this is glue for real wiring, not something the cache's own
 * logic depends on.
 */
export function createOffscreenSurface(
  width: number,
  height: number,
): CacheSurface<CanvasRenderingContext2D> | CacheSurface<OffscreenCanvasRenderingContext2D> {
  const OffscreenCanvasCtor = (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas })
    .OffscreenCanvas;
  if (OffscreenCanvasCtor) return new OffscreenCanvasCtor(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
