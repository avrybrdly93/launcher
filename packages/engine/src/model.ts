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
  /**
   * Optional analytic J = df/dy, row-major dim*dim. Takes `ctx` for the same
   * reason `rhs` does: mass/environment live there, not in the Model itself
   * (§3.7). Present only when every force in the composed model supplies one
   * (P1.22); models that can't provide an exact analytic Jacobian (e.g. with
   * Magnus enabled) omit this and callers fall back to finite differences
   * (P1.23).
   */
  jacobian?(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void;
  /** Index sets (q, p) for symplectic/Verlet steppers requiring second-order mechanical structure. */
  readonly partitions?: { readonly q: readonly number[]; readonly p: readonly number[] };
}
