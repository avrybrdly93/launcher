/**
 * Vec2 ops as pure functions on plain [x, y] tuples — no allocation beyond
 * the explicit `out` parameter, so hot paths (rhs evaluation) stay allocation-free.
 */
export type Vec2 = readonly [x: number, y: number];
export type MutVec2 = [x: number, y: number];

/** Row-major 2x2 matrix [a, b, c, d] = [[a, b], [c, d]], used for ∂(Fx,Fy)/∂(vx,vy). */
export type MutMat2 = [a: number, b: number, c: number, d: number];

export function add(a: Vec2, b: Vec2, out: MutVec2): MutVec2 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  return out;
}

export function sub(a: Vec2, b: Vec2, out: MutVec2): MutVec2 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  return out;
}

export function scale(a: Vec2, s: number, out: MutVec2): MutVec2 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  return out;
}

export function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

/** z-component of the 2D cross product (a 3D cross product with z=0 inputs). */
export function crossZ(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

export function norm(a: Vec2): number {
  return Math.hypot(a[0], a[1]);
}

export function normSq(a: Vec2): number {
  return a[0] * a[0] + a[1] * a[1];
}

export function zero(): MutVec2 {
  return [0, 0];
}
