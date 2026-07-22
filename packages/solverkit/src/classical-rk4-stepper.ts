import type { EvalContext, Model } from "@ballista/engine";
import {
  RK4_TABLEAU,
  createExplicitRKBuffers,
  stepExplicitRK,
  type ExplicitRKBuffers,
} from "./explicit-rk-kernel.js";
import type { Stepper, StepResult } from "./types.js";

/**
 * Classical Runge-Kutta 4 (§4.4, eq. 4.6): order 4 with exactly 4 stages --
 * the boundary where explicit RK stage count equals order (the
 * Butcher-barrier fact for $p \ge 5$). A thin wrapper over the shared
 * {@link stepExplicitRK} kernel (P2.12) with {@link RK4_TABLEAU}; `step`
 * itself allocates nothing beyond the buffers preallocated in `init`
 * (ADR-004).
 *
 * See the [derivation](./classical-rk4-stepper.derivation.md) for the rooted-tree order
 * theory and the Butcher-barrier stage-count fact.
 */
export class ClassicalRK4Stepper implements Stepper {
  readonly info = { id: "classical-rk4", order: 4, fsal: false, symplectic: false } as const;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private buffers: ExplicitRKBuffers | undefined;

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    this.model = model;
    this.ctx = ctx;
    this.buffers = createExplicitRKBuffers(model.dim, RK4_TABLEAU.c.length);
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult): void {
    const model = this.model;
    const ctx = this.ctx;
    const buffers = this.buffers;
    if (!model || !ctx || !buffers) {
      throw new Error("ClassicalRK4Stepper.step called before init()");
    }

    stepExplicitRK(model, ctx, RK4_TABLEAU, buffers, t, y, h, out);
  }
}
