import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { type AimBounds, aimActiveSet, constrainedShooting } from "./constraints.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { finiteDifferenceStep, shootingJacobian } from "./shooting-jacobian.js";
import {
  type Aim,
  type ShootingProblem,
  type ShootingResidual,
  createShootingResidual,
} from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

/**
 * P0.92: the difference stencil used to step outside the feasible region at an
 * active bound. Validation criterion: "no residual evaluation outside the box
 * during a projected solve; Jacobian accuracy at a face unchanged elsewhere".
 *
 * **Both clauses are checked the way that can actually fail.** Feasibility is
 * measured by recording every aim the residual is called with and judging each
 * one against the bounds afterwards — not by asking the solver whether it
 * behaved. And "accuracy unchanged elsewhere" is checked against the exact
 * drag-free Jacobian, not against the previous implementation, so a shared
 * mistake in both cannot pass.
 *
 * **The order drop is measured, not asserted.** The fix trades `O(h²)` for
 * `O(h)` in the column that touches a face; the task filing asked for that to
 * be demonstrated rather than claimed, because P5.05's whole comment is about
 * how step-size error behaves here. `measures the order drop...` below fits a
 * log-log slope through the truncation branch for both stencils on the same
 * problem at the same steps, and prints the table.
 */

const V0 = 60;
const THETA = 0.65;
const AIM: Aim = { theta: THETA, speed: V0 };

/** Fixed grid for every aim, so truncation error cancels and the branch is clean. */
const FIXED_STEP = { stepper: "dopri5" as const, h: 0.01, maxSteps: 200_000 };
const TIGHT_TOL = { stepper: "dopri5" as const, rtol: 1e-12, atol: 1e-14, maxSteps: 200_000 };

function context(dragCoefficient: number) {
  return createEvalContext(
    new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
    createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(dragCoefficient),
    }),
  );
}

