import {
  type JacobianOptions,
  type ShootingJacobian,
  shootingJacobian,
} from "./shooting-jacobian.js";
import {
  type NewtonShootingOptions,
  type NewtonShootingResult,
  newtonShooting,
} from "./newton-shooting.js";
import {
  type Aim,
  type ResidualFunction,
  type ShootingResidual,
  residualNorm,
} from "./shooting-residual.js";

/**
 * The Levenberg–Marquardt fallback of §7 Phase 5 (P5.26): the solver to reach
 * for when P5.06's Newton solve stops converging near the reachability
 * envelope.
 *
 * **What P5.06 already does, so that what this adds is clear.**
 * {@link newtonShooting} handles the rank deficiency every ground-impact shot
 * carries — a terminal event at `y = 0` pins the vertical residual row to zero,
 * so `J` is rank 1 for every aim — by *truncating*: singular values below a
 * relative floor are discarded and the step is the minimum-norm least-squares
 * solution in what survives. `newton-shooting.ts` says in as many words that
 * "Levenberg–Marquardt — regularizing rather than truncating — is P5.26 and
 * deliberately not this task". This is that task.
 *
 * **The difference is not step length, it is step *direction*, and that is the
 * whole reason this converges where Newton does not.** On a rank-1 Jacobian
 * whose surviving row is `(a, b)` in the scaled variables — `a = ∂R/∂θ · θₛ`,
 * `b = ∂R/∂v₀ · v₀ₛ` — the minimum-norm step is the shortest vector solving
 * `a Δθ + b Δv = −F`, which is parallel to `(a, b)`: **the step is allocated in
 * proportion to each variable's sensitivity.** Since a shot's range responds far
 * more strongly to speed than to elevation — `levenberg-marquardt.test.ts`
 * measures `b/a` at the near-envelope start aim, and `→ ∞` at the envelope
 * itself where `a → 0` — the minimum-norm step is almost entirely
 * a speed change. That is the correct thing to do when the speed is free, and
 * the worst thing to do when it is not: with the launch speed against its cap,
 * a projection clips the speed component away and what reaches `θ` is the small
 * remainder, so the iteration crawls, exhausts `maxIterations`, and reports a
 * residual it was never going to reduce.
 *
 * Marquardt's diagonal damping inverts that allocation. Damping with
 * `diag(JᵀJ)` rather than with `I` — the difference between Marquardt's 1963
 * paper and Levenberg's 1944 one, and the reason the method carries both names
 * — makes the step invariant to how the columns are scaled, and on a rank-1
 * system the algebra collapses to
 *
 * $$\Delta \;=\; \frac{-F}{ab\,(2 + \lambda)}\,(b,\;a),$$
 *
 * a step along `(b, a)` — the *reciprocal* of the minimum-norm direction. The
 * variable the residual is least sensitive to receives the largest correction,
 * which near the envelope is exactly `θ`. That is not a tuning accident; it is
 * what column-scale invariance means when one column is nearly dead.
 *
 * **LM is a fallback, not a replacement, and the measurements say so.**
 * `levenberg-marquardt.test.ts` runs both solvers over a grid of targets
 * approaching the envelope from a range of initial aims. Newton wins where it
 * works: 3–4 iterations against LM's 14, because a Gauss–Newton step that is
 * trustworthy is quadratically convergent and a damped one is not. LM wins
 * where Newton has stopped: with the target `0.01 m` inside a `232.6 m`
 * envelope, Newton exhausts 40 iterations at `‖F‖ = 3.6e-3` and LM converges
 * below `1e-6` in 14. Neither reaches a solution from every start — a start on
 * the far side of the peak fails in both, which is a basin problem and belongs
 * to P5.27's multi-start, not here. {@link shootingWithFallback} composes them
 * in the order those numbers imply: Newton first, LM only if Newton did not
 * converge, warm-started from the best aim Newton found.
 *
 * **Dissipative dynamics, so no symplectic anything.** This module only calls
 * the residual, and the trajectories underneath it carry drag; the platform's
 * standing rule that symplectic integration is for conservative systems only is
 * satisfied by construction here — nothing in this file chooses an integrator.
 */

