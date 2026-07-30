/**
 * Terrain editor page logic (§7 P4.14): pure data<->screen mapping and
 * ground-profile sampling for `TerrainEditorPage`'s SVG canvas. Screen space
 * is a plain `viewportWidth x viewportHeight` pixel box with y growing
 * *downward* (SVG convention) -- the inverse of data space's y growing
 * upward -- so the Y mapping flips, mirroring `plot-pane.ts`'s
 * `plotScreenY`/`screenYToPlotValue` split but for an (x, y) data domain
 * instead of a (t, value) one.
 */
import { PiecewisePchipTerrain, type TerrainControlPoint } from "@ballista/engine";

export interface DataDomain {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Fraction of the tightest-fitting range added as padding on every side, so control points and the trajectory never sit flush against the SVG's edge. */
const DOMAIN_PADDING_FRACTION = 0.15;

/** Floor under the un-padded x/y range, so a nearly-flat or single-point-wide terrain still gets a sane, non-degenerate viewing domain. */
const MIN_DOMAIN_RANGE = 1;

/**
 * The data-space view domain spanning every control point plus every extra
 * x/y sample given (e.g. the re-solved trajectory's channels and impact
 * point), padded so nothing touches the SVG's edge. Never degenerates to a
 * zero-width/height domain (which would divide by zero in the screen
 * mapping below), even for a two-point flat terrain with no trajectory.
 */
export function computeViewDomain(
  controlPoints: readonly TerrainControlPoint[],
  extraXs: readonly number[] = [],
  extraYs: readonly number[] = [],
): DataDomain {
  const xs = [...controlPoints.map((p) => p.x), ...extraXs];
  const ys = [...controlPoints.map((p) => p.y), ...extraYs];

  const rawMinX = Math.min(...xs);
  const rawMaxX = Math.max(...xs);
  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);

  const xRange = Math.max(rawMaxX - rawMinX, MIN_DOMAIN_RANGE);
  const yRange = Math.max(rawMaxY - rawMinY, MIN_DOMAIN_RANGE);
  const xPad = xRange * DOMAIN_PADDING_FRACTION;
  const yPad = yRange * DOMAIN_PADDING_FRACTION;

  return {
    minX: rawMinX - xPad,
    maxX: rawMaxX + xPad,
    minY: rawMinY - yPad,
    maxY: rawMaxY + yPad,
  };
}

export function dataXToScreenX(domain: DataDomain, viewportWidth: number, x: number): number {
  return ((x - domain.minX) / (domain.maxX - domain.minX)) * viewportWidth;
}

export function screenXToDataX(domain: DataDomain, viewportWidth: number, screenX: number): number {
  return domain.minX + (screenX / viewportWidth) * (domain.maxX - domain.minX);
}

/** Flips top<->bottom: SVG screen y grows downward, data y grows upward. */
export function dataYToScreenY(domain: DataDomain, viewportHeight: number, y: number): number {
  return viewportHeight - ((y - domain.minY) / (domain.maxY - domain.minY)) * viewportHeight;
}

export function screenYToDataY(
  domain: DataDomain,
  viewportHeight: number,
  screenY: number,
): number {
  return domain.minY + ((viewportHeight - screenY) / viewportHeight) * (domain.maxY - domain.minY);
}

export interface ProfilePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Densely samples `h(x)` across the domain's x-range for drawing the ground
 * polyline -- the terrain is a continuous PCHIP curve between control
 * points, not just straight segments between them, so this must sample
 * rather than just connect the control points directly.
 */
export function sampleTerrainProfile(
  controlPoints: readonly TerrainControlPoint[],
  domain: DataDomain,
  sampleCount = 100,
): ProfilePoint[] {
  const terrain = new PiecewisePchipTerrain(controlPoints);
  const points: ProfilePoint[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const x = domain.minX + (i / (sampleCount - 1)) * (domain.maxX - domain.minX);
    points.push({ x, y: terrain.height(x) });
  }
  return points;
}

/** SVG `points` attribute value for a polyline through data-space `points`, mapped into `viewportWidth x viewportHeight` screen space. */
export function profileToSvgPolylinePoints(
  points: readonly ProfilePoint[],
  domain: DataDomain,
  viewportWidth: number,
  viewportHeight: number,
): string {
  return points
    .map(
      (p) =>
        `${dataXToScreenX(domain, viewportWidth, p.x)},${dataYToScreenY(domain, viewportHeight, p.y)}`,
    )
    .join(" ");
}

/** Formats a data-space value to a fixed 1-decimal-place meter reading, matching the rest of the app's numeric readouts (e.g. `stability-explorer-page.tsx`'s `.toFixed(3)` style, scaled for this page's coarser terrain-editing precision). */
export function formatMeters(value: number): string {
  return `${value.toFixed(1)} m`;
}
