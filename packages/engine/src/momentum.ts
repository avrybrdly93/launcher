import type { EvalContext } from "./eval-context.js";
import type { InvariantSpec } from "./model.js";

const VX = 2;

/** Horizontal momentum p_x = m*vx -- a teaching-case invariant when no horizontal force acts. */
export function momentumX(y: Float64Array, ctx: EvalContext): number {
  return ctx.params.mass * y[VX]!;
}

/** Builds the `InvariantSpec` exposing horizontal momentum as a Model channel. */
export function createMomentumXInvariant(): InvariantSpec {
  return {
    name: "momentum-x",
    evaluate(_t: number, y: Float64Array, ctx: EvalContext): number {
      return momentumX(y, ctx);
    },
  };
}