/** Why {@link levenbergMarquardt} stopped. */
export type LevenbergMarquardtStatus =
  /** `‖F‖` reached {@link LevenbergMarquardtOptions.residualTolerance}. */
  | "converged"
  /**
   * The step became smaller than {@link LevenbergMarquardtOptions.stepTolerance}
   * while `‖F‖` was still above tolerance. As in {@link newtonShooting}, this is
   * the *expected* terminal state when part of `F` is structurally irreducible —
   * read {@link LevenbergMarquardtResult.residual} before calling it a failure.
   */
  | "stalled"
  /**
   * Damping was raised {@link LevenbergMarquardtOptions.maxDampingIncreases}
   * times in one iteration without producing a step that reduced the merit.
   *
   * This is LM's analogue of a failed line search, and it means something
   * slightly different: because raising `λ` shortens the step *and* rotates it
   * toward steepest descent, a run of rejections says the linear model is
   * untrustworthy in every direction at this iterate, not merely at this
   * length.
   */
  | "damping-exhausted"
  /** A residual or Jacobian evaluation failed (an aim outside the reachable set). */
  | "evaluation-failed"
  /** {@link LevenbergMarquardtOptions.maxIterations} was reached. */
  | "max-iterations";

/** One accepted iteration's worth of diagnostics, oldest first. */
export interface LevenbergMarquardtStep {
  /** 0-based iteration index. */
  readonly iteration: number;
  /** `‖F‖` at the iterate this step started from. */
  readonly merit: number;
  /** Damping in force when the accepted step was computed. */
  readonly lambda: number;
  /**
   * Gain ratio of the accepted step: achieved reduction in `‖F‖²` divided by
   * the reduction the linear model predicted. 1 means the model was exact;
   * near 0 means it barely held; negative steps are never accepted.
   */
  readonly gainRatio: number;
  /** Damping increases spent inside this iteration before acceptance. */
  readonly rejections: number;
  /** Euclidean norm of the accepted step, in the *scaled* variables. */
  readonly stepNorm: number;
  /** `‖F‖` after the accepted step. */
  readonly nextMerit: number;
}

/** Tuning for {@link levenbergMarquardt}. Every field has a defensible default. */
export interface LevenbergMarquardtOptions {
  /** Absolute miss distance below which the solve is converged. Defaults to `1e-6`. */
  readonly residualTolerance?: number;
  /** Maximum outer iterations. Defaults to 40 — see the note on {@link LevenbergMarquardtResult.iterations}. */
  readonly maxIterations?: number;
  /** Passed through to {@link shootingJacobian} at every iterate. */
  readonly jacobian?: JacobianOptions;
  /**
   * Initial damping, relative to `diag(JᵀJ)`. Defaults to `1e-3`, the value
   * MINPACK and Madsen–Nielsen–Tingleff both start from: small enough that the
   * first step is nearly Gauss–Newton when the model is good, large enough that
   * it is not a full Gauss–Newton step when the model is not.
   */
  readonly initialDamping?: number;
  /**
   * Times damping may be raised within a single iteration before the solve
   * gives up on that iterate. Defaults to 30. Each increase multiplies `λ` by a
   * factor that itself doubles, so 30 is a very large budget and reaching it
   * means something structural rather than a bad guess at scale.
   */
  readonly maxDampingIncreases?: number;
  /** Scaled step norm below which the iteration is {@link LevenbergMarquardtStatus | stalled}. Defaults to `1e-12`. */
  readonly stepTolerance?: number;
  /** Typical magnitude of `θ`. Defaults to 1 radian. */
  readonly thetaScale?: number;
  /** Typical magnitude of `v₀`. Defaults to `max(|v₀|, 1)` at the initial aim. */
  readonly speedScale?: number;
  /**
   * Maps a trial aim to a feasible one, exactly as
   * {@link NewtonShootingOptions.projection} does, and for the same reason:
   * projecting each trial keeps every *iterate* feasible rather than only the
   * answer.
   *
   * This is the option the near-envelope case turns on. An unconstrained aim
   * problem has no fold — a target past the envelope at one speed is simply
   * reached at a higher one — so the degeneracy the blueprint pairs LM with
   * only exists once the speed is bounded, which is what a real machine is.
   */
  readonly projection?: (aim: Aim) => Aim;
  /** Called with each {@link LevenbergMarquardtStep} as it is appended to `history`. */
  readonly onIteration?: (step: LevenbergMarquardtStep) => void;
}

