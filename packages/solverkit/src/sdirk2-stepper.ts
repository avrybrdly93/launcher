import type { EvalContext, Model } from "@ballista/engine";
import { solveLinearSystemInPlace } from "./dense-linear-solve.js";
import { scaledErrorNorm } from "./scaled-error-norm.js";
import type { NewtonFailureReason, Stepper, StepResult } from "./types.js";

const SQRT_EPS = Math.sqrt(Number.EPSILON);
const DEFAULT_NEWTON_ATOL = 1e-10;
const DEFAULT_NEWTON_RTOL = 1e-8;
const DEFAULT_MAX_NEWTON_ITERATIONS = 50;
const DEFAULT_MAX_DAMPING_HALVINGS = 12;

/**
 * $\gamma = 1 - \tfrac{1}{\sqrt2} \approx 0.2928932$ — the root of $\gamma^2
 * - 2\gamma + \tfrac12 = 0$ that lies in $(0,1)$, which is exactly the
 * second-order condition $\mathbf b\cdot\mathbf c = \tfrac12$ for this
 * tableau (see the derivation). The other root, $1 + 1/\sqrt2$, is also
 * second-order and A-stable but has a larger error constant and is not the
 * conventional choice.
 */
export const SDIRK2_GAMMA = 1 - Math.SQRT1_2;

/** Constructor options for {@link Sdirk2Stepper}'s per-stage Newton iteration. */
export interface Sdirk2Options {
  /** Absolute part of the Newton convergence tolerance (eq. 4.9-style scaling). */
  readonly newtonAtol?: number;
  /** Relative part of the Newton convergence tolerance. */
  readonly newtonRtol?: number;
  /** Iteration budget per stage before the step is treated as a Newton convergence failure. */
  readonly maxNewtonIterations?: number;
  /** Backtracking-line-search halvings tried per Newton iteration before giving up. */
  readonly maxDampingHalvings?: number;
}

/**
 * The stability function of this tableau,
 *
 * $$R(z) = \frac{1 + (1-2\gamma)z}{(1-\gamma z)^2},$$
 *
 * evaluated on the real axis. Two properties this method exists for, both
 * readable straight off the expression: $|R(z)| \le 1$ for every $z \le 0$
 * (**A-stability**, and the full complex left half-plane case is proved in
 * the derivation), and $R(z) \to 0$ as $z \to -\infty$ (**L-stability**),
 * since the numerator is linear in $z$ and the denominator quadratic.
 *
 * That second property is the whole point of preferring this method to the
 * trapezoidal rule, whose $R(z) = (1 + z/2)/(1 - z/2) \to -1$: on a stiff
 * mode both are A-stable and neither blows up, but the trapezoidal rule
 * *flips the sign of the stiff component and keeps its magnitude* at every
 * step instead of damping it, so a transient that physically dies instantly
 * instead rings for the whole solve. Exported because it is what the
 * L-stability test measures the stepper against; it is deliberately *not*
 * added to `stability-region.ts`, whose {@link stabilityFunction} documents
 * itself as the truncated-exponential closed form for explicit methods whose
 * stage count equals their order — an implicit method's $R$ is rational, not
 * polynomial, so it does not belong to that family.
 */
export function sdirk2StabilityFunction(z: number, gamma: number = SDIRK2_GAMMA): number {
  const denominator = 1 - gamma * z;
  return (1 + (1 - 2 * gamma) * z) / (denominator * denominator);
}

