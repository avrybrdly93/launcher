import type { EvalContext, Model } from "@ballista/engine";
import { solveLinearSystemInPlace } from "./dense-linear-solve.js";
import { scaledErrorNorm } from "./scaled-error-norm.js";
import type { Stepper, StepResult } from "./types.js";

const SQRT_EPS = Math.sqrt(Number.EPSILON);
const DEFAULT_NEWTON_ATOL = 1e-10;
const DEFAULT_NEWTON_RTOL = 1e-8;
const DEFAULT_MAX_NEWTON_ITERATIONS = 50;
const DEFAULT_MAX_DAMPING_HALVINGS = 12;

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
 * exhausted. Convergence is declared once that norm is $\le 1$. A step that
 * exhausts `maxNewtonIterations` without converging, or fails a damping
 * search, writes `NaN` into `out.yNext` -- `integrate`'s existing P2.03
 * non-finite-state guard then reports a typed solve failure rather than
 * this stepper needing its own diagnostics field (P2.39 adds structured
 * Newton diagnostics to `StepResult`; this task only needs the failure to
 * surface, not to be described in detail).
 */
export class BackwardEulerStepper implements Stepper {
  readonly info = { id: "backward-euler", order: 1, fsal: false, symplectic: false } as const;

  private readonly newtonAtol: number;
  private readonly newtonRtol: number;
  private readonly maxNewtonIterations: number;
  private readonly maxDampingHalvings: number;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private dim = 0;

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

  /** Newton iterations the most recent {@link step} call took; diagnostic only, not part of {@link Stepper}. */
  lastNewtonIterations = 0;

  constructor(options: BackwardEulerOptions = {}) {
    this.newtonAtol = options.newtonAtol ?? DEFAULT_NEWTON_ATOL;
    this.newtonRtol = options.newtonRtol ?? DEFAULT_NEWTON_RTOL;
    this.maxNewtonIterations = options.maxNewtonIterations ?? DEFAULT_MAX_NEWTON_ITERATIONS;
    this.maxDampingHalvings = options.maxDampingHalvings ?? DEFAULT_MAX_DAMPING_HALVINGS;
  }

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    this.model = model;
    this.ctx = ctx;
    const dim = model.dim;
    this.dim = dim;
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
    let failed = false;

    while (err > 1) {
      if (iterations >= this.maxNewtonIterations) {
        failed = true;
        break;
      }
      iterations++;

      nRHS += this.computeJacobian(tNext, yGuess);
      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) {
          iterMatrix[i * dim + j] = (i === j ? 1 : 0) - h * jac[i * dim + j]!;
        }
        delta[i] = -residual[i]!;
      }

      if (!solveLinearSystemInPlace(iterMatrix, delta, dim)) {
        failed = true;
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
        failed = true;
        break;
      }
    }

    this.lastNewtonIterations = iterations;

    if (failed || !Number.isFinite(err)) {
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
