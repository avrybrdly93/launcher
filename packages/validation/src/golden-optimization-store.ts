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
  type EvalContext,
} from "@ballista/engine";
import {
  PLANAR_LAYOUT,
  type Aim,
  type PlatformTarget,
  type PointTarget,
  type RingTarget,
  type ShootingProblem,
  type Target,
  createShootingResidual,
  maximizeRange,
  minimumSpeedToHit,
  nelderMead,
  newtonShooting,
  residualNorm,
} from "@ballista/analysis";
import { createDormandPrince54Stepper, type SolverConfig } from "@ballista/solverkit";

/**
 * Golden results for the Phase 5 inverse solvers (P5.25, blueprint §7).
 *
 * P4.37's trajectory store pins what the *integrator* produces. This one pins what the
 * *optimizers on top of it* produce, which is a different failure surface and is not covered
 * by any existing regression: a change to the Jacobian stencil, to the Armijo line search, to
 * Brent's bracketing, or to the residual's target geometry can leave every golden trajectory
 * bit-identical while moving the aim a solve converges to, or the number of iterations it
 * takes to get there. Both are user-visible -- the first is the answer, the second is the wait.
 *
 * **Iteration and evaluation counts are pinned exactly, and that is the point of the store.**
 * They are integers produced by deterministic arithmetic on a fixed problem, so there is no
 * tolerance to speak of: if a count moves, either the algorithm changed or the floating-point
 * result of a convergence test crossed a threshold, and both deserve a human reading the diff.
 * This mirrors `golden-trajectories.test.ts` pinning `nSteps` exactly.
 *
 * **Continuous quantities are compared against a per-case tolerance that comes from the
 * solver's own documented resolution, not from a number chosen to make the suite pass.** A
 * converged aim is only defined to within the criterion that stopped the iteration; asking for
 * more digits than the solver claims would pin roundoff. Each case states its tolerances in
 * {@link GOLDEN_OPTIMIZATION_CASES} below, next to a comment naming where the figure comes
 * from. Widening one therefore means editing reviewable source with a justification, rather
 * than editing a recorded number in a JSON file.
 */