/** What {@link levenbergMarquardt} returns. */
export interface LevenbergMarquardtResult {
  /** Whether {@link status} is `"converged"`. */
  readonly converged: boolean;
  /** Why the iteration stopped. */
  readonly status: LevenbergMarquardtStatus;
  /** The final aim — the best one found, not necessarily a converged one. */
  readonly aim: Aim;
  /** The residual evaluation at {@link aim}. */
  readonly residual: ShootingResidual;
  /** `‖F‖` at {@link aim}. */
  readonly merit: number;
  /**
   * Accepted iterations taken.
   *
   * Expect more of these than {@link newtonShooting} needs on a problem both
   * can solve: damping costs the quadratic convergence rate, which is the price
   * of the robustness. The default `maxIterations` is 40 rather than Newton's
   * 20 for that reason and no other.
   */
  readonly iterations: number;
  /** Residual evaluations spent, rejected trials and Jacobian columns included. */
  readonly evaluations: number;
  /** Final damping, useful for diagnosing how far from Gauss–Newton the solve ended. */
  readonly lambda: number;
  /** Per-iteration diagnostics, oldest first. */
  readonly history: readonly LevenbergMarquardtStep[];
  /** Human-readable detail when {@link converged} is false. */
  readonly failure?: string;
}

/** The damped normal-equations step, or `null` if the damped matrix is singular. */
interface DampedStep {
  readonly step: readonly [number, number];
  readonly norm: number;
}

/**
 * Solve `(JᵀJ + λ·diag(JᵀJ)) Δ = −Jᵀ F` for a two-column `J`, given the Gram
 * matrix and `Jᵀ F` already accumulated.
 *
 * Written against the `2 × 2` closed form rather than a factorisation for the
 * same reason {@link newtonShooting} works from the Gram matrix: an aim has two
 * components, so the inverse is three multiplications and a determinant. The
 * damped matrix is symmetric positive definite whenever `λ > 0` and the
 * diagonal is positive, which is exactly what the `diag` floor below
 * guarantees, so the determinant is only checked for the degenerate case where
 * both columns are numerically dead.
 */
function dampedStep(
  gram: readonly [number, number, number],
  jtf: readonly [number, number],
  diag: readonly [number, number],
  lambda: number,
): DampedStep | null {
  const [g00, g01, g11] = gram;
  const m00 = g00 + lambda * diag[0];
  const m11 = g11 + lambda * diag[1];
  const determinant = m00 * m11 - g01 * g01;
  if (!Number.isFinite(determinant) || determinant <= 0) return null;
  const s0 = (-m11 * jtf[0] + g01 * jtf[1]) / determinant;
  const s1 = (g01 * jtf[0] - m00 * jtf[1]) / determinant;
  if (!Number.isFinite(s0) || !Number.isFinite(s1)) return null;
  return { step: [s0, s1], norm: Math.hypot(s0, s1) };
}