/**
 * Alexander's 2-stage SDIRK2 (§4.6, P4.38): the **singly diagonally
 * implicit** Runge-Kutta method
 *
 * ```
 *   gamma | gamma      0
 *       1 | 1 - gamma  gamma
 *   ------+------------------
 *         | 1 - gamma  gamma
 * ```
 *
 * with $\gamma = 1 - 1/\sqrt2$ ({@link SDIRK2_GAMMA}). Second order,
 * A-stable, and — unlike the trapezoidal rule, the other obvious second-order
 * A-stable choice — **L-stable**: $R(z) \to 0$ as $z \to -\infty$, so a
 * stiff transient is annihilated rather than rung. See
 * {@link sdirk2StabilityFunction}.
 *
 * Three structural properties earn this method its place next to
 * {@link BackwardEulerStepper}, which is first order:
 *
 * - **Diagonally implicit**: $a_{12} = 0$, so the two stages are solved
 *   *sequentially*, each a `dim`-dimensional nonlinear system. A general
 *   2-stage implicit RK would couple them into one `2*dim`-dimensional
 *   solve.
 * - **Singly**: both diagonal entries equal $\gamma$, so both stages share
 *   the same iteration matrix $(\mathbf I - h\gamma\mathbf J)$. This
 *   implementation exploits that directly — the Jacobian is evaluated once
 *   per step (at $\mathbf y_k$, simplified/chord Newton) and the resulting
 *   matrix is reused by every iteration of *both* stages.
 * - **Stiffly accurate**: the weight row $\mathbf b$ equals the last row of
 *   $\mathbf A$, so $\mathbf y_{k+1} = \mathbf Y_2$ exactly. The final
 *   update is a copy, not a weighted sum of stage derivatives, which is
 *   what makes $R(\infty) = 0$ hold in the presence of an algebraic
 *   constraint as well as for the scalar test equation.
 *
 * Each stage's implicit system is solved by the same damped Newton iteration
 * {@link BackwardEulerStepper} runs, against the residual
 * $F(\mathbf Y) = \mathbf Y - \mathbf y_k - h\sum_j a_{ij}\mathbf f_j = 0$
 * with $\mathbf f_i = \mathbf f(t + c_i h, \mathbf Y_i)$. The Jacobian comes
 * from `model.jacobian` when the model declares one (P1.22) and from an
 * in-place central-difference fallback (P1.23's formula, against preallocated
 * buffers, since `Stepper.step` must not allocate per ADR-004) otherwise.
 * Stage 1's initial guess is $\mathbf y_k$; stage 2's is stage 1's converged
 * $\mathbf Y_1$, which is already $O(h)$ closer.
 *
 * A stage that exhausts its iteration budget, hits a numerically singular
 * iteration matrix, or fails its damping search writes `NaN` into
 * `out.yNext` and sets `out.accepted = false`, recording the cumulative
 * iteration count and a typed {@link NewtonFailureReason} (P2.39) — same
 * contract as {@link BackwardEulerStepper}, so `integrate`'s P2.03
 * non-finite-state guard reports a typed solve failure either way.
 *
 * `errorEstimate` stays 0: this is a fixed-step method with no embedded
 * pair. Pairing SDIRK2 with the ESDIRK-style embedded estimator that would
 * make it adaptive is not part of P4.38.
 *
 * See the [derivation](./sdirk2-stepper.derivation.md) for the order
 * conditions that pin $\gamma$, the L-stability proof, and the per-stage
 * Newton iteration.
 */
export class Sdirk2Stepper implements Stepper {
  readonly info = { id: "sdirk2", order: 2, fsal: false, symplectic: false } as const;

  private readonly newtonAtol: number;
  private readonly newtonRtol: number;
  private readonly maxNewtonIterations: number;
  private readonly maxDampingHalvings: number;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private dim = 0;

  private stage: Float64Array | undefined;
  private f1: Float64Array | undefined;
  private f2: Float64Array | undefined;
  /** `y_k + h*sum_{j<i} a_ij*f_j` — the fixed part of stage `i`'s residual, rebuilt once per stage. */
  private explicitPart: Float64Array | undefined;
  private candidate: Float64Array | undefined;
  private fEval: Float64Array | undefined;
  private fCandidate: Float64Array | undefined;
  private residual: Float64Array | undefined;
  private candidateResidual: Float64Array | undefined;
  private jac: Float64Array | undefined;
  /** `(I - h*gamma*J)`, evaluated once per step and shared by BOTH stages — the payoff of "singly". */
  private iterMatrixBase: Float64Array | undefined;
  /** Scratch copy of the above; `solveLinearSystemInPlace` destroys its matrix argument. */
  private iterMatrix: Float64Array | undefined;
  private delta: Float64Array | undefined;
  private fdYPerturbed: Float64Array | undefined;
  private fdFPlus: Float64Array | undefined;
  private fdFMinus: Float64Array | undefined;

