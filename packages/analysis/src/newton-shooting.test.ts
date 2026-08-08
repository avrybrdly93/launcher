import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
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
import { createDormandPrince54Stepper, solveLinearSystemInPlace } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { minimumNormStep, newtonShooting } from "./newton-shooting.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { shootingJacobian } from "./shooting-jacobian.js";
import { type Aim, type ShootingProblem, createShootingResidual } from "./shooting-residual.js";
import type { PlatformTarget, PointTarget } from "./targets.js";

/**
 * P5.06's validation criterion is "hits target with drag+wind in ≤ 8 iters from
 * smart init", and the interesting half of this file is not the iteration
 * count — it is the rank deficiency the count is achieved *despite*.
 *
 * P5.05 measured the shooting Jacobian's vertical row as zero to `<1e-8`: a
 * ground-impact terminal event pins `y_impact` for every aim, so the matrix a
 * Newton step is handed is rank 1 with a condition number around `1e11`. The
 * "unguarded 2×2 elimination" test below runs the real Jacobian from the real
 * drag-and-wind problem through `solveLinearSystemInPlace` and reports what
 * that produces, so the guard in `newton-shooting.ts` is justified by a
 * measurement rather than by an argument.
 *
 * The initializer P5.06's criterion calls "smart" is **P5.07, not yet
 * written**. Every solve here starts from a deliberately rough hand-chosen aim
 * instead, which makes the iteration count an upper bound on what a smart init
 * would need rather than a claim about it — see the ROADMAP note.
 */

const TIGHT_TOL = {
  stepper: "dopri5" as const,
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

/** Matches the inner solve's tolerance, per `JacobianOptions.noiseFloor`. */
const NOISE_FLOOR = 1e-12;

function context(dragCoefficient: number, wind: number) {
  return createEvalContext(
    new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(G_STD, false),
      wind === 0 ? new ZeroWind() : new UniformWind(wind),
    ),
    createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(dragCoefficient),
    }),
  );
}