/** Tight inner solve, so the residual's own error never dominates a solver's convergence test. */
const TIGHT_TOLERANCE: SolverConfig = {
  stepper: "dopri5",
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

/**
 * A 1 kg, 50 mm sphere -- `newton-shooting.test.ts`'s projectile, deliberately. Reusing the
 * existing test's parameters keeps this store comparable with the measurements already in the
 * repository instead of introducing a second, unrelated projectile whose numbers cannot be
 * checked against anything.
 */
function context(dragCoefficient: number, wind: number): EvalContext {
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

function problem(target: Target, dragCoefficient: number, wind = 0): ShootingProblem {
  const forces =
    dragCoefficient === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: context(dragCoefficient, wind),
    target,
    config: TIGHT_TOLERANCE,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

const point = (x: number, y = 0): PointTarget => ({ kind: "point", center: [x, y] });

/**
 * What one recorded case reports. Every field is a *result* of running the case; nothing here
 * is a setting. `solution` is the case's answer in its own coordinates (an aim's
 * `[theta, speed]` for the shooting solvers, `[theta]` for range maximization,
 * `[speed, theta]` for the minimum-energy solve), and `objective` is the scalar the case was
 * trying to drive to zero or to an extremum.
 */
export interface GoldenOptimizationOutcome {
  /** The solver's own status string, pinned verbatim. */
  readonly status: string;
  readonly converged: boolean;
  /** The answer, in the case's coordinates. */
  readonly solution: readonly number[];
  /** The scalar the case optimizes: miss magnitude, maximum range, or minimum speed. */
  readonly objective: number;
  /** Outer iterations taken. */
  readonly iterations: number;
  /** Objective/residual evaluations spent. */
  readonly evaluations: number;
}

/** A case: a named problem, the solver to run on it, and the tolerances its answer is defined to. */
export interface GoldenOptimizationCase {
  readonly id: string;
  /** Why this case is in the store -- what it would catch that the others would not. */
  readonly covers: string;
  /**
   * Absolute tolerance on each component of {@link GoldenOptimizationOutcome.solution}, and
   * where the figure comes from. Absolute rather than relative because the components are
   * physically unlike each other: an angle in radians and a speed in m/s do not share a scale.
   */
  readonly solutionTolerance: readonly number[];
  /** Absolute tolerance on {@link GoldenOptimizationOutcome.objective}. */
  readonly objectiveTolerance: number;
  readonly run: () => GoldenOptimizationOutcome;
}

/**
 * `newtonShooting`'s default `residualTolerance` is `1e-6` m on the miss. The aim that
 * achieves it is determined to that miss divided by the residual's sensitivity to the aim,
 * which for these shots is O(100 m per radian) and O(10 m per m/s) -- so the aim is pinned to
 * roughly `1e-8` rad and `1e-7` m/s by the criterion alone. Both figures are given three
 * decades of headroom here, because the store's job is to catch an aim that *moved*, and a
 * genuine algorithmic change moves it by far more than this.
 */
const NEWTON_SOLUTION_TOLERANCE = [1e-5, 1e-4] as const;

/** Slack on the miss magnitude: the solver's own convergence threshold, unmodified. */
const NEWTON_OBJECTIVE_TOLERANCE = 1e-6;

function newtonCase(
  id: string,
  covers: string,
  target: Target,
  drag: number,
  wind: number,
  initialAim: Aim,
): GoldenOptimizationCase {
  return {
    id,
    covers,
    solutionTolerance: NEWTON_SOLUTION_TOLERANCE,
    objectiveTolerance: NEWTON_OBJECTIVE_TOLERANCE,
    run: () => {
      const residual = createShootingResidual(problem(target, drag, wind));
      const result = newtonShooting(residual, initialAim);
      return {
        status: result.status,
        converged: result.converged,
        solution: [result.aim.theta, result.aim.speed],
        objective: result.merit,
        iterations: result.iterations,
        evaluations: result.evaluations,
      };
    },
  };
}

const RAISED_PLATFORM: PlatformTarget = {
  kind: "platform",
  center: [120, 15],
  halfExtents: [2],
  tolerance: 1e-3,
};

const GROUND_RING: RingTarget = {
  kind: "ring",
  center: [200, 0],
  radius: 5,
  tolerance: 1e-3,
};

/**
 * The cases, in the order they are recorded. Each one is here because it reaches code the
 * others do not; a regression store earns its keep by failing for a reason someone can name.
 */
export const GOLDEN_OPTIMIZATION_CASES: readonly GoldenOptimizationCase[] = [
  newtonCase(
    "newton-drag-free-point",
    "The baseline Newton solve: no drag, a point target on the ground, so the answer is the " +
      "one closed-form ballistics also gives and a regression here is unambiguous.",
    point(150),
    0,
    0,
    { theta: 0.6, speed: 45 },
  ),
  newtonCase(
    "newton-quadratic-drag-point",
    "Quadratic drag on the same geometry. Exercises the integrated residual proper -- the " +
      "case P5.03's closed form cannot reach -- and is the shot whose Jacobian P5.05 measured " +
      "as rank-deficient, so it also pins the rank-aware step.",
    point(150),
    0.47,
    0,
    { theta: 0.6, speed: 55 },
  ),
  newtonCase(
    "newton-drag-and-headwind-point",
    "Drag plus a 10 m/s headwind: the configuration P5.06's validation criterion is written " +
      "against, and the only case here where the wind term contributes to the residual.",
    point(150),
    0.47,
    -10,
    { theta: 0.6, speed: 60 },
  ),
  newtonCase(
    "newton-raised-platform-unreachable",
    "**A deliberately non-convergent case, and the store's most important entry.** A platform " +
      "target 15 m up cannot be hit by a model whose terminal event is ground impact: " +
      "`createShootingResidual` reads the miss at the *ground* impact point, so the vertical " +
      "component is pinned at -15 for every aim and no aim reduces it. What is pinned here is " +
      "that the solver says so -- `stalled`, `converged: false`, merit 15 -- rather than " +
      "returning an aim with `converged: true`, which is the silent-wrong-answer shape P0.97, " +
      "P0.99 and P0.101 were each filed for. Filed as P0.105; if that task changes this " +
      "behaviour, rewrite this entry rather than deleting it, exactly as P0.99's " +
      "characterization test asks.",
    RAISED_PLATFORM,
    0.47,
    0,
    { theta: 0.9, speed: 60 },
  ),
  newtonCase(
    "newton-ground-ring",
    "A ring target, whose miss is a nearest-point displacement to a *set*: every impact inside " +
      "the disc has a zero miss, so the solver stops at the first aim that lands anywhere on " +
      "it rather than at the centre. Started from an aim that falls well short, so the case " +
      "pins real iterations and not just the already-inside shortcut.",
    GROUND_RING,
    0.47,
    0,
    { theta: 0.35, speed: 45 },
  ),
  {
    id: "nelder-mead-quadratic-drag-point",
    covers:
      "The derivative-free solver on the same problem as newton-quadratic-drag-point -- and " +
      "**it lands on a different aim, which is correct and is the reason this entry is here.** " +
      "The two do not disagree: with the ground event pinning the impact height, one scalar " +
      "constraint is left over two unknowns, so the aims that hit 150 m form a *curve*, not a " +
      "point. Measured: Newton stops at (0.549 rad, 46.25 m/s) and Nelder-Mead at (0.655 rad, " +
      "44.63 m/s), both with a miss under 3e-14 m. That is the rank-1 Jacobian P5.05 measured, " +
      "observed from the other side. Anyone tempted to 'fix' the disagreement should change " +
      "the problem (pin the speed, or add a second constraint), not the solvers. It also pins " +
      "the cost gap: 16 residual evaluations against roughly 1600.",
    // Nelder-Mead's default `spreadTolerance` is 1e-10 on the simplex, which bounds the
    // coordinates far more loosely than Newton's residual test bounds the aim. These are the
    // solver's own stated resolution, not a widened Newton tolerance. They are additionally
    // loose here because the simplex is contracting along a valley floor rather than into a
    // well -- see `status` below, which is pinned as `max-evaluations`, not `converged`.
    solutionTolerance: [1e-6, 1e-5],
    // The objective is the miss magnitude itself, converged to the simplex spread rather than
    // to a residual threshold.
    objectiveTolerance: 1e-4,
    run: () => {
      const residual = createShootingResidual(problem(point(150), 0.47, 0));
      const objective = (x: readonly number[]): number => {
        const evaluation = residual({ theta: x[0]!, speed: x[1]! });
        // An aim with no impact is infeasible, not merely bad. Returning a large finite value
        // rather than Infinity keeps the simplex's reflections well defined.
        return evaluation.ok ? residualNorm(evaluation) : 1e6;
      };
      const result = nelderMead(objective, [0.6, 55]);
      return {
        status: result.status,
        converged: result.converged,
        solution: result.x,
        objective: result.fx,
        iterations: result.iterations,
        evaluations: result.evaluations,
      };
    },
  },
  {
    id: "maximize-range-drag-free",
    covers:
      "Range maximization with no drag, where the answer is known analytically to be pi/4 " +
      "from a ground launch. The one case in the store with an external check on its value.",
    // `optimal-angle.ts` documents that theta at a smooth maximum cannot be resolved below
    // roughly sqrt(2*eps*R/|R''|), about 1e-4 rad for a shot of this size, while the range at
    // it is resolved far more tightly. The tolerances are asymmetric for that reason.
    solutionTolerance: [1e-4],
    objectiveTolerance: 1e-6,
    run: () => {
      const outcome = rangeOf(0, 0);
      return outcome;
    },
  },
  {
    id: "maximize-range-quadratic-drag",
    covers:
      "The same maximization with quadratic drag, where the optimum shifts below pi/4. Pins " +
      "the shift, which is the pedagogical point of the module and the thing a change to the " +
      "drag force would move.",
    solutionTolerance: [1e-4],
    objectiveTolerance: 1e-6,
    run: () => rangeOf(0.47, 0),
  },
  {
    id: "min-energy-drag-free-point",
    covers:
      "The minimum-speed tangency solve. A different optimizer again (an outer Brent over an " +
      "inner envelope maximization), and the only case whose answer is a speed rather than " +
      "an aim that hits.",
    // `min-energy.ts` reports that `speed` tracks its `speedTol` (default far below this)
    // while the tangency `theta` floors between 7.4e-10 and 1.6e-8 rad on drag-free
    // geometries -- measured figures quoted in that module, not derived here. The theta
    // tolerance is that measured floor with two decades of headroom.
    solutionTolerance: [1e-8, 1e-6],
    objectiveTolerance: 1e-8,
    run: () => {
      const target: readonly [number, number] = [150, 0];
      const solution = minimumSpeedToHit(problem(point(150), 0, 0), target);
      return {
        status: solution.status,
        converged: solution.status === "converged",
        solution: [solution.speed, solution.theta],
        objective: solution.speed,
        iterations: solution.iterations,
        evaluations: solution.evaluations,
      };
    },
  },
];

/**
 * Maximum range for a given drag and wind, as a recorded outcome.
 *
 * The range function integrates one trajectory per elevation and reports the impact's
 * downrange coordinate, or {@link NO_IMPACT} when the aim never comes down inside `tspan`.
 * Speed is fixed at 60 m/s: the maximizer varies only the angle, which is what makes this a
 * one-dimensional problem and a different code path from the shooting cases above.
 */
function rangeOf(dragCoefficient: number, wind: number): GoldenOptimizationOutcome {
  const residual = createShootingResidual(problem(point(0), dragCoefficient, wind));
  const range = (theta: number): number => {
    const evaluation = residual({ theta, speed: 60 });
    return evaluation.ok ? evaluation.impact![0]! : Number.NEGATIVE_INFINITY;
  };
  const optimum = maximizeRange(range);
  return {
    status: optimum.status,
    converged: optimum.converged,
    solution: [optimum.theta],
    objective: optimum.range,
    iterations: optimum.iterations,
    evaluations: optimum.evaluations,
  };
}

/** Every case id, in record order. */
export const GOLDEN_OPTIMIZATION_IDS: readonly string[] = GOLDEN_OPTIMIZATION_CASES.map(
  (c) => c.id,
);

/** Runs one case by id. Throws if the id is unknown, so a renamed case fails loudly. */
export function runGoldenOptimization(id: string): GoldenOptimizationOutcome {
  const found = GOLDEN_OPTIMIZATION_CASES.find((c) => c.id === id);
  if (!found) {
    throw new Error(`Unknown golden optimization case: ${id}`);
  }
  return found.run();
}
