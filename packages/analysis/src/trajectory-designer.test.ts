import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  type ForceModel,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  UniformWind,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { type SolverConfig, createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { PLANAR_LAYOUT } from "./observables.js";
import type { ShootingProblem } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";
import { designTrajectory } from "./trajectory-designer.js";

/**
 * P5.22's criterion is "all three lock combinations function", which is a
 * weaker sentence than it looks and is easy to satisfy without testing
 * anything. Three calls that return without throwing would pass a reading of
 * it, and would pass equally well against an implementation that solved a
 * different problem in each branch.
 *
 * So "function" is read here as three claims:
 *
 * 1. **Each combination is right on its own**, against the drag-free closed
 *    form, which is independent of every line of the module.
 * 2. **The three agree about what R is.** Solve v₀ from (θ, R), re-lock
 *    (θ, v₀), and the R that comes back must be the R that went in — and the
 *    same for the θ solve. This is the check that catches the plausible bug:
 *    one branch measuring downrange from the origin and another from the launch
 *    point, or one aiming at the target's centre and another at the ground. Both
 *    branches would look correct in isolation and disagree here.
 * 3. **They still function with drag and wind**, where no closed form exists
 *    and the round trip is the only available reference.
 *
 * One further property is measured rather than assumed: the v₀ solve brackets,
 * and a bracketing method on a non-monotone function converges to *a* root and
 * reports it as *the* root. `range(v₀)` at fixed θ being monotone is therefore
 * load-bearing, and it is swept rather than argued.
 */

/* ------------------------------------------------------------------ */
/* Harness                                                              */
/* ------------------------------------------------------------------ */

/** As in `arcs.test.ts`: an interactive tolerance is noise to a 1e-9 root find. */
const TIGHT_TOL: SolverConfig = {
  stepper: "dopri5",
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

/** Deliberately the same shape as `arcs.test.ts`'s helper of the same name. */
function simpleProblem(
  target: PointTarget,
  cd = 0,
  launchPoint = [0, 0],
  wind = new ZeroWind(),
): ShootingProblem {
  const forces: ForceModel[] =
    cd === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), wind),
      createSphericalProjectileParams({
        mass: 1,
        radius: 0.05,
        dragCoefficient: new ConstantCd(cd),
      }),
    ),
    target,
    launchPoint,
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 600],
    layout: PLANAR_LAYOUT,
  };
}

const groundTarget = (downrange: number): PointTarget => ({
  kind: "point",
  center: [downrange, 0],
});

/* ------------------------------------------------------------------ */
/* 1. Each combination against the drag-free closed form                */
/* ------------------------------------------------------------------ */

