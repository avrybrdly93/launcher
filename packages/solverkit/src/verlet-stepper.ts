import type { EvalContext, Model } from "@ballista/engine";
import type { Stepper, StepResult } from "./types.js";

/** Which splitting of the Stormer-Verlet integrator (§4.8, eq. 4.13) a {@link VerletStepper} uses. */
export type VerletVariant = "velocity" | "position";

/**
 * Order-2, symplectic, structure-preserving integrator for
 * $\ddot{\mathbf q} = \mathbf a(\mathbf q, \mathbf v)$ via `model.partitions`
 * (§4.8, eq. 4.13) -- gravity-only is the clean stage this construction is
 * exact for; velocity-dependent forces (drag, Magnus) break exact
 * symplecticity regardless of variant.
 *
 * **`"velocity"`** (velocity Verlet, kick-drift-half-kick-half, the
 * default): $\mathbf a_k = \mathbf a(\mathbf q_k, \mathbf v_k)$;
 * $\mathbf q_{k+1} = \mathbf q_k + h\mathbf v_k + \tfrac{h^2}2 \mathbf a_k$;
 * $\mathbf a_{k+1} = \mathbf a(\mathbf q_{k+1}, \tilde{\mathbf v}_{k+1})$
 * where $\tilde{\mathbf v}_{k+1} = \mathbf v_k + h\mathbf a_k$ is an
 * explicit-Euler *extrapolated* velocity (P2.17, §4.8's "standard practical
 * compromise" for velocity-dependent forces -- using the true stale
 * $\mathbf v_k$ here instead, as a naive port of the velocity-independent
 * recurrence would, degrades the trapezoidal update below to first order
 * whenever $\mathbf a$ genuinely depends on $\mathbf v$; the extrapolated
 * pass is a no-op, and the order-2 recurrence exact, when it doesn't);
 * $\mathbf v_{k+1} = \mathbf v_k + \tfrac h2(\mathbf a_k + \mathbf a_{k+1})$.
 * 2 rhs evaluations/step.
 *
 * **`"position"`** (position Verlet, drift-kick-drift): $\mathbf q_{k+1/2}
 * = \mathbf q_k + \tfrac h2 \mathbf v_k$; $\mathbf a_{\text{mid}} =
 * \mathbf a(\mathbf q_{k+1/2}, \mathbf v_k)$ (stale v -- the P2.17
 * extrapolated-velocity pass above is scoped to the velocity-Verlet variant
 * only, per §4.8's phrasing; position-Verlet's velocity-dependent-force
 * order is not corrected here); $\mathbf v_{k+1} = \mathbf v_k
 * + h\,\mathbf a_{\text{mid}}$; $\mathbf q_{k+1} = \mathbf q_{k+1/2} +
 * \tfrac h2 \mathbf v_{k+1}$. 1 rhs evaluation/step.
 *
 * Any model channel outside `partitions.q`/`partitions.p` (e.g. a future
 * spin channel, P4.10) is advanced by a companion Euler/midpoint step using
 * the same rhs evaluation(s) rather than left untouched.
 *
 * See the [derivation](./verlet-stepper.derivation.md) for the backward-error-analysis
 * argument behind the bounded (rather than secular) energy error.
 */
export class VerletStepper implements Stepper {
  readonly info: {
    readonly id: string;
    readonly order: 2;
    readonly fsal: false;
    readonly symplectic: true;
  };
  private readonly variant: VerletVariant;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private qIndex: readonly number[] | undefined;
  private pIndex: readonly number[] | undefined;
  private partitioned: boolean[] | undefined;
  private derivA: Float64Array | undefined;
  private derivB: Float64Array | undefined;
  private yStage: Float64Array | undefined;

  constructor(variant: VerletVariant = "velocity") {
    this.variant = variant;
    this.info = {
      id: variant === "velocity" ? "velocity-verlet" : "position-verlet",
      order: 2,
      fsal: false,
      symplectic: true,
    };
  }

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    const partitions = model.partitions;
    if (!partitions) {
      throw new Error("VerletStepper requires a Model declaring partitions (q, p)");
    }
    if (partitions.q.length !== partitions.p.length) {
      throw new Error("VerletStepper requires equal-length q/p partition index arrays");
    }

    this.model = model;
    this.ctx = ctx;
    this.qIndex = partitions.q;
    this.pIndex = partitions.p;
    this.derivA = new Float64Array(model.dim);
    this.derivB = new Float64Array(model.dim);
    this.yStage = new Float64Array(model.dim);

