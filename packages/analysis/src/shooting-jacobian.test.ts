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
import { ClassicalRK4Stepper, createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { PLANAR_LAYOUT } from "./observables.js";
import {
  AIM_COLUMNS,
  DEFAULT_NOISE_FLOOR,
  finiteDifferenceStep,
  shootingJacobian,
} from "./shooting-jacobian.js";
import { type Aim, type ShootingProblem, createShootingResidual } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.05's validation criterion is "Jacobian FD convergence plateau documented;
 * no tolerance-noise blowup", and its two clauses want two different problems,
 * because no single one can measure both.
 *
 * **The plateau is measured drag-free**, where the range is
 * `R = v₀² sin 2θ / g` and the Jacobian is therefore known in closed form. An
 * error curve is only as good as what it is an error *against*, and an exact
 * reference removes the question entirely. Sweeping the FD step over ten
 * decades then traces the V directly: a truncation branch falling as `h²`, a
 * noise branch rising as `1/h`, and the plateau between them.
 *
 * **The blowup is measured with drag**, because drag-free motion is quadratic
 * in `t` and Dormand–Prince integrates it *exactly* — the embedded error
 * estimate is zero, every tolerance from `1e-4` to `1e-12` produces the
 * identical step sequence, and a tolerance-noise experiment on that problem
 * measures nothing at all. (That is not hypothetical: the first version of this
 * file ran the negative control drag-free and got byte-identical curves for
 * loose and tight tolerances.) Quadratic drag makes the controller actually
 * adapt, and the loose-tolerance residual is then a *different function* from
 * the tight-tolerance one — biased at the `rtol` level, with the bias varying
 * with the aim. That bias does not cancel in a difference, so it puts a floor
 * under the Jacobian error that no step size can get below.
 *
 * Both sweeps print their table, so the criterion's "documented" is satisfied
 * by a measurement in the run output rather than by a number retyped into a
 * comment.
 */

const V0 = 60;
const THETA = 0.65;
const AIM: Aim = { theta: THETA, speed: V0 };

/** Fixed step: identical grid for every aim, so truncation error cancels in a difference. */
const FIXED_STEP = { stepper: "dopri5" as const, h: 0.01, maxSteps: 200_000 };
/** Adaptive at a tolerance far below any accuracy asked of the Jacobian. */
const TIGHT_TOL = { stepper: "dopri5" as const, rtol: 1e-12, atol: 1e-14, maxSteps: 200_000 };
/** Adaptive at a tolerance that is ordinary for a trajectory and ruinous for its derivative. */
const LOOSE_TOL = { stepper: "dopri5" as const, rtol: 1e-5, atol: 1e-7, maxSteps: 200_000 };

function environment(): Environment {
  return new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(G_STD, false),
    new ZeroWind(),
  );
}

function context(dragCoefficient: number) {
  return createEvalContext(
    environment(),
    createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(dragCoefficient),
    }),
  );
}

