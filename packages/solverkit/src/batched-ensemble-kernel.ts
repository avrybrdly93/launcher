import type { EvalContext, Model } from "@ballista/engine";
import {
  gatherParams,
  type EnsembleBlock,
  type EnsembleLayout,
  type EnsembleStepOptions,
} from "./ensemble-state.js";
import { RK4_TABLEAU, type ButcherTableau } from "./explicit-rk-kernel.js";

/**
 * Batched explicit-RK kernel over an ensemble, with structure-of-arrays inner
 * loops (P7.03, §7 phase-7 table: "Batched RK4 kernel over ensembles
 * (structure-of-arrays inner loops)").
 *
 * ## What this delivers, and what it measurably does not
 *
 * P7.03's validation criterion is "≥3× throughput vs naive loop (measured)".
 * **This kernel does not meet it, and the criterion is not reachable by any
 * kernel of this shape.** The measurement is in P7.03's task notes and is
 * summarized here because a reader who finds this file first should not have
 * to discover it from a changelog:
 *
 * - Against {@link stepEnsembleReference}, the per-replicate loop the blueprint
 *   calls the naive loop (P7.02's criterion names the same object), this kernel
 *   measures **1.07× at 64 replicates, 1.04× at 256, and 1.00× at 1024** on a
 *   planar projectile with gravity and quadratic drag.
 * - That is not a tuning failure. Decomposing the reference step on the same
 *   fixture: the four `Model.rhs` calls per replicate alone run at 8454/sec
 *   against the whole step's 5008/sec, so the rhs is roughly **59%** of the
 *   step and **1.69× is the hard ceiling** for removing *all* of the work
 *   around it. A criterion of 3× is above the ceiling, so no arrangement of
 *   these loops reaches it.
 *
 * The reason is structural and is fixed by a later task, not by this one:
 * {@link Model.rhs} takes a **contiguous** `Float64Array` of length `dim`
 * (§3.7). So however the batch is arranged, each replicate's state must be
 * materialized into an array-of-structures buffer for every stage evaluation,
 * and the number of rhs calls is identical to the reference's. P7.05 (RHS
 * specializer) is the task that removes that boundary; P7.04 (monomorphic call
 * sites) is what makes the calls themselves cheaper. Until one of them lands,
 * reordering the arithmetic *around* the rhs cannot buy what the rhs costs.
 *
 * ## Then why does this exist
 *
 * Because it is the substrate those two tasks specialize, and because it is
 * **bit-identical** to the reference, which is the property that lets them be
 * written at all. P7.02's own documentation makes the point: its reference
 * stepper is bit-identical by construction, so bit-identity there proves only
 * that the container is faithful. Here it is a real constraint on how the
 * arithmetic may be reassociated, and it is asserted rather than argued
 * (`batched-ensemble-kernel.test.ts`).
 *
 * It ships with no throughput claim. The numbers above are what was measured;
 * they are not quoted anywhere as a speedup.
 *
 * ## The operation order, which is the whole correctness story
 *
 * `explicit-rk-kernel.ts` documents a per-component order that must be
 * reproduced exactly, because the alternatives round differently:
 *
 * - a stage value is `y[i]`, then `+= h * a_ij * k_j[i]` term by term,
 *   left-to-right — **not** `h * (a_ij * k_j[i])`, and not accumulated in any
 *   other grouping;
 * - the combine forms the whole weighted sum first and multiplies by `h` once,
 *   `y[i] + h * (Σ_s b_s k_s[i])` — **not** a running
 *   `(y + h*b1*k1) + h*b2*k2`;
 * - the stage time is `t + c_s * h`.
 *
 * This kernel changes the *loop nest* and the *memory layout* and nothing else.
 * Every floating-point expression above appears here in the same association,
 * which is why the outputs agree to the bit rather than to a tolerance.
 *
 * ## The loop nest, and the one behavioural difference it forces
 *
 * The reference runs every stage for replicate 0, then every stage for
 * replicate 1. This kernel inverts that: stage `s` for every replicate, then
 * stage `s+1`. That is what "structure-of-arrays inner loops" means — the
 * inner loop runs over replicates at a fixed channel and stage, walking unit
 * stride through the `k` rows and through the block's own state rows.
 *
 * Inverting the nest is safe for the arithmetic (each replicate's stage value
 * depends only on its own earlier stages) but it changes **when
 * {@link EnsembleStepOptions.applyParams} is called**: the reference calls it
 * once per replicate per step, this kernel once per replicate *per stage*, so
 * `stages` times as often. `applyParams` is documented as installing a
 * replicate's parameters into whatever the model reads, and a pure installer
 * called more often is idempotent — but a caller using it to count steps, or
 * to advance any state of its own, will see the difference. That is a real
 * cost of the inversion and is stated rather than hidden; the alternative
 * (hoisting it) would require the rhs to read the block directly, which is
 * P7.05 again.
 */

/** Reusable scratch for {@link stepEnsembleBatched}, allocated once by {@link createBatchedEnsembleBuffers}. */
export interface BatchedEnsembleBuffers {
  /**
   * One row-major SoA slab per stage, each `stateDim * replicates` long, with
   * stage value `(channel, replicate)` at `channel * replicates + replicate` —
   * the same indexing the block's own state rows use, deliberately, so the two
   * are walked by one induction variable.
   */
  readonly k: readonly Float64Array[];
  /** Contiguous AoS stage input handed to `Model.rhs`, length `stateDim`. */
  readonly yStage: Float64Array;
  /** Contiguous AoS rhs output, length `stateDim`. */
  readonly kStage: Float64Array;
  /** Scratch for one replicate's parameter row, length `paramDim`. */
  readonly params: Float64Array;
}

