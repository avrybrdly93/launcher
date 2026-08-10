import { describe, expect, it } from "vitest";
import { type NelderMeadBound, type ObjectiveFunction, nelderMead } from "./nelder-mead.js";

/**
 * P5.12's criterion is "Rosenbrock 2D to 1e-8; restarts on collapse", and the
 * two halves are checked in deliberately different ways.
 *
 * **Rosenbrock** has a known minimizer — `f(1, 1) = 0` — so every expectation
 * below is that closed form, never a previous run of this code. The start is
 * `(−1.2, 1)`, the one the literature uses, which sits outside the banana's
 * bend so the run has to traverse the curved valley rather than slide down a
 * quadratic.
 *
 * **Collapse** is checked against McKinnon's counterexample, because "restarts
 * on collapse" is only meaningful if a collapse actually happens, and a
 * well-implemented Nelder–Mead does not collapse on ordinary problems — the
 * probe that led to this file tried Powell's singular function and a 6-D
 * Rosenbrock and neither could be made to fail. McKinnon (1998) constructs
 * families where the method provably converges to a non-stationary point: the
 * simplex flattens onto a line and every subsequent iteration is an inside
 * contraction inside that line. His construction is a property of the *initial
 * simplex*, not of a starting point, which is what {@link
 * NelderMeadOptions.initialSimplex} exists to express. The test pins both
 * sides: that the collapse really occurs without restarts (a wrong answer, from
 * an unbroken run of inside contractions), and that restarts escape it and land
 * on the true minimum, which is again known in closed form.
 */

/** Rosenbrock's banana. Minimum `0` at `(1, 1)`, valley curved along `y = x²`. */
const rosenbrock: ObjectiveFunction = (x) => {
  const offset = 1 - x[0]!;
  const valley = x[1]! - x[0]! * x[0]!;
  return offset * offset + 100 * valley * valley;
};

/**
 * McKinnon's `τ = 2, θ = 6, φ = 60` function, which has a descent direction at
 * the origin — `∂f/∂y = 1 + 2y = 1 > 0` there, so moving to `y < 0` decreases
 * `f` — and whose true minimum is `f(0, −½) = −¼`.
 */
const mckinnon: ObjectiveFunction = (x) => {
  const u = x[0]!;
  const v = x[1]!;
  const tau = 2;
  const theta = 6;
  const phi = 60;
  const first = u <= 0 ? theta * phi * Math.abs(u) ** tau : theta * u ** tau;
  return first + v + v * v;
};

/**
 * The initial simplex McKinnon's proof requires: `(1, 1)`, `(λ₁, λ₂)` and the
 * origin, with `λ = (1 ± √33)/8` the roots that make the reflection of the
 * worst vertex land exactly where the next inside contraction repeats the
 * pattern.
 */
const MCKINNON_SIMPLEX = [
  [1, 1],
  [(1 + Math.sqrt(33)) / 8, (1 - Math.sqrt(33)) / 8],
  [0, 0],
] as const;

/** Wrap an objective so the test can inspect every point it was asked about. */
function recording(objective: ObjectiveFunction): {
  objective: ObjectiveFunction;
  points: number[][];
} {
  const points: number[][] = [];
  return {
    objective: (x) => {
      points.push([...x]);
      return objective(x);
    },
    points,
  };
}

