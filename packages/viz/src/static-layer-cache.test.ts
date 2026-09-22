import { describe, expect, it } from "vitest";
import {
  createStaticLayerCache,
  sameStaticLayerCacheKey,
  staticLayerCacheKey,
  type CacheContext,
  type CacheSurface,
} from "./static-layer-cache.js";
import { buildDecimatedTrajectoryPath } from "./trajectory-decimation.js";
import { drawAxesLayer, type AxesLayerCanvas } from "./axes-layer.js";
import type { PathBuilder } from "./trajectory-layer.js";
import { IDENTITY_CAMERA, type Camera2DState, type Viewport } from "./camera2d.js";
import {
  bestOfMs,
  isIdleEnoughForWallClock,
  measureCalibrationMs,
  measureIdleGateCalibration,
} from "@ballista/solverkit";

/** A cached-layer re-render must stay well inside one animation frame. */
const CACHED_RENDER_BUDGET_MS = 4;
/**
 * MEASURED at ~0.0005 across three runs: a cache HIT does essentially nothing,
 * costing ~0.0003 ms against a ~0.65 ms calibration. The limit of 0.05 is 100x
 * that, which sounds absurdly loose and is not: the failure this guards
 * against is the cache missing and actually re-running `drawStaticLayers`,
 * which costs the same order as a real render -- a ratio near 1, twenty times
 * over the limit. Anything between 0.0005 and 0.05 is not a state this code
 * has.
 *
 * The deterministic assertions on `drawCalls` and `redrawCount` are the real
 * check here and they are unchanged; this ratio is a backstop, and it is
 * written down as one rather than dressed up as a performance budget.
 */
const MAX_CACHED_RENDER_COST_IN_CALIBRATIONS = 0.05;

class RecordingPath implements PathBuilder {
  points: Array<[number, number]> = [];
  moveTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
}

/** Implements just enough of `CanvasRenderingContext2D` to run `drawAxesLayer` plus the cache's own `clearRect` call. */
class MockCtx implements AxesLayerCanvas, CacheContext {
  strokeStyle = "";
  lineWidth = 0;
  fillStyle = "";
  font = "";
  textAlign = "";
  textBaseline = "";
  clearRectCalls = 0;
  beginPathCalls = 0;
  strokeCalls = 0;
  fillTextCalls = 0;
  clearRect(): void {
    this.clearRectCalls++;
  }
  beginPath(): void {
    this.beginPathCalls++;
  }
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {
    this.strokeCalls++;
  }
  fillText(): void {
    this.fillTextCalls++;
  }
}

class MockSurface implements CacheSurface<MockCtx> {
  width: number;
  height: number;
  private readonly ctx = new MockCtx();
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext(): MockCtx {
    return this.ctx;
  }
}

const VIEWPORT: Viewport = { width: 800, height: 600 };
const CAMERA: Camera2DState = { ...IDENTITY_CAMERA, scaleX: 2, scaleY: 3 };

describe("staticLayerCacheKey / sameStaticLayerCacheKey", () => {
  it("keys built from equal camera/viewport/revision compare equal", () => {
    const a = staticLayerCacheKey(CAMERA, VIEWPORT, 0);
    const b = staticLayerCacheKey({ ...CAMERA }, { ...VIEWPORT }, 0);
    expect(sameStaticLayerCacheKey(a, b)).toBe(true);
  });

  it("detects a camera change", () => {
    const a = staticLayerCacheKey(CAMERA, VIEWPORT, 0);
    const b = staticLayerCacheKey({ ...CAMERA, centerX: CAMERA.centerX + 1 }, VIEWPORT, 0);
    expect(sameStaticLayerCacheKey(a, b)).toBe(false);
  });

  it("detects a viewport change", () => {
    const a = staticLayerCacheKey(CAMERA, VIEWPORT, 0);
    const b = staticLayerCacheKey(
      CAMERA,
      { width: VIEWPORT.width + 1, height: VIEWPORT.height },
      0,
    );
    expect(sameStaticLayerCacheKey(a, b)).toBe(false);
  });

  it("detects a data-revision change", () => {
    const a = staticLayerCacheKey(CAMERA, VIEWPORT, 0);
    const b = staticLayerCacheKey(CAMERA, VIEWPORT, 1);
    expect(sameStaticLayerCacheKey(a, b)).toBe(false);
  });

  it("treats undefined (no prior key) as different from any key", () => {
    expect(sameStaticLayerCacheKey(undefined, staticLayerCacheKey(CAMERA, VIEWPORT, 0))).toBe(
      false,
    );
  });
});