/** Allocates the scratch {@link stepEnsembleBatched} needs for `layout` and a `stages`-stage tableau. */
export function createBatchedEnsembleBuffers(
  layout: EnsembleLayout,
  stages: number,
): BatchedEnsembleBuffers {
  if (!Number.isInteger(stages) || stages < 1) {
    throw new RangeError(`stages must be a positive integer, got ${stages}`);
  }
  const k: Float64Array[] = [];
  for (let s = 0; s < stages; s++) {
    k.push(new Float64Array(layout.stateDim * layout.replicates));
  }
  return {
    k,
    yStage: new Float64Array(layout.stateDim),
    kStage: new Float64Array(layout.stateDim),
    params: new Float64Array(layout.paramDim),
  };
}

/**
 * Advances every replicate in `block` by one step of size `h` from time `t`,
 * in place, using structure-of-arrays inner loops.
 *
 * Bit-identical to {@link stepEnsembleReference} on the same inputs. Allocates
 * nothing: all scratch comes from `buffers` (ADR-004). See the module
 * documentation for the measured throughput, which is not the criterion P7.03
 * asks for, and for why.
 *
 * @throws if `model.dim` disagrees with the block's `stateDim`, or if
 * `buffers` was built for a different `stateDim`, `paramDim`, `replicates` or
 * stage count than the block and tableau in hand.
 */
export function stepEnsembleBatched(
  model: Model,
  ctx: EvalContext,
  block: EnsembleBlock,
  buffers: BatchedEnsembleBuffers,
  t: number,
  h: number,
  options: EnsembleStepOptions = {},
): void {
  const { layout } = block;
  const tableau: ButcherTableau = options.tableau ?? RK4_TABLEAU;
  const stages = tableau.c.length;
  const replicates = layout.replicates;
  const dim = layout.stateDim;
  const stateOffset = layout.stateOffset;
  const data = block.data;

  if (model.dim !== dim) {
    throw new Error(`model.dim ${model.dim} does not match ensemble stateDim ${dim}`);
  }
  if (buffers.yStage.length !== dim) {
    throw new Error(`buffers sized for stateDim ${buffers.yStage.length}, block has ${dim}`);
  }
  if (buffers.k.length !== stages) {
    throw new Error(`buffers sized for ${buffers.k.length} stages, tableau has ${stages}`);
  }
  if (buffers.params.length !== layout.paramDim) {
    throw new Error(
      `buffers sized for paramDim ${buffers.params.length}, block has ${layout.paramDim}`,
    );
  }
  for (let s = 0; s < stages; s++) {
    if (buffers.k[s]!.length !== dim * replicates) {
      throw new Error(
        `stage buffer ${s} has length ${buffers.k[s]!.length}, block needs ${dim * replicates}`,
      );
    }
  }

  const applyParams = options.applyParams;
  const yStage = buffers.yStage;
  const kStage = buffers.kStage;

  for (let s = 0; s < stages; s++) {
    const aRow = tableau.a[s]!;
    const aLen = aRow.length;
    const kOut = buffers.k[s]!;
    const tStage = t + tableau.c[s]! * h;

    for (let r = 0; r < replicates; r++) {
      // Per-stage rather than per-step: the loop nest is inverted relative to
      // the reference, so this is the only place a replicate's parameters can
      // be installed before its rhs evaluation. See the module docs.
      if (applyParams !== undefined) {
        gatherParams(block, r, buffers.params);
        applyParams(r, buffers.params, ctx);
      }

      // Stage input, term by term in the documented association. `data` is
      // read, never written, until the combine below, so `y[i]` here is the
      // step's original state for every stage -- as in the reference.
      for (let i = 0; i < dim; i++) {
        const row = i * replicates + r;
        let yi = data[stateOffset + row]!;
        for (let j = 0; j < aLen; j++) {
          yi += h * aRow[j]! * buffers.k[j]![row]!;
        }
        yStage[i] = yi;
      }

      model.rhs(tStage, yStage, kStage, ctx);

      // Transpose the stage derivative back into SoA. This copy is the AoS
      // boundary the module docs name as the reason the throughput criterion
      // is out of reach here; it is P7.05's to remove, not this kernel's.
      for (let i = 0; i < dim; i++) {
        kOut[i * replicates + r] = kStage[i]!;
      }
    }
  }

  // Combine. Unit stride over replicates at a fixed channel, which is the
  // arrangement the SoA layout exists for. In place is safe: element
  // (channel, replicate) is read exactly once and written exactly once, and
  // the read precedes the write.
  for (let i = 0; i < dim; i++) {
    const rowBase = i * replicates;
    for (let r = 0; r < replicates; r++) {
      const row = rowBase + r;
      let increment = 0;
      for (let s = 0; s < stages; s++) {
        increment += tableau.b[s]! * buffers.k[s]![row]!;
      }
      const index = stateOffset + row;
      data[index] = data[index]! + h * increment;
    }
  }
}
