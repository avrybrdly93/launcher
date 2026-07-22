/**
 * Screen-space Ramer-Douglas-Peucker (RDP) polyline decimation (§6.2:
 * "decimated for display with a tolerance-based algorithm (Ramer-Douglas-
 * Peucker in *screen* space, recomputed on zoom) so a 50k-step stiff run
 * still draws in << 1 ms"; P3.10).
 *
 * Decimation runs in *screen* space (after the camera transform), not
 * world space, because the perceptually-relevant error is pixels on
 * screen: a tolerance in world units would over-simplify when zoomed in
 * and under-simplify when zoomed out, whereas a fixed pixel tolerance
 * (default 0.5 px, sub-pixel and so visually lossless) gives a consistent
 * on-screen result at every zoom level -- which is also why this has to
 * *recompute* on zoom change rather than decimate once in world space and
 * cache forever (P3.11 wires the "only on zoom change" caching; this
 * module is the pure, stateless decimation step it calls).
 *
 * Implemented iteratively with an explicit index stack (not the textbook
 * recursive formulation) so a pathological 50k-point input -- e.g. a
 * monotonically-curving stiff trajectory, RDP's recursion-depth worst
 * case -- can't blow the call stack, and so V8 can keep everything in
 * registers/typed-array reads instead of allocating a stack frame per
 * candidate segment.
 */

import type { Camera2DState, Viewport } from "./camera2d.js";
import type { PathBuilder } from "./trajectory-layer.js";

/** Default simplification tolerance: sub-pixel, so decimation is visually lossless (§6.2, P3.10 validation: max deviation < 0.5 px). */
export const DEFAULT_DECIMATION_EPSILON_PX = 0.5;

/**
 * Indices (strictly increasing, always including `0` and `n - 1`) of the
 * points to keep from `xs`/`ys` under RDP simplification at tolerance
 * `epsilon`: every dropped point lies within `epsilon` of the simplified
 * polyline (by RDP's standard guarantee) -- see `trajectory-decimation.test.ts`
 * for a direct measurement of that bound. `xs.length < 3` keeps everything
 * (nothing to simplify).
 *
 * Performance (P3.10 validation: 50k points in < 1 ms) is why the inner
 * scan compares *squared* cross-products -- `|cross|/sqrt(lenSq)` is each
 * candidate point's actual perpendicular distance, but `sqrt(lenSq)` is
 * constant for every point within one segment, so finding the point with
 * the largest distance only needs the largest `|cross|`; the one `sqrt`
 * and one division are deferred to run once per segment (against the
 * winning point only) instead of once per point scanned.
 */
export function rdpDecimateIndices(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  epsilon: number,
): Uint32Array {
  const n = xs.length;
  if (n < 3) {
    const all = new Uint32Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    return all;
  }

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Explicit stack of (lo, hi) index ranges still to be examined, as two
  // parallel typed arrays (no per-push tuple allocation, no dynamic
  // resize -- each successful split nets exactly one new stack entry
  // beyond what it consumed, and at most n - 2 points can ever become new
  // split points, so capacity n is always sufficient).
  const stackLo = new Int32Array(n);
  const stackHi = new Int32Array(n);
  let top = 0;
  stackLo[top] = 0;
  stackHi[top] = n - 1;
  top++;

  while (top > 0) {
    top--;
    const lo = stackLo[top]!;
    const hi = stackHi[top]!;
    if (hi - lo < 2) continue; // no point strictly between lo and hi

    const x1 = xs[lo]!;
    const y1 = ys[lo]!;
    const dx = xs[hi]! - x1;
    const dy = ys[hi]! - y1;
    const lenSq = dx * dx + dy * dy;

    let maxIdx = -1;
    if (lenSq === 0) {
      // Degenerate (coincident) endpoints: fall back to squared point
      // distance from the shared endpoint -- still no sqrt in the loop.
      let maxSq = -1;
      for (let i = lo + 1; i < hi; i++) {
        const ex = xs[i]! - x1;
        const ey = ys[i]! - y1;
        const sq = ex * ex + ey * ey;
        if (sq > maxSq) {
          maxSq = sq;
          maxIdx = i;
        }
      }
      if (Math.sqrt(maxSq) <= epsilon) continue;
    } else {
      let maxAbsCross = -1;
      for (let i = lo + 1; i < hi; i++) {
        const cross = dy * (xs[i]! - x1) - dx * (ys[i]! - y1);
        const absCross = cross < 0 ? -cross : cross;
        if (absCross > maxAbsCross) {
          maxAbsCross = absCross;
          maxIdx = i;
        }
      }
      if (maxAbsCross / Math.sqrt(lenSq) <= epsilon) continue;
    }

    keep[maxIdx] = 1;
    stackLo[top] = lo;
    stackHi[top] = maxIdx;
    top++;
    stackLo[top] = maxIdx;
    stackHi[top] = hi;
    top++;
  }

  let kept = 0;
  for (let i = 0; i < n; i++) if (keep[i] === 1) kept++;
  const result = new Uint32Array(kept);
  let w = 0;
  for (let i = 0; i < n; i++) if (keep[i] === 1) result[w++] = i;
  return result;
}

/**
 * Transforms `worldXs`/`worldYs` to screen space under `camera`/`viewport`,
 * RDP-decimates the screen-space polyline at `epsilonPx`, and traces the
 * surviving points into `path` (one `moveTo` + one `lineTo` per remaining
 * point, matching `buildTrajectoryPath`'s contract).
 */
export function buildDecimatedTrajectoryPath(
  path: PathBuilder,
  camera: Camera2DState,
  viewport: Viewport,
  worldXs: ArrayLike<number>,
  worldYs: ArrayLike<number>,
  epsilonPx: number = DEFAULT_DECIMATION_EPSILON_PX,
): void {
  const n = worldXs.length;
  if (n < 2) return;

  // Inlines `worldToScreen`'s formula rather than calling it per point: at
  // 50k points (P3.10's budget) the per-call `{x, y}` object allocation
  // that function's signature requires is measurable overhead this hot
  // path can't afford. Must be kept in exact sync with `worldToScreen` in
  // camera2d.ts.
  const halfWidth = viewport.width / 2;
  const halfHeight = viewport.height / 2;
  const screenXs = new Float64Array(n);
  const screenYs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    screenXs[i] = halfWidth + (worldXs[i]! - camera.centerX) * camera.scaleX;
    screenYs[i] = halfHeight - (worldYs[i]! - camera.centerY) * camera.scaleY;
  }

  const indices = rdpDecimateIndices(screenXs, screenYs, epsilonPx);
  path.moveTo(screenXs[indices[0]!]!, screenYs[indices[0]!]!);
  for (let i = 1; i < indices.length; i++) {
    const idx = indices[i]!;
    path.lineTo(screenXs[idx]!, screenYs[idx]!);
  }
}