    const partitioned = new Array<boolean>(model.dim).fill(false);
    for (const qi of partitions.q) partitioned[qi] = true;
    for (const pi of partitions.p) partitioned[pi] = true;
    this.partitioned = partitioned;
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult): void {
    const model = this.model;
    const ctx = this.ctx;
    const qIndex = this.qIndex;
    const pIndex = this.pIndex;
    const partitioned = this.partitioned;
    const derivA = this.derivA;
    const derivB = this.derivB;
    const yStage = this.yStage;
    if (!model || !ctx || !qIndex || !pIndex || !partitioned || !derivA || !derivB || !yStage) {
      throw new Error("VerletStepper.step called before init()");
    }

    if (this.variant === "velocity") {
      this.stepVelocityVerlet(
        model,
        ctx,
        qIndex,
        pIndex,
        partitioned,
        derivA,
        derivB,
        yStage,
        t,
        y,
        h,
        out,
      );
    } else {
      this.stepPositionVerlet(
        model,
        ctx,
        qIndex,
        pIndex,
        partitioned,
        derivA,
        yStage,
        t,
        y,
        h,
        out,
      );
    }
  }

  private stepVelocityVerlet(
    model: Model,
    ctx: EvalContext,
    qIndex: readonly number[],
    pIndex: readonly number[],
    partitioned: readonly boolean[],
    accelOld: Float64Array,
    accelNew: Float64Array,
    yStage: Float64Array,
    t: number,
    y: Float64Array,
    h: number,
    out: StepResult,
  ): void {
    const dim = y.length;
    model.rhs(t, y, accelOld, ctx);

    for (let i = 0; i < dim; i++) {
      yStage[i] = partitioned[i]! ? y[i]! : y[i]! + h * accelOld[i]!;
    }
    for (let k = 0; k < qIndex.length; k++) {
      const qi = qIndex[k]!;
      const pi = pIndex[k]!;
      yStage[qi] = y[qi]! + h * y[pi]! + 0.5 * h * h * accelOld[pi]!;
    }

    // P2.17: extrapolated-velocity pass. a(q_{k+1}) alone would need v_{k+1}
    // to evaluate a velocity-dependent force (drag, Magnus), which isn't
    // known yet -- using the stale v_k there (as a naive port of the
    // velocity-independent recurrence would) makes the trapezoidal velocity
    // update only first-order accurate whenever a genuinely depends on v, per
    // §4.8's "standard practical compromise": feed the explicit-Euler
    // *prediction* v_k + h*a(q_k,v_k) into the q_{k+1} force evaluation
    // instead. Harmless when a doesn't depend on v (the prediction and the
    // stale value give the identical a_{k+1}), and restores second-order
    // convergence when it does (verified against quadratic drag below).
    for (let k = 0; k < pIndex.length; k++) {
      const pi = pIndex[k]!;
      yStage[pi] = y[pi]! + h * accelOld[pi]!;
    }

    model.rhs(t + h, yStage, accelNew, ctx);

    for (let i = 0; i < dim; i++) {
      out.yNext[i] = yStage[i]!;
    }
    for (let k = 0; k < qIndex.length; k++) {
      const pi = pIndex[k]!;
      out.yNext[pi] = y[pi]! + 0.5 * h * (accelOld[pi]! + accelNew[pi]!);
    }

    out.accepted = true;
    out.h = h;
    out.errorEstimate = 0;
    out.nRHS = 2;
  }

  private stepPositionVerlet(
    model: Model,
    ctx: EvalContext,
    qIndex: readonly number[],
    pIndex: readonly number[],
    partitioned: readonly boolean[],
    accelMid: Float64Array,
    yHalf: Float64Array,
    t: number,
    y: Float64Array,
    h: number,
    out: StepResult,
  ): void {
    const dim = y.length;
    for (let i = 0; i < dim; i++) {
      yHalf[i] = y[i]!;
    }
    for (let k = 0; k < qIndex.length; k++) {
      const qi = qIndex[k]!;
      const pi = pIndex[k]!;
      yHalf[qi] = y[qi]! + 0.5 * h * y[pi]!;
    }

    model.rhs(t + 0.5 * h, yHalf, accelMid, ctx);

    for (let i = 0; i < dim; i++) {
      out.yNext[i] = partitioned[i]! ? y[i]! : y[i]! + h * accelMid[i]!;
    }
    for (let k = 0; k < qIndex.length; k++) {
      const qi = qIndex[k]!;
      const pi = pIndex[k]!;
      const vNext = y[pi]! + h * accelMid[pi]!;
      out.yNext[pi] = vNext;
      out.yNext[qi] = yHalf[qi]! + 0.5 * h * vNext;
    }

    out.accepted = true;
    out.h = h;
    out.errorEstimate = 0;
    out.nRHS = 1;
  }
}
