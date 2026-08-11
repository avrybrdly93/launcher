import {
  AIM_COLUMNS,
  type JacobianOptions,
  type ShootingJacobian,
  shootingJacobian,
} from "./shooting-jacobian.js";
import {
  type Aim,
  type ResidualFunction,
  type ShootingResidual,
  residualNorm,
} from "./shooting-residual.js";

/**
 * The Newton shooting solver of §7 Phase 5 (P5.06): drive P5.04's residual
 * `F(θ, v₀)` to zero using P5.05's finite-difference Jacobian, globalized by an
 * Armijo backtracking line search.
 *
 * **This solver is built around a rank deficiency, and that is the whole
 * design.** P5.05 measured what the shooting Jacobian actually looks like on
 * this problem: its vertical row is zero to `<1e-8`, because a ground-impact
 * terminal event pins `y_impact` to the ground for *every* aim, so
 * `∂F_y/∂θ = ∂F_y/∂v₀ = 0`. A raised target does not fix that — it shifts `F_y`
 * by a constant, leaving the row zero. So `J` is rank 1: a ground-impact shot
 * is one scalar equation (downrange miss) in two unknowns, which is exactly why
 * P5.08 speaks of low and high arcs and P5.22 of locking two of three
 * quantities.
 *
 * A textbook Newton step solves `J Δ = −F` by Gaussian elimination. On this
 * matrix that is a divide by a pivot of order `1e-8` against entries of order
 * `1e2`, which produces a step of order `1e10` — and the failure is not a
 * thrown error but a line search that backtracks twenty times, accepts a
 * microscopic fraction of a preposterous direction, and converges linearly
 * while every iterate looks finite. That is the failure mode this module is
 * written to make impossible, so the step is a **truncated-SVD minimum-norm
 * least-squares solve** rather than a linear solve: singular values below a
 * relative threshold are discarded, the step lands in the row space of what is
 * left, and the null-space direction is simply not moved.
 *
 * That generalizes the obvious fix. "Lock `v₀` and solve for `θ`" also works on
 * a rank-1 Jacobian, but it hard-codes *which* unknown is the expendable one;
 * the truncated solve lets the matrix decide, and keeps working unchanged if a
 * later task introduces a terminal event that does not pin the vertical
 * component. Levenberg–Marquardt — regularizing rather than truncating — is
 * P5.26 and deliberately not this task.
 *
 * `newton-shooting.test.ts` measures the iteration count on a drag-and-wind
 * problem, and pins the rank-deficiency behaviour with a negative control that
 * runs the same problem through an unguarded 2×2 elimination.
 */

/** Why {@link newtonShooting} stopped. */
export type NewtonShootingStatus =
  /** `‖F‖` reached {@link NewtonShootingOptions.residualTolerance}. */
  | "converged"
  /**
   * The step became smaller than {@link NewtonShootingOptions.stepTolerance}
   * while `‖F‖` was still above tolerance — the iteration has stopped moving.
   *
   * On a rank-deficient problem this is the *expected* terminal state whenever
   * part of `F` lies outside the range of `J`: a ground-impact solve against a
   * target 12 m above the ground can null the downrange miss and can do nothing
   * at all about the vertical one. Read {@link NewtonShootingResult.residual}
   * before treating it as a failure.
   */
  | "stalled"
  /** Backtracking ran out of halvings without meeting the Armijo condition. */
  | "line-search-failed"
  /** A residual or Jacobian evaluation failed (an aim outside the reachable set). */
  | "evaluation-failed"
  /** {@link NewtonShootingOptions.maxIterations} was reached. */
  | "max-iterations";

/** One iteration's worth of diagnostics, in the order they were produced. */
export interface NewtonShootingStep {
  /** 0-based iteration index. */
  readonly iteration: number;
  /** `‖F‖` at the iterate this step started from. */
  readonly merit: number;
  /**
   * Numerical rank of the Jacobian at this iterate, i.e. how many singular
   * values survived {@link NewtonShootingOptions.rankTolerance}. Expect 1 for
   * any ground-impact problem.
   */
  readonly rank: number;
  /** Singular values of the column-scaled Jacobian, descending. */
  readonly singularValues: readonly number[];
  /** Accepted line-search fraction: 1 for a full step. */
  readonly alpha: number;
  /** Backtracks spent before acceptance. */
  readonly backtracks: number;
  /** Euclidean norm of the *scaled* step, the quantity `stepTolerance` compares. */
  readonly stepNorm: number;
  /**
   * Reduction in `‖F‖` the linear model predicted for the full step —
   * `‖F‖ − ‖F + JΔ‖`. This is what the Armijo condition asks for a fraction
   * of, and on a rank-deficient problem it is strictly less than `‖F‖`.
   */
  readonly predictedReduction: number;
  /** `‖F‖` after the accepted step. */
  readonly nextMerit: number;
}