describe("nelderMead — the P5.12 criterion", () => {
  it("takes Rosenbrock 2D from (-1.2, 1) to well inside 1e-8", () => {
    const result = nelderMead(rosenbrock, [-1.2, 1]);

    expect(result.converged).toBe(true);
    expect(result.status).toBe("converged");
    // The criterion, read on the objective value.
    expect(result.fx).toBeLessThanOrEqual(1e-8);
    // And on the minimizer itself, against the closed form rather than a
    // recorded run: f ≤ 1e-8 near the valley floor still allows |x − 1| ~ 1e-4,
    // so the point is the stronger statement of the two.
    expect(result.x[0]!).toBeCloseTo(1, 8);
    expect(result.x[1]!).toBeCloseTo(1, 8);
  });

  it("reaches the same minimum from starts scattered around the valley", () => {
    for (const start of [
      [-1.2, 1],
      [0, 0],
      [5, -5],
      [-3, -4],
      [2.5, 6],
    ]) {
      const result = nelderMead(rosenbrock, start);
      expect(result.converged).toBe(true);
      expect(result.fx).toBeLessThanOrEqual(1e-8);
      expect(result.x[0]!).toBeCloseTo(1, 6);
      expect(result.x[1]!).toBeCloseTo(1, 6);
    }
  });

  it("collapses on McKinnon's simplex when restarts are disabled, and the collapse is the documented one", () => {
    const result = nelderMead(mckinnon, [0, 0], {
      initialSimplex: MCKINNON_SIMPLEX,
      maxRestarts: 0,
    });

    // It stops, and reports itself converged — that is the trap. A tidy small
    // simplex is not evidence of a minimum.
    expect(result.status).toBe("converged");

    // Every single iteration was an inside contraction: the simplex never
    // reflected, expanded or shrank, which is the signature of the failure.
    expect(result.history.length).toBeGreaterThan(50);
    expect(new Set(result.history.map((step) => step.move))).toEqual(new Set(["contract-inside"]));

    // And it landed on the origin, where f = 0 — a non-stationary point, and
    // strictly worse than the true minimum of −¼.
    expect(result.x[0]!).toBeCloseTo(0, 8);
    expect(result.x[1]!).toBeCloseTo(0, 8);
    expect(result.fx).toBeCloseTo(0, 10);
    expect(result.fx).toBeGreaterThan(-0.25);
  });

  it("restarts out of that collapse and finds the true minimum", () => {
    const result = nelderMead(mckinnon, [0, 0], { initialSimplex: MCKINNON_SIMPLEX });

    expect(result.converged).toBe(true);
    expect(result.restarts).toBeGreaterThanOrEqual(1);
    // f(0, −½) = −¼, in closed form.
    expect(result.fx).toBeCloseTo(-0.25, 10);
    expect(result.x[0]!).toBeCloseTo(0, 6);
    expect(result.x[1]!).toBeCloseTo(-0.5, 6);
    // The restart is what did it: the escaped run had to use moves the
    // collapsed one never reached.
    expect(new Set(result.history.map((step) => step.move)).size).toBeGreaterThan(1);
  });
});

