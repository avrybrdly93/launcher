/**
 * Ground/terrain height, y = h(x) (§3.7, §3.9). Flat ground (h≡0) is the
 * platform default; P4.13 later adds a piecewise-PCHIP editor data model on
 * top of this same interface for sloped/edited terrain.
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

/**
 * Ground-contact event quantity g_gnd(t) = y - h(x) (§3.8, eq. in §3.9
 * "Well-posedness of events"): its root marks ground impact, falling
 * through zero as the projectile descends onto the terrain.
 */
export function groundHeightResidual(terrain: Terrain, x: number, y: number): number {
  return y - terrain.height(x);
}
