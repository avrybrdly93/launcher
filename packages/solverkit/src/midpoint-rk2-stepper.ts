import type { EvalContext, Model } from "@ballista/engine";
import type { Stepper, StepResult } from "./types.js";

/**
 * Midpoint Runge-Kutta 2 (§4.3, eq. 4.4-4.5 with $c_2 = a_{21} = \tfrac12$,
 * $b = (0,1)$): evaluate the slope at the step's midpoint using an Euler
 * half-step to get there, then advance the full step with that single slope.
 *
 * $$k_1 = f(t_k, y_k), \quad k_2 = f(t_k + h/2,\ y_k + (h/2) k_1), \quad
 * y_{k+1} = y_k + h k_2$$
 *
 * Order 2. Preallocates its two rhs-evaluation scratch buffers and the
 * midpoint-state buffer once in `init`, per ADR-004; `step` itself allocates
 * nothing.
 */
export class MidpointRK2Stepper implements Stepper {
  readonly info = { id: "midpoint-rk2", order: 2, fsal: false, symplectic: false } as const;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private k1: Float64Array | undefined;
  private k2: Float64Array | undefined;
  private yMid: Float64Array | undefined;

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    this.model = model;
    this.ctx = ctx;
    this.k1 = new Float64Array(model.dim);
    this.k2 = new Float64Array(model.dim);
    this.yMid = new Float64Array(model.dim);
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult): void {
    const model = this.model;
    const ctx = this.ctx;
    const k1 = this.k1;
    const k2 = this.k2;
    const yMid = this.yMid;
    if (!model || !ctx || !k1 || !k2 || !yMid) {
      throw new Error("MidpointRK2Stepper.step called before init()");
    }

    model.rhs(t, y, k1, ctx);
    for (let i = 0; i < y.length; i++) {
      yMid[i] = y[i]! + (h / 2) * k1[i]!;
    }
    model.rhs(t + h / 2, yMid, k2, ctx);
    for (let i = 0; i < y.length; i++) {
      out.yNext[i] = y[i]! + h * k2[i]!;
    }
    out.accepted = true;
    out.h = h;
    out.errorEstimate = 0;
    out.nRHS = 2;
  }
}
