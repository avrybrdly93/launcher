import type { EvalContext, Model } from "@ballista/engine";
import { kahanAdd } from "./compensated-summation.js";
import type { Stepper, StepResult } from "./types.js";

/**
 * Explicit (forward) Euler: y_{n+1} = y_n + h*f(t_n, y_n) (§4.1). The first
 * real, registered {@link Stepper} -- earlier tasks only exercised
 * `integrate` against mocks. Preallocates its single rhs-evaluation scratch
 * buffer once in `init`, per ADR-004; `step` itself allocates nothing.
 *
 * Also the platform's Kahan-compensated-summation exhibit (§4.7, P2.20):
 * when `integrate` passes a `compensation` buffer, the final `y + h*f`
 * addition -- the state update -- runs through {@link kahanAdd} instead of
 * a plain `+`, which is what actually lets the rounding-dominated branch of
 * the V-curve flatten (the blueprint ties that demo specifically to "the
 * Euler curve").
 */
export class ExplicitEulerStepper implements Stepper {
  readonly info = { id: "explicit-euler", order: 1, fsal: false, symplectic: false } as const;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private deriv: Float64Array | undefined;

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    this.model = model;
    this.ctx = ctx;
    this.deriv = new Float64Array(model.dim);
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult, compensation?: Float64Array): void {
    const model = this.model;
    const ctx = this.ctx;
    const deriv = this.deriv;
    if (!model || !ctx || !deriv) {
      throw new Error("ExplicitEulerStepper.step called before init()");
    }

    model.rhs(t, y, deriv, ctx);
    if (compensation) {
      for (let i = 0; i < y.length; i++) {
        out.yNext[i] = kahanAdd(y[i]!, h * deriv[i]!, compensation, i);
      }
    } else {
      for (let i = 0; i < y.length; i++) {
        out.yNext[i] = y[i]! + h * deriv[i]!;
      }
    }
    out.accepted = true;
    out.h = h;
    out.errorEstimate = 0;
    out.nRHS = 1;
  }
}