function dragFreeProblem(target: PointTarget): ShootingProblem {
  return {
    model: createPlanarProjectileModel([new GravityForce()]),
    ctx: context(0),
    target,
    config: FIXED_STEP,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

function dragProblem(target: PointTarget): ShootingProblem {
  return {
    model: createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]),
    ctx: context(0.47),
    target,
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

/** Drag-free ground-launch range: the exact residual up to the target offset. */
const analyticRange = (theta: number, v0: number): number =>
  (v0 * v0 * Math.sin(2 * theta)) / G_STD;
const analyticDRangeDTheta = (theta: number, v0: number): number =>
  (2 * v0 * v0 * Math.cos(2 * theta)) / G_STD;
const analyticDRangeDSpeed = (theta: number, v0: number): number =>
  (2 * v0 * Math.sin(2 * theta)) / G_STD;

const TARGET_X = analyticRange(THETA, V0);
const EXACT_DTHETA = analyticDRangeDTheta(THETA, V0);
const EXACT_DSPEED = analyticDRangeDSpeed(THETA, V0);

function dragFreeResidual(): (aim: Aim) => ShootingResidual {
  return createShootingResidual(dragFreeProblem({ kind: "point", center: [TARGET_X, 0] }));
}

/** Wraps a residual so the test can see every aim it was asked about. */
function recording(inner: (aim: Aim) => ShootingResidual): {
  residual: (aim: Aim) => ShootingResidual;
  seen: Aim[];
} {
  const seen: Aim[] = [];
  return {
    residual: (aim: Aim) => {
      seen.push({ theta: aim.theta, speed: aim.speed });
      return inner(aim);
    },
    seen,
  };
}

/** A half-space hook: everything at or below `thetaMax`, nothing above. */
const noHigherThan =
  (thetaMax: number) =>
  (aim: Aim): boolean =>
    aim.theta <= thetaMax;

describe("shootingJacobian feasible-region hook (P0.92)", () => {
  const residual = dragFreeResidual();

  it("differences centrally when the whole stencil is inside the region", () => {
    // The hook is supplied but never binding: 0.65 ± 6e-6 is nowhere near 1.2.
    const jacobian = shootingJacobian(residual, AIM, { feasible: noHigherThan(1.2) });

    expect(jacobian.ok).toBe(true);
    expect(jacobian.stencils).toEqual({ theta: "central", speed: "central" });
  });

  it("leaves the matrix bit-for-bit identical when the hook never binds", () => {
    // "Accuracy unchanged elsewhere", in its strongest form: not merely close,
    // the same numbers. A hook that perturbed the ordinary path would show up
    // here before any accuracy argument was needed.
    const withHook = shootingJacobian(residual, AIM, { feasible: noHigherThan(1.2) });
    const without = shootingJacobian(residual, AIM);

    expect(withHook.matrix).toEqual(without.matrix);
    expect(withHook.steps).toEqual(without.steps);
    expect(withHook.evaluations).toBe(without.evaluations);
    expect(withHook.base).toBeNull();
  });

  it("differences inward at an upper face, and says so", () => {
    const jacobian = shootingJacobian(residual, AIM, { feasible: noHigherThan(THETA) });

    expect(jacobian.ok).toBe(true);
    // θ sits exactly on the face, so its stencil must reach downward only. v₀
    // is untouched by this hook and keeps its central stencil and its order.
    expect(jacobian.stencils).toEqual({ theta: "backward", speed: "central" });
  });

  it("differences inward at a lower face too", () => {
    const jacobian = shootingJacobian(residual, AIM, {
      feasible: (aim: Aim) => aim.theta >= THETA,
    });

    expect(jacobian.stencils.theta).toBe("forward");
  });

  it("evaluates nothing outside the region once the hook is given", () => {
    const { residual: watched, seen } = recording(dragFreeResidual());
    const inside = noHigherThan(THETA);

    const jacobian = shootingJacobian(watched, AIM, { feasible: inside });

    expect(jacobian.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((aim) => !inside(aim))).toEqual([]);
  });

  it("evaluated outside it without the hook, which is the bug", () => {
    // The negative control. Without this the test above could pass because the
    // stencil never reached the face, rather than because the fix works.
    const { residual: watched, seen } = recording(dragFreeResidual());

    shootingJacobian(watched, AIM);

    expect(seen.some((aim) => aim.theta > THETA)).toBe(true);
  });

  it("re-derives the step for first order when a column goes one-sided", () => {
    const jacobian = shootingJacobian(residual, AIM, { feasible: noHigherThan(THETA) });

    // ε^(1/2) rather than ε^(1/3): a first-order stencil run at a second-order
    // scheme's optimum would sit needlessly far up the truncation branch.
    expect(jacobian.steps.theta).toBe(finiteDifferenceStep(Number.EPSILON, "forward", 1));
    expect(jacobian.steps.theta).toBeLessThan(finiteDifferenceStep(Number.EPSILON, "central", 1));
    // The untouched column keeps the central step it always had.
    expect(jacobian.steps.speed).toBe(finiteDifferenceStep(Number.EPSILON, "central", V0));
  });

  it("honours a pinned step instead of re-deriving it, since the sweeps depend on that", () => {
    const jacobian = shootingJacobian(residual, AIM, {
      feasible: noHigherThan(THETA),
      thetaStep: 1e-3,
    });

    expect(jacobian.stencils.theta).toBe("backward");
    expect(jacobian.steps.theta).toBe(1e-3);
  });

  it("shares one base evaluation between a one-sided column and the scheme", () => {
    const { residual: watched, seen } = recording(dragFreeResidual());

    const jacobian = shootingJacobian(watched, AIM, { feasible: noHigherThan(THETA) });

    // θ one-sided (base + one offset) and v₀ central (two offsets) = 4, not 5:
    // the base point is evaluated once and reused, and it is returned.
    expect(jacobian.evaluations).toBe(4);
    expect(seen).toHaveLength(4);
    expect(jacobian.base).not.toBeNull();
  });

  it("mirrors a forward scheme into a backward one rather than going central", () => {
    const jacobian = shootingJacobian(residual, AIM, {
      scheme: "forward",
      feasible: noHigherThan(THETA),
    });

    expect(jacobian.ok).toBe(true);
    expect(jacobian.stencils.theta).toBe("backward");
    // Already first order, so there is no step to re-derive.
    expect(jacobian.steps.theta).toBe(finiteDifferenceStep(Number.EPSILON, "forward", 1));
  });

  it("stays accurate at the face, to the order it now claims and no better", () => {
    const jacobian = shootingJacobian(residual, AIM, { feasible: noHigherThan(THETA) });
    const plain = shootingJacobian(residual, AIM);

    expect(jacobian.ok).toBe(true);
    const relative = (got: number, exact: number): number =>
      Math.abs(got - exact) / Math.abs(exact);
    const errTheta = relative(jacobian.matrix![0]![0]!, EXACT_DTHETA);
    const errSpeed = relative(jacobian.matrix![0]![1]!, EXACT_DSPEED);
    const centralTheta = relative(plain.matrix![0]![0]!, EXACT_DTHETA);

    // **These are measured plateau figures, not targets.** At the first-order
    // step ε^(1/2) ≈ 1.5e-8 the θ column measures 3.5e-6 relative — the bottom
    // of a first-order V, where truncation `C·h` has met the amplified noise
    // `ε_F/h`. The bounds sit just above what was measured so they fail on a
    // regression rather than on the third digit.
    expect(errTheta).toBeLessThan(1e-5);
    expect(errSpeed).toBeLessThan(1e-7);

    // The informative comparison, and the one that would catch a fallback that
    // silently kept running: central on the same column measures ~2e-9, three
    // orders better. That gap IS the cost of the trade.
    expect(centralTheta).toBeLessThan(errTheta / 100);
  });
});

describe("the order the one-sided fallback costs (P0.92, measured)", () => {
  const residual = dragFreeResidual();

  /** Relative error of `∂F_x/∂θ` at a pinned step, with and without a face. */
  function errorAt(step: number, hooked: boolean): number {
    const jacobian = shootingJacobian(residual, AIM, {
      thetaStep: step,
      ...(hooked ? { feasible: noHigherThan(THETA) } : {}),
    });
    if (!jacobian.ok) return Number.NaN;
    return Math.abs(jacobian.matrix![0]![0]! - EXACT_DTHETA) / Math.abs(EXACT_DTHETA);
  }

  /** Least-squares slope of log(error) against log(step). */
  function slope(steps: readonly number[], errors: readonly number[]): number {
    const n = steps.length;
    const xs = steps.map(Math.log10);
    const ys = errors.map(Math.log10);
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i]! - meanX) * (ys[i]! - meanY);
      den += (xs[i]! - meanX) ** 2;
    }
    return num / den;
  }

  it("measures the order drop: central stays O(h²), the one-sided face is O(h)", () => {
    // Steps chosen inside the truncation branch. Below ~1e-4 the noise branch
    // starts lifting the central curve and the fitted slope stops meaning what
    // it says; above 1e-1 the quadratic term in the expansion is no longer
    // negligible for either scheme.
    const steps = [1e-4, 1e-3, 1e-2, 1e-1] as const;
    const central = steps.map((h) => errorAt(h, false));
    const oneSided = steps.map((h) => errorAt(h, true));

    const table = (label: string, errors: readonly number[]): string =>
      `${label} ${steps.map((h, i) => `${h}:${errors[i]!.toExponential(1)}`).join(" ")}`;
    console.log(table("P0.92 central  rel err ∂F/∂θ:", central));
    console.log(table("P0.92 backward rel err ∂F/∂θ:", oneSided));

    expect(slope(steps, central)).toBeCloseTo(2, 1);
    expect(slope(steps, oneSided)).toBeCloseTo(1, 1);
  });

  it("costs accuracy only in the column that touches the face", () => {
    // The speed column is differenced identically either way, so its error is
    // not merely similar but the same number.
    const hooked = shootingJacobian(residual, AIM, { feasible: noHigherThan(THETA) });
    const plain = shootingJacobian(residual, AIM);

    expect(hooked.matrix![0]![1]!).toBe(plain.matrix![0]![1]!);
    expect(hooked.matrix![0]![0]!).not.toBe(plain.matrix![0]![0]!);
  });
});

