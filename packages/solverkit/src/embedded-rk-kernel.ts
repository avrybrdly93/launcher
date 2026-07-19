import type { EvalContext, Model } from "@ballista/engine";
import {
  createExplicitRKBuffers,
  type ButcherTableau,
  type ExplicitRKBuffers,
} from "./explicit-rk-kernel.js";
import type { Stepper, StepperInfo, StepResult } from "./types.js";

/**
 * An embedded Runge-Kutta pair (§4.5, eq. 4.8): a base {@link ButcherTableau}
 * whose stages are shared by two weight vectors of adjacent order. `b`
 * (inherited from `ButcherTableau`, the pair's higher order) advances the
 * accepted solution; `bHat` (order `embeddedOrder`, conventionally one
 * lower) estimates the higher-order result's local truncation error via
 * $\boldsymbol\delta_{k+1} = \mathbf y_{k+1} - \hat{\mathbf y}_{k+1} = h
 * \sum_i (b_i - \hat b_i)\, \mathbf k_i = \mathcal O(h^{\hat p + 1})$.
 */
export interface EmbeddedButcherTableau extends ButcherTableau {
  readonly bHat: readonly number[];
  readonly embeddedOrder: number;
}

/** Scratch buffers an {@link EmbeddedRKStepper} preallocates once in `init` (ADR-004). */
export interface EmbeddedRKBuffers extends ExplicitRKBuffers {
  readonly delta: Float64Array;
}

export function createEmbeddedRKBuffers(dim: number, stages: number): EmbeddedRKBuffers {
  return { ...createExplicitRKBuffers(dim, stages), delta: new Float64Array(dim) };
}

/**
 * Runs the same stage evaluations {@link stepExplicitRK} would (an embedded
 * pair's whole point, eq. 4.8, is that the two methods *share* stages
 * rather than duplicating work), then additionally forms $\delta$ into
 * `buffers.delta` and its RMS norm into `out.errorEstimate`. `out.yNext` is
 * always advanced with the pair's higher-order weights `b` ("local
 * extrapolation": the platform propagates the more accurate result and
 * uses the lower-order estimate only for error control -- the standard
 * choice, e.g. MATLAB `ode45`/SciPy's default `RK45`).
 *
 * `out.errorEstimate` here is $\delta$'s raw (unscaled) RMS magnitude --
 * per-component tolerance scaling (eq. 4.9's $sc_i = atol_i + rtol \cdot
 * \max(|y_i|, |\hat y_i|)$) is P2.26's job. The raw magnitude alone is
 * sufficient to demonstrate $\delta \sim \mathcal O(h^{\hat p+1})$ (P2.23's
 * validation criterion).
 */
export function stepEmbeddedRK(
  model: Model,
  ctx: EvalContext,
  tableau: EmbeddedButcherTableau,
  buffers: EmbeddedRKBuffers,
  t: number,
  y: Float64Array,
  h: number,
  out: StepResult,
): void {
  const { k, yStage, delta } = buffers;
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

  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    let increment = 0;
    let deltaIncrement = 0;
    for (let s = 0; s < stages; s++) {
      const ks = k[s]![i]!;
      increment += tableau.b[s]! * ks;
      deltaIncrement += (tableau.b[s]! - tableau.bHat[s]!) * ks;
    }
    out.yNext[i] = y[i]! + h * increment;
    const d = h * deltaIncrement;
    delta[i] = d;
    sumSq += d * d;
  }

  out.accepted = true;
  out.h = h;
  out.errorEstimate = Math.sqrt(sumSq / dim);
  out.nRHS = stages;
}

/**
 * Heun(2)-Euler(1): the smallest genuine embedded pair, sharing
 * {@link HEUN_TABLEAU}'s two stages with Euler's `b=(1,0)` as the embedded
 * lower-order estimate. Not a named production method (P2.24's
 * Dormand-Prince 5(4) and P2.25's Bogacki-Shampine 3(2) are); this exists
 * to exercise {@link stepEmbeddedRK} with the smallest possible tableau.
 */
export const HEUN_EULER_TABLEAU: EmbeddedButcherTableau = {
  c: [0, 1],
  a: [[], [1]],
  b: [0.5, 0.5],
  bHat: [1, 0],
  embeddedOrder: 1,
};

/**
 * A {@link Stepper} for any {@link EmbeddedButcherTableau} (P2.23): the
 * embedded-pair counterpart to {@link ExplicitRKStepper}, letting adaptive
 * methods (P2.24's DOPRI5, P2.25's Bogacki-Shampine) be added as data.
 */
export class EmbeddedRKStepper implements Stepper {
  readonly info: StepperInfo;
  private readonly tableau: EmbeddedButcherTableau;

  private model: Model | undefined;
  private ctx: EvalContext | undefined;
  private buffers: EmbeddedRKBuffers | undefined;

  constructor(info: StepperInfo, tableau: EmbeddedButcherTableau) {
    this.info = info;
    this.tableau = tableau;
  }

  /** @inheritDoc */
  init(model: Model, ctx: EvalContext): void {
    this.model = model;
    this.ctx = ctx;
    this.buffers = createEmbeddedRKBuffers(model.dim, this.tableau.c.length);
  }

  /** @inheritDoc */
  step(t: number, y: Float64Array, h: number, out: StepResult): void {
    const model = this.model;
    const ctx = this.ctx;
    const buffers = this.buffers;
    if (!model || !ctx || !buffers) {
      throw new Error("EmbeddedRKStepper.step called before init()");
    }

    stepEmbeddedRK(model, ctx, this.tableau, buffers, t, y, h, out);
  }
}
