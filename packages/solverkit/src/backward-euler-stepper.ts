import type { EvalContext, Model } from "@ballista/engine";
import { solveLinearSystemInPlace } from "./dense-linear-solve.js";
import { scaledErrorNorm } from "./scaled-error-norm.js";
import type { NewtonFailureReason, Stepper, StepResult } from "./types.js";

const SQRT_EPS = Math.sqrt(Number.EPSILON);
const DEFAULT_NEWTON_ATOL = 1e-10;
const DEFAULT_NEWTON_RTOL = 1e-8;
const DEFAULT_MAX_NEWTON_ITERATIONS = 50;
const DEFAULT_MAX_DAMPING_HALVINGS = 12;
const DEFAULT_NEWTON_STRATEGY: NewtonStrategy = "full";
/**
 * `"simplified"` mode's cross-step reuse heuristic (P4.21): a step that
 * needed more than this many Newton iterations to converge -- even with a
 * reused Jacobian available -- is evidence the cached matrix is drifting
 * out of date, so the *next* step starts from a fresh one rather than
 * compounding the staleness. Small because simplified Newton is only a
 * win while it converges fast; once it doesn't, the FD/analytic
 * reevaluation this threshold triggers is cheap next to another handful
 * of poorly-converging iterations.
 */
const DEFAULT_JACOBIAN_STALE_ITERATIONS = 2;

/**
 * Newton strategy for {@link BackwardEulerStepper} (P4.21). `"full"`
 * recomputes (and refactors) the Jacobian on every Newton iteration of
 * every step -- P2.38's original, most-robust-but-priciest behavior, and
 * the default so existing callers see no change. `"simplified"` is the
 * classic modified/chord Newton: the Jacobian is evaluated once and then
 * reused, both across the iterations of a single step and, as long as
 * convergence stays fast, across consecutive steps too -- the "Jacobian
 * reuse" half of this task, valuable because an FD Jacobian costs `2*dim`
 * extra rhs evaluations per evaluation (`computeJacobian`) while
 * rebuilding `I - h*J` from an already-known `J` costs none.
 */
export type NewtonStrategy = "full" | "simplified";

/** Constructor options for {@link BackwardEulerStepper}'s Newton iteration. */
export interface BackwardEulerOptions {
  /** Absolute part of the Newton convergence tolerance (eq. 4.9-style scaling). */
  readonly newtonAtol?: number;
  /** Relative part of the Newton convergence tolerance. */
  readonly newtonRtol?: number;
  /** Iteration budget before a step is treated as a Newton convergence failure. */
  readonly maxNewtonIterations?: number;
  /** Backtracking-line-search halvings tried per Newton iteration before giving up. */
  readonly maxDampingHalvings?: number;
  /**
   * `"full"` (default) or `"simplified"` -- see {@link NewtonStrategy}.
   * Simplified/modified Newton with Jacobian reuse across iterations and
   * steps (P4.21's "productionizing"): fewer Jacobian evaluations for the
   * same converged trajectory, at the cost of a slightly larger (but
   * still typically small) Newton iteration count per step.
   */
  readonly newtonStrategy?: NewtonStrategy;
}

/**
 * Implicit (backward) Euler: solves $\mathbf y_{k+1} = \mathbf y_k + h\,
 * \mathbf f(t_{k+1}, \mathbf y_{k+1})$ for $\mathbf y_{k+1}$ by damped
 * Newton iteration on $F(\mathbf y) = \mathbf y - \mathbf y_k - h\,
 * \mathbf f(t_{k+1}, \mathbf y) = 0$ (§4.6). $R(z) = (1-z)^{-1}$ is
 * A-stable ($|R(z)| \le 1$ for all $\operatorname{Re}(z) \le 0$) --
 * the platform's one implicit reference method, included precisely to
 * complete the stiffness story: on the dust-grain scenario it takes
 * visually-sized stable steps where any explicit method must crawl below
 * $h_{\text{crit}} \approx 2/|\lambda_{\max}|$ (eq. 4.12).
 *
 * Each Newton iteration solves the linear system
 * $(\mathbf I - h\mathbf J)\,\boldsymbol\delta = -F(\mathbf y_k^{(i)})$ via
 * {@link solveLinearSystemInPlace}, where $\mathbf J = \partial
 * \mathbf f/\partial \mathbf y$ comes from `model.jacobian` when the model
 * declares one (P1.22), or an in-place central-difference fallback
 * (P1.23's `finiteDifferenceJacobian` formula, reimplemented here against
 * preallocated buffers instead of that utility's allocating one, since a
 * `Stepper.step` call must allocate nothing per ADR-004) otherwise. The
 * initial guess is $\mathbf y_k$ itself (not an explicit-Euler predictor):
 * robust regardless of $h$'s magnitude, which matters exactly at the huge
 * step sizes this method exists to take.
 *
 * Damping: each Newton correction is applied with a backtracking step size
 * $\lambda \in \{1, \tfrac12, \tfrac14, \dots\}$, halved until the
 * candidate's scaled residual norm ({@link scaledErrorNorm}, reused here as
 * the Newton convergence/decrease test rather than an embedded-pair error
 * estimate) is smaller than the current iterate's, or the halving budget is
 * exhausted. Convergence is declared once that norm is $\le 1$. A step that exhausts
 * `maxNewtonIterations` without converging, hits a numerically singular
 * iteration matrix, or fails a damping search writes `NaN` into
 * `out.yNext` and sets `out.accepted = false` -- `integrate`'s existing
 * P2.03 non-finite-state guard then reports a typed solve failure -- while
 * also recording the iteration count and a typed {@link NewtonFailureReason}
 * onto `out.newtonIterations` / `out.newtonFailureReason` (P2.39), so a
 * forced non-convergence surfaces *why* it failed rather than only the
 * NaN/`accepted: false` pair.
 *
 * `newtonStrategy: "simplified"` (P4.21) reuses the Jacobian instead of
 * recomputing it every iteration: within a step, `J` is evaluated once
 * (at that step's initial guess $\mathbf y_k$) and every iteration only
 * rebuilds $\mathbf I - h\mathbf J$ from the cached value and re-solves --
 * cheap, since it costs no rhs evaluations, unlike re-evaluating `J`
 * itself. The cached `J` then carries into the *next* step's first
 * iteration too, and is only refreshed when a step needed more than a
 * couple of iterations to converge (a sign it's drifting stale) or failed
 * outright -- a failed/slow iteration
 * that was relying on a reused Jacobian gets one on-the-spot retry with a
 * freshly evaluated one before it's allowed to fail the step, so a stale
 * cache degrades efficiency, never correctness.
 *
 * See the [derivation](./backward-euler-stepper.derivation.md) for the A-stability proof
 * and the damped-Newton iteration this stepper runs each step.
 */
