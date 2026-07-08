import type { EventSpec } from "./model.js";

/** Ground height as a function of horizontal position (§3.7/3.8's h(x)). */
export interface Terrain {
  height(x: number): number;
}

/** The default terrain: flat ground at y=0. */
export class FlatTerrain implements Terrain {
  height(_x: number): number {
    return 0;
  }
}

/** Arbitrary terrain profile from a user-supplied height function. */
export class FunctionTerrain implements Terrain {
  constructor(private readonly heightFn: (x: number) => number) {}

  height(x: number): number {
    return this.heightFn(x);
  }
}

const X = 0;
const Y = 1;

/** Ground-impact event: g(t,y) = y - h(x), its root the point of impact. */
export function createGroundEventSpec(terrain: Terrain): EventSpec {
  return {
    name: "ground",
    g(_t: number, y: Float64Array): number {
      return y[Y]! - terrain.height(y[X]!);
    },
  };
}