/**
 * Levenberg–Marquardt shooting solve with Marquardt's diagonal damping and
 * Nielsen's gain-ratio update.
 *
 * **The damping is updated from the gain ratio, not from a fixed schedule.**
 * `ρ = (‖F‖² − ‖F(x+Δ)‖²) / (‖F‖² − ‖F + JΔ‖²)` compares what the step achieved
 * against what the linear model promised. A step is accepted only for `ρ > 0` —
 * any real decrease — and `λ` then moves by Nielsen's
 * `λ ← λ · max(1/3, 1 − (2ρ − 1)³)`, which shrinks damping smoothly toward
 * Gauss–Newton as the model proves itself and cannot shrink it by more than a
 * factor of 3 in one step. A rejected step multiplies `λ` by a factor that
 * itself doubles, so a genuinely bad iterate is escaped geometrically rather
 * than by 30 patient halvings.
 *
 * This is preferred over the older "multiply by 10 / divide by 10" schedule
 * because that one is discontinuous in `ρ`: it treats a step that achieved 99%
 * of its prediction the same as one that achieved 1%, and oscillates between
 * two damping values on problems where the truth is in between — which,
 * approaching a fold, is most of them.
 *
 * **`‖F‖²` rather than `‖F‖` in the gain ratio**, because the model LM
 * minimises is the least-squares one and the predicted decrease has to be
 * stated in the same quantity it predicts, or `ρ` is not a ratio of comparable
 * things. {@link newtonShooting}'s Armijo test is stated in `‖F‖`, which is
 * consistent for the line search it drives; the two are not interchangeable and
 * are deliberately not shared.
 *
 * A residual evaluation that fails has merit `Infinity` by
 * {@link residualNorm}'s contract, so `ρ` is `−∞`, the step is rejected, and
 * damping rises — no special case at the comparison site.
 */
