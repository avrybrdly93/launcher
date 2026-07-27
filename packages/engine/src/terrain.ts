import { PchipInterpolator } from "./pchip.js";

/**
 * Ground/terrain height, y = h(x) (§3.7, §3.9). Flat ground (h≡0) is the
 * platform default; {@link PchipTerrain} adds a piecewise-PCHIP editor data
 * model on top of this same interface for sloped/edited terrain (P4.13).
 */
export interface Terrain {
  /** Ground height h(x) at horizontal position x. */
  height(x: number): number;
}

/** Flat terrain: h(x) = 0 everywhere. */
export class FlatTerrain implements Terrain {
  /** @inheritDoc */
  height(_x: number): number {
    return 0;
  }
}

/** Terrain defined by an arbitrary height function h(x). */
export class FunctionTerrain implements Terrain {
  constructor(private readonly h: (x: number) => number) {}

  /** @inheritDoc */
  height(x: number): number {
    return this.h(x);
  }
}

/** One draggable knot of a {@link PchipTerrain}: horizontal position and ground height. */
export interface TerrainControlPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Editable terrain: a small set of draggable control points (§7 P4.13),
 * interpolated by {@link PchipInterpolator} so the resulting h(x) is smooth
 * ($C^1$) and never overshoots between knots -- important since an
 * overshoot could put the interpolated ground briefly *above* an edited
 * point's neighbors, producing a spurious extra terrain feature the editor
 * never asked for. Control points may be supplied in any order (an editor
 * drags points independently, so their x-order can change at any time);
 * they are sorted here before being handed to `PchipInterpolator`, which
 * requires strictly increasing x. Outside the outermost control points,
 * height clamps to the nearest endpoint (`PchipInterpolator`'s own
 * out-of-domain behavior) -- flat ground extending past the edited region.
 */
export class PchipTerrain implements Terrain {
  /** Control points actually used, sorted ascending by x (ties broken by rejecting the terrain -- see constructor). */
  readonly controlPoints: readonly TerrainControlPoint[];

  private readonly interpolator: PchipInterpolator;

  constructor(controlPoints: readonly TerrainControlPoint[]) {
    if (controlPoints.length < 2) {
      throw new Error("PchipTerrain requires at least 2 control points");
    }
    const sorted = [...controlPoints].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.x === sorted[i - 1]!.x) {
        throw new Error(
          `PchipTerrain control points must have distinct x values (duplicate x=${sorted[i]!.x})`,
        );
      }
    }
    this.controlPoints = sorted;
    this.interpolator = new PchipInterpolator(
      sorted.map((p) => p.x),
      sorted.map((p) => p.y),
    );
  }

  /** @inheritDoc */
  height(x: number): number {
    return this.interpolator.evaluate(x);
  }
}

/**
 * Ground-contact event quantity g_gnd(t) = y - h(x) (§3.8, eq. in §3.9
 * "Well-posedness of events"): its root marks ground impact, falling
 * through zero as the projectile descends onto the terrain.
 */
export function groundHeightResidual(terrain: Terrain, x: number, y: number): number {
  return y - terrain.height(x);
}
