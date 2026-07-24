import { describe, expect, it } from "vitest";
import {
  TrajectoryRecorder,
  createDormandPrince54Stepper,
  integrate,
  type SolverConfig,
} from "@ballista/solverkit";
import {
  createDragFreeParabolaReference,
  createLinearDragReference,
  type AnalyticReference,
} from "./analytic-references.js";

/**
 * P3.26 validation criterion: "overlay coincides with DOPRI5 at 1e-6 rtol
 * (visual + max-dev test)." The "visual" half (GhostLayer's faded/dashed
 * style, and that it traces the same geometry `TrajectoryLayer` does) is
 * `packages/viz`'s `ghost-layer.test.ts` -- `viz` can't import this
 * dev-only `validation` package (`.dependency-cruiser.cjs`), so the actual
 * analytic-vs-numeric comparison a live GhostLayer would draw over a
 * DOPRI5 trajectory lives here instead, as the "max-dev test" half: solve
 * each P2.08 analytic reference with DOPRI5 at rtol 1e-6, and confirm the
 * recorded trajectory never departs from the closed-form solution by more
 * than a tolerance consistent with that rtol.
 */
function maxAbsoluteDeviation(reference: AnalyticReference, rtol: number, atol: number): number {
  const cfg: SolverConfig = { stepper: "dopri5", rtol, atol, controller: "PI", maxSteps: 200_000 };
  const recorder = new TrajectoryRecorder();
  const stepper = createDormandPrince54Stepper();
  const report = integrate(reference.model, reference.ctx, reference.y0, [0, 3], cfg, stepper, [
    recorder,
  ]);
  expect(report.status).toBe("ok");

  const { trajectory } = recorder;
  let maxDeviation = 0;
  for (let i = 0; i < trajectory.nSteps; i++) {
    const t = trajectory.t[i]!;
    const exact = reference.state(t);
    for (let c = 0; c < trajectory.channels.length; c++) {
      const deviation = Math.abs(trajectory.channels[c]![i]! - exact[c]!);
      if (deviation > maxDeviation) maxDeviation = deviation;
    }
  }
  return maxDeviation;
}

describe("Ghost analytic overlay coincides with DOPRI5 at rtol 1e-6 (P3.26)", () => {
  it("drag-free parabola: DOPRI5 stays within 1e-4 of the closed-form state over the whole flight", () => {
    const deviation = maxAbsoluteDeviation(createDragFreeParabolaReference(), 1e-6, 1e-9);
    expect(deviation).toBeLessThan(1e-4);
  });

  it("linear drag: DOPRI5 stays within 1e-4 of the closed-form state over the whole flight", () => {
    const deviation = maxAbsoluteDeviation(createLinearDragReference(), 1e-6, 1e-9);
    expect(deviation).toBeLessThan(1e-4);
  });

  it("tightening rtol tightens the max deviation (the coincidence is rtol-driven, not accidental)", () => {
    const loose = maxAbsoluteDeviation(createDragFreeParabolaReference(), 1e-6, 1e-9);
    const tight = maxAbsoluteDeviation(createDragFreeParabolaReference(), 1e-9, 1e-12);
    expect(tight).toBeLessThan(loose);
  });
});