function dragFreeProblem(
  target: PointTarget,
  config: ShootingProblem["config"] = FIXED_STEP,
): ShootingProblem {
  return {
    model: createPlanarProjectileModel([new GravityForce()]),
    ctx: context(0),
    target,
    config,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

function dragProblem(target: PointTarget, config: ShootingProblem["config"]): ShootingProblem {
  return {
    model: createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]),
    ctx: context(0.47),
    target,
    config,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

/** Drag-free ground-launch range — the exact residual, up to the target offset. */
function analyticRange(theta: number, v0: number): number {
  return (v0 * v0 * Math.sin(2 * theta)) / G_STD;
}

/** `∂R/∂θ` in closed form, the exact value the drag-free sweep measures against. */
function analyticDRangeDTheta(theta: number, v0: number): number {
  return (2 * v0 * v0 * Math.cos(2 * theta)) / G_STD;
}

/** `∂R/∂v₀` in closed form. */
function analyticDRangeDSpeed(theta: number, v0: number): number {
  return (2 * v0 * Math.sin(2 * theta)) / G_STD;
}

const DECADES = [-10, -9, -8, -7, -6, -5, -4, -3, -2, -1] as const;

/** Relative error of the downrange row of a Jacobian against a reference pair. */
function downrangeError(
  matrix: number[][],
  reference: readonly [number, number],
): { theta: number; speed: number } {
  return {
    theta: Math.abs(matrix[0]![0]! - reference[0]) / Math.abs(reference[0]),
    speed: Math.abs(matrix[0]![1]! - reference[1]) / Math.abs(reference[1]),
  };
}

describe("shootingJacobian against the exact drag-free Jacobian (P5.05)", () => {
  const targetX = analyticRange(THETA, V0);
  const residual = createShootingResidual(dragFreeProblem({ kind: "point", center: [targetX, 0] }));
  const exact: readonly [number, number] = [
    analyticDRangeDTheta(THETA, V0),
    analyticDRangeDSpeed(THETA, V0),
  ];

  it("reproduces both closed-form derivatives at its default step", () => {
    const jacobian = shootingJacobian(residual, AIM);

    expect(jacobian.ok).toBe(true);
    const error = downrangeError(jacobian.matrix!, exact);
    // The default step is derived from a machine-epsilon noise floor, which is
    // the right assumption for this fixed-step inner solve; the sweep below
    // shows that step sitting in the plateau.
    expect(error.theta).toBeLessThan(1e-7);
    expect(error.speed).toBeLessThan(1e-7);
  });

  it("orders columns as (θ, v₀) with each column in that variable's own units", () => {
    const jacobian = shootingJacobian(residual, AIM);

    expect(AIM_COLUMNS).toEqual(["theta", "speed"]);
    // ∂R/∂θ ≈ 196 m/rad and ∂R/∂v₀ ≈ 11.8 m/(m/s) differ by more than an order
    // of magnitude here, so a transposed matrix cannot pass both bounds.
    expect(jacobian.matrix![0]![0]!).toBeCloseTo(exact[0], 3);
    expect(jacobian.matrix![0]![1]!).toBeCloseTo(exact[1], 3);
  });

  it("uses per-variable scaled steps, since θ ~ 1 rad and v₀ ~ 60 m/s share none", () => {
    const jacobian = shootingJacobian(residual, AIM);

    expect(jacobian.steps.speed / jacobian.steps.theta).toBeCloseTo(V0, 6);
  });

  it("reports a structurally rank-1 matrix: the ground event pins the vertical row to zero", () => {
    const jacobian = shootingJacobian(residual, AIM);

    // Not an artifact of this target's height: `y_impact` is the ground for
    // every aim, so `F_y` is a constant and its derivatives vanish exactly.
    // P5.06 must not hand this to an unguarded 2x2 solve. See the field docs
    // on `ShootingJacobian.matrix`.
    expect(Math.abs(jacobian.matrix![1]![0]!)).toBeLessThan(1e-8);
    expect(Math.abs(jacobian.matrix![1]![1]!)).toBeLessThan(1e-8);

    const raised = createShootingResidual(
      dragFreeProblem({ kind: "point", center: [targetX, 12] }),
    );
    const raisedJacobian = shootingJacobian(raised, AIM);
    expect(Math.abs(raisedJacobian.matrix![1]![0]!)).toBeLessThan(1e-8);
    expect(Math.abs(raisedJacobian.matrix![1]![1]!)).toBeLessThan(1e-8);
  });

  it("spends 4 evaluations for central and 3 for forward, base point included", () => {
    expect(shootingJacobian(residual, AIM, { scheme: "central" }).evaluations).toBe(4);

    const forward = shootingJacobian(residual, AIM, { scheme: "forward" });
    expect(forward.evaluations).toBe(3);
    // The base evaluation a Newton iteration needs anyway comes back with it.
    expect(forward.base?.ok).toBe(true);
  });

  /**
   * THE VALIDATION MEASUREMENT, first clause: the convergence plateau.
   *
   * Against an exact reference the curve is unambiguous, and the two branches
   * are asserted by their *scaling law* rather than by pinned magnitudes —
   * `h²` down the truncation side is what makes the scheme second order, and it
   * is the property that would break first if the difference quotient were
   * wrong.
   */
  it("traces a V-shaped error curve with an interior plateau (central, h² truncation branch)", () => {
    const errors = new Map<number, number>();
    for (const decade of DECADES) {
      const step = Math.pow(10, decade);
      const jacobian = shootingJacobian(residual, AIM, {
        scheme: "central",
        thetaStep: step,
        speedStep: step * V0,
      });
      expect(jacobian.ok).toBe(true);
      errors.set(decade, downrangeError(jacobian.matrix!, exact).theta);
    }

    console.log(
      "P5.05 plateau (drag-free, fixed step, central) rel err ∂F/∂θ:",
      DECADES.map((d) => `1e${d}:${errors.get(d)!.toExponential(1)}`).join(" "),
    );

    // Truncation branch: second order, so a decade of step is two decades of
    // error. Checked across 1e-1 -> 1e-3, all far above the noise floor.
    expect(errors.get(-1)! / errors.get(-2)!).toBeGreaterThan(50);
    expect(errors.get(-1)! / errors.get(-2)!).toBeLessThan(200);
    expect(errors.get(-2)! / errors.get(-3)!).toBeGreaterThan(50);
    expect(errors.get(-2)! / errors.get(-3)!).toBeLessThan(200);

    // The plateau: an interior minimum, strictly better than either end.
    const best = DECADES.reduce((a, b) => (errors.get(a)! <= errors.get(b)! ? a : b));
    expect(best).toBeGreaterThan(-10);
    expect(best).toBeLessThan(-1);
    expect(errors.get(best)!).toBeLessThan(1e-8);

    // Noise branch: shrinking the step below the plateau makes it worse, which
    // is the half of the curve that intuition gets backwards.
    expect(errors.get(-10)!).toBeGreaterThan(errors.get(best)! * 100);
  });

  it("puts the default machine-epsilon step inside that plateau", () => {
    const derived = shootingJacobian(residual, AIM);
    const decadeBest = DECADES.map((decade) => {
      const step = Math.pow(10, decade);
      const jacobian = shootingJacobian(residual, AIM, {
        scheme: "central",
        thetaStep: step,
        speedStep: step * V0,
      });
      return downrangeError(jacobian.matrix!, exact).theta;
    }).reduce((a, b) => Math.min(a, b));

    // Within two decades of the best step in the whole sweep: the point is that
    // the derived default is on the flat of the V, not that it is optimal.
    expect(downrangeError(derived.matrix!, exact).theta).toBeLessThan(decadeBest * 100 + 1e-12);
  });

  it("gives forward differencing a shallower plateau than central, as its order predicts", () => {
    const bestOf = (scheme: "forward" | "central"): number =>
      DECADES.map((decade) => {
        const step = Math.pow(10, decade);
        const jacobian = shootingJacobian(residual, AIM, {
          scheme,
          thetaStep: step,
          speedStep: step * V0,
        });
        return downrangeError(jacobian.matrix!, exact).theta;
      }).reduce((a, b) => Math.min(a, b));

    const forward = bestOf("forward");
    const central = bestOf("central");
    console.log(
      `P5.05 best achievable rel err: central ${central.toExponential(1)}, forward ${forward.toExponential(1)}`,
    );
    expect(central).toBeLessThan(forward);
  });
});

describe("tolerance noise in the inner solve (P5.05)", () => {
  // Drag makes the adaptive controller actually adapt; see the file comment for
  // why the drag-free problem cannot measure this.
  const probe = createShootingResidual(dragProblem({ kind: "point", center: [0, 0] }, TIGHT_TOL));
  const range = probe(AIM).impact![0]!;
  const target: PointTarget = { kind: "point", center: [range, 0] };

  /** Reference: tight tolerance, differenced at the plateau step. */
  const reference = shootingJacobian(createShootingResidual(dragProblem(target, TIGHT_TOL)), AIM, {
    scheme: "central",
    thetaStep: 1e-5,
    speedStep: 1e-3,
  });
  const exact: readonly [number, number] = [reference.matrix![0]![0]!, reference.matrix![0]![1]!];

  function sweep(config: ShootingProblem["config"]): Map<number, number> {
    const residual = createShootingResidual(dragProblem(target, config));
    const errors = new Map<number, number>();
    for (const decade of DECADES) {
      const step = Math.pow(10, decade);
      const jacobian = shootingJacobian(residual, AIM, {
        scheme: "central",
        thetaStep: step,
        speedStep: step * 100,
      });
      expect(jacobian.ok).toBe(true);
      errors.set(decade, downrangeError(jacobian.matrix!, exact).theta);
    }
    return errors;
  }

  /**
   * THE VALIDATION MEASUREMENT, second clause: no tolerance-noise blowup — for
   * a quiet inner solve — and a demonstration of what "blowup" costs when the
   * inner solve is not quiet.
   */
  it("floors a loose-tolerance Jacobian orders of magnitude above a fixed-step one", () => {
    const fixed = sweep(FIXED_STEP);
    const loose = sweep(LOOSE_TOL);

    const format = (errors: Map<number, number>): string =>
      DECADES.map((d) => `1e${d}:${errors.get(d)!.toExponential(1)}`).join(" ");
    console.log("P5.05 noise (drag, fixed step)  rel err ∂F/∂θ:", format(fixed));
    console.log("P5.05 noise (drag, rtol 1e-5)   rel err ∂F/∂θ:", format(loose));

    const fixedBest = Math.min(...fixed.values());
    const looseBest = Math.min(...loose.values());

    // The quiet solve reaches a genuinely small error...
    expect(fixedBest).toBeLessThan(1e-8);
    // ...and the loose one cannot, at any step size in the sweep. This is the
    // "tolerance-noise blowup" the task names: refining `h` does not recover
    // it, because the error is a bias in the residual itself, not a truncation
    // term. Three orders is a deliberately loose bound on a measured gap of
    // about four and a half.
    expect(looseBest / fixedBest).toBeGreaterThan(1e3);
  });

  it("recovers no accuracy from a smaller step once the tolerance floor is reached", () => {
    const loose = sweep(LOOSE_TOL);

    // Across the four decades below the plateau the curve is flat-to-rising:
    // the defining signature of a noise floor rather than a truncation error.
    expect(loose.get(-10)!).toBeGreaterThan(loose.get(-6)! * 0.5);
  });
});

describe("finiteDifferenceStep (P5.05)", () => {
  it("takes the square root of the noise floor for forward, the cube root for central", () => {
    expect(finiteDifferenceStep(1e-12, "forward", 1)).toBeCloseTo(1e-6, 12);
    expect(finiteDifferenceStep(1e-12, "central", 1)).toBeCloseTo(1e-4, 12);
  });

  it("scales linearly with the variable's own magnitude", () => {
    expect(finiteDifferenceStep(1e-12, "central", 60)).toBeCloseTo(60e-4, 10);
  });

  it("grows the step by three and a half decades when the floor moves from ε to 1e-6", () => {
    const quiet = finiteDifferenceStep(DEFAULT_NOISE_FLOOR, "central", 1);
    const noisy = finiteDifferenceStep(1e-6, "central", 1);

    // The practical warning behind the whole task: keeping the machine-epsilon
    // step while loosening the tolerance is not conservatism, it is sitting far
    // up the noise branch.
    expect(noisy / quiet).toBeGreaterThan(1e3);
  });

  it("rejects a non-positive or non-finite noise floor or scale", () => {
    expect(() => finiteDifferenceStep(0, "central", 1)).toThrow(/noiseFloor/);
    expect(() => finiteDifferenceStep(Number.NaN, "central", 1)).toThrow(/noiseFloor/);
    expect(() => finiteDifferenceStep(1e-12, "central", -1)).toThrow(/scale/);
  });
});

describe("shootingJacobian failure handling (P5.05)", () => {
  const targetX = analyticRange(THETA, V0);

  it("reports a failed perturbation as a value, naming which one, rather than throwing", () => {
    // A span far too short for the shot to reach the ground: every evaluation
    // runs out of `tspan` and comes back `ok: false`.
    const residual = createShootingResidual({
      ...dragFreeProblem({ kind: "point", center: [targetX, 0] }),
      tspan: [0, 1],
    });

    const jacobian = shootingJacobian(residual, AIM);

    expect(jacobian.ok).toBe(false);
    expect(jacobian.matrix).toBeNull();
    expect(jacobian.failure).toContain("theta");
    // A Newton line search needs the step it tried in order to shorten it.
    expect(jacobian.steps.theta).toBeGreaterThan(0);
  });

  it("names the base evaluation when a forward difference has nothing to difference from", () => {
    const residual = createShootingResidual({
      ...dragFreeProblem({ kind: "point", center: [targetX, 0] }),
      tspan: [0, 1],
    });

    const jacobian = shootingJacobian(residual, AIM, { scheme: "forward" });

    expect(jacobian.ok).toBe(false);
    expect(jacobian.failure).toContain("base aim");
    expect(jacobian.evaluations).toBe(1);
  });

  it("throws on a non-positive explicit step, which is a caller error and not an outcome", () => {
    const residual = createShootingResidual(
      dragFreeProblem({ kind: "point", center: [targetX, 0] }),
    );

    expect(() => shootingJacobian(residual, AIM, { thetaStep: 0 })).toThrow(/theta step/);
    expect(() => shootingJacobian(residual, AIM, { speedStep: Number.NaN })).toThrow(/speed step/);
  });

  it("inherits the residual's construction guard against an interpolant-free stepper", () => {
    // The staircase guard belongs to P5.04, but it is what makes a Jacobian
    // here meaningful at all, so the pairing is pinned rather than assumed.
    expect(() =>
      createShootingResidual({
        ...dragFreeProblem({ kind: "point", center: [targetX, 0] }),
        stepper: new ClassicalRK4Stepper(),
      }),
    ).toThrow(/interpolant/);
  });
});
