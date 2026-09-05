import type { EvalContext, Model } from "@ballista/engine";
import {
  createExplicitRKBuffers,
  stepExplicitRK,
  RK4_TABLEAU,
  type ButcherTableau,
  type ExplicitRKBuffers,
} from "./explicit-rk-kernel.js";
import { createStepResult, type StepResult } from "./types.js";

/**
 * Structure-of-arrays ensemble state layout (P7.02, §7 phase-7 table:
 * "SoA ensemble state layout: `Float64Array` blocks [param | state] per
 * replicate batch", validation "batch RK4 produces bit-identical results to
 * per-replicate loop").
 *
 * ## What this is and what it is not
 *
 * This module owns the **container**, not the fast kernel. P7.03 is the
 * batched RK4 kernel with structure-of-arrays inner loops; P7.04 and P7.05
 * are the monomorphism and RHS-specialization passes that make such a kernel
 * worth writing. Phase 7 is a performance phase, and the blueprint's own
 * ordering puts the layout first because **every one of those later tasks is
 * a rewrite of arithmetic that must not change a single bit of the answer.**
 * A rewrite like that needs a reference to be measured against before it is
 * written, not after.
 *
 * So what ships here is the layout, the exact gather/scatter that moves a
 * replicate between it and the array-of-structures buffers `Model.rhs` reads,
 * and {@link stepEnsembleReference} -- a batch stepper that drives the layout
 * through the *existing*, already-validated {@link stepExplicitRK} once per
 * replicate. That function is deliberately **not** optimized and makes **no
 * performance claim whatsoever**: no benchmark was run for this task and none
 * is quoted. Its value is that it is the oracle P7.03's kernel has to match
 * bit-for-bit, and it establishes the property P7.03 will otherwise have to
 * establish and debug at the same time -- that the *layout* is a faithful
 * container, so any discrepancy P7.03 finds is in P7.03's arithmetic.
 *
 * ## The layout
 *
 * One `Float64Array` per batch, holding two blocks in this order:
 *
 * ```text
 *   [ param block                     | state block                     ]
 *   [ p0r0 p0r1 ... p0rN p1r0 ... ]   [ y0r0 y0r1 ... y0rN y1r0 ... ]
 *     <-- one row per parameter -->     <-- one row per channel -->
 * ```
 *
 * Within each block a *row* is one quantity across every replicate, so
 * element `(i, r)` lives at `row * replicates + r`. This is the transpose of
 * the obvious arrangement, and the transpose is the entire point: the inner
 * loop of a batched step runs over replicates at a fixed channel, and in this
 * layout that loop walks **unit stride** through memory. Storing each
 * replicate's state contiguously instead (the array-of-structures
 * arrangement, which is what `Model.rhs` requires) would make that same loop
 * stride by `stateDim`.
 *
 * ## Why params sit in the same buffer, and why they come first
 *
 * A Monte Carlo replicate is a *drawn parameter vector* plus the trajectory
 * it produces (`runtime/mc-job.ts`), so a batch that carries state without
 * the parameters that generated it is only half a batch -- the caller ends up
 * holding a second array and keeping two indexings in step by hand. Keeping
 * both in one allocation also means one buffer to transfer to a worker
 * (`runtime/worker-pool.ts` moves `Float64Array`s), not two.
 *
 * They come **first** because the state block is the half that is written
 * every step while the parameter block is written once per batch and then
 * only read. Putting the mutable half at the end means {@link stateBlock}
 * hands out a subarray that runs to the end of the buffer, and a length
 * mistake in a kernel writing past its channel walks off the end of the
 * allocation -- where a `Float64Array` bounds-check catches it -- instead of
 * silently corrupting a parameter that some later replicate then integrates
 * with. The ordering is in the task title; this is why it is the right way
 * round.
 *
 * ## Parameters are opaque numbers here
 *
 * SolverKit never imports anything projectile-specific (§3.7), and
 * `ProjectileParams` is not a vector of numbers anyway -- it carries
 * function-valued fields like `dragCoefficient`. So this module stores
 * `paramDim` anonymous scalars per replicate and knows nothing about what
 * they mean. Installing replicate `r`'s parameters into an
 * {@link EvalContext} before its rhs evaluation is the caller's job, via
 * {@link EnsembleStepOptions.applyParams}. A batch with `paramDim: 0` is
 * legal and is what a study that varies only initial conditions wants.
 */

/** Shape of an {@link EnsembleBlock}: how many replicates, and the two block sizes. */
export interface EnsembleLayout {
  /** Number of replicates in the batch. Must be >= 1. */
  readonly replicates: number;
  /** Scalar parameters carried per replicate. May be 0. */
  readonly paramDim: number;
  /** State channels per replicate; equals the `Model.dim` being integrated. Must be >= 1. */
  readonly stateDim: number;
  /** Index of the first parameter element. Always 0 -- named so callers never hardcode it. */
  readonly paramOffset: number;
  /** Index of the first state element, i.e. `paramDim * replicates`. */
  readonly stateOffset: number;
  /** Total elements, i.e. `(paramDim + stateDim) * replicates`. */
  readonly length: number;
}

