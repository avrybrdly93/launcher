import type { ChannelMeta } from "./schema.js";
import type { EvalContext } from "./eval-context.js";

/** A quantity g(t,y) whose root marks an event of interest (ground impact, apex, ...). */
export interface EventSpec {
  readonly name: string;
  g(t: number, y: Float64Array): number;
}

/** A conserved or monotone quantity of the model, used as a runtime correctness check (§3.8). */
export interface InvariantSpec {
  readonly name: string;
  evaluate(t: number, y: Float64Array, ctx: EvalContext): number;
}

/**
 * The abstract right-hand-side model SolverKit integrates (§3.7). The
 * projectile is the first registered Model, not a special case: SolverKit
 * never imports anything projectile-specific, only this interface.
 */
export interface Model {
  readonly dim: number;
  readonly channels: readonly ChannelMeta[];
  rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void;
  readonly invariants?: readonly InvariantSpec[];
  readonly events?: readonly EventSpec[];
  /** Optional analytic J = df/dy, row-major dim*dim; needs ctx (env/params) same as rhs. */
  jacobian?(t: number, y: Float64Array, ctx: EvalContext, out: Float64Array): void;
  /** Index sets (q, p) for symplectic/Verlet steppers requiring second-order mechanical structure. */
  readonly partitions?: { readonly q: readonly number[]; readonly p: readonly number[] };
}
