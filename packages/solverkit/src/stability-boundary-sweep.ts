import type { EvalContext, Model } from "@ballista/engine";
import { integrate } from "./integrate.js";
import type { Stepper } from "./types.js";

/**
 * Runs `stepper` for `nSteps` fixed steps of size `h` from `y0` and reports
 * whether channel `channelIndex` stayed bounded: `|y_final[channel] -
 * reference| <= |y0[channel] - reference|`. This is the empirical
 * counterpart of the Dahlquist linear-stability criterion |R(z)| <= 1
 * (§4.6, eq. 4.12): near a fixed step size well inside the system's linear
 * regime, the monitored channel's own recursion is (to that precision)
 * `y_{n+1} = R(z) y_n + const`, whose fixed point is `reference` (0 by
 * default -- exact for an unforced channel like a Stokes-drag-only
 * velocity component). Monotone decay toward `reference` holds for
 * `|R(z)| <= 1`; magnitude growing every step (unboundedly, in exact
 * arithmetic) holds for `|R(z)| > 1`. `nSteps` must be large enough that
 * the sign of `|R(z)| - 1` dominates any transient -- the caller picks it
 * (a handful of the system's own relaxation times is typically enough; see
 * `bisectCriticalStepSize`'s doc for why the boundary itself needs very
 * few steps to resolve precisely).
 */
export function isStepperStable(
  stepper: Stepper,
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  h: number,
  nSteps: number,
  channelIndex: number,
  reference = 0,
): boolean {
  const cfg = { stepper: stepper.info.id, h, maxSteps: nSteps + 1 };
  const report = integrate(model, ctx, y0, [0, h * nSteps], cfg, stepper);
  if (report.status !== "ok") return false;

  const finalMagnitude = Math.abs(report.yFinal[channelIndex]! - reference);
  const initialMagnitude = Math.abs(y0[channelIndex]! - reference);
  return finalMagnitude <= initialMagnitude;
}

/** Result of {@link bisectCriticalStepSize}: the located boundary and how many bisection steps it took. */
export interface StabilityBoundaryResult {
  readonly hCrit: number;
  readonly iterations: number;
}

/**
 * Bisects, in log(h) space, for the critical step size at which
 * `isStable(h)` flips from true to false -- the empirical h_crit of
 * §4.6/(4.12)'s linear stability theory (P2.22). Log space (a geometric,
 * not arithmetic, midpoint) is used because h_crit is a *multiplicative*
 * boundary set by a relative growth factor, not an additive one.
 *
 * `hStable` must test stable and `hUnstable` must test unstable -- an
 * invalid bracket throws immediately rather than silently returning a
 * meaningless answer. Assumes `isStable` is monotonic between the two
 * (true of the growth-factor recursions this targets: |R(z)| crosses 1
 * exactly once as h increases through h_crit). Because the underlying
 * recursion amplifies `|R(z)| - 1` geometrically with every step, even a
 * small `nSteps` in the `isStable` predicate resolves the crossing to a
 * very tight relative tolerance -- the bisection itself, not step count,
 * is what limits `hCrit`'s precision here.
 */
export function bisectCriticalStepSize(
  isStable: (h: number) => boolean,
  hStable: number,
  hUnstable: number,
  relTol = 1e-6,
  maxIterations = 80,
): StabilityBoundaryResult {
  if (!isStable(hStable)) {
    throw new Error(
      `bisectCriticalStepSize: hStable=${hStable} does not test stable -- invalid bracket`,
    );
  }
  if (isStable(hUnstable)) {
    throw new Error(
      `bisectCriticalStepSize: hUnstable=${hUnstable} does not test unstable -- invalid bracket`,
    );
  }

  let lo = hStable;
  let hi = hUnstable;
  let iterations = 0;
  while (hi / lo - 1 > relTol && iterations < maxIterations) {
    const mid = Math.sqrt(lo * hi);
    if (isStable(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
    iterations++;
  }

  return { hCrit: Math.sqrt(lo * hi), iterations };
}
