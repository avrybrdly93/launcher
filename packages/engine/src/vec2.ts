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

/**
 * Euclidean norm `|a|`.
 *
 * `sqrt(x*x + y*y)`, **not** `Math.hypot` — a deliberate per-site numerical
 * choice, the same kind `kepler-model.ts` makes in the opposite direction and
 * for the same reason. `Math.hypot` scales its arguments by a power of two
 * before squaring so that it cannot overflow or underflow intermediates, and
 * that scaling is the whole of its extra cost. It buys nothing here: this
 * function's only production callers are the `ctx.speedRel = norm(ctx.vRel)`
 * line in `planar-projectile-model.ts` and its spin variant, where the
 * argument is a relative air velocity in m/s. The naive form's intermediates
 * only overflow above |component| ~ 1.3e154 and only underflow into
 * subnormals below ~1.5e-162; a projectile velocity is neither, by roughly a
 * hundred and fifty orders of magnitude.
 *
 * The cost is not marginal, which is why this is worth a comment rather than
 * left as a style preference. Measured on Node 22.22 (linux x64) over 2e7
 * evaluations at trajectory-scale arguments: `Math.hypot` 1113.6 ms against
 * 36.6 ms for the form below — **30.4x**. RK4 evaluates the RHS four times
 * per step, so P7.01's profile found this at 8.6% self time in the Monte
 * Carlo batch and recorded it as "the model being the model rather than a
 * defect". That was reading the function rather than its implementation, and
 * P0.120 corrects it.
 *
 * The two forms are not bit-identical and this is not claimed to be a
 * no-op: measured maximum relative difference over the same sample is
 * 3.085e-16, about 1.4 ulp, with `Math.hypot` the more accurate of the two
 * (it is the one doing the extra work). That is inside §8.4's cross-platform
 * golden tolerance by orders of magnitude and inside the throughput
 * benchmark's accuracy ceiling likewise — both re-measured rather than
 * assumed when this landed; see P0.120's notes. Anywhere overflow range
 * genuinely matters, call `Math.hypot` directly and say why, as
 * `kepler-model.ts` does.
 */
export function norm(a: Vec2): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1]);
}

/** Squared Euclidean norm `|a|^2`, avoiding the `sqrt` in {@link norm}. */
export function normSq(a: Vec2): number {
  return a[0] * a[0] + a[1] * a[1];
}

/** A fresh zero vector. */
export function zero(): MutVec2 {
  return [0, 0];
}
