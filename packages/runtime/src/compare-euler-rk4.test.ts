import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { compareLegend, COMPARE_PALETTE, createCompareStore } from "./compare-store.js";
import { createSimulationSession } from "./simulation-session.js";

/**
 * P3.25 validation criterion: "Euler vs RK4 overlay reproduces §4
 * range-bias story visually." §4.2's pitfall 1 is that explicit Euler
 * "always spirals outward" on dynamics it can't represent exactly, which
 * "on the projectile ... appears as systematic range/apex bias" -- i.e. at
 * a given (not-tiny) step size h, Euler's landing range differs from a
 * high-order reference in a *consistent* direction and by an amount that
 * shrinks as h shrinks (an O(h) global-error signature, not run-to-run
 * noise). This test drives exactly the pin/compare workflow a user would
 * (commit a scenario with one stepper, pin the result, switch steppers,
 * re-run, pin again) and checks the two pinned trajectories' landing
 * ranges reproduce that story numerically.
 *
 * Uses the drag-free reference preset (gravity only): for this ODE, Euler's
 * discrete recurrence has an exact closed form, y_Euler(t) = y_exact(t) +
 * 0.5*g*h*t (derived from the telescoping sum of vy_k = vy0 - k*h*g) --
 * Euler's simulated altitude is always *above* the true parabola, so it
 * takes longer to reach the ground and travels a correspondingly longer
 * horizontal range. Classical RK4 (order 4) has no such term at these step
 * sizes and stays essentially exact, making it the "true" reference the
 * blueprint's overlay compares Euler against.
 */
describe("Euler vs RK4 pinned-trajectory range bias (P3.25)", () => {
  const dragFree = PRESET_SCENARIOS.find(
    (p) => p.model.forceIds.length === 1 && p.model.forceIds[0] === "gravity",
  )!;

  function landingRange(session: ReturnType<typeof createSimulationSession>, h: number) {
    const outcome = session.commitScenario({
      ...dragFree,
      solver: { stepper: "explicit-euler", h, maxSteps: 1_000_000 },
    });
    expect(outcome.status).toBe("ok");
    const eulerTrajectory = session.result.getState().trajectory!;
    const eulerRange = eulerTrajectory.channels[0]![eulerTrajectory.nSteps - 1]!;

    const rk4Outcome = session.commitScenario({
      ...dragFree,
      solver: { stepper: "classical-rk4", h, maxSteps: 1_000_000 },
    });
    expect(rk4Outcome.status).toBe("ok");
    const rk4Trajectory = session.result.getState().trajectory!;
    const rk4Range = rk4Trajectory.channels[0]![rk4Trajectory.nSteps - 1]!;

    return { eulerTrajectory, rk4Trajectory, eulerRange, rk4Range };
  }

  it("Euler systematically overshoots RK4's range at a moderate h, and the gap shrinks as h shrinks", () => {
    const session = createSimulationSession(dragFree, [dragFree]);

    const coarse = landingRange(session, 0.05);
    const fine = landingRange(session, 0.0125); // h/4

    const coarseGap = coarse.eulerRange - coarse.rk4Range;
    const fineGap = fine.eulerRange - fine.rk4Range;

    // Systematic, one-directional bias (Euler always lands farther than RK4
    // on this drag-free case, per the closed-form derivation above) --
    // not just nonzero noise.
    expect(coarseGap).toBeGreaterThan(0);
    expect(fineGap).toBeGreaterThan(0);

    // Visually significant at the coarse step (this is what the pinned
    // overlay is meant to make obvious).
    expect(coarseGap / coarse.rk4Range).toBeGreaterThan(0.01);

    // O(h) global error => quartering h should quarter the gap (allow slack
    // for RK4's own much-smaller residual error).
    expect(fineGap).toBeLessThan(coarseGap * 0.4);

    // RK4 itself barely moves between the two step sizes -- it's already
    // an accurate reference at the coarse h, isolating the bias as Euler's.
    expect(Math.abs(fine.rk4Range - coarse.rk4Range) / coarse.rk4Range).toBeLessThan(1e-4);
  });

  it("pinning both runs produces a two-entry legend with distinct palette colors, in pin order", () => {
    const session = createSimulationSession(dragFree, [dragFree]);
    const compare = createCompareStore();

    session.commitScenario({
      ...dragFree,
      solver: { stepper: "explicit-euler", h: 0.05, maxSteps: 1_000_000 },
    });
    const euler = compare.pin(
      session.result.getState().trajectory!,
      "explicit-euler",
      "Explicit Euler",
    );

    session.commitScenario({
      ...dragFree,
      solver: { stepper: "classical-rk4", h: 0.05, maxSteps: 1_000_000 },
    });
    const rk4 = compare.pin(
      session.result.getState().trajectory!,
      "classical-rk4",
      "Classical RK4",
    );

    const legend = compareLegend(compare.getState());
    expect(legend).toEqual([
      { id: euler.id, label: "Explicit Euler", color: COMPARE_PALETTE[0] },
      { id: rk4.id, label: "Classical RK4", color: COMPARE_PALETTE[1] },
    ]);
    expect(legend[0]!.color).not.toBe(legend[1]!.color);
  });
});