describe("when the hook cannot help (P0.92 rules 1 and 5)", () => {
  const residual = dragFreeResidual();

  it("stays central at an infeasible base aim, where inward has no meaning", () => {
    // Rule 1. The aim is already above the face, so neither side is 'inward'
    // and the historical behaviour is the honest answer.
    const jacobian = shootingJacobian(residual, AIM, { feasible: noHigherThan(THETA - 0.01) });

    expect(jacobian.stencils).toEqual({ theta: "central", speed: "central" });
    expect(jacobian.base).toBeNull();
  });

  it("stays central when the region is narrower than the step", () => {
    // Rule 5. Feasible at the aim, infeasible on both sides: there is no
    // one-sided stencil to fall back to, so the requested scheme runs.
    const jacobian = shootingJacobian(residual, AIM, {
      feasible: (aim: Aim) => aim.theta === THETA,
    });

    expect(jacobian.stencils.theta).toBe("central");
  });

  it("keeps the original step when a non-convex region rejects the re-derived one", () => {
    // The convexity assumption is documented and re-checked rather than
    // trusted. This hook admits the outer ring but not the inner one, which no
    // box can do; the column still goes one-sided, at the step it started with.
    const pinnedStep = 1e-3;
    const jacobian = shootingJacobian(residual, AIM, {
      thetaStep: pinnedStep,
      feasible: (aim: Aim) => aim.theta <= THETA - 1e-4 || aim.theta === THETA,
    });

    expect(jacobian.stencils.theta).toBe("backward");
    expect(jacobian.steps.theta).toBe(pinnedStep);
  });
});