/** Tuning for {@link newtonShooting}. Every field has a defensible default. */
export interface NewtonShootingOptions {
  /**
   * Absolute miss distance, in metres, below which the solve is converged.
   * Defaults to `1e-6` — a micrometre, far below any meaningful target, and
   * reachable because the residual is a smooth function of the aim (P5.04).
   */
  readonly residualTolerance?: number;
  /** Maximum Newton iterations. Defaults to 20. */
  readonly maxIterations?: number;
  /** Passed through to {@link shootingJacobian} at every iterate. */
  readonly jacobian?: JacobianOptions;
  /**
   * Singular values smaller than this fraction of the largest are treated as
   * zero. Defaults to `1e-7`.
   *
   * **The default is not arbitrary, and it is not `ε`.** The singular values
   * here come from the eigenvalues of `JᵀJ` (see {@link minimumNormStep}),
   * which squares the ratio being tested, so a threshold below `√ε ≈ 1.5e-8`
   * would be asking a `double` to resolve a Gram-matrix eigenvalue smaller than
   * its own rounding. `1e-7` sits an order above that floor and three orders
   * below the smallest ratio a genuinely two-dimensional aim problem would
   * produce, while the ground-impact rank deficiency it must catch measures
   * around `1e-11` — the gap is wide enough that the exact value does not
   * matter.
   */
  readonly rankTolerance?: number;
  /**
   * Armijo sufficient-decrease constant. Defaults to `1e-4`, the conventional
   * value: it asks for essentially any decrease, and exists to reject steps
   * that increase the merit rather than to demand real progress.
   */
  readonly armijoC?: number;
  /** Backtracking factor, applied to `α` on each rejection. Defaults to `0.5`. */
  readonly backtrackFactor?: number;
  /** Halvings allowed before the line search gives up. Defaults to 25. */
  readonly maxBacktracks?: number;
  /**
   * Scaled step norm below which the iteration is declared {@link
   * NewtonShootingStatus | stalled}. Defaults to `1e-12`.
   */
  readonly stepTolerance?: number;
  /**
   * Typical magnitude of `θ`, used to scale the Jacobian's first column.
   * Defaults to 1 radian.
   */
  readonly thetaScale?: number;
  /** Typical magnitude of `v₀`. Defaults to `max(|v₀|, 1)` at the initial aim. */
  readonly speedScale?: number;
  /**
   * Maps a trial aim to a feasible one, turning the line search into a search
   * along the **projected arc** `α ↦ P(x + αΔ)` rather than along the ray. The
   * constraint-handling entry point of P5.16 supplies `projectAim` here; omitted,
   * the solve is unconstrained and every code path below is unchanged.
   *
   * **Projecting the trial, not the accepted step, is what makes this correct.**
   * Clamping only the final answer would let the iteration wander outside the
   * box and converge to an exterior point, then report its projection — an aim
   * that is feasible and solves nothing. Projecting each trial keeps every
   * *iterate* feasible, at every iteration, which is what
   * `ConstrainedShootingResult.feasible` reports.
   *
   * **It does not make every residual *evaluation* feasible, and that gap is
   * measured rather than glossed.** {@link shootingJacobian} differences the
   * residual about the current iterate, and those difference steps are not
   * projected — at an iterate sitting on a face, the stencil reaches one
   * difference step past it. `constraints.test.ts` measures exactly that on a
   * speed-capped solve: 5 of 56 evaluations land outside the box, every one of
   * them `4.8e-4` m/s past a 70 m/s cap, which is the speed column's difference
   * step and nothing more. It is harmless when the residual is defined slightly
   * outside the box, as it is there. It is **not** harmless when the bound marks
   * the edge of the model's domain — a non-negative speed, say — where the
   * stencil would evaluate at an aim that has no trajectory and the Jacobian
   * would come back `ok: false`. Filed as P0.92; a one-sided stencil at an
   * active face is the fix and belongs to that task, not this one.
   *
   * **The Armijo test is left stated against the unprojected linear model.** The
   * model predicts the reduction for `x + αΔ`, and the projected arc reaches a
   * different point, so on a face the achieved decrease is smaller than
   * predicted. With `armijoC` at its `1e-4` default the condition asks for so
   * small a fraction of the prediction that this is slack rather than a
   * distortion, and the alternative — re-deriving a model along the arc — is
   * Bertsekas' two-metric projection and a far larger piece of machinery than a
   * box on two variables can justify.
   */
  readonly projection?: (aim: Aim) => Aim;
}

