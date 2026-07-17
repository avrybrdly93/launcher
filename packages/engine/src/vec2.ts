/**
 * Vec2 ops as pure functions on plain [x, y] tuples — no allocation beyond
 * the explicit `out` parameter, so hot paths (rhs evaluation) stay allocation-free.
 */
/** Immutable 2D vector represented as a plain `[x, y]` tuple. */
export type Vec2 = readonly [x: number, y: number];
/** Mutable 2D vector, used as the `out` parameter of the ops below. */
export type MutVec2 = [x: number, y: number];

/** `out = a + b`. */
export function add(a: Vec2, b: Vec2, out: MutVec2): MutVec2 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  return out;
}

/** `out = a - b`. */
export function sub(a: Vec2, b: Vec2, out: MutVec2): MutVec2 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  return out;
}

/** `out = a * s`. */
export function scale(a: Vec2, s: number, out: MutVec2): MutVec2 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  return out;
}

/** Dot product `a . b`. */
export function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

/** z-component of the 2D cross product (a 3D cross product with z=0 inputs). */
export function crossZ(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

/** Euclidean norm `|a|`. */
export function norm(a: Vec2): number {
  return Math.hypot(a[0], a[1]);
}

/** Squared Euclidean norm `|a|^2`, avoiding the `sqrt` in {@link norm}. */
export function normSq(a: Vec2): number {
  return a[0] * a[0] + a[1] * a[1];
}

/** A fresh zero vector. */
export function zero(): MutVec2 {
  return [0, 0];
}
