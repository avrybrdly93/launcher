import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  type ForceModel,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
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
import { type DesignResult, designTrajectory } from "./trajectory-designer.js";

/**
 * P5.22's validation criterion is "all three lock combinations function", and
 * "function" is read here as three separate claims, because a designer can be
 * wrong in three different ways:
 *
 * 1. **Each lock is right on its own** — checked against the drag-free closed
 *    form `R = v₀² sin 2θ / g`, which none of the implementation knows. The θ
 *    and v₀ locks each have an analytic inverse of that identity to be checked
 *    against, so all three have an external reference.
 * 2. **The three agree with each other** — the cross-lock section. Solve for R
 *    from (θ, v₀), then recover v₀ from (θ, R) and θ from (v₀, R), and the
 *    original numbers must come back. This is the test that actually earns the
 *    word "designer": three locks that are each self-consistently wrong would
 *    pass claim 1 and fail here.
 * 3. **Infeasible requests are reported, not fabricated** — the failure
 *    section. An out-of-reach target must come back `feasible: false` with a
 *    reason, not as a converged-looking aim that misses.
 *
 * Claim 2 is run *with drag on*, deliberately. The closed form is exact only
 * without drag, so a drag-free round trip could be satisfied by three
 * independent re-derivations of the same formula; with drag there is no formula
 * to agree with, and the locks can only agree by genuinely inverting the same
 * integrated trajectory.
 */

/* ------------------------------------------------------------------ */
/* Harness                                                              */
/* ------------------------------------------------------------------ */