  /** `solveStage`'s out-parameters, as fields rather than a returned record (ADR-004: a step allocates nothing). */
  private stageNRHS = 0;
  private stageIterations = 0;
  private stageFailureReason: NewtonFailureReason | undefined;

  constructor(options: Sdirk2Options = {}) {
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
    this.stage = new Float64Array(dim);
    this.f1 = new Float64Array(dim);
    this.f2 = new Float64Array(dim);
    this.explicitPart = new Float64Array(dim);
    this.candidate = new Float64Array(dim);
    this.fEval = new Float64Array(dim);
    this.fCandidate = new Float64Array(dim);
    this.residual = new Float64Array(dim);
    this.candidateResidual = new Float64Array(dim);
    this.jac = new Float64Array(dim * dim);
    this.iterMatrixBase = new Float64Array(dim * dim);
    this.iterMatrix = new Float64Array(dim * dim);
    this.delta = new Float64Array(dim);
    this.fdYPerturbed = new Float64Array(dim);
    this.fdFPlus = new Float64Array(dim);
    this.fdFMinus = new Float64Array(dim);
  }

  /** Writes df/dy at (t, y) into `this.jac`; returns the rhs evaluations it cost. */
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
      const step = SQRT_EPS * Math.max(Math.abs(yj), 1);

      yPerturbed[j] = yj + step;
      model.rhs(t, yPerturbed, fPlus, ctx);

      yPerturbed[j] = yj - step;
      model.rhs(t, yPerturbed, fMinus, ctx);

      yPerturbed[j] = yj;