export class BackwardEulerStepper implements Stepper {
  readonly info = { id: "backward-euler", order: 1, fsal: false, symplectic: false } as const;

  private readonly newtonAtol: number;
  private readonly newtonRtol: number;
  private readonly maxNewtonIterations: number;
  private readonly maxDampingHalvings: number;
  private readonly newtonStrategy: NewtonStrategy;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private dim = 0;

  /** `"simplified"` mode only: whether `this.jac` holds a usable (possibly stale-but-untested) Jacobian carried from a previous evaluation. */
  private jacobianValid = false;

  private yGuess: Float64Array | undefined;
  private candidate: Float64Array | undefined;
  private fEval: Float64Array | undefined;
  private fCandidate: Float64Array | undefined;
  private residual: Float64Array | undefined;
  private candidateResidual: Float64Array | undefined;
  private jac: Float64Array | undefined;
  private iterMatrix: Float64Array | undefined;
  private delta: Float64Array | undefined;
  private fdYPerturbed: Float64Array | undefined;
  private fdFPlus: Float64Array | undefined;
  private fdFMinus: Float64Array | undefined;

  constructor(options: BackwardEulerOptions = {}) {
    this.newtonAtol = options.newtonAtol ?? DEFAULT_NEWTON_ATOL;
    this.newtonRtol = options.newtonRtol ?? DEFAULT_NEWTON_RTOL;
    this.maxNewtonIterations = options.maxNewtonIterations ?? DEFAULT_MAX_NEWTON_ITERATIONS;
    this.maxDampingHalvings = options.maxDampingHalvings ?? DEFAULT_MAX_DAMPING_HALVINGS;
    this.newtonStrategy = options.newtonStrategy ?? DEFAULT_NEWTON_STRATEGY;
  }

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    this.model = model;
    this.ctx = ctx;
    const dim = model.dim;
    this.dim = dim;
    this.jacobianValid = false;
    this.yGuess = new Float64Array(dim);
    this.candidate = new Float64Array(dim);
    this.fEval = new Float64Array(dim);
    this.fCandidate = new Float64Array(dim);
    this.residual = new Float64Array(dim);
    this.candidateResidual = new Float64Array(dim);
    this.jac = new Float64Array(dim * dim);
    this.iterMatrix = new Float64Array(dim * dim);
    this.delta = new Float64Array(dim);
    this.fdYPerturbed = new Float64Array(dim);
    this.fdFPlus = new Float64Array(dim);
    this.fdFMinus = new Float64Array(dim);
  }

  /** Writes df/dy at (t, y) into `this.jac`: analytic if the model declares one, else in-place central differences. */
  private computeJacobian(t: number, y: Float64Array): number {
    const model = this.model!;
    const ctx = this.ctx!;
    const jac = this.jac!;

    if (model.jacobian) {
      model.jacobian(t, y, ctx, jac);
      return 0;
    }

    const dim = this.dim;
    const yPerturbed = this.fdYPerturbed!;
    const fPlus = this.fdFPlus!;
    const fMinus = this.fdFMinus!;
    yPerturbed.set(y);

    for (let j = 0; j < dim; j++) {
      const yj = y[j]!;
      const h = SQRT_EPS * Math.max(Math.abs(yj), 1);

      yPerturbed[j] = yj + h;
      model.rhs(t, yPerturbed, fPlus, ctx);

      yPerturbed[j] = yj - h;
      model.rhs(t, yPerturbed, fMinus, ctx);

      yPerturbed[j] = yj;

      const inv2h = 1 / (2 * h);
      for (let i = 0; i < dim; i++) {
        jac[i * dim + j] = (fPlus[i]! - fMinus[i]!) * inv2h;
      }
    }
    return 2 * dim;
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult): void {
    const model = this.model;
    const ctx = this.ctx;
    if (!model || !ctx || !this.yGuess) {
      throw new Error("BackwardEulerStepper.step called before init()");
    }

    const dim = this.dim;
    const tNext = t + h;
    const yGuess = this.yGuess;
    const fEval = this.fEval!;
    const residual = this.residual!;
    const iterMatrix = this.iterMatrix!;
    const jac = this.jac!;
    const delta = this.delta!;
    const candidate = this.candidate!;
    const fCandidate = this.fCandidate!;
    const candidateResidual = this.candidateResidual!;

    let nRHS = 0;

    yGuess.set(y);
    model.rhs(tNext, yGuess, fEval, ctx);
    nRHS++;
    for (let i = 0; i < dim; i++) residual[i] = yGuess[i]! - y[i]! - h * fEval[i]!;
    let err = scaledErrorNorm(residual, y, yGuess, this.newtonRtol, this.newtonAtol);

    let iterations = 0;
    let failureReason: NewtonFailureReason | undefined;

    const simplified = this.newtonStrategy === "simplified";
    // "full" mode always needs a fresh Jacobian, so this is always true for it
    // (jacobianValid is only ever set by simplified mode -- see below). In
    // simplified mode, a still-valid cached Jacobian (from an earlier
    // iteration of *this* step, or carried over from the previous step) is
    // reused instead, until something below invalidates it.
    let jacobianRefreshedThisStep = false;

    while (err > 1) {
      if (iterations >= this.maxNewtonIterations) {
        failureReason = "max-iterations";
        break;
      }
      iterations++;

      if (!simplified || !this.jacobianValid) {
        nRHS += this.computeJacobian(tNext, yGuess);
        this.jacobianValid = true;
        jacobianRefreshedThisStep = true;
      }
      // Rebuilt every iteration regardless of whether `jac` itself was just
      // recomputed: solveLinearSystemInPlace eliminates `iterMatrix` in
      // place, and this reassembly costs O(dim^2) with no rhs evaluations,
      // negligible next to a Jacobian evaluation's O(dim) rhs calls.
      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) {
          iterMatrix[i * dim + j] = (i === j ? 1 : 0) - h * jac[i * dim + j]!;
        }
        delta[i] = -residual[i]!;
      }

      if (!solveLinearSystemInPlace(iterMatrix, delta, dim)) {
        if (simplified && !jacobianRefreshedThisStep) {
          // The *reused* Jacobian produced a singular iteration matrix --
          // not necessarily a genuinely singular system, just a stale one.
          // Force a fresh evaluation and retry this same iteration before
          // declaring failure.
          this.jacobianValid = false;
          iterations--;
          continue;
        }
        failureReason = "singular-jacobian";
        break;
      }

      let lambda = 1;
      let accepted = false;
      for (let damp = 0; damp <= this.maxDampingHalvings; damp++) {
        for (let i = 0; i < dim; i++) candidate[i] = yGuess[i]! + lambda * delta[i]!;
        model.rhs(tNext, candidate, fCandidate, ctx);
        nRHS++;
        for (let i = 0; i < dim; i++) {
          candidateResidual[i] = candidate[i]! - y[i]! - h * fCandidate[i]!;
        }
        const candidateErr = scaledErrorNorm(
          candidateResidual,
          y,
          candidate,
          this.newtonRtol,
          this.newtonAtol,
        );

        if (candidateErr < err || damp === this.maxDampingHalvings) {
          yGuess.set(candidate);
          residual.set(candidateResidual);
          err = candidateErr;
          accepted = true;
          break;
        }
        lambda *= 0.5;
      }

      if (!accepted) {
        if (simplified && !jacobianRefreshedThisStep) {
          // Same staleness fallback as the singular-matrix branch above: a
          // reused Jacobian that can't even find a decreasing direction is
          // more likely stale than the step being genuinely unsolvable.
          this.jacobianValid = false;
          iterations--;
          continue;
        }
        failureReason = "damping-exhausted";
        break;
      }
    }

    if (failureReason === undefined && !Number.isFinite(err)) {
      failureReason = "non-finite-residual";
    }

    if (simplified) {
      // Carry the Jacobian into the next step only if this one both
      // succeeded and converged fast -- see DEFAULT_JACOBIAN_STALE_ITERATIONS.
      this.jacobianValid =
        failureReason === undefined && iterations <= DEFAULT_JACOBIAN_STALE_ITERATIONS;
    }

    out.newtonIterations = iterations;
    out.newtonFailureReason = failureReason;

    if (failureReason !== undefined) {
      out.yNext.fill(NaN);
      out.accepted = false;
    } else {
      out.yNext.set(yGuess);
      out.accepted = true;
    }
    out.h = h;
    out.errorEstimate = 0;
    out.nRHS = nRHS;
  }
}
