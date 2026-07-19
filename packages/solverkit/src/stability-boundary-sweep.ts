/**
 * Generic bisection for a monotone Euler stability boundary (§4.6): given a
 * predicate `isStable(h)` assumed true on `[hLo, h_crit]` and false on
 * `(h_crit, hHi]`, returns `h_crit` to `relTol` relative precision. Throws if
 * the caller's bracket doesn't actually straddle the boundary (`isStable`
 * false at `hLo` or true at `hHi`) rather than silently returning a
 * meaningless midpoint.
 */
export function bisectStabilityBoundary(
  isStable: (h: number) => boolean,
  hLo: number,
  hHi: number,
  opts: { relTol?: number; maxIter?: number } = {},
): number {
  const relTol = opts.relTol ?? 1e-6;
  const maxIter = opts.maxIter ?? 100;

  if (!isStable(hLo)) {
    throw new Error(
      `bisectStabilityBoundary: hLo=${hLo} is already unstable -- bracket misses h_crit`,
    );
  }
  if (isStable(hHi)) {
    throw new Error(`bisectStabilityBoundary: hHi=${hHi} is still stable -- bracket misses h_crit`);
  }

  let lo = hLo;
  let hi = hHi;
  for (let i = 0; i < maxIter && (hi - lo) / hi > relTol; i++) {
    const mid = (lo + hi) / 2;
    if (isStable(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Explicit Euler's exact linear stability limit (§4.6, eq. 4.11): applied to
 * the Dahlquist test equation `ydot = lambda*y` with real `lambda < 0`,
 * `R(z) = 1+z` stays within the unit disk (`|R(z)| <= 1`) iff `-2 <= z <= 0`,
 * i.e. `h <= 2/|lambda|`. This is the closed form eq. (4.12) specializes for
 * the projectile's quadratic-drag Jacobian eigenvalue (P2.22).
 */
export function eulerLinearStabilityLimit(lambda: number): number {
  return 2 / Math.abs(lambda);
}
