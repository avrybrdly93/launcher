import { PchipInterpolator } from "./pchip.js";

/**
 * Ground/terrain height, y = h(x) (§3.7, §3.9). Flat ground (h≡0) is the
 * platform default; {@link PiecewisePchipTerrain} (P4.13) adds a
 * piecewise-PCHIP editor data model on top of this same interface for
 * sloped/edited terrain.
 */
export interface Terrain {
  /** Ground height h(x) at horizontal position x. */
  height(x: number): number;
}

/** One draggable control point of a {@link PiecewisePchipTerrain} editor. */
export interface TerrainControlPoint {
  readonly x: number;
  readonly y: number;
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

/**
 * Terrain editor data model (§7 P4.13): h(x) as a {@link PchipInterpolator}
 * through a set of user-draggable control points, sorted by `x` so the
 * editor UI (P4.14) can append/drag points in any order. PCHIP rather than
 * a natural cubic spline for the same shape-preserving reason as the Cd(Re)
 * tables (`pchip.ts`'s own doc note): a spline through hand-placed terrain
 * points can overshoot and put the ground *above* a point that's a local
 * max, which would silently produce a nonsensical (overhanging) surface;
 * PCHIP never overshoots the data's own local extrema. Requires at least 2
 * control points, strictly increasing in `x` (mirrors
 * `PchipInterpolator`'s own constructor contract) -- the editor UI (P4.14)
 * is responsible for keeping dragged points sorted and distinct before
 * constructing this.
 */
export class PiecewisePchipTerrain implements Terrain {
  private readonly interpolator: PchipInterpolator;

  constructor(readonly controlPoints: readonly TerrainControlPoint[]) {
    if (controlPoints.length < 2) {
      throw new Error("PiecewisePchipTerrain requires at least 2 control points");
    }
    this.interpolator = new PchipInterpolator(
      controlPoints.map((p) => p.x),
      controlPoints.map((p) => p.y),
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

/**
 * Sorts `points` by `x` ascending and merges any with equal `x` (last one
 * in original order wins), so a freshly-dragged control-point list -- which
 * the editor UI (P4.14) may hand over in any order, and with two points
 * momentarily coincident mid-drag -- can always be fed straight into
 * {@link PiecewisePchipTerrain}'s strictly-increasing-`x` constructor
 * contract without the caller hand-rolling that bookkeeping itself.
 */
export function sanitizeTerrainControlPoints(
  points: readonly TerrainControlPoint[],
): TerrainControlPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const result: TerrainControlPoint[] = [];
  for (const p of sorted) {
    const last = result[result.length - 1];
    if (last !== undefined && last.x === p.x) {
      result[result.length - 1] = p;
    } else {
      result.push(p);
    }
  }
  return result;
}

/**
 * Serializes terrain control points to portable JSON text (P4.14
 * "serialization round-trip"), for a save/export action in the editor UI.
 * Plain `{x,y}[]` needs no schema/migration machinery (unlike
 * `scenario-persistence.ts`'s `ScenarioSpec` export) -- round-trips via
 * {@link deserializeTerrainControlPoints}.
 */
export function serializeTerrainControlPoints(points: readonly TerrainControlPoint[]): string {
  return JSON.stringify(points);
}

/**
 * Parses JSON text produced by {@link serializeTerrainControlPoints} back
 * into control points. Throws (a `SyntaxError`) on malformed JSON, exactly
 * like `importScenarioFromJson` -- a load-file UI action should catch and
 * surface the message rather than silently discarding a bad import.
 */
export function deserializeTerrainControlPoints(json: string): TerrainControlPoint[] {
  return JSON.parse(json) as TerrainControlPoint[];
}
