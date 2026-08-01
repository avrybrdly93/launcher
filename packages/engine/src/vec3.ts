/**
 * Vec3 ops as pure functions on plain [x, y, z] tuples — no allocation beyond
 * the explicit `out` parameter, mirroring `vec2.ts`'s style exactly (P4.23).
 *
 * Axis/handedness convention for the whole 3D-projectile line of work
 * (P4.23-P4.26 and beyond): **x = downrange, y = up (opposite gravity), z =
 * lateral/out-of-plane**, right-handed with e_x x e_y = e_z. This is a
 * direct continuation of the existing 2D convention, not a new one:
 * `forces.ts`'s `MagnusForce.accumulate` already documents its implicit spin
 * axis as ê_z (out of the x-y plane, right-handed) via
 * `ê_z x v_rel = (-v_rel_y, v_rel_x)`, i.e. `cross((0,0,1), (vx,vy,0)) =
 * (-vy, vx, 0)` -- exactly what {@link cross} below reproduces when called
 * with those same arguments. Every 2D scenario is therefore the z=0 slice of
 * this 3D frame with its spin axis unchanged, which is what
 * `spatial-projectile-model.ts` relies on and what its own tests verify.
 */
/** Immutable 3D vector represented as a plain `[x, y, z]` tuple. */
export type Vec3 = readonly [x: number, y: number, z: number];
/** Mutable 3D vector, used as the `out` parameter of the ops below. */
export type MutVec3 = [x: number, y: number, z: number];

/** `out = a + b`. */
export function add(a: Vec3, b: Vec3, out: MutVec3): MutVec3 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

/** `out = a - b`. */
export function sub(a: Vec3, b: Vec3, out: MutVec3): MutVec3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

/** `out = a * s`. */
export function scale(a: Vec3, s: number, out: MutVec3): MutVec3 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

/** Dot product `a . b`. */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Full 3D cross product `a x b`, right-handed (e_x x e_y = e_z, e_y x e_z =
 * e_x, e_z x e_x = e_y). With `a = (0,0,1)` (ê_z) and `b = (vx,vy,0)` this
 * reduces to `(-vy, vx, 0)`, matching `vec2.ts`'s {@link crossZ} (the
 * z-component of this same product for z=0 inputs) and `forces.ts`'s
 * `MagnusForce` comment exactly.
 */
export function cross(a: Vec3, b: Vec3, out: MutVec3): MutVec3 {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

/** Euclidean norm `|a|`. */
export function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Squared Euclidean norm `|a|^2`, avoiding the `sqrt` in {@link norm}. */
export function normSq(a: Vec3): number {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
}

/** A fresh zero vector. */
export function zero(): MutVec3 {
  return [0, 0, 0];
}