/** A batch: one {@link EnsembleLayout} and the single `Float64Array` holding both blocks. */
export interface EnsembleBlock {
  readonly layout: EnsembleLayout;
  readonly data: Float64Array;
}

/**
 * Computes the offsets for a batch of `replicates` replicates, each carrying
 * `paramDim` scalar parameters and `stateDim` state channels.
 *
 * @throws if any argument is not a non-negative integer, if `replicates` or
 * `stateDim` is 0, or if the resulting length would exceed what a
 * `Float64Array` can address. A zero-replicate or zero-channel batch is
 * rejected rather than quietly allocating an empty buffer, because both are
 * far more likely to be an arithmetic slip in the caller than a real request,
 * and an empty batch makes every downstream loop silently do nothing.
 */
export function createEnsembleLayout(
  replicates: number,
  paramDim: number,
  stateDim: number,
): EnsembleLayout {
  requirePositiveInteger(replicates, "replicates");
  requireNonNegativeInteger(paramDim, "paramDim");
  requirePositiveInteger(stateDim, "stateDim");

  const length = (paramDim + stateDim) * replicates;
  if (!Number.isSafeInteger(length)) {
    throw new RangeError(
      `ensemble layout of ${replicates} replicates x (${paramDim} params + ${stateDim} channels) ` +
        `is not addressable`,
    );
  }

  return {
    replicates,
    paramDim,
    stateDim,
    paramOffset: 0,
    stateOffset: paramDim * replicates,
    length,
  };
}

/** Allocates a zeroed {@link EnsembleBlock} for `layout`. */
export function createEnsembleBlock(layout: EnsembleLayout): EnsembleBlock {
  return { layout, data: new Float64Array(layout.length) };
}

/**
 * Index of parameter `param` for replicate `replicate`.
 *
 * Bounds are **not** checked: this is called from the innermost loop of every
 * kernel built on the layout, and the two arguments it would check are loop
 * counters, not user input. Callers taking indices from outside should
 * validate them; {@link gatherParams} and {@link scatterParams} do.
 */
export function paramIndex(layout: EnsembleLayout, param: number, replicate: number): number {
  return layout.paramOffset + param * layout.replicates + replicate;
}

/** Index of state channel `channel` for replicate `replicate`. Unchecked, as {@link paramIndex}. */
export function stateIndex(layout: EnsembleLayout, channel: number, replicate: number): number {
  return layout.stateOffset + channel * layout.replicates + replicate;
}

/**
 * The state half of `block.data` as a subarray -- a view, not a copy, so
 * writes through it land in the block. Row `c` of the view spans
 * `[c * replicates, (c + 1) * replicates)`.
 */
export function stateBlock(block: EnsembleBlock): Float64Array {
  return block.data.subarray(block.layout.stateOffset, block.layout.length);
}

/** The parameter half of `block.data` as a view. Empty when `paramDim` is 0. */
export function paramBlock(block: EnsembleBlock): Float64Array {
  return block.data.subarray(block.layout.paramOffset, block.layout.stateOffset);
}

/**
 * Copies replicate `replicate`'s state out of the SoA block into the
 * contiguous `out` buffer that `Model.rhs` reads (§3.7 takes a plain
 * `Float64Array` of length `dim`).
 *
 * This is the transpose that makes the layout usable at all: SoA is the right
 * shape for the batch loop and the wrong shape for a model evaluation, and
 * exactly one of the two has to give. Until P7.05 specializes the rhs to read
 * the block directly, it is this copy.
 */
export function gatherState(block: EnsembleBlock, replicate: number, out: Float64Array): void {
  const { layout } = block;
  requireReplicate(layout, replicate);
  requireLength(out, layout.stateDim, "out");
  for (let c = 0; c < layout.stateDim; c++) {
    out[c] = block.data[stateIndex(layout, c, replicate)]!;
  }
}

/** The inverse of {@link gatherState}: writes contiguous `y` into replicate `replicate`'s column. */
export function scatterState(block: EnsembleBlock, replicate: number, y: Float64Array): void {
  const { layout } = block;
  requireReplicate(layout, replicate);
  requireLength(y, layout.stateDim, "y");
  for (let c = 0; c < layout.stateDim; c++) {
    block.data[stateIndex(layout, c, replicate)] = y[c]!;
  }
}

/** Copies replicate `replicate`'s parameters into contiguous `out` (length `paramDim`). */
export function gatherParams(block: EnsembleBlock, replicate: number, out: Float64Array): void {
  const { layout } = block;
  requireReplicate(layout, replicate);
  requireLength(out, layout.paramDim, "out");
  for (let p = 0; p < layout.paramDim; p++) {
    out[p] = block.data[paramIndex(layout, p, replicate)]!;
  }
}