/** What {@link newtonShooting} returns. */
export interface NewtonShootingResult {
  /** Whether {@link status} is `"converged"`. */
  readonly converged: boolean;
  /** Why the iteration stopped. */
  readonly status: NewtonShootingStatus;
  /** The final aim — the best one found, not necessarily a converged one. */
  readonly aim: Aim;
  /** The residual evaluation at {@link aim}. */
  readonly residual: ShootingResidual;
  /** `‖F‖` at {@link aim}. */
  readonly merit: number;
  /** Newton iterations actually taken. */
  readonly iterations: number;
  /** Residual evaluations spent, line search and Jacobian columns included. */
  readonly evaluations: number;
  /** Per-iteration diagnostics, oldest first. */
  readonly history: readonly NewtonShootingStep[];
  /** Human-readable detail when {@link converged} is false. */
  readonly failure?: string;
}

/** A truncated-SVD minimum-norm least-squares solution. */
export interface MinimumNormStep {
  /** The solution `x` minimizing `‖x‖` among the minimizers of `‖Ax − b‖`. */
  readonly solution: number[];
  /** Singular values of `A`, descending. */
  readonly singularValues: number[];
  /** How many of them survived the relative threshold. */
  readonly rank: number;
}

/**
 * Minimum-norm least-squares solution of `A x = b` for a matrix with **exactly
 * two columns**, via a truncated SVD.
 *
 * `A` is `m × 2` here because an aim is `(θ, v₀)`; `m` is the number of
 * position axes, 2 for a planar layout and 3 for a spatial one. Two columns is
 * what makes a closed form reasonable: `AᵀA` is a `2 × 2` symmetric
 * positive-semidefinite matrix whose eigenpairs are elementary, and its
 * eigenvalues are the squared singular values of `A` with eigenvectors the
 * right singular vectors. The truncated pseudo-inverse is then
 *
 * $$x = \sum_{\sigma_i > \tau\sigma_1} \frac{v_i^\mathsf{T} A^\mathsf{T} b}{\sigma_i^2} v_i.$$
 *
 * **The cost of the Gram-matrix route is that it squares the condition
 * number**, and that is a real limitation rather than a footnote: a matrix
 * whose singular values differ by more than `√ε ≈ 1.5e-8` is numerically rank
 * deficient *to this routine* even though it is not to a proper SVD. It is the
 * right trade here for one reason — the deficiency this solver must survive is
 * a ratio near `1e-11`, four orders past that floor, so no threshold in the
 * usable range decides it differently. A caller who needs to resolve a genuine
 * `1e-9` singular value needs a Golub–Kahan SVD, not this.
 *
 * The larger eigenvalue is computed from the symmetric form
 * `mean ± √(half-difference² + b²)`, which cannot cancel; the smaller comes
 * from `det / larger` rather than from `mean − √(…)`, which can lose every
 * significant digit exactly when the matrix is nearly singular — the case that
 * matters.
 *
 * @param a Row-major `m × 2` matrix.
 * @param b Right-hand side of length `m`.
 * @param rankTolerance Relative singular-value floor.
 */