describe("constrainedShooting keeps its evaluations feasible (P0.92 validation)", () => {
  const TARGET: PointTarget = { kind: "point", center: [400, 0] };
  const START: Aim = { theta: 0.6, speed: 80 };
  /** The cap P5.16 measured the leak against: 5 of 56 evaluations, 4.8444e-4 m/s past it. */
  const BOUNDS: AimBounds = { speedMax: 70 };

  function watchedSolve(bounds: AimBounds): { seen: Aim[]; miss: number; feasible: boolean } {
    const inner = createShootingResidual(dragProblem(TARGET));
    const { residual, seen } = recording(inner);
    const result = constrainedShooting(residual, START, bounds);
    return { seen, miss: result.miss, feasible: result.feasible };
  }

  it("evaluates the residual only inside the box, not merely at feasible iterates", () => {
    const { seen } = watchedSolve(BOUNDS);

    const outside = seen.filter((aim) => !aimActiveSet(aim, BOUNDS).feasible);
    // The message carries the worst overshoot, because "5 of 56" is what made
    // this diagnosable in the first place and a bare count would not.
    const worst = outside.reduce((m, aim) => Math.max(m, aim.speed - 70), 0);
    expect(
      { count: outside.length, of: seen.length, worstOvershoot: worst },
      "no stencil point may leave the box",
    ).toEqual({ count: 0, of: seen.length, worstOvershoot: 0 });
  });

  it("still converges to the same capped answer it did before", () => {
    // The fix must not buy feasibility with accuracy. `blocked-by-bound` at a
    // 70 m/s cap against a 400 m target leaves a real miss; 116.76 m is the
    // figure constraints.test.ts pins, and it is unchanged.
    const { miss, feasible } = watchedSolve(BOUNDS);

    expect(feasible).toBe(true);
    expect(miss).toBeCloseTo(116.76, 1);
  });

  it("left the box during the solve before the hook existed", () => {
    // Negative control for the first assertion, run through the same solver
    // with the hook explicitly disabled. Without it, "0 outside" could mean the
    // stencil simply never reached a face on this problem.
    const inner = createShootingResidual(dragProblem(TARGET));
    const { residual, seen } = recording(inner);

    constrainedShooting(residual, START, BOUNDS, {
      jacobian: { feasible: () => true },
    });

    const outside = seen.filter((aim) => !aimActiveSet(aim, BOUNDS).feasible);
    expect(outside.length).toBeGreaterThan(0);
    expect(Math.max(...outside.map((aim) => aim.speed - 70))).toBeGreaterThan(0);
  });
});