      const inv2h = 1 / (2 * step);
      for (let i = 0; i < dim; i++) {
        jac[i * dim + j] = (fPlus[i]! - fMinus[i]!) * inv2h;
      }
    }
    return 2 * dim;
  }

  /**
   * Damped Newton solve of one stage: finds `Y` with
   * `Y = explicitPart + h*gamma*f(tStage, Y)`, starting from the value
   * already in `this.stage` and leaving the converged `Y` there and
   * `f(tStage, Y)` in `fOut`. Results come back through the
   * `stageNRHS`/`stageIterations`/`stageFailureReason` fields rather than a
   * returned record, so a step allocates nothing (ADR-004).
   */
  private solveStage(tStage: number, h: number, yScale: Float64Array, fOut: Float64Array): void {
    const model = this.model!;
    const ctx = this.ctx!;
    const dim = this.dim;
    const gammaH = SDIRK2_GAMMA * h;
    const stage = this.stage!;
    const explicitPart = this.explicitPart!;
    const fEval = this.fEval!;
    const residual = this.residual!;
    const candidate = this.candidate!;
    const fCandidate = this.fCandidate!;
    const candidateResidual = this.candidateResidual!;
    const iterMatrix = this.iterMatrix!;
    const iterMatrixBase = this.iterMatrixBase!;
    const delta = this.delta!;

    let nRHS = 0;
    let iterations = 0;
    let failureReason: NewtonFailureReason | undefined;

    model.rhs(tStage, stage, fEval, ctx);
    nRHS++;
    for (let i = 0; i < dim; i++) {
      residual[i] = stage[i]! - explicitPart[i]! - gammaH * fEval[i]!;
    }
    let err = scaledErrorNorm(residual, yScale, stage, this.newtonRtol, this.newtonAtol);

    while (err > 1) {
      if (iterations >= this.maxNewtonIterations) {
        failureReason = "max-iterations";
        break;
      }
      iterations++;

      // The iteration matrix was built once for the whole step; every
      // iteration of every stage re-copies it because
      // solveLinearSystemInPlace overwrites its matrix argument.
      iterMatrix.set(iterMatrixBase);
      for (let i = 0; i < dim; i++) delta[i] = -residual[i]!;

      if (!solveLinearSystemInPlace(iterMatrix, delta, dim)) {
        failureReason = "singular-jacobian";
        break;
      }

      let lambda = 1;
      let accepted = false;
      for (let damp = 0; damp <= this.maxDampingHalvings; damp++) {
        for (let i = 0; i < dim; i++) candidate[i] = stage[i]! + lambda * delta[i]!;
        model.rhs(tStage, candidate, fCandidate, ctx);
        nRHS++;
        for (let i = 0; i < dim; i++) {
          candidateResidual[i] = candidate[i]! - explicitPart[i]! - gammaH * fCandidate[i]!;
        }
        const candidateErr = scaledErrorNorm(
          candidateResidual,
          yScale,
          candidate,
          this.newtonRtol,
          this.newtonAtol,
        );

        if (candidateErr < err || damp === this.maxDampingHalvings) {
          stage.set(candidate);
          residual.set(candidateResidual);
          fEval.set(fCandidate);
          err = candidateErr;
          accepted = true;
          break;
        }
        lambda *= 0.5;
      }

      if (!accepted) {
        failureReason = "damping-exhausted";
        break;
      }
    }

    if (failureReason === undefined && !Number.isFinite(err)) {
      failureReason = "non-finite-residual";
    }

    fOut.set(fEval);
    this.stageNRHS = nRHS;
    this.stageIterations = iterations;
    this.stageFailureReason = failureReason;
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult): void {
    const model = this.model;
    const ctx = this.ctx;
    if (!model || !ctx || !this.stage) {
      throw new Error("Sdirk2Stepper.step called before init()");
    }

    const dim = this.dim;
    const gamma = SDIRK2_GAMMA;
    const stage = this.stage;
    const explicitPart = this.explicitPart!;
    const f1 = this.f1!;
    const f2 = this.f2!;
    const jac = this.jac!;
    const iterMatrixBase = this.iterMatrixBase!;

    // One Jacobian, one iteration matrix, both stages. Evaluated at y_k
    // (simplified/chord Newton) rather than per-iterate: with a shared
    // gamma this matrix is the same for stage 1 and stage 2, so rebuilding
    // it per iteration would throw away the only structural saving "singly
    // diagonally implicit" buys.
    let nRHS = this.computeJacobian(t, y);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        iterMatrixBase[i * dim + j] = (i === j ? 1 : 0) - h * gamma * jac[i * dim + j]!;
      }
    }

    // Stage 1: Y1 = y_k + h*gamma*f(t + gamma*h, Y1). Guess Y1 = y_k.
    explicitPart.set(y);
    stage.set(y);
    this.solveStage(t + gamma * h, h, y, f1);
    nRHS += this.stageNRHS;

    let iterations = this.stageIterations;
    let failureReason = this.stageFailureReason;

    if (failureReason === undefined) {
      // Stage 2: Y2 = y_k + h*(1-gamma)*f1 + h*gamma*f(t + h, Y2).
      // Guess Y2 = Y1, already O(h) closer than y_k.
      const hOneMinusGamma = h * (1 - gamma);
      for (let i = 0; i < dim; i++) {
        explicitPart[i] = y[i]! + hOneMinusGamma * f1[i]!;
      }
      this.solveStage(t + h, h, y, f2);
      nRHS += this.stageNRHS;
      iterations += this.stageIterations;
      failureReason = this.stageFailureReason;
    }

    out.newtonIterations = iterations;
    out.newtonFailureReason = failureReason;

    if (failureReason !== undefined) {
      out.yNext.fill(NaN);
      out.accepted = false;
    } else {
      // Stiffly accurate: b equals the last row of A, so y_{k+1} = Y2 and
      // no separate weighted-sum update is formed. Writing
      // y + h*((1-gamma)*f1 + gamma*f2) instead would be algebraically the
      // same but would reintroduce the rounding the copy avoids, and would
      // hide the property the L-stability argument leans on.
      out.yNext.set(stage);
      out.accepted = true;
    }
    out.h = h;
    out.errorEstimate = 0;
    out.nRHS = nRHS;
  }
}