describe("the three lock combinations, drag-free, against closed forms", () => {
  // R = v₀² sin(2θ)/g. None of the three expectations below is read from the
  // implementation; each is the inverse of that one identity.
  const speed = 80;
  const theta = 0.5;
  const expectedRange = ((speed * speed) / G_STD) * Math.sin(2 * theta);

  it("locks (θ, v₀) and returns the closed-form range", () => {
    const result = designTrajectory(simpleProblem(groundTarget(300)), { theta, speed });

    expect(result.solveFor).toBe("range");
    expect(result.locked).toEqual(["theta", "speed"]);
    expect(result.feasible).toBe(true);
    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]!.range).toBeCloseTo(expectedRange, 6);
    expect(result.solutions[0]!.theta).toBe(theta);
    expect(result.solutions[0]!.speed).toBe(speed);
    // No root find happened, and the result says so rather than reporting a
    // plausible-looking iteration count.
    expect(result.solutions[0]!.iterations).toBe(0);
    expect(result.evaluations).toBe(1);
  });

  it("locks (θ, R) and returns the closed-form speed", () => {
    // v₀ = sqrt(g R / sin 2θ).
    const targetRange = 400;
    const expectedSpeed = Math.sqrt((G_STD * targetRange) / Math.sin(2 * theta));
    const result = designTrajectory(simpleProblem(groundTarget(targetRange)), {
      theta,
      range: targetRange,
    });

    expect(result.solveFor).toBe("speed");
    expect(result.locked).toEqual(["theta", "range"]);
    expect(result.feasible).toBe(true);
    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]!.speed).toBeCloseTo(expectedSpeed, 6);
    // A converged bracket is a claim about the bracket; this is the claim
    // about the physics.
    expect(Math.abs(result.solutions[0]!.downrangeMiss)).toBeLessThan(1e-7);
  });

  it("locks (v₀, R) and returns both closed-form arcs, low first", () => {
    const targetRange = 400;
    const expectedLow = 0.5 * Math.asin((G_STD * targetRange) / (speed * speed));
    const expectedHigh = Math.PI / 2 - expectedLow;
    const result = designTrajectory(simpleProblem(groundTarget(targetRange)), {
      speed,
      range: targetRange,
    });

    expect(result.solveFor).toBe("theta");
    expect(result.locked).toEqual(["speed", "range"]);
    expect(result.feasible).toBe(true);
    expect(result.solutions).toHaveLength(2);
    expect(result.solutions[0]!.arc).toBe("low");
    expect(result.solutions[1]!.arc).toBe("high");
    expect(result.solutions[0]!.theta).toBeCloseTo(expectedLow, 9);
    expect(result.solutions[1]!.theta).toBeCloseTo(expectedHigh, 9);
    // Independent of which bracket each came from: the lofted arc flies longer.
    expect(result.solutions[0]!.timeOfFlight).toBeLessThan(result.solutions[1]!.timeOfFlight);
  });

  it("labels an arc only where there were two answers to tell apart", () => {
    const problem = simpleProblem(groundTarget(400));
    expect(designTrajectory(problem, { theta, speed }).solutions[0]!.arc).toBeNull();
    expect(designTrajectory(problem, { theta, range: 400 }).solutions[0]!.arc).toBeNull();
    for (const s of designTrajectory(problem, { speed, range: 400 }).solutions) {
      expect(s.arc).not.toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. The three agree about what R is                                   */
/* ------------------------------------------------------------------ */

describe("round trips: the three combinations share one definition of R", () => {
  // With drag on, so the agreement cannot be coming from a shared closed form.
  const problem = simpleProblem(groundTarget(140), 0.47);

  it("solves v₀ for a locked R, then recovers that R from the pair it produced", () => {
    const targetRange = 140;
    const theta = 0.6;
    const solved = designTrajectory(problem, { theta, range: targetRange });
    expect(solved.feasible).toBe(true);

    const back = designTrajectory(problem, { theta, speed: solved.solutions[0]!.speed });
    expect(back.solutions[0]!.range).toBeCloseTo(targetRange, 7);
  });

  it("solves both θ for a locked R, then recovers that R from each of them", () => {
    const targetRange = 140;
    const speed = 60;
    const solved = designTrajectory(problem, { speed, range: targetRange });
    expect(solved.feasible).toBe(true);
    expect(solved.solutions).toHaveLength(2);

    for (const solution of solved.solutions) {
      const back = designTrajectory(problem, { theta: solution.theta, speed });
      expect(back.solutions[0]!.range).toBeCloseTo(targetRange, 7);
    }
  });

  it("measures R from the launch point, not from the origin", () => {
    // The bug this is built for: one branch subtracting the launch downrange
    // and another not. Both look right from a launch at x = 0, which is why
    // every other case in this file would miss it.
    const launched = simpleProblem(groundTarget(140), 0.47, [25, 0]);
    const theta = 0.6;
    const speed = 60;

    const forward = designTrajectory(launched, { theta, speed });
    const impactDownrange = forward.solutions[0]!.residual.impact![0]!;
    expect(forward.solutions[0]!.range).toBeCloseTo(impactDownrange - 25, 9);

    // And the inverse agrees: asking for that same R gives back that speed.
    const inverse = designTrajectory(launched, { theta, range: forward.solutions[0]!.range });
    expect(inverse.solutions[0]!.speed).toBeCloseTo(speed, 6);
  });

  it("solves for the requested R and not for the target's own downrange", () => {
    // The θ solve reaches solveArcs, whose default aim point is the target
    // centre. If the requested R did not override that centre's downrange, this
    // combination would quietly solve a different problem from the other two
    // whenever R and the target disagreed -- which is every step of a designer
    // sweep.
    const problem = simpleProblem(groundTarget(140), 0.47);
    const speed = 60;
    const result = designTrajectory(problem, { speed, range: 110 });

    expect(result.feasible).toBe(true);
    for (const solution of result.solutions) {
      expect(solution.range).toBe(110);
      expect(Math.abs(solution.downrangeMiss)).toBeLessThan(1e-6);
      // The independent check: fly that aim forward and it lands at 110, not 140.
      const flown = designTrajectory(problem, { theta: solution.theta, speed });
      expect(flown.solutions[0]!.range).toBeCloseTo(110, 7);
    }
  });

  it("lets the requested R override an aimPoint the caller also passed", () => {
    // Both name a downrange, so one of them has to win, and silently honouring
    // the aimPoint would make the designer's own field the one being ignored.
    const problem = simpleProblem(groundTarget(140), 0.47);
    const speed = 60;
    const result = designTrajectory(problem, { speed, range: 110 }, { aimPoint: [200, 0] });

    expect(result.feasible).toBe(true);
    for (const solution of result.solutions) {
      const flown = designTrajectory(problem, { theta: solution.theta, speed });
      expect(flown.solutions[0]!.range).toBeCloseTo(110, 7);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Drag and wind: the literal criterion, where no closed form exists */
/* ------------------------------------------------------------------ */

describe("all three lock combinations with drag and wind", () => {
  const problem = simpleProblem(groundTarget(140), 0.47, [0, 0], new UniformWind(-6));
  const theta = 0.55;
  const speed = 62;

  it("solves R, then v₀ and θ back to it, all consistent", () => {
    const forward = designTrajectory(problem, { theta, speed });
    expect(forward.feasible).toBe(true);
    const range = forward.solutions[0]!.range;
    expect(range).toBeGreaterThan(0);

    const bySpeed = designTrajectory(problem, { theta, range });
    expect(bySpeed.feasible).toBe(true);
    expect(bySpeed.solutions[0]!.speed).toBeCloseTo(speed, 6);

    const byTheta = designTrajectory(problem, { speed, range });
    expect(byTheta.feasible).toBe(true);
    // The forward aim is one of the two arcs to its own range, and a headwind
    // does not change that.
    const angles = byTheta.solutions.map((s) => s.theta);
    expect(angles.some((a) => Math.abs(a - theta) < 1e-6)).toBe(true);
    for (const solution of byTheta.solutions) {
      expect(Math.abs(solution.downrangeMiss)).toBeLessThan(1e-6);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4. The property the v₀ bracket rests on                              */
/* ------------------------------------------------------------------ */

describe("range is monotone in speed at fixed elevation", () => {
  it("rises at every step of a swept speed, with drag and wind", () => {
    // Measured, not argued. The v₀ solve is a bracketing method, and on a
    // non-monotone function a bracket converges to *a* root while reporting it
    // as *the* root -- a wrong answer that looks converged. Three elevations
    // across the usable band, because monotonicity failing only near the
    // grazing end would be missed by one.
    const problem = simpleProblem(groundTarget(140), 0.47, [0, 0], new UniformWind(-6));
    for (const theta of [0.15, 0.6, 1.3]) {
      let previous = Number.NEGATIVE_INFINITY;
      for (let speed = 10; speed <= 200; speed += 10) {
        const range = designTrajectory(problem, { theta, speed }).solutions[0]!.range;
        expect(range).toBeGreaterThan(previous);
        previous = range;
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 5. Infeasible requests are answers, not exceptions                   */
/* ------------------------------------------------------------------ */

describe("requests with no solution", () => {
  it("reports a target past the envelope at the locked speed", () => {
    const problem = simpleProblem(groundTarget(400), 0.47);
    // Drag-free reach at 40 m/s is v₀²/g ≈ 163 m, and drag only shortens it.
    const result = designTrajectory(problem, { speed: 40, range: 400 });

    expect(result.feasible).toBe(false);
    expect(result.solutions).toEqual([]);
    expect(result.shortfall).toBeGreaterThan(0);
    expect(result.reason).toMatch(/envelope/);
    // The shortfall is the distance past reach, so adding it back must land on
    // the envelope rather than being some other positive number.
    const envelopeRange = 400 - result.shortfall;
    const atEnvelope = designTrajectory(problem, { speed: 40, range: envelopeRange });
    expect(atEnvelope.feasible).toBe(true);
  });

  it("reports a range beyond what the speed bound allows at a locked elevation", () => {
    const problem = simpleProblem(groundTarget(5000), 0.47);
    const result = designTrajectory(
      problem,
      { theta: 0.6, range: 5000 },
      { speedBounds: [1, 120] },
    );

    expect(result.feasible).toBe(false);
    expect(result.solutions).toEqual([]);
    expect(result.shortfall).toBeGreaterThan(0);
    expect(result.reason).toMatch(/speed bound/);
  });

  it("reports a requested range shorter than the lower speed bound already reaches", () => {
    // The other sign failure, which brentRoot would otherwise report as
    // "does not bracket a sign change" -- the symptom, not the cause.
    const problem = simpleProblem(groundTarget(140), 0.47);
    const result = designTrajectory(problem, { theta: 0.6, range: 1 }, { speedBounds: [30, 120] });

    expect(result.feasible).toBe(false);
    expect(result.reason).toMatch(/shorter than/);
    expect(result.shortfall).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 6. A request must name exactly two                                   */
/* ------------------------------------------------------------------ */

describe("request validation", () => {
  const problem = simpleProblem(groundTarget(140), 0.47);

  it("rejects an over-determined request", () => {
    // Three values is not "extra information": the third is almost never the
    // one the physics produces, so honouring two and ignoring the third would
    // answer a question the caller did not ask while looking like it had.
    expect(() => designTrajectory(problem, { theta: 0.6, speed: 60, range: 140 })).toThrow(
      /exactly two/,
    );
  });

  it("rejects an under-determined request", () => {
    expect(() => designTrajectory(problem, { speed: 60 })).toThrow(/exactly two/);
    expect(() => designTrajectory(problem, {})).toThrow(/exactly two/);
  });

  it("rejects non-finite values and non-positive speeds", () => {
    expect(() => designTrajectory(problem, { theta: Number.NaN, speed: 60 })).toThrow(/finite/);
    expect(() => designTrajectory(problem, { theta: 0.6, range: Infinity })).toThrow(/finite/);
    expect(() => designTrajectory(problem, { theta: 0.6, speed: 0 })).toThrow(/positive/);
    expect(() => designTrajectory(problem, { theta: 0.6, speed: -60 })).toThrow(/positive/);
  });

  it("rejects speed bounds that cannot bracket", () => {
    expect(() =>
      designTrajectory(problem, { theta: 0.6, range: 140 }, { speedBounds: [100, 10] }),
    ).toThrow(/speedBounds/);
    expect(() =>
      designTrajectory(problem, { theta: 0.6, range: 140 }, { speedBounds: [0, 100] }),
    ).toThrow(/speedBounds/);
  });
});