export function minimumNormStep(
  a: readonly (readonly number[])[],
  b: readonly number[],
  rankTolerance: number,
): MinimumNormStep {
  if (a.length !== b.length) {
    throw new Error(
      `minimumNormStep: matrix has ${a.length} row(s) but the right-hand side has ${b.length}`,
    );
  }
  if (a.length === 0) {
    throw new Error("minimumNormStep: matrix has no rows");
  }
  for (const row of a) {
    if (row.length !== 2) {
      throw new Error(`minimumNormStep: every row must have 2 columns; got ${row.length}`);
    }
  }
  if (!(rankTolerance > 0)) {
    throw new Error(`minimumNormStep: rankTolerance must be positive; got ${rankTolerance}`);
  }

  // Gram matrix [[g00, g01], [g01, g11]] and the projected right-hand side Aᵀb.
  let g00 = 0;
  let g01 = 0;
  let g11 = 0;
  let atb0 = 0;
  let atb1 = 0;
  for (let row = 0; row < a.length; row++) {
    const c0 = a[row]![0]!;
    const c1 = a[row]![1]!;
    const rhs = b[row]!;
    g00 += c0 * c0;
    g01 += c0 * c1;
    g11 += c1 * c1;
    atb0 += c0 * rhs;
    atb1 += c1 * rhs;
  }

  const mean = (g00 + g11) / 2;
  const halfDifference = (g00 - g11) / 2;
  const spread = Math.hypot(halfDifference, g01);
  const larger = mean + spread;
  // det(AᵀA) = λ₁λ₂, so the small eigenvalue divides out of the determinant
  // without the subtraction that would annihilate it. Guarding on `larger`
  // rather than on the determinant: a zero matrix has both zero.
  const determinant = g00 * g11 - g01 * g01;
  const smaller = larger > 0 ? Math.max(determinant / larger, 0) : 0;

  const singularValues = [Math.sqrt(larger), Math.sqrt(smaller)];

  // Eigenvector for the larger eigenvalue. Both (g01, λ − g00) and
  // (λ − g11, g01) span the eigenspace; taking the longer of the two avoids
  // normalizing a vector that is zero to rounding when the matrix is nearly
  // diagonal.
  let v0x: number;
  let v0y: number;
  const candidate1 = [larger - g11, g01] as const;
  const candidate2 = [g01, larger - g00] as const;
  if (Math.hypot(...candidate1) >= Math.hypot(...candidate2)) {
    [v0x, v0y] = candidate1;
  } else {
    [v0x, v0y] = candidate2;
  }
  const length = Math.hypot(v0x, v0y);
  if (length === 0) {
    // AᵀA is a multiple of the identity (including the zero matrix): every
    // direction is an eigenvector, so the axes will do.
    v0x = 1;
    v0y = 0;
  } else {
    v0x /= length;
    v0y /= length;
  }
  // The second right singular vector is orthogonal to the first, in 2D.
  const v1x = -v0y;
  const v1y = v0x;

  const floor = rankTolerance * singularValues[0]!;
  let x0 = 0;
  let x1 = 0;
  let rank = 0;
  const modes: readonly (readonly [number, number, number])[] = [
    [singularValues[0]!, v0x, v0y],
    [singularValues[1]!, v1x, v1y],
  ];
  for (const [sigma, vx, vy] of modes) {
    if (!(sigma > floor) || sigma === 0) continue;
    rank++;
    const coefficient = (vx * atb0 + vy * atb1) / (sigma * sigma);
    x0 += coefficient * vx;
    x1 += coefficient * vy;
  }
  const solution = [x0, x1];

  return { solution, singularValues, rank };
}

/** `‖b + A x‖`, the linear model's predicted residual after a step. */
function modelResidualNorm(
  a: readonly (readonly number[])[],
  b: readonly number[],
  x: readonly number[],
): number {
  let sum = 0;
  for (let row = 0; row < a.length; row++) {
    const value = b[row]! + a[row]![0]! * x[0]! + a[row]![1]! * x[1]!;
    sum += value * value;
  }
  return Math.sqrt(sum);
}

/** Scale a Jacobian's columns, so a step norm means something across mixed units. */
function scaleColumns(
  matrix: readonly (readonly number[])[],
  scales: readonly number[],
): number[][] {
  return matrix.map((row) => row.map((value, column) => value * scales[column]!));
}

