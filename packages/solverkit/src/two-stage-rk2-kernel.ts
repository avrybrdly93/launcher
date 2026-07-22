import type { EvalContext, Model } from "@ballista/engine";
import type { StepResult } from "./types.js";

/**
 * The general explicit 2-stage RK tableau (§4.3, eq. 4.4): $c_2 = a_{21}$ is
 * forced by the order-2 conditions (eq. 4.5), leaving a one-parameter
 * family. Midpoint ($c_2=a_{21}=\tfrac12$, $b=(0,1)$) and Heun
 * ($c_2=a_{21}=1$, $b=(\tfrac12,\tfrac12)$) are its two named members
 * (P2.10/P2.11) -- same order-2 slope, different LTE constant.
 */
export interface TwoStageTableau {
  readonly c2: number;
  readonly a21: number;
  readonly b1: number;
  readonly b2: number;
}

/** Scratch buffers a {@link TwoStageTableau} stepper preallocates once in `init` (ADR-004). */
export interface TwoStageRK2Buffers {
  readonly k1: Float64Array;
  readonly k2: Float64Array;
  readonly yStage: Float64Array;
}

/** Allocates a {@link TwoStageRK2Buffers} sized for a model of dimension `dim`. */
export function createTwoStageRK2Buffers(dim: number): TwoStageRK2Buffers {
  return { k1: new Float64Array(dim), k2: new Float64Array(dim), yStage: new Float64Array(dim) };
}

/**
 * The shared 2-stage kernel every explicit 2-stage RK stepper (P2.10's
 * midpoint, P2.11's Heun, ...) delegates its `step()` to, parameterized only
 * by {@link TwoStageTableau}: $k_1 = f(t,y)$, $k_2 = f(t+c_2h,\ y+h a_{21}
 * k_1)$, $y_{k+1} = y + h(b_1 k_1 + b_2 k_2)$. Allocates nothing -- writes
 * only into the caller-owned `buffers` and `out`.
 */
export function stepTwoStageRK2(
  model: Model,
  ctx: EvalContext,
  tableau: TwoStageTableau,
  buffers: TwoStageRK2Buffers,
  t: number,
  y: Float64Array,
  h: number,
  out: StepResult,
): void {
  const { k1, k2, yStage } = buffers;

  model.rhs(t, y, k1, ctx);
  for (let i = 0; i < y.length; i++) {
    yStage[i] = y[i]! + h * tableau.a21 * k1[i]!;
  }
  model.rhs(t + tableau.c2 * h, yStage, k2, ctx);
  for (let i = 0; i < y.length; i++) {
    out.yNext[i] = y[i]! + h * (tableau.b1 * k1[i]! + tableau.b2 * k2[i]!);
  }
  out.accepted = true;
  out.h = h;
  out.errorEstimate = 0;
  out.nRHS = 2;
}