function problem(
  target: ShootingProblem["target"],
  dragCoefficient: number,
  wind = 0,
): ShootingProblem {
  const forces =
    dragCoefficient === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: context(dragCoefficient, wind),
    target,
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

function pointTarget(x: number, y = 0): PointTarget {
  return { kind: "point", center: [x, y] };
}

/** Where a given aim actually lands, used to build targets that are reachable by construction. */
function impactOf(target: ShootingProblem["target"], drag: number, wind: number, aim: Aim) {
  const residual = createShootingResidual(problem(target, drag, wind));
  const evaluation = residual(aim);
  expect(evaluation.ok).toBe(true);
  return evaluation.impact!;
}

describe("minimumNormStep (the rank-aware core of the Newton step)", () => {
  it("reproduces the exact solution when the matrix is nonsingular", () => {
    // [[2, 1], [1, 3]] x = [5, 10]  =>  x = [1, 3].
    const { solution, rank } = minimumNormStep(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
      1e-7,
    );
    expect(rank).toBe(2);
    expect(solution[0]!).toBeCloseTo(1, 12);
    expect(solution[1]!).toBeCloseTo(3, 12);
  });

  it("returns singular values that reproduce the matrix's own scale", () => {
    // A diagonal matrix's singular values are its |entries|, descending.
    const { singularValues } = minimumNormStep(
      [
        [3, 0],
        [0, -7],
      ],
      [0, 0],
      1e-7,
    );
    expect(singularValues[0]!).toBeCloseTo(7, 12);
    expect(singularValues[1]!).toBeCloseTo(3, 12);
  });

  it("gives the minimum-norm solution on an exactly rank-1 matrix", () => {
    // Both rows are multiples of [1, 2]: every solution of x₁ + 2x₂ = 5 is a
    // least-squares solution, and the minimum-norm one is the multiple of
    // [1, 2] itself — [1, 2] * 5/5 = [1, 2].
    const a = [
      [1, 2],
      [2, 4],
    ];
    const { solution, rank } = minimumNormStep(a, [5, 10], 1e-7);
    expect(rank).toBe(1);
    expect(solution[0]!).toBeCloseTo(1, 12);
    expect(solution[1]!).toBeCloseTo(2, 12);

    // It really is minimal: every other solution of the same equation is longer.
    const norm = Math.hypot(solution[0]!, solution[1]!);
    for (const t of [-2, -0.5, 0.3, 1.7]) {
      // Move along the null space direction [2, -1] (orthogonal to [1, 2]).
      const other = Math.hypot(solution[0]! + 2 * t, solution[1]! - t);
      expect(other).toBeGreaterThan(norm);
    }
  });

  it("solves the least-squares problem, not the equations, when the system is inconsistent", () => {
    // Rank-1 matrix with a right-hand side that has a component outside its
    // range: the residual cannot be driven to zero, and the returned step must
    // be the one that leaves the *orthogonal* leftover.
    const a = [
      [1, 2],
      [2, 4],
    ];
    const b = [5, 0];
    const { solution } = minimumNormStep(a, b, 1e-7);
    const leftover = [
      b[0]! - (a[0]![0]! * solution[0]! + a[0]![1]! * solution[1]!),
      b[1]! - (a[1]![0]! * solution[0]! + a[1]![1]! * solution[1]!),
    ];
    // Orthogonality to the column space is the defining property of a
    // least-squares solution: Aᵀ(b − Ax) = 0.
    expect(a[0]![0]! * leftover[0]! + a[1]![0]! * leftover[1]!).toBeCloseTo(0, 12);
    expect(a[0]![1]! * leftover[0]! + a[1]![1]! * leftover[1]!).toBeCloseTo(0, 12);
  });

  it("handles an overdetermined (3×2) system, the spatial-layout case", () => {
    // Exactly consistent, so least squares must recover it exactly.
    const a = [
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    const { solution, rank } = minimumNormStep(a, [2, 3, 5], 1e-7);
    expect(rank).toBe(2);
    expect(solution[0]!).toBeCloseTo(2, 12);
    expect(solution[1]!).toBeCloseTo(3, 12);
  });

  it("reports rank 0 and a zero step for a zero matrix rather than dividing", () => {
    const { solution, rank } = minimumNormStep(
      [
        [0, 0],
        [0, 0],
      ],
      [1, 1],
      1e-7,
    );
    expect(rank).toBe(0);
    expect(solution).toEqual([0, 0]);
  });

  it("treats a singular value below the relative threshold as zero", () => {
    // σ₂/σ₁ = 1e-9, an order below the 1e-7 default: truncated.
    const a = [
      [1, 0],
      [0, 1e-9],
    ];
    expect(minimumNormStep(a, [1, 1], 1e-7).rank).toBe(1);
    // …and retained by a caller who lowers the threshold, so the truncation is
    // the threshold's doing rather than an accident of the routine.
    expect(minimumNormStep(a, [1, 1], 1e-12).rank).toBe(2);
  });

  it("rejects a right-hand side whose length does not match the matrix", () => {
    expect(() => minimumNormStep([[1, 2]], [1, 2], 1e-7)).toThrow(/right-hand side/);
  });
});

describe("newtonShooting on the drag-free problem (an exactly known answer)", () => {
  const V0 = 60;
  const THETA = 0.65;
  // R = v₀² sin 2θ / g, so this target is hit exactly by (THETA, V0).
  const RANGE = (V0 * V0 * Math.sin(2 * THETA)) / G_STD;

  it("drives the residual below a micrometre from a rough initial aim", () => {
    const residual = createShootingResidual(problem(pointTarget(RANGE), 0));
    const result = newtonShooting(
      residual,
      { theta: 0.45, speed: V0 },
      { jacobian: { noiseFloor: NOISE_FLOOR } },
    );

    expect(result.converged).toBe(true);
    expect(result.status).toBe("converged");
    expect(result.merit).toBeLessThan(1e-6);
    // The recovered aim is *a* solution, not necessarily the one the target was
    // built from: the problem is rank 1, so the solution set is a curve.
    const check = residual(result.aim);
    expect(Math.abs(check.impact![0]! - RANGE)).toBeLessThan(1e-6);
  });

  it("sees a rank-1 Jacobian at every iterate, and says so", () => {
    const residual = createShootingResidual(problem(pointTarget(RANGE), 0));
    const result = newtonShooting(
      residual,
      { theta: 0.45, speed: V0 },
      { jacobian: { noiseFloor: NOISE_FLOOR } },
    );

    expect(result.history.length).toBeGreaterThan(0);
    for (const step of result.history) {
      expect(step.rank).toBe(1);
      // The deficiency is not marginal: report it so the ratio is on the record.
      const ratio = step.singularValues[1]! / step.singularValues[0]!;
      expect(ratio).toBeLessThan(1e-8);
    }
    console.log(
      "drag-free singular-value ratios:",
      result.history
        .map((s) => (s.singularValues[1]! / s.singularValues[0]!).toExponential(2))
        .join(", "),
    );
  });

  it("reports evaluation-failed rather than throwing when the initial aim cannot land", () => {
    const residual = createShootingResidual(problem(pointTarget(RANGE), 0));
    // Straight up at 400 m/s: drag-free flight time is 2v₀/g ≈ 81.5 s, past the
    // 60 s tspan, so the solve ends by exhausting its span rather than on the
    // ground event and the residual reports no impact.
    const result = newtonShooting(residual, { theta: Math.PI / 2, speed: 400 });
    expect(result.converged).toBe(false);
    expect(result.status).toBe("evaluation-failed");
    expect(result.failure).toMatch(/initial aim/);
  });
});

describe("newtonShooting with drag and wind (P5.06's validation criterion)", () => {
  const DRAG = 0.47;
  const WIND = -6;
  /** The aim the target is built from — never handed to the solver. */
  const TRUTH: Aim = { theta: 0.7, speed: 65 };
  /** Deliberately rough, since P5.07's smart initializer does not exist yet. */
  const ROUGH: Aim = { theta: 0.45, speed: 65 };

  it("hits the target in ≤ 8 iterations", () => {
    const impact = impactOf(pointTarget(0), DRAG, WIND, TRUTH);
    const target = pointTarget(impact[0]!, impact[1]!);
    const residual = createShootingResidual(problem(target, DRAG, WIND));

    const result = newtonShooting(residual, ROUGH, { jacobian: { noiseFloor: NOISE_FLOOR } });

    console.log(
      `drag+wind: target x = ${target.center[0]!.toFixed(4)} m, from θ = ${ROUGH.theta} rad, ` +
        `v₀ = ${ROUGH.speed} m/s\n` +
        result.history
          .map(
            (s) =>
              `  iter ${s.iteration}: ‖F‖ = ${s.merit.toExponential(3)} → ` +
              `${s.nextMerit.toExponential(3)}, α = ${s.alpha}, rank ${s.rank}`,
          )
          .join("\n"),
    );

    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(8);
    expect(result.merit).toBeLessThan(1e-6);
  });

  it("converges from either side of the answer, not only from below", () => {
    const impact = impactOf(pointTarget(0), DRAG, WIND, TRUTH);
    const target = pointTarget(impact[0]!, impact[1]!);
    const residual = createShootingResidual(problem(target, DRAG, WIND));

    for (const start of [
      { theta: 0.3, speed: 70 },
      { theta: 0.45, speed: 65 },
      { theta: 0.95, speed: 60 },
    ] as const) {
      const result = newtonShooting(residual, start, { jacobian: { noiseFloor: NOISE_FLOOR } });
      expect(result.converged).toBe(true);
      expect(result.iterations).toBeLessThanOrEqual(8);
    }
  });

  it("the same Jacobian breaks an unguarded 2×2 elimination — the negative control", () => {
    const impact = impactOf(pointTarget(0), DRAG, WIND, TRUTH);
    const target = pointTarget(impact[0]!, impact[1]!);
    const residual = createShootingResidual(problem(target, DRAG, WIND));

    const jacobian = shootingJacobian(residual, ROUGH, { noiseFloor: NOISE_FLOOR });
    expect(jacobian.ok).toBe(true);
    const matrix = jacobian.matrix!;
    const evaluation = residual(ROUGH);
    const rhs = evaluation.residual!.map((value) => -value);

    // The vertical row is what P5.05 measured: zero to rounding, for every aim.
    const rowScale = Math.max(Math.abs(matrix[0]![0]!), Math.abs(matrix[0]![1]!));
    const verticalRow = Math.max(Math.abs(matrix[1]![0]!), Math.abs(matrix[1]![1]!));
    console.log(
      `unguarded control: downrange row ~${rowScale.toExponential(3)}, ` +
        `vertical row ~${verticalRow.toExponential(3)}, ratio ${(verticalRow / rowScale).toExponential(2)}`,
    );
    expect(verticalRow / rowScale).toBeLessThan(1e-8);

    const a = Float64Array.from([matrix[0]![0]!, matrix[0]![1]!, matrix[1]![0]!, matrix[1]![1]!]);
    const b = Float64Array.from(rhs);
    const ok = solveLinearSystemInPlace(a, b, 2);

    // Either the elimination refuses (near-zero pivot) or it returns a step so
    // large it is meaningless. Both are failures; asserting the disjunction
    // rather than one of them keeps this test about the *problem* rather than
    // about solveLinearSystemInPlace's pivot threshold.
    const guardedStep = minimumNormStep(
      [
        [matrix[0]![0]!, matrix[0]![1]! * ROUGH.speed],
        [matrix[1]![0]!, matrix[1]![1]! * ROUGH.speed],
      ],
      rhs,
      1e-7,
    );
    const guardedNorm = Math.hypot(guardedStep.solution[0]!, guardedStep.solution[1]!);
    if (ok) {
      const unguardedNorm = Math.hypot(b[0]!, b[1]!);
      console.log(
        `unguarded elimination returned a step of norm ${unguardedNorm.toExponential(3)} ` +
          `vs guarded ${guardedNorm.toExponential(3)}`,
      );
      expect(unguardedNorm).toBeGreaterThan(1e3 * guardedNorm);
    } else {
      console.log(
        "unguarded elimination refused the system (pivot below its threshold); " +
          `guarded step norm ${guardedNorm.toExponential(3)}`,
      );
    }
    expect(guardedNorm).toBeLessThan(10);
    expect(guardedStep.rank).toBe(1);
  });
});

describe("newtonShooting when part of the residual is structurally irreducible", () => {
  it("stalls with the downrange miss nulled and the vertical one untouched", () => {
    // A platform 12 m up: a ground-impact solve can never reach it, so F_y is a
    // constant −12 no aim can change. The solver must null the reducible
    // component and stop, rather than exhausting its line search.
    const HEIGHT = 12;
    const platform: PlatformTarget = {
      kind: "platform",
      center: [200, HEIGHT],
      halfExtents: [0],
    };
    const residual = createShootingResidual(problem(platform, 0.47));
    const result = newtonShooting(
      residual,
      { theta: 0.6, speed: 70 },
      { jacobian: { noiseFloor: NOISE_FLOOR } },
    );

    expect(result.converged).toBe(false);
    expect(result.status).toBe("stalled");
    // The downrange component is solved to the same accuracy a hittable target
    // would have been.
    expect(Math.abs(result.residual.residual![0]!)).toBeLessThan(1e-6);
    // The vertical one is the whole irreducible height, undisturbed.
    expect(result.residual.residual![1]!).toBeCloseTo(-HEIGHT, 9);
    expect(result.failure).toMatch(/rank 1 of 2/);
  });
});

describe("newtonShooting line search", () => {
  it("shortens an overshooting full step instead of accepting it", () => {
    // A target four times further than the current aim can throw, under drag.
    // Range is *concave* in v₀ once drag is quadratic — each extra m/s buys
    // less than the last — so the linear model wildly overestimates what a
    // speed increase achieves, and the full Gauss-Newton step lands long. This
    // is the ordinary Newton overshoot the line search exists for, not an
    // artifact of the reachability boundary: the whole path stays well inside
    // the 60 s span.
    const residual = createShootingResidual(problem(pointTarget(240), 0.47, -6));
    const result = newtonShooting(
      residual,
      { theta: 0.2, speed: 25 },
      { jacobian: { noiseFloor: NOISE_FLOOR } },
    );

    console.log(
      "line search α sequence:",
      result.history.map((s) => `${s.alpha} (${s.backtracks} backtracks)`).join(", "),
    );
    expect(result.converged).toBe(true);
    expect(result.history.some((step) => step.backtracks > 0)).toBe(true);
    // Every accepted step is a genuine decrease — that is what the Armijo test
    // buys, and asserting it is what distinguishes "backtracked" from
    // "backtracked and still went uphill".
    for (const step of result.history) {
      expect(step.alpha).toBeLessThanOrEqual(1);
      expect(step.nextMerit).toBeLessThan(step.merit);
    }
  });

  it("rejects a backtrack factor outside (0, 1)", () => {
    const residual = createShootingResidual(problem(pointTarget(150), 0));
    expect(() =>
      newtonShooting(residual, { theta: 0.6, speed: 60 }, { backtrackFactor: 1 }),
    ).toThrow(/backtrackFactor/);
  });

  it("stops at maxIterations rather than running forever", () => {
    const residual = createShootingResidual(problem(pointTarget(150), 0.47));
    const result = newtonShooting(
      residual,
      { theta: 0.2, speed: 30 },
      { maxIterations: 1, jacobian: { noiseFloor: NOISE_FLOOR } },
    );
    expect(result.iterations).toBeLessThanOrEqual(1);
    expect(["max-iterations", "converged"]).toContain(result.status);
  });
});