/**
 * Newton (Gauss–Newton) shooting solve with an Armijo backtracking line search.
 *
 * **Columns are scaled before the step is computed, and the step norm is
 * measured in the scaled variables.** `θ` is order 1 radian and `v₀` order
 * 60 m/s, so "minimum-norm" in raw units is a statement about `v₀` and
 * essentially nothing about `θ` — the minimum-norm solve would resolve the
 * rank-1 ambiguity by declining to change the angle, for no reason but the unit
 * it happens to be measured in. Scaling makes the choice about the problem
 * rather than about metres per second. It is the same `thetaScale`/`speedScale`
 * pair {@link shootingJacobian} uses to size its difference steps.
 *
 * **The Armijo condition is stated against the *predicted* reduction, not
 * against `‖F‖`.** The usual form for nonlinear equations,
 * `‖F(x + αΔ)‖ ≤ (1 − c₁α)‖F(x)‖`, assumes the step can in principle remove all
 * of `‖F‖` — true for a nonsingular square `J`, false here. On a rank-deficient
 * problem with an irreducible residual component, that test is unsatisfiable
 * for every `α` once the reducible part is gone, so the line search would
 * exhaust its backtracks and report failure at the exact moment the solver had
 * done everything the problem allows. Comparing against
 * `‖F‖ − ‖F + JΔ‖` — what the linear model actually promises — asks for a
 * fraction of the achievable reduction and terminates cleanly by
 * {@link NewtonShootingStatus | stalling} instead.
 *
 * **With a {@link NewtonShootingOptions.projection}, the stall test moves to the
 * projected displacement, and for the same reason.** An iterate sitting on an
 * active face whose Newton step points out of the box projects back onto itself
 * for every `α`: the trial equals the current aim, the merit is unchanged, and
 * the Armijo condition — which asks for a strict decrease — is unsatisfiable all
 * the way down. Left alone the search would spend its full backtrack budget and
 * report `line-search-failed` at the precise moment the solver had reached a
 * constrained stationary point and was entitled to stop. Measuring the distance
 * actually travelled, rather than the distance proposed, detects that on the
 * first trial and stops with `"stalled"`. The test is applied **only** when a
 * projection is supplied, so an unconstrained solve keeps its existing
 * termination behaviour to the letter.
 *
 * A residual evaluation that fails (an aim past the reachability boundary, no
 * impact) has merit `Infinity` by {@link residualNorm}'s contract, so the line
 * search rejects it and backtracks with no special case at the comparison site.
 */