describe("createStaticLayerCache", () => {
  it("redraws on the first render() call", () => {
    const cache = createStaticLayerCache((w, h) => new MockSurface(w, h));
    let drawCalls = 0;
    cache.render(100, 100, staticLayerCacheKey(CAMERA, VIEWPORT, 0), () => {
      drawCalls++;
    });
    expect(drawCalls).toBe(1);
    expect(cache.redrawCount).toBe(1);
  });

  it("does not redraw across repeated render() calls with an unchanged key", () => {
    const cache = createStaticLayerCache((w, h) => new MockSurface(w, h));
    const key = staticLayerCacheKey(CAMERA, VIEWPORT, 0);
    let drawCalls = 0;
    for (let i = 0; i < 50; i++) {
      cache.render(100, 100, key, () => {
        drawCalls++;
      });
    }
    expect(drawCalls).toBe(1);
    expect(cache.redrawCount).toBe(1);
  });

  it("redraws when the key changes (camera pan/zoom or data revision)", () => {
    const cache = createStaticLayerCache((w, h) => new MockSurface(w, h));
    let drawCalls = 0;
    cache.render(100, 100, staticLayerCacheKey(CAMERA, VIEWPORT, 0), () => {
      drawCalls++;
    });
    cache.render(100, 100, staticLayerCacheKey({ ...CAMERA, centerX: 5 }, VIEWPORT, 0), () => {
      drawCalls++;
    });
    expect(drawCalls).toBe(2);
    expect(cache.redrawCount).toBe(2);
  });

  it("redraws on resize even if the key is otherwise unchanged", () => {
    const cache = createStaticLayerCache((w, h) => new MockSurface(w, h));
    const key = staticLayerCacheKey(CAMERA, VIEWPORT, 0);
    let drawCalls = 0;
    cache.render(100, 100, key, () => {
      drawCalls++;
    });
    cache.render(200, 150, key, () => {
      drawCalls++;
    });
    expect(drawCalls).toBe(2);
    expect(cache.redrawCount).toBe(2);
  });

  it("clears the surface before every redraw", () => {
    const surfaces: MockSurface[] = [];
    const cache = createStaticLayerCache((w, h) => {
      const s = new MockSurface(w, h);
      surfaces.push(s);
      return s;
    });
    const key = staticLayerCacheKey(CAMERA, VIEWPORT, 0);
    cache.render(100, 100, key, () => {});
    expect((surfaces[0]!.getContext() as MockCtx).clearRectCalls).toBe(1);
  });

  it("invalidate() forces a redraw on the next render() even with an unchanged key", () => {
    const cache = createStaticLayerCache((w, h) => new MockSurface(w, h));
    const key = staticLayerCacheKey(CAMERA, VIEWPORT, 0);
    let drawCalls = 0;
    cache.render(100, 100, key, () => {
      drawCalls++;
    });
    cache.invalidate();
    cache.render(100, 100, key, () => {
      drawCalls++;
    });
    expect(drawCalls).toBe(2);
    expect(cache.redrawCount).toBe(2);
  });

  it("reuses the same surface instance across cache hits", () => {
    const cache = createStaticLayerCache((w, h) => new MockSurface(w, h));
    const key = staticLayerCacheKey(CAMERA, VIEWPORT, 0);
    const first = cache.render(100, 100, key, () => {});
    const second = cache.render(100, 100, key, () => {});
    expect(second).toBe(first);
  });
});

describe("performance (P3.11 validation: steady-state frame cost < 4 ms)", () => {
  it("holds a 50k-point trajectory + axes grid redraw out of the steady-state per-frame cost", () => {
    const n = 50_000;
    const worldXs = new Float64Array(n);
    const worldYs = new Float64Array(n);
    let t = 0;
    for (let i = 0; i < n; i++) {
      const h = 1e-5 + 0.02 * (1 - Math.exp(-t / 5));
      t += h;
      worldXs[i] = t;
      worldYs[i] = 3 * Math.exp(-t / 2) + 0.05 * t;
    }

    const camera: Camera2DState = { centerX: t / 2, centerY: 0, scaleX: 3, scaleY: 200 };
    const viewport: Viewport = { width: 1200, height: 800 };
    const key = staticLayerCacheKey(camera, viewport, 0);

    let drawCalls = 0;
    function drawStaticLayers(ctx: MockCtx): void {
      drawCalls++;
      // Stand-in for the actual per-redraw cost this cache exists to avoid
      // paying every frame: the full decimation + axes-grid walk.
      buildDecimatedTrajectoryPath(new RecordingPath(), camera, viewport, worldXs, worldYs);
      drawAxesLayer(ctx, camera, viewport);
    }

    const cache = createStaticLayerCache<MockCtx>((w, h) => new MockSurface(w, h));

    // Cold frame: camera/viewport/data unchanged from the prior frame is
    // impossible on the very first frame, so this one legitimately redraws.
    cache.render(viewport.width, viewport.height, key, drawStaticLayers);
    expect(drawCalls).toBe(1);

    // Warmup, then best-of-N steady-state frames -- same key every time
    // (playback advancing the marker, not the camera), so none of these
    // should touch `drawStaticLayers` at all.
    const best = bestOfMs(
      () => cache.render(viewport.width, viewport.height, key, drawStaticLayers),
      15,
      20,
    );
    const calibrationMs = measureCalibrationMs();
    const costInCalibrations = best / calibrationMs;

    // The redraw never re-fires once the key stops changing -- that's what
    // keeps the steady-state cost independent of trajectory size.
    expect(drawCalls).toBe(1);
    expect(cache.redrawCount).toBe(1);
    // Load-invariant (P0.96); see impact-scatter.test.ts for the rationale.
    // AUDITED BY P0.148 AND KEPT AS IT STANDS; see impact-scatter.test.ts for
    // the argument. This is the least marginal of the four by a wide margin:
    // a cache hit costs 0.0003 ms, identical idle and under 8-way sustained
    // load, four orders of magnitude below the boundary where a minimum starts
    // stretching. The ratio was 0.0005 in both conditions against a limit of
    // 0.05.
    expect(costInCalibrations).toBeLessThan(MAX_CACHED_RENDER_COST_IN_CALIBRATIONS);
    // REWIRED BY P0.149. The gate used to be handed `calibrationMs` above --
    // a 0.2M minimum, below both preemption boundaries, which read 1.00x
    // under 8-way sustained load and so reported "idle" on a fully contended
    // runner. It now gets its own calibration, long enough to be preempted,
    // and closes on the dimensionless dispersion. The ratio assertion above
    // is untouched: that pairing is minimum-over-minimum and P0.148 audited
    // it as sound at this size.
    const idleGate = measureIdleGateCalibration();
    if (isIdleEnoughForWallClock(idleGate)) {
      expect(best).toBeLessThan(CACHED_RENDER_BUDGET_MS);
    }
  });
});
