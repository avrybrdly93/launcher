/**
 * Integrating driver for {@link PlanarObservableReducer} (P7.16).
 *
 * ## Why this is a separate module from the reducer
 *
 * The reducer must be loadable under plain Node straight out of `dist/`, because
 * `scripts/gpu-observables-fixture.mjs` imports it that way to compute the CPU
 * side of the device comparison. A runtime `import ... from "@ballista/solverkit"`
 * would defeat that: it survives compilation as a bare specifier, and Node
 * resolves it to the workspace package whose `main` is a `.ts` file it cannot
 * load. Every fixture in `scripts/` lives under the same constraint, which is why
 * they all import deep `dist/` paths.
 *
 * So the reducer carries type-only imports and this module -- which genuinely
 * needs `integratePlanarRk4` at runtime, and which the fixture does not use --
 * holds the one value import. The fixture drives the reducer over its own march
 * instead, through the same `integratePlanarRk4` imported from solverkit's own
 * `dist/`.
 */

import { DIM, integratePlanarRk4, type PlanarDragParams, type RoundFn } from "@ballista/solverkit";

import { PlanarObservableReducer, type PlanarObservables } from "./planar-observables-reduction.js";

/** Options for {@link reducePlanarObservables}. */
export interface PlanarObservablesOptions {
  /** Initial state `[x, y, vx, vy]`. */
  readonly y0: ArrayLike<number>;
  /** Fixed step size. */
  readonly h: number;
  /** Number of steps to take. */
  readonly steps: number;
  /** Model parameters. */
  readonly params: PlanarDragParams;
  /** Working precision: `toF32` for the shader comparison, `identity` for f64. */
  readonly round: RoundFn;
  /** Start time; defaults to 0. */
  readonly t0?: number;
}

/**
 * Integrates one flight with {@link integratePlanarRk4} and reduces it.
 *
 * Driven through that function's `onStep` hook rather than re-implementing the
 * march, so the trajectory this reduces is by construction the same one P7.14
 * compared against the device -- the reduction is the only new thing in the
 * comparison.
 */
export function reducePlanarObservables(options: PlanarObservablesOptions): PlanarObservables {
  const { round } = options;
  const t0 = round(options.t0 ?? 0);
  const y0 = new Float64Array(DIM);
  for (let i = 0; i < DIM; i++) y0[i] = round(options.y0[i]!);

  const reducer = new PlanarObservableReducer(y0, t0, round);
  integratePlanarRk4({
    y0,
    h: options.h,
    steps: options.steps,
    params: options.params,
    round,
    t0,
    onStep: (_step, t, y) => reducer.step(t, y),
  });
  return reducer.finish();
}