export function newtonShooting(
  residual: ResidualFunction,
  initialAim: Aim,
  options: NewtonShootingOptions = {},
): NewtonShootingResult {
  const residualTolerance = options.residualTolerance ?? 1e-6;
  const maxIterations = options.maxIterations ?? 20;
  const rankTolerance = options.rankTolerance ?? 1e-7;
  const armijoC = options.armijoC ?? 1e-4;
  const backtrackFactor = options.backtrackFactor ?? 0.5;
  const maxBacktracks = options.maxBacktracks ?? 25;
  const stepTolerance = options.stepTolerance ?? 1e-12;
  const thetaScale = options.thetaScale ?? 1;
  const speedScale = options.speedScale ?? Math.max(Math.abs(initialAim.speed), 1);
  const scales = [thetaScale, speedScale];

  if (!(backtrackFactor > 0) || backtrackFactor >= 1) {
    throw new Error(`newtonShooting: backtrackFactor must be in (0, 1); got ${backtrackFactor}`);
  }
  for (const [name, scale] of [
    ["thetaScale", thetaScale],
    ["speedScale", speedScale],
  ] as const) {
    if (!(scale > 0) || !Number.isFinite(scale)) {
      throw new Error(`newtonShooting: ${name} must be finite and positive; got ${scale}`);
    }
  }

  // The Jacobian is differenced about the current iterate with the same scales,
  // so its steps and this solver's step norm are talking about the same
  // variables.
  const jacobianOptions: JacobianOptions = { thetaScale, speedScale, ...options.jacobian };

  let evaluations = 0;
  const evaluate = (at: Aim): ShootingResidual => {
    evaluations++;
    return residual(at);
  };

  const project = options.projection;

  const history: NewtonShootingStep[] = [];
  // The starting point is projected too: a caller whose initial guess comes from
  // P5.07's drag-free closed form has no reason to expect it inside a box the
  // machine imposes, and an infeasible iterate zero would make "every iterate is
  // feasible" false at the only step nobody checks.
  let aim = project === undefined ? initialAim : project(initialAim);
  let current = evaluate(aim);
  let merit = residualNorm(current);

  const finish = (status: NewtonShootingStatus, failure?: string): NewtonShootingResult => ({
    converged: status === "converged",
    status,
    aim,
    residual: current,
    merit,
    iterations: history.length,
    evaluations,
    history,
    ...(failure === undefined ? {} : { failure }),
  });

  if (!current.ok) {
    return finish(
      "evaluation-failed",
      "the initial aim produced no impact, so there is nothing to iterate from",
    );
  }

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (merit <= residualTolerance) return finish("converged");

    const jacobian: ShootingJacobian = shootingJacobian(residual, aim, jacobianOptions);
    evaluations += jacobian.evaluations;
    if (!jacobian.ok || jacobian.matrix === null) {
      return finish(
        "evaluation-failed",
        `the Jacobian could not be formed at θ = ${aim.theta}, v₀ = ${aim.speed}: ` +
          `${jacobian.failure ?? "unknown reason"}`,
      );
    }

    const scaled = scaleColumns(jacobian.matrix, scales);
    // Gauss-Newton solves J Δ = −F, so the right-hand side is the negated
    // residual; `predictedReduction` below then measures ‖F‖ − ‖F + JΔ‖ with
    // the un-negated residual, which is the same model evaluated consistently.
    const negated = current.residual!.map((value) => -value);
    const {
      solution: scaledStep,
      singularValues,
      rank,
    } = minimumNormStep(scaled, negated, rankTolerance);

    const stepNorm = Math.hypot(scaledStep[0]!, scaledStep[1]!);
    if (!(stepNorm > stepTolerance)) {
      return finish(
        "stalled",
        `the step norm ${stepNorm} fell to the stall tolerance while ‖F‖ = ${merit}` +
          (rank < AIM_COLUMNS.length
            ? `; the Jacobian is rank ${rank} of ${AIM_COLUMNS.length}, so part of the ` +
              "residual may be structurally irreducible (see NewtonShootingStatus)"
            : ""),
      );
    }

    const predictedReduction = merit - modelResidualNorm(scaled, current.residual!, scaledStep);
    const step = [scaledStep[0]! * thetaScale, scaledStep[1]! * speedScale];

    let alpha = 1;
    let backtracks = 0;
    let accepted: { aim: Aim; residual: ShootingResidual; merit: number } | null = null;
    let blocked = false;
    while (backtracks <= maxBacktracks) {
      const ray: Aim = {
        theta: aim.theta + alpha * step[0]!,
        speed: aim.speed + alpha * step[1]!,
      };
      const trial = project === undefined ? ray : project(ray);
      if (Number.isFinite(trial.theta) && Number.isFinite(trial.speed)) {
        if (project !== undefined) {
          // Distance actually travelled along the projected arc, in the same
          // scaled variables `stepTolerance` is stated in. Zero here means the
          // whole step was clipped away and no smaller `α` can travel further,
          // so this is a termination rather than another backtrack.
          const displacement = Math.hypot(
            (trial.theta - aim.theta) / thetaScale,
            (trial.speed - aim.speed) / speedScale,
          );
          if (!(displacement > stepTolerance)) {
            blocked = true;
            break;
          }
        }
        const trialResidual = evaluate(trial);
        const trialMerit = residualNorm(trialResidual);
        if (trialMerit <= merit - armijoC * alpha * predictedReduction) {
          accepted = { aim: trial, residual: trialResidual, merit: trialMerit };
          break;
        }
      }
      alpha *= backtrackFactor;
      backtracks++;
    }

    if (blocked) {
      history.push({
        iteration,
        merit,
        rank,
        singularValues,
        alpha: 0,
        backtracks,
        stepNorm,
        predictedReduction,
        nextMerit: merit,
      });
      return finish(
        "stalled",
        `the projected step travelled no further than the stall tolerance ${stepTolerance} ` +
          `while ‖F‖ = ${merit}: the Newton direction points out of the feasible set at ` +
          `θ = ${aim.theta}, v₀ = ${aim.speed}, which is a constrained stationary point rather ` +
          "than a failure — read the active set to see which bound is carrying the residual",
      );
    }

    if (accepted === null) {
      history.push({
        iteration,
        merit,
        rank,
        singularValues,
        alpha: 0,
        backtracks,
        stepNorm,
        predictedReduction,
        nextMerit: merit,
      });
      return finish(
        "line-search-failed",
        `no fraction of the step down to α = ${alpha / backtrackFactor} met the Armijo ` +
          `condition at ‖F‖ = ${merit} (predicted reduction ${predictedReduction}, rank ${rank})`,
      );
    }

    history.push({
      iteration,
      merit,
      rank,
      singularValues,
      alpha,
      backtracks,
      stepNorm,
      predictedReduction,
      nextMerit: accepted.merit,
    });

    aim = accepted.aim;
    current = accepted.residual;
    merit = accepted.merit;
  }

  if (merit <= residualTolerance) return finish("converged");
  return finish(
    "max-iterations",
    `${maxIterations} iterations left ‖F‖ = ${merit}, above the tolerance ${residualTolerance}`,
  );
}
