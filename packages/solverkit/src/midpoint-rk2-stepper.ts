import type { EvalContext, Model } from "@ballista/engine";
import {
  createTwoStageRK2Buffers,
  stepTwoStageRK2,
  type TwoStageRK2Buffers,
  type TwoStageTableau,
} from "./two-stage-rk2-kernel.js";
import type { Stepper, StepResult } from "./types.js";

/** Midpoint's tableau (§4.3): $c_2 = a_{21} = \tfrac12$, $b = (0,1)$. */
const MIDPOINT_TABLEAU: TwoStageTableau = { c2: 0.5, a21: 0.5, b1: 0, b2: 1 };

/**
 * Midpoint Runge-Kutta 2 (§4.3, eq. 4.4-4.5): evaluate the slope at the
 * step's midpoint using an Euler half-step to get there, then advance the
 * full step with that single slope. Order 2. A thin wrapper over the shared
 * {@link stepTwoStageRK2} kernel (P2.11) with {@link MIDPOINT_TABLEAU};
 * `step` itself allocates nothing beyond the buffers preallocated in `init`
 * (ADR-004).
 *
 * See the [derivation](./midpoint-rk2-stepper.derivation.md) for the order-condition
 * expansion this tableau satisfies.
 */
export class MidpointRK2Stepper implements Stepper {
  readonly info = { id: "midpoint-rk2", order: 2, fsal: false, symplectic: false } as const;

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
      throw new Error("MidpointRK2Stepper.step called before init()");
    }

    stepTwoStageRK2(model, ctx, MIDPOINT_TABLEAU, buffers, t, y, h, out);
  }
}
