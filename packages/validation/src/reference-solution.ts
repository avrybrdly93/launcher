import type { EvalContext, Model } from "@ballista/engine";
import { ClassicalRK4Stepper, integrate } from "@ballista/solverkit";

/** Runs a fixed-step classical RK4 solve to `tspan[1]` and returns the final state. */
function rk4FinalState(
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  tspan: readonly [number, number],
  h: number,
): Float64Array {
  const report = integrate(
    model,
    ctx,
    y0,
    tspan,
    { stepper: "classical-rk4", h, maxSteps: Number.MAX_SAFE_INTEGER },
    new ClassicalRK4Stepper(),
  );
  if (report.status !== "ok") {
    throw new Error(
      `reference RK4 solve failed to reach t_f: ${report.failure?.message ?? report.status}`,
    );
  }
  return report.yFinal;
}

/**
 * Reference-solution utility (§8.2, P2.18): for scenarios with no
 * closed-form analytic solution (Magnus lift, tabulated Cd(Re), non-uniform
 * wind, ...) this is the platform's stand-in ground truth for convergence
 * studies, filling the same role `AnalyticReference` (analytic-references.ts)
 * fills for the handful of problems that do have one.
 *
 * Runs {@link ClassicalRK4Stepper} (order 4, global error ~ C h^4 + O(h^5))
 * at h and h/2, then Richardson-extrapolates the two final states to cancel
 * the leading h^4 term: y* = (16 y(h/2) - y(h)) / 15. The residual error is
 * one order tighter (O(h^5)) than either raw RK4 run at the tested h.
 *
 * DOPRI5 (P2.24) with embedded error control is the blueprint's preferred
 * long-run choice for this role; Richardson-extrapolated RK4 is the
 * documented fallback until it lands (P2.18's title names both options).
 */
export function referenceSolution(
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  tspan: readonly [number, number],
  h: number,
): Float64Array {
  const yCoarse = rk4FinalState(model, ctx, y0, tspan, h);
  const yFine = rk4FinalState(model, ctx, y0, tspan, h / 2);

  const dim = yFine.length;
  const out = new Float64Array(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = (16 * yFine[i]! - yCoarse[i]!) / 15;
  }
  return out;
}
