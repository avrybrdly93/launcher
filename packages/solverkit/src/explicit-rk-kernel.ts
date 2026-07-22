import type { EvalContext, Model } from "@ballista/engine";
import type { Stepper, StepperInfo, StepResult } from "./types.js";

/**
 * A general explicit Runge-Kutta Butcher tableau (§4.4, eq. 4.6): stage $i$
 * is $\mathbf k_i = \mathbf f(t + c_i h,\ \mathbf y + h \sum_{j<i} a_{ij}
 * \mathbf k_j)$, and the step is $\mathbf y_{k+1} = \mathbf y_k + h \sum_i
 * b_i \mathbf k_i$. `a[i]` holds only the strictly-lower-triangular row for
 * stage $i$ (its `j < i` entries) since explicit RK never reads $a_{ij}$ for
 * $j \ge i$; `a[0]` is always empty (stage 0 has no prior stages). Every
 * fixed tableau in this file (and Euler's, midpoint's, Heun's, RK4's) is an
 * instance of this one shape.
 */
export interface ButcherTableau {
  readonly c: readonly number[];
  readonly a: readonly (readonly number[])[];
  readonly b: readonly number[];
}

/** Scratch buffers an {@link ExplicitRKStepper} preallocates once in `init` (ADR-004). */
export interface ExplicitRKBuffers {
  readonly k: readonly Float64Array[];
  readonly yStage: Float64Array;
}

/** Allocates an {@link ExplicitRKBuffers} sized for a model of dimension `dim` and a tableau with `stages` stages. */
export function createExplicitRKBuffers(dim: number, stages: number): ExplicitRKBuffers {
  const k: Float64Array[] = [];
  for (let s = 0; s < stages; s++) {
    k.push(new Float64Array(dim));
  }
  return { k, yStage: new Float64Array(dim) };
}

/**
 * The shared explicit-RK kernel every tableau-driven stepper (P2.12) steps
 * through, generalizing P2.06's hand-written Euler and P2.11's
 * {@link stepTwoStageRK2} to an arbitrary number of stages. Allocates
 * nothing -- writes only into the caller-owned `buffers` and `out`.
 *
 * To reproduce a hand-written stepper bit-for-bit (P2.12's validation
 * criterion), the per-component floating-point operation order matters, not
 * just the mathematical result: the stage increment is accumulated as a
 * single weighted sum before the one multiply-by-h (matching
 * `y[i] + h * (b1*k1[i] + b2*k2[i])`, not `(y[i] + h*b1*k1[i]) + h*b2*k2[i]`,
 * which rounds differently), and each `a_{ij}` term is formed as `h *
 * a_{ij} * k_j[i]` (left-to-right) rather than `h * (a_{ij} * k_j[i])`.
 */
export function stepExplicitRK(
  model: Model,
  ctx: EvalContext,
  tableau: ButcherTableau,
  buffers: ExplicitRKBuffers,
  t: number,
  y: Float64Array,
  h: number,
  out: StepResult,
): void {
  const { k, yStage } = buffers;
  const dim = y.length;
  const stages = tableau.c.length;

  for (let s = 0; s < stages; s++) {
    const aRow = tableau.a[s]!;
    for (let i = 0; i < dim; i++) {
      let yi = y[i]!;
      for (let j = 0; j < aRow.length; j++) {
        yi += h * aRow[j]! * k[j]![i]!;
      }
      yStage[i] = yi;
    }
    model.rhs(t + tableau.c[s]! * h, yStage, k[s]!, ctx);
  }

  for (let i = 0; i < dim; i++) {
    let increment = 0;
    for (let s = 0; s < stages; s++) {
      increment += tableau.b[s]! * k[s]![i]!;
    }
    out.yNext[i] = y[i]! + h * increment;
  }
  out.accepted = true;
  out.h = h;
  out.errorEstimate = 0;
  out.nRHS = stages;
}

/** Explicit Euler as a 1-stage tableau (§4.2, eq. 4.2): $c=(0)$, $b=(1)$. */
export const EULER_TABLEAU: ButcherTableau = { c: [0], a: [[]], b: [1] };

/** Midpoint's tableau (§4.3): $c=(0,\tfrac12)$, $a_{21}=\tfrac12$, $b=(0,1)$. */
export const MIDPOINT_TABLEAU: ButcherTableau = { c: [0, 0.5], a: [[], [0.5]], b: [0, 1] };

/** Heun/trapezoidal's tableau (§4.3): $c=(0,1)$, $a_{21}=1$, $b=(\tfrac12,\tfrac12)$. */
export const HEUN_TABLEAU: ButcherTableau = { c: [0, 1], a: [[], [1]], b: [0.5, 0.5] };

/** Classical RK4's tableau (§4.4, eq. 4.6). */
export const RK4_TABLEAU: ButcherTableau = {
  c: [0, 0.5, 0.5, 1],
  a: [[], [0.5], [0, 0.5], [0, 0, 1]],
  b: [1 / 6, 1 / 3, 1 / 3, 1 / 6],
};

/**
 * A {@link Stepper} for any explicit {@link ButcherTableau} (P2.12): the
 * generic counterpart to hand-written steppers like
 * {@link ExplicitEulerStepper}, letting new explicit RK methods (P2.13's
 * classical RK4, ...) be added as data rather than new stepper classes.
 */
export class ExplicitRKStepper implements Stepper {
  readonly info: StepperInfo;
  private readonly tableau: ButcherTableau;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private buffers: ExplicitRKBuffers | undefined;

  constructor(info: StepperInfo, tableau: ButcherTableau) {
    this.info = info;
    this.tableau = tableau;
  }

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    this.model = model;
    this.ctx = ctx;
    this.buffers = createExplicitRKBuffers(model.dim, this.tableau.c.length);
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult): void {
    const model = this.model;
    const ctx = this.ctx;
    const buffers = this.buffers;
    if (!model || !ctx || !buffers) {
      throw new Error("ExplicitRKStepper.step called before init()");
    }

    stepExplicitRK(model, ctx, this.tableau, buffers, t, y, h, out);
  }
}
