import type { EvalContext, Model } from "@ballista/engine";
import type { Stepper, StepResult } from "./types.js";

/**
 * Semi-implicit (symplectic) Euler (§4.2, eq. 4.3): update each p-channel
 * (velocity) using the derivative at the OLD state, then update its paired
 * q-channel (position) using the freshly updated velocity --
 * $v_{k+1} = v_k + h\,a(t_k, r_k, v_k)$, $r_{k+1} = r_k + h\,v_{k+1}$.
 *
 * Requires `model.partitions` (P1.19): `q[k]`/`p[k]` must be a pair where
 * `dy[q[k]]/dt` is exactly the `p[k]` channel's value (true for a mechanical
 * position/velocity split like the planar projectile's, not guaranteed for
 * an arbitrary Model), since this stepper reuses the freshly updated p-value
 * directly rather than re-evaluating rhs for the q-update.
 *
 * Order 1, same one-rhs-per-step cost as {@link ExplicitEulerStepper}, but
 * symplectic on separable Hamiltonian problems: it (approximately) conserves
 * a nearby "shadow" Hamiltonian, so on a genuinely bounded/periodic orbit the
 * true energy error oscillates in a bounded band rather than secularly
 * drifting outward like explicit Euler's spiral (§4.2 pitfall 1, eq. in
 * §4.2: $|y_{k+1}| = \sqrt{1+h^2\lambda^2}\,|y_k|$ for undamped rotation).
 * That boundedness guarantee is specific to bounded/periodic orbits -- a
 * linear potential like pure uniform gravity has no periodic recurrence to
 * exploit, so the qualitative benefit is demonstrated here on an oscillator
 * fixture, not a single unbounded ballistic arc (see the test file).
 *
 * See the [derivation](./semi-implicit-euler-stepper.derivation.md) for the symplectic
 * shear-composition argument behind the bounded-energy-error claim.
 */
export class SemiImplicitEulerStepper implements Stepper {
  readonly info = { id: "semi-implicit-euler", order: 1, fsal: false, symplectic: true } as const;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private deriv: Float64Array | undefined;
  private qIndex: readonly number[] | undefined;
  private pIndex: readonly number[] | undefined;

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    const partitions = model.partitions;
    if (!partitions) {
      throw new Error("SemiImplicitEulerStepper requires a Model declaring partitions (q, p)");
    }
    if (partitions.q.length !== partitions.p.length) {
      throw new Error("SemiImplicitEulerStepper requires equal-length q/p partition index arrays");
    }

    this.model = model;
    this.ctx = ctx;
    this.deriv = new Float64Array(model.dim);
    this.qIndex = partitions.q;
    this.pIndex = partitions.p;
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult): void {
    const model = this.model;
    const ctx = this.ctx;
    const deriv = this.deriv;
    const qIndex = this.qIndex;
    const pIndex = this.pIndex;
    if (!model || !ctx || !deriv || !qIndex || !pIndex) {
      throw new Error("SemiImplicitEulerStepper.step called before init()");
    }

    model.rhs(t, y, deriv, ctx);
    for (let i = 0; i < y.length; i++) {
      out.yNext[i] = y[i]! + h * deriv[i]!;
    }
    for (let k = 0; k < qIndex.length; k++) {
      const qi = qIndex[k]!;
      const pi = pIndex[k]!;
      out.yNext[qi] = y[qi]! + h * out.yNext[pi]!;
    }

    out.accepted = true;
    out.h = h;
    out.errorEstimate = 0;
    out.nRHS = 1;
  }
}