export function levenbergMarquardt(
  residual: ResidualFunction,
  initialAim: Aim,
  options: LevenbergMarquardtOptions = {},
): LevenbergMarquardtResult {
  const residualTolerance = options.residualTolerance ?? 1e-6;
  const maxIterations = options.maxIterations ?? 40;
  const initialDamping = options.initialDamping ?? 1e-3;
  const maxDampingIncreases = options.maxDampingIncreases ?? 30;
  const stepTolerance = options.stepTolerance ?? 1e-12;
  const thetaScale = options.thetaScale ?? 1;
  const speedScale = options.speedScale ?? Math.max(Math.abs(initialAim.speed), 1);

  for (const [name, value] of [
    ["thetaScale", thetaScale],
    ["speedScale", speedScale],
    ["initialDamping", initialDamping],
  ] as const) {
    if (!(value > 0) || !Number.isFinite(value)) {
      throw new Error(`levenbergMarquardt: ${name} must be finite and positive; got ${value}`);
    }
  }

  const scales = [thetaScale, speedScale] as const;
  const jacobianOptions: JacobianOptions = { thetaScale, speedScale, ...options.jacobian };

  let evaluations = 0;
  const evaluate = (at: Aim): ShootingResidual => {
    evaluations++;
    return residual(at);
  };

  const project = options.projection;
  const history: LevenbergMarquardtStep[] = [];
  const record = (step: LevenbergMarquardtStep): void => {
    history.push(step);
    options.onIteration?.(step);
  };

  let aim = project === undefined ? initialAim : project(initialAim);
  let current = evaluate(aim);
  let merit = residualNorm(current);
  let lambda = initialDamping;
  // Nielsen's rejection multiplier, doubled on every consecutive rejection and
  // reset to 2 on acceptance.
  let nu = 2;
  // Marquardt's scaling matrix, kept as a running maximum of `diag(JᵀJ)` the
  // way MINPACK does: a column whose sensitivity collapses at this iterate
  // keeps the damping it earned earlier, so the step does not suddenly swing
  // into a direction the problem stopped supporting.
  const diag: [number, number] = [0, 0];

  const finish = (
    status: LevenbergMarquardtStatus,
    failure?: string,
  ): LevenbergMarquardtResult => ({
    converged: status === "converged",
    status,
    aim,
    residual: current,
    merit,
    iterations: history.length,
    evaluations,
    lambda,
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

    const scaled = jacobian.matrix.map((row) =>
      row.map((value, column) => value * scales[column]!),
    );
    const f = current.residual!;

    let g00 = 0;
    let g01 = 0;
    let g11 = 0;
    let jtf0 = 0;
    let jtf1 = 0;
    for (let row = 0; row < scaled.length; row++) {
      const c0 = scaled[row]![0]!;
      const c1 = scaled[row]![1]!;
      const value = f[row]!;
      g00 += c0 * c0;
      g01 += c0 * c1;
      g11 += c1 * c1;
      jtf0 += c0 * value;
      jtf1 += c1 * value;
    }
    diag[0] = Math.max(diag[0], g00);
    diag[1] = Math.max(diag[1], g11);
    // A structurally dead column — the vertical row's contribution on a
    // ground-impact shot — would give a zero diagonal entry and a singular
    // damped matrix however large `λ` grew. Flooring it relative to the live
    // column keeps `JᵀJ + λ diag` positive definite without perturbing the
    // direction by anything measurable when both columns are alive.
    const floor = Math.max(diag[0], diag[1], 1) * 1e-12;
    const damping: [number, number] = [Math.max(diag[0], floor), Math.max(diag[1], floor)];

    let accepted: { aim: Aim; residual: ShootingResidual; merit: number } | null = null;
    let rejections = 0;
    let stepNorm = 0;
    let gainRatio = 0;
    let lambdaUsed = lambda;
    let stalled = false;

    while (rejections <= maxDampingIncreases) {
      lambdaUsed = lambda;
      const solved = dampedStep([g00, g01, g11], [jtf0, jtf1], damping, lambda);
      if (solved === null) {
        lambda *= nu;
        nu *= 2;
        rejections++;
        continue;
      }
      stepNorm = solved.norm;
      if (!(stepNorm > stepTolerance)) {
        stalled = true;
        break;
      }

      const ray: Aim = {
        theta: aim.theta + solved.step[0] * thetaScale,
        speed: aim.speed + solved.step[1] * speedScale,
      };
      const trial = project === undefined ? ray : project(ray);
      if (!Number.isFinite(trial.theta) || !Number.isFinite(trial.speed)) {
        lambda *= nu;
        nu *= 2;
        rejections++;
        continue;
      }

      const trialResidual = evaluate(trial);
      const trialMerit = residualNorm(trialResidual);

      // Predicted decrease in ‖F‖², from the same linear model the step solves.
      let predicted = 0;
      for (let row = 0; row < scaled.length; row++) {
        const value = f[row]!;
        const linear =
          value + scaled[row]![0]! * solved.step[0] + scaled[row]![1]! * solved.step[1];
        predicted += value * value - linear * linear;
      }
      gainRatio = predicted > 0 ? (merit * merit - trialMerit * trialMerit) / predicted : -1;

      if (gainRatio > 0) {
        accepted = { aim: trial, residual: trialResidual, merit: trialMerit };
        lambda *= Math.max(1 / 3, 1 - (2 * gainRatio - 1) ** 3);
        nu = 2;
        break;
      }
      lambda *= nu;
      nu *= 2;
      rejections++;
    }

    if (stalled) {
      return finish(
        "stalled",
        `the damped step norm ${stepNorm} fell to the stall tolerance while ‖F‖ = ${merit} ` +
          `at λ = ${lambdaUsed}; part of the residual may be structurally irreducible`,
      );
    }

    if (accepted === null) {
      return finish(
        "damping-exhausted",
        `${rejections} damping increases reached λ = ${lambda} without a step that reduced ` +
          `‖F‖ = ${merit} at θ = ${aim.theta}, v₀ = ${aim.speed}`,
      );
    }

    record({
      iteration,
      merit,
      lambda: lambdaUsed,
      gainRatio,
      rejections,
      stepNorm,
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

/** What {@link shootingWithFallback} returns: both legs, and which one answered. */
export interface FallbackShootingResult {
  /** Whether the aim reported below is a converged one. */
  readonly converged: boolean;
  /** The best aim found by whichever leg ran last. */
  readonly aim: Aim;
  /** `‖F‖` at {@link aim}. */
  readonly merit: number;
  /** Which solver produced {@link aim}. */
  readonly solver: "newton" | "levenberg-marquardt";
  /** The Newton leg, which always runs. */
  readonly newton: NewtonShootingResult;
  /** The LM leg, present only when Newton did not converge. */
  readonly levenbergMarquardt?: LevenbergMarquardtResult;
  /** Residual evaluations spent across both legs. */
  readonly evaluations: number;
}

/** Options for {@link shootingWithFallback}: one bag per leg, plus the shared aim scales. */
export interface FallbackShootingOptions {
  /** Passed to the Newton leg. */
  readonly newton?: NewtonShootingOptions;
  /** Passed to the LM leg. */
  readonly levenbergMarquardt?: LevenbergMarquardtOptions;
  /**
   * Applied to both legs unless a leg's own options override it. A projection
   * belongs here rather than in one leg: handing the fallback a feasible set the
   * first leg respects and the second does not would let LM answer with an aim
   * the machine cannot fire.
   */
  readonly projection?: (aim: Aim) => Aim;
  /** Applied to both legs unless a leg's own options override it. */
  readonly residualTolerance?: number;
}

/**
 * Newton first, Levenberg–Marquardt only if Newton did not converge — warm
 * started from the best aim Newton found.
 *
 * **The order is the measurement, not a preference.** On targets both solvers
 * reach, Newton takes 3–4 iterations and LM 14, because an undamped
 * Gauss–Newton step near a solution is quadratically convergent and a damped
 * one is not. Running LM first would pay that every time to buy robustness that
 * is only needed near the envelope. Running it second costs one wasted Newton
 * solve on the hard cases and nothing at all on the easy ones.
 *
 * **Warm starting rather than restarting** because Newton's failure mode here is
 * not divergence — it is a crawl toward the solution that runs out of
 * iterations. Its final aim is therefore the best point either solver has seen,
 * even when it is nowhere near good enough, and `levenberg-marquardt.test.ts`
 * measures what that is worth on the starts neither solver can finish: from an
 * aim on the far side of the peak, cold LM ends at `‖F‖ ≈ 3.8e-1` and the
 * warm-started leg at `≈ 8.6e-6` — **four to five orders of magnitude**, on a
 * case where both still report `max-iterations`. Warm starting is not what makes
 * a hopeless start converge; it is what makes a failed solve return an aim worth
 * handing to P5.27's multi-start rather than one worth discarding.
 *
 * A caller who wants LM alone should call {@link levenbergMarquardt}; a caller
 * who wants to know *which* solver answered should read {@link
 * FallbackShootingResult.solver}, which is why it is reported rather than
 * inferred.
 */
export function shootingWithFallback(
  residual: ResidualFunction,
  initialAim: Aim,
  options: FallbackShootingOptions = {},
): FallbackShootingResult {
  const shared = {
    ...(options.projection === undefined ? {} : { projection: options.projection }),
    ...(options.residualTolerance === undefined
      ? {}
      : { residualTolerance: options.residualTolerance }),
  };

  const newton = newtonShooting(residual, initialAim, { ...shared, ...options.newton });
  if (newton.converged) {
    return {
      converged: true,
      aim: newton.aim,
      merit: newton.merit,
      solver: "newton",
      newton,
      evaluations: newton.evaluations,
    };
  }

  // Newton's residual evaluation failed at the very first aim: there is no
  // trajectory to warm start from, and LM would fail identically at the same
  // point. Report Newton's diagnosis rather than producing a second copy of it.
  if (newton.status === "evaluation-failed" && newton.iterations === 0) {
    return {
      converged: false,
      aim: newton.aim,
      merit: newton.merit,
      solver: "newton",
      newton,
      evaluations: newton.evaluations,
    };
  }

  const lm = levenbergMarquardt(residual, newton.aim, {
    ...shared,
    ...options.levenbergMarquardt,
  });
  return {
    converged: lm.converged,
    aim: lm.aim,
    merit: lm.merit,
    solver: "levenberg-marquardt",
    newton,
    levenbergMarquardt: lm,
    evaluations: newton.evaluations + lm.evaluations,
  };
}