describe("nelderMead — bounds by transform", () => {
  /**
   * Rosenbrock with `x₀` capped below its unconstrained minimizer. Minimizing
   * over `x₁` at fixed `x₀` gives `g(x₀) = (1 − x₀)²`, which decreases in `x₀`
   * on the box, so the constrained minimum sits on the cap: `f = ¼` at
   * `(½, ¼)`. All closed form.
   */
  const CAP: readonly NelderMeadBound[] = [
    { lower: -2, upper: 0.5 },
    { lower: -2, upper: 2 },
  ];

  it("finds a minimum that lies on an active bound", () => {
    const result = nelderMead(rosenbrock, [-1.2, 1], { bounds: CAP });

    expect(result.converged).toBe(true);
    expect(result.fx).toBeCloseTo(0.25, 8);
    expect(result.x[0]!).toBeCloseTo(0.5, 8);
    expect(result.x[1]!).toBeCloseTo(0.25, 6);
  });

  it("never evaluates the objective outside the box, not even once", () => {
    const { objective, points } = recording(rosenbrock);
    nelderMead(objective, [-1.2, 1], { bounds: CAP });

    expect(points.length).toBeGreaterThan(50);
    for (const point of points) {
      expect(point[0]!).toBeGreaterThan(-2);
      expect(point[0]!).toBeLessThanOrEqual(0.5);
      expect(point[1]!).toBeGreaterThan(-2);
      expect(point[1]!).toBeLessThan(2);
    }
  });

  it("honours a one-sided lower bound", () => {
    // Minimize (x − 3)² + (y + 1)² with y held at or above 0: the unconstrained
    // minimizer (3, −1) is infeasible, so the answer is (3, 0), value 1.
    const objective: ObjectiveFunction = (x) => (x[0]! - 3) ** 2 + (x[1]! + 1) ** 2;
    const result = nelderMead(objective, [0, 5], { bounds: [{}, { lower: 0 }] });

    expect(result.x[0]!).toBeCloseTo(3, 6);
    expect(result.x[1]!).toBeGreaterThanOrEqual(0);
    expect(result.x[1]!).toBeCloseTo(0, 6);
    expect(result.fx).toBeCloseTo(1, 6);
  });

  it("honours a one-sided upper bound", () => {
    const objective: ObjectiveFunction = (x) => (x[0]! - 3) ** 2;
    const result = nelderMead(objective, [0], { bounds: [{ upper: 1 }] });

    expect(result.x[0]!).toBeLessThanOrEqual(1);
    expect(result.x[0]!).toBeCloseTo(1, 6);
    expect(result.fx).toBeCloseTo(4, 6);
  });

  it("starts from a point sitting exactly on a bound rather than producing an infinite vertex", () => {
    // The inverse transforms are infinite at the bounds; the inset is what keeps
    // this from becoming an all-NaN simplex.
    const objective: ObjectiveFunction = (x) => (x[0]! - 0.3) ** 2;
    const result = nelderMead(objective, [0], { bounds: [{ lower: 0, upper: 1 }] });

    expect(Number.isFinite(result.fx)).toBe(true);
    expect(result.x[0]!).toBeCloseTo(0.3, 6);
  });

  it("leaves an unbounded run unchanged when bounds are wide enough to be inactive", () => {
    const wide = nelderMead(rosenbrock, [-1.2, 1], {
      bounds: [
        { lower: -50, upper: 50 },
        { lower: -50, upper: 50 },
      ],
    });
    expect(wide.converged).toBe(true);
    expect(wide.x[0]!).toBeCloseTo(1, 6);
    expect(wide.x[1]!).toBeCloseTo(1, 6);
  });
});

describe("nelderMead — behaviour on awkward objectives", () => {
  it("treats a non-finite value as a wall to retreat from, not an error", () => {
    // A quadratic with a NaN moat around the feasible disc. The minimizer at
    // (1, 1) is inside it; a run that threw, or that let NaN into the ordering,
    // would not get there.
    const objective: ObjectiveFunction = (x) => {
      const radius = Math.hypot(x[0]!, x[1]!);
      if (radius > 3) return Number.NaN;
      return (x[0]! - 1) ** 2 + (x[1]! - 1) ** 2;
    };
    const result = nelderMead(objective, [0, 0]);

    expect(result.fx).toBeLessThan(1e-12);
    expect(result.x[0]!).toBeCloseTo(1, 6);
    expect(result.x[1]!).toBeCloseTo(1, 6);
  });

  it("reports evaluation-failed when no initial vertex is admissible", () => {
    const result = nelderMead(() => Number.NaN, [0, 0]);

    expect(result.converged).toBe(false);
    expect(result.status).toBe("evaluation-failed");
    expect(result.failure).toMatch(/no finite value/);
  });

  it("stops on the evaluation budget and says so", () => {
    const result = nelderMead(rosenbrock, [-1.2, 1], { maxEvaluations: 25 });

    expect(result.converged).toBe(false);
    expect(result.status).toBe("max-evaluations");
    expect(result.evaluations).toBeLessThanOrEqual(30);
    // It still returns the best point it saw.
    expect(Number.isFinite(result.fx)).toBe(true);
  });

  it("stops on the iteration budget and says so", () => {
    const result = nelderMead(rosenbrock, [-1.2, 1], { maxIterations: 10 });

    expect(result.converged).toBe(false);
    expect(result.status).toBe("max-iterations");
    expect(result.iterations).toBe(10);
  });

  it("minimizes a quadratic to its closed-form minimizer in several dimensions", () => {
    // Diagonal-plus-coupling SPD quadratic centred at a known point.
    const centre = [1.5, -2.25, 0.5, 4];
    const objective: ObjectiveFunction = (x) => {
      let total = 0;
      for (let i = 0; i < centre.length; i++) {
        const d = x[i]! - centre[i]!;
        total += (i + 1) * d * d;
      }
      return total;
    };
    const result = nelderMead(objective, [0, 0, 0, 0]);

    expect(result.converged).toBe(true);
    for (let i = 0; i < centre.length; i++) {
      expect(result.x[i]!).toBeCloseTo(centre[i]!, 6);
    }
  });
});