/** Tighter than the app's working tolerance, matching `arcs.test.ts`'s reasoning. */
const TIGHT_TOL: SolverConfig = {
  stepper: "dopri5",
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

/** Deliberately identical in shape to `arcs.test.ts`'s `simpleProblem`. */
function simpleProblem(target: PointTarget, cd = 0, launchPoint = [0, 0]): ShootingProblem {
  const forces: ForceModel[] =
    cd === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
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

const somewhere: PointTarget = { kind: "point", center: [400, 0] };

/** The drag-free identity every reference value below is derived from. */
function dragFreeRangeOf(speed: number, theta: number): number {
  return (speed * speed * Math.sin(2 * theta)) / G_STD;
}

function onlySolution(result: DesignResult) {
  expect(result.feasible).toBe(true);
  expect(result.failure).toBeNull();
  expect(result.solutions).toHaveLength(1);
  return result.solutions[0]!;
}

/* ------------------------------------------------------------------ */
/* Lock 1 of 3 — (θ, v₀) → R                                            */
/* ------------------------------------------------------------------ */

describe("the (θ, v₀) → R lock", () => {
  it("reports the range the drag-free closed form predicts", () => {
    const theta = Math.PI / 6;
    const speed = 70;
    const result = designTrajectory(simpleProblem(somewhere), {
      solveFor: "range",
      theta,
      speed,
    });

    const solution = onlySolution(result);
    expect(solution.range).toBeCloseTo(dragFreeRangeOf(speed, theta), 6);
    expect(solution.aim).toEqual({ theta, speed });
    // Nothing was requested, so nothing was missed. Exact, not converged.
    expect(solution.downrangeMiss).toBe(0);
    expect(solution.arc).toBeNull();
    // One flight, no iteration: this lock is an evaluation, not a solve.
    expect(result.evaluations).toBe(1);
  });

  it("reports a shorter range with drag than without, at the same aim", () => {
    const theta = Math.PI / 4;
    const speed = 90;
    const free = onlySolution(
      designTrajectory(simpleProblem(somewhere, 0), { solveFor: "range", theta, speed }),
    );
    const dragged = onlySolution(
      designTrajectory(simpleProblem(somewhere, 0.47), { solveFor: "range", theta, speed }),
    );

    expect(dragged.range).toBeLessThan(free.range);
    expect(dragged.range).toBeGreaterThan(0);
  });

  it("measures downrange from the launcher, not from the origin", () => {
    // A launcher moved 100 m downrange reaches the same *displacement*, so the
    // reported R must be unchanged. If R were measured from the origin it would
    // come back 100 m longer.
    const theta = Math.PI / 5;
    const speed = 60;
    const atOrigin = onlySolution(
      designTrajectory(simpleProblem(somewhere, 0, [0, 0]), { solveFor: "range", theta, speed }),
    );
    const movedDownrange = onlySolution(
      designTrajectory(simpleProblem(somewhere, 0, [100, 0]), { solveFor: "range", theta, speed }),
    );

    expect(movedDownrange.range).toBeCloseTo(atOrigin.range, 6);
  });
});

/* ------------------------------------------------------------------ */
/* Lock 2 of 3 — (θ, R) → v₀                                            */
/* ------------------------------------------------------------------ */

describe("the (θ, R) → v₀ lock", () => {
  it("recovers the speed the drag-free closed form predicts", () => {
    // Inverting R = v₀² sin2θ / g gives v₀ = √(gR / sin2θ). Not a number the
    // implementation produces — it is the analytic inverse of the identity.
    const theta = Math.PI / 6;
    const range = 300;
    const expected = Math.sqrt((G_STD * range) / Math.sin(2 * theta));

    const solution = onlySolution(
      designTrajectory(simpleProblem(somewhere), { solveFor: "speed", theta, range }),
    );

    expect(solution.aim.speed).toBeCloseTo(expected, 6);
    expect(solution.aim.theta).toBe(theta);
    expect(Math.abs(solution.downrangeMiss)).toBeLessThan(1e-6);
    expect(solution.range).toBeCloseTo(range, 6);
    expect(solution.arc).toBeNull();
  });

  it("needs a faster launch to reach the same range once drag is on", () => {
    const theta = Math.PI / 4;
    const range = 500;
    const free = onlySolution(
      designTrajectory(simpleProblem(somewhere, 0), { solveFor: "speed", theta, range }),
    );
    const dragged = onlySolution(
      designTrajectory(simpleProblem(somewhere, 0.47), { solveFor: "speed", theta, range }),
    );

    expect(dragged.aim.speed).toBeGreaterThan(free.aim.speed);
    // Both genuinely hit the requested range, not merely converge.
    expect(Math.abs(dragged.downrangeMiss)).toBeLessThan(1e-5);
    expect(Math.abs(free.downrangeMiss)).toBeLessThan(1e-5);
  });

  it("solves from a raised launcher at zero elevation, where no drag-free seed exists", () => {
    // sin(2·0) = 0, so the seed formula is unavailable. A launcher 50 m up
    // still reaches downrange at θ = 0, so this must solve rather than report
    // a degenerate elevation — the distinction the seed fallback exists for.
    const result = designTrajectory(simpleProblem(somewhere, 0, [0, 50]), {
      solveFor: "speed",
      theta: 0,
      range: 200,
    });

    const solution = onlySolution(result);
    // Level launch from height h: time to fall is √(2h/g), so v₀ = R/√(2h/g).
    const expected = 200 / Math.sqrt((2 * 50) / G_STD);
    expect(solution.aim.speed).toBeCloseTo(expected, 5);
    expect(Math.abs(solution.downrangeMiss)).toBeLessThan(1e-5);
  });
});

/* ------------------------------------------------------------------ */
/* Lock 3 of 3 — (v₀, R) → θ                                            */
/* ------------------------------------------------------------------ */

describe("the (v₀, R) → θ lock", () => {
  it("returns both arcs, at the elevations the closed form predicts", () => {
    const speed = 80;
    const range = 400;
    const expectedLow = 0.5 * Math.asin((G_STD * range) / (speed * speed));
    const expectedHigh = Math.PI / 2 - expectedLow;

    const result = designTrajectory(simpleProblem(somewhere), {
      solveFor: "theta",
      speed,
      range,
    });

    expect(result.feasible).toBe(true);
    expect(result.solutions).toHaveLength(2);
    const [low, high] = result.solutions as [
      (typeof result.solutions)[0],
      (typeof result.solutions)[0],
    ];
    expect(low.arc).toBe("low");
    expect(high.arc).toBe("high");
    expect(low.aim.theta).toBeCloseTo(expectedLow, 9);
    expect(high.aim.theta).toBeCloseTo(expectedHigh, 9);
    expect(low.aim.speed).toBe(speed);
    expect(high.aim.speed).toBe(speed);
  });

  it("labels the lofted arc as the one that stays up longer", () => {
    // The same property `arcs.test.ts` checks the labels against, re-asserted
    // through this module's own translation layer: a swap between solveArcs
    // and DesignSolution would pass an ordering check and fail this one.
    const result = designTrajectory(simpleProblem(somewhere, 0.3), {
      solveFor: "theta",
      speed: 90,
      range: 400,
    });

    expect(result.solutions).toHaveLength(2);
    const [low, high] = result.solutions;
    expect(low!.aim.theta).toBeLessThan(high!.aim.theta);
    expect(high!.residual.timeOfFlight!).toBeGreaterThan(low!.residual.timeOfFlight!);
  });

  it("aims relative to a launcher that is not at the origin", () => {
    // Same displacement from a launcher moved 100 m downrange must give the
    // same two elevations; if R were read as a world abscissa they would differ.
    const speed = 80;
    const range = 400;
    const atOrigin = designTrajectory(simpleProblem(somewhere, 0, [0, 0]), {
      solveFor: "theta",
      speed,
      range,
    });
    const moved = designTrajectory(simpleProblem(somewhere, 0, [100, 0]), {
      solveFor: "theta",
      speed,
      range,
    });

    expect(moved.solutions).toHaveLength(2);
    expect(moved.solutions[0]!.aim.theta).toBeCloseTo(atOrigin.solutions[0]!.aim.theta, 9);
    expect(moved.solutions[1]!.aim.theta).toBeCloseTo(atOrigin.solutions[1]!.aim.theta, 9);
  });
});

/* ------------------------------------------------------------------ */
/* The three locks describe the same physics                            */
/* ------------------------------------------------------------------ */

describe("cross-lock consistency, with drag on so no closed form can supply the answer", () => {
  const problem = () => simpleProblem(somewhere, 0.47);
  // 22.5° is well clear of this problem's drag-lowered peak (measured at ~36°,
  // max range ~397 m), so the round trip below lands unambiguously on the low
  // branch. Sitting on the peak would make the two arcs coincide and turn a
  // real disagreement into a passing test.
  const theta = Math.PI / 8;
  const speed = 95;

  it("round-trips (θ, v₀) → R → v₀", () => {
    const range = onlySolution(
      designTrajectory(problem(), { solveFor: "range", theta, speed }),
    ).range;
    const recovered = onlySolution(
      designTrajectory(problem(), { solveFor: "speed", theta, range }),
    );

    expect(recovered.aim.speed).toBeCloseTo(speed, 6);
  });

  it("round-trips (θ, v₀) → R → θ, recovering the original as one of the two arcs", () => {
    const range = onlySolution(
      designTrajectory(problem(), { solveFor: "range", theta, speed }),
    ).range;
    const result = designTrajectory(problem(), { solveFor: "theta", speed, range });

    expect(result.feasible).toBe(true);
    const thetas = result.solutions.map((s) => s.aim.theta);
    // 22.5° is below the drag-lowered peak, so it comes back as the low arc.
    expect(Math.min(...thetas.map((t) => Math.abs(t - theta)))).toBeLessThan(1e-8);
  });

  it("agrees on the range each solved arc actually reaches", () => {
    // Inside this problem's measured envelope (~397 m at 95 m/s with cd 0.47),
    // so both arcs exist and both can be flown back through the range lock.
    const range = 340;
    const arcs = designTrajectory(problem(), { solveFor: "theta", speed, range });
    expect(arcs.solutions).toHaveLength(2);

    for (const solution of arcs.solutions) {
      const flown = onlySolution(
        designTrajectory(problem(), {
          solveFor: "range",
          theta: solution.aim.theta,
          speed: solution.aim.speed,
        }),
      );
      // Fly the solved aim through the *other* lock and it lands on the request.
      expect(flown.range).toBeCloseTo(range, 5);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Infeasible requests are reported, not fabricated                     */
/* ------------------------------------------------------------------ */

describe("requests with no solution", () => {
  it("reports a target beyond the speed cap as unreachable rather than solving past it", () => {
    const result = designTrajectory(
      simpleProblem(somewhere),
      { solveFor: "speed", theta: Math.PI / 4, range: 1e7 },
      { maxSpeed: 100 },
    );

    expect(result.feasible).toBe(false);
    expect(result.failure).toBe("unreachable");
    expect(result.solutions).toHaveLength(0);
  });

  it("reports a target beyond the envelope as unreachable for the θ lock", () => {
    // Drag-free maximum range at 40 m/s is v₀²/g ≈ 163 m; 5000 m is far past it.
    const result = designTrajectory(simpleProblem(somewhere), {
      solveFor: "theta",
      speed: 40,
      range: 5000,
    });

    expect(result.feasible).toBe(false);
    expect(result.failure).toBe("unreachable");
    expect(result.solutions).toHaveLength(0);
  });

  it("rejects a level ground launch, which reaches no downrange at any speed", () => {
    const result = designTrajectory(simpleProblem(somewhere, 0, [0, 0]), {
      solveFor: "speed",
      theta: 0,
      range: 100,
    });

    expect(result.feasible).toBe(false);
    expect(result.failure).toBe("degenerate-elevation");
    // Rejected up front: no trajectory was flown to discover it.
    expect(result.evaluations).toBe(0);
  });

  it("rejects a non-positive requested range on both locks that take one", () => {
    for (const request of [
      { solveFor: "speed", theta: Math.PI / 4, range: 0 },
      { solveFor: "speed", theta: Math.PI / 4, range: -50 },
      { solveFor: "theta", speed: 80, range: 0 },
      { solveFor: "theta", speed: 80, range: -50 },
    ] as const) {
      const result = designTrajectory(simpleProblem(somewhere), request);
      expect(result.failure).toBe("non-positive-range");
      expect(result.feasible).toBe(false);
    }
  });

  it("throws on a malformed aim rather than reporting it as infeasible", () => {
    // A negative speed is not an unreachable target, it is a caller bug, and
    // the two must not come back looking alike.
    expect(() =>
      designTrajectory(simpleProblem(somewhere), { solveFor: "range", theta: 0.5, speed: -1 }),
    ).toThrow(/speed must be finite and positive/);
    expect(() =>
      designTrajectory(simpleProblem(somewhere), {
        solveFor: "range",
        theta: Number.NaN,
        speed: 50,
      }),
    ).toThrow(/theta must be finite/);
    expect(() =>
      designTrajectory(simpleProblem(somewhere), { solveFor: "theta", speed: 0, range: 100 }),
    ).toThrow(/speed must be finite and positive/);
  });
});