/** The inverse of {@link gatherParams}. */
export function scatterParams(block: EnsembleBlock, replicate: number, params: Float64Array): void {
  const { layout } = block;
  requireReplicate(layout, replicate);
  requireLength(params, layout.paramDim, "params");
  for (let p = 0; p < layout.paramDim; p++) {
    block.data[paramIndex(layout, p, replicate)] = params[p]!;
  }
}

/** Per-replicate hooks for {@link stepEnsembleReference}. */
export interface EnsembleStepOptions {
  /**
   * Called with replicate `r`'s parameter row immediately before its rhs
   * evaluations, so a caller can install those numbers into whatever the
   * model reads. The buffer is reused between replicates and is only valid
   * for the duration of the call.
   *
   * Omit when `paramDim` is 0, or when every replicate shares one context.
   */
  applyParams?(replicate: number, params: Float64Array, ctx: EvalContext): void;
  /** Tableau to step with; {@link RK4_TABLEAU} when omitted. */
  tableau?: ButcherTableau;
}

/** Reusable scratch for {@link stepEnsembleReference}, allocated once by {@link createEnsembleStepBuffers}. */
export interface EnsembleStepBuffers {
  readonly rk: ExplicitRKBuffers;
  readonly y: Float64Array;
  readonly params: Float64Array;
  readonly result: StepResult;
}

/** Allocates the scratch {@link stepEnsembleReference} needs for `layout` and a `stages`-stage tableau. */
export function createEnsembleStepBuffers(
  layout: EnsembleLayout,
  stages: number,
): EnsembleStepBuffers {
  return {
    rk: createExplicitRKBuffers(layout.stateDim, stages),
    y: new Float64Array(layout.stateDim),
    params: new Float64Array(layout.paramDim),
    result: createStepResult(layout.stateDim),
  };
}

/**
 * Advances every replicate in `block` by one step of size `h` from time `t`,
 * in place.
 *
 * **This is the correctness oracle for P7.03, not a fast path.** It gathers
 * each replicate out of the SoA block, hands the contiguous copy to the
 * existing {@link stepExplicitRK}, and scatters the result back. Every
 * floating-point operation is therefore performed by the same already-tested
 * kernel, in the same order, on bit-identical inputs -- which is what makes
 * the result bit-identical to a plain per-replicate loop, and is exactly the
 * property P7.02's validation criterion asks for. It is bit-identity by
 * *construction*: the copies are exact, so there is nothing left for it to
 * turn on. The tests assert it anyway, because a structural argument that is
 * never checked is a comment.
 *
 * P7.03 replaces the body with true SoA inner loops and inherits the same
 * criterion -- at which point bit-identity stops being structural and starts
 * being a real constraint on how the arithmetic is reassociated. Having this
 * function already green means a failure there is unambiguously in the new
 * arithmetic and not in the container.
 *
 * Allocates nothing: all scratch comes from `buffers` (ADR-004).
 *
 * @throws if `buffers` was built for a different `stateDim` or a tableau with
 * a different stage count than `options.tableau`.
 */
export function stepEnsembleReference(
  model: Model,
  ctx: EvalContext,
  block: EnsembleBlock,
  buffers: EnsembleStepBuffers,
  t: number,
  h: number,
  options: EnsembleStepOptions = {},
): void {
  const { layout } = block;
  const tableau = options.tableau ?? RK4_TABLEAU;

  if (model.dim !== layout.stateDim) {
    throw new Error(`model.dim ${model.dim} does not match ensemble stateDim ${layout.stateDim}`);
  }
  if (buffers.y.length !== layout.stateDim) {
    throw new Error(`buffers sized for stateDim ${buffers.y.length}, block has ${layout.stateDim}`);
  }
  if (buffers.rk.k.length !== tableau.c.length) {
    throw new Error(
      `buffers sized for ${buffers.rk.k.length} stages, tableau has ${tableau.c.length}`,
    );
  }
  if (buffers.params.length !== layout.paramDim) {
    throw new Error(
      `buffers sized for paramDim ${buffers.params.length}, block has ${layout.paramDim}`,
    );
  }

  const applyParams = options.applyParams;
  for (let r = 0; r < layout.replicates; r++) {
    if (applyParams !== undefined) {
      gatherParams(block, r, buffers.params);
      applyParams(r, buffers.params, ctx);
    }
    gatherState(block, r, buffers.y);
    stepExplicitRK(model, ctx, tableau, buffers.rk, t, buffers.y, h, buffers.result);
    scatterState(block, r, buffers.result.yNext);
  }
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

function requireReplicate(layout: EnsembleLayout, replicate: number): void {
  if (!Number.isInteger(replicate) || replicate < 0 || replicate >= layout.replicates) {
    throw new RangeError(`replicate ${replicate} out of range for a batch of ${layout.replicates}`);
  }
}

function requireLength(buffer: Float64Array, expected: number, name: string): void {
  if (buffer.length !== expected) {
    throw new RangeError(`${name} must have length ${expected}, got ${buffer.length}`);
  }
}