describe("nelderMead — coefficients and input validation", () => {
  it("adaptive and fixed coefficients agree exactly at n = 2", () => {
    // Gao–Han reduce to (1, 2, ½, ½) at n = 2, so the two runs should not merely
    // agree on the answer — they should take the identical path.
    const adaptive = nelderMead(rosenbrock, [-1.2, 1], { adaptive: true });
    const fixed = nelderMead(rosenbrock, [-1.2, 1], { adaptive: false });

    expect(fixed.iterations).toBe(adaptive.iterations);
    expect(fixed.evaluations).toBe(adaptive.evaluations);
    expect(fixed.fx).toBe(adaptive.fx);
    expect(fixed.history.map((step) => step.move)).toEqual(
      adaptive.history.map((step) => step.move),
    );
  });

  it("solves a higher-dimensional Rosenbrock, where the coefficients do differ", () => {
    const rosenbrockN: ObjectiveFunction = (x) => {
      let total = 0;
      for (let i = 0; i + 1 < x.length; i++) {
        total += 100 * (x[i + 1]! - x[i]! * x[i]!) ** 2 + (1 - x[i]!) ** 2;
      }
      return total;
    };
    const result = nelderMead(rosenbrockN, [-1.2, 1, -1.2, 1, -1.2, 1], {
      maxIterations: 20000,
      maxEvaluations: 40000,
    });

    expect(result.converged).toBe(true);
    expect(result.fx).toBeLessThanOrEqual(1e-8);
    for (const value of result.x) {
      expect(value).toBeCloseTo(1, 4);
    }
  });

  it("rejects malformed input rather than guessing", () => {
    expect(() => nelderMead(rosenbrock, [])).toThrow(/at least one coordinate/);
    expect(() => nelderMead(rosenbrock, [Number.NaN, 1])).toThrow(/not finite/);
    expect(() => nelderMead(rosenbrock, [0, 0], { initialStep: 0 })).toThrow(/must be positive/);
    expect(() => nelderMead(rosenbrock, [0, 0], { bounds: [{ lower: 2, upper: 1 }] })).toThrow(
      /must exceed lower/,
    );
    expect(() => nelderMead(rosenbrock, [0, 0], { initialSimplex: [[0, 0]] })).toThrow(
      /must have 3 vertices/,
    );
    expect(() =>
      nelderMead(rosenbrock, [0, 0], {
        initialSimplex: [[0, 0], [1, 0], [0]],
      }),
    ).toThrow(/expected 2/);
  });

  it("records a history whose length matches the iteration count, and can suppress it", () => {
    const kept = nelderMead(rosenbrock, [-1.2, 1]);
    expect(kept.history.length).toBe(kept.iterations);

    const dropped = nelderMead(rosenbrock, [-1.2, 1], { recordHistory: false });
    expect(dropped.history).toHaveLength(0);
    expect(dropped.fx).toBe(kept.fx);
  });
});
