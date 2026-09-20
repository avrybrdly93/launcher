import { describe, expect, it } from "vitest";
import { ExplicitEulerStepper, integrate } from "@ballista/solverkit";
import { createDragFreeParabolaReference } from "./analytic-references.js";

/**
 * Global error at t_f of a single {@link integrate} run at step size h,
 * measured against the reference's exact closed-form state.
 */
function globalErrorAt(h: number): number {
  const ref = createDragFreeParabolaReference();
  const tspan: readonly [number, number] = [0, 1];
  const report = integrate(
    ref.model,
    ref.ctx,
    ref.y0,
    tspan,
    // events: "off" (P0.99): global error at t_f versus the drag-free parabola,
    // which requires reaching t_f rather than stopping at the ground.
    { stepper: "explicit-euler", h, maxSteps: Number.MAX_SAFE_INTEGER, events: "off" },
    new ExplicitEulerStepper(),
  );
  const exact = ref.state(tspan[1]);
  let sumSq = 0;
  for (let i = 0; i < exact.length; i++) {
    const d = report.yFinal[i]! - exact[i]!;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq);
}

describe("Explicit Euler global error vs drag-free parabola (P2.09)", () => {
  it("error at t_f halves when h halves (ratio 2.0 +/- 5%) across a ladder of step sizes", () => {
    const hs = [0.02, 0.01, 0.005, 0.0025, 0.00125];
    const errors = hs.map(globalErrorAt);

    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]!).toBeLessThan(errors[i - 1]!);
      const ratio = errors[i - 1]! / errors[i]!;
      expect(ratio).toBeGreaterThan(1.9);
      expect(ratio).toBeLessThan(2.1);
    }
  });
});
