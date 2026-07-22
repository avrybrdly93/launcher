import type { EvalContext, Model } from "@ballista/engine";
import {
  createTwoStageRK2Buffers,
  stepTwoStageRK2,
  type TwoStageRK2Buffers,
  type TwoStageTableau,
} from "./two-stage-rk2-kernel.js";
import type { Stepper, StepResult } from "./types.js";

/** Heun/trapezoidal's tableau (§4.3): $c_2 = a_{21} = 1$, $b = (\tfrac12, \tfrac12)$. */
const HEUN_TABLEAU: TwoStageTableau = { c2: 1, a21: 1, b1: 0.5, b2: 0.5 };

/**
 * Heun (trapezoidal) Runge-Kutta 2 (§4.3, eq. 4.4-4.5): a full Euler step to
 * get a trial endpoint slope, then average it with the starting slope.
 * Order 2, same as {@link MidpointRK2Stepper} -- $c_2 = a_{21}$ is forced by
 * the order conditions, so the two only differ in their LTE constant (same
 * work-precision slope, offset intercept). A thin wrapper over the shared
 * {@link stepTwoStageRK2} kernel with {@link HEUN_TABLEAU}; `step` itself
 * allocates nothing beyond the buffers preallocated in `init` (ADR-004).
 *
 * See the [derivation](./heun-rk2-stepper.derivation.md) for the full order-condition
 * expansion this tableau satisfies.
 */
export class HeunRK2Stepper implements Stepper {
  readonly info = { id: "heun-rk2", order: 2, fsal: false, symplectic: false } as const;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private buffers: TwoStageRK2Buffers | undefined;

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    this.model = model;
    this.ctx = ctx;
    this.buffers = createTwoStageRK2Buffers(model.dim);
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult): void {
    const model = this.model;
    const ctx = this.ctx;
    const buffers = this.buffers;
    if (!model || !ctx || !buffers) {
      throw new Error("HeunRK2Stepper.step called before init()");
    }

    stepTwoStageRK2(model, ctx, HEUN_TABLEAU, buffers, t, y, h, out);
  }
}
