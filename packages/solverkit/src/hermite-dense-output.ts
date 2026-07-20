import type { EvalContext, Model } from "@ballista/engine";
import type { Stepper, StepperInfo, StepResult } from "./types.js";

/**
 * Cubic Hermite interpolation (§4.9) for fixed-step methods: given the
 * endpoint state/derivative pairs $(\mathbf y_k, \mathbf f_k)$ and
 * $(\mathbf y_{k+1}, \mathbf f_{k+1})$ of an accepted step of size $h$,
 * evaluates $\mathbf y(t_k + \theta h)$ via the standard Hermite basis
 *
 * $$\mathbf y_{k+\theta} = h_{00}(\theta)\,\mathbf y_k +
 * h\,h_{10}(\theta)\,\mathbf f_k + h_{01}(\theta)\,\mathbf y_{k+1} +
 * h\,h_{11}(\theta)\,\mathbf f_{k+1}$$
 *
 * Matching both value and derivative at $\theta=0$ and $\theta=1$ (4
 * constraints) exactly determines a cubic's 4 coefficients, so this
 * reproduces any cubic-in-$t$ trajectory exactly; for a general (non-cubic)
 * solution it is locally 3rd order -- "adequate for display" per the
 * blueprint, one order below a 4th-order fixed step (RK4) itself. Allocates
 * nothing.
 */
export function hermiteInterpolant(
  theta: number,
  y0: Float64Array,
  f0: Float64Array,
  y1: Float64Array,
  f1: Float64Array,
  h: number,
  out: Float64Array,
): void {
  const t2 = theta * theta;
  const t3 = t2 * theta;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + theta;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  for (let i = 0; i < out.length; i++) {
    out[i] = h00 * y0[i]! + h * h10 * f0[i]! + h01 * y1[i]! + h * h11 * f1[i]!;
  }
}

/** True iff every component of `a` and `b` is bit-identical (step-chaining reuse check, mirrors P2.24's FSAL cache). */
function sameState(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Decorates any fixed-step {@link Stepper} (Euler, the RK2 variants, RK4,
 * ...) with cubic Hermite dense output (P2.31, §4.9), without touching the
 * wrapped stepper's internals or requiring method-specific interpolation
 * coefficients the way P2.30's DOPRI5 interpolant needs -- the tradeoff is
 * up to 2 extra `model.rhs` calls per step (one at `(t, y)` for $\mathbf
 * f_k$, one at `(t+h, y_{k+1})` for $\mathbf f_{k+1}$), counted into
 * `out.nRHS` alongside the inner stepper's own.
 *
 * The $\mathbf f_k$ evaluation is skipped -- an FSAL-style reuse mirroring
 * {@link EmbeddedRKStepper}'s stage cache -- whenever this step's `y` is
 * bit-identical to the *previous* step's accepted $\mathbf y_{k+1}$, true
 * for every step but the first in a normal `integrate()` run (the driver
 * always passes the prior accepted state straight back in as the next
 * step's `y`), halving the steady-state overhead to 1 extra call/step.
 *
 * This wrapper is opt-in by construction (`new HermiteDenseOutputStepper(new
 * ClassicalRK4Stepper())`), matching §5.1(c)'s interactive-vs-batch split:
 * the batch/Monte-Carlo path composes the bare inner stepper and pays
 * nothing extra; only a caller that actually wants dense output (rendering,
 * event location) reaches for this.
 */
export class HermiteDenseOutputStepper implements Stepper {
  readonly info: StepperInfo;
  private readonly inner: Stepper;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private y0: Float64Array | undefined;
  private f0: Float64Array | undefined;
  private y1: Float64Array | undefined;
  private f1: Float64Array | undefined;
  private h = 0;
  private hasAccepted = false;

  constructor(inner: Stepper) {
    this.inner = inner;
    this.info = { ...inner.info, denseOrder: 3 };
  }

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    this.inner.init(model, ctx);
    this.model = model;
    this.ctx = ctx;
    this.y0 = new Float64Array(model.dim);
    this.f0 = new Float64Array(model.dim);
    this.y1 = new Float64Array(model.dim);
    this.f1 = new Float64Array(model.dim);
    this.hasAccepted = false;
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult): void {
    const model = this.model;
    const ctx = this.ctx;
    if (!model || !ctx || !this.y0 || !this.f0 || !this.y1 || !this.f1) {
      throw new Error("HermiteDenseOutputStepper.step called before init()");
    }

    const reuse = this.hasAccepted && sameState(this.y1, y);
    if (reuse) {
      this.f0.set(this.f1);
    } else {
      model.rhs(t, y, this.f0, ctx);
    }
    this.y0.set(y);

    this.inner.step(t, y, h, out);
    if (!reuse) out.nRHS += 1;

    model.rhs(t + h, out.yNext, this.f1, ctx);
    out.nRHS += 1;

    this.y1.set(out.yNext);
    this.h = h;
    this.hasAccepted = true;
  }

  /** @inheritDoc */
  interpolant(theta: number, out: Float64Array): void {
    if (!this.hasAccepted || !this.y0 || !this.f0 || !this.y1 || !this.f1) {
      throw new Error("HermiteDenseOutputStepper.interpolant called before init()/step()");
    }
    hermiteInterpolant(theta, this.y0, this.f0, this.y1, this.f1, this.h, out);
  }
}
