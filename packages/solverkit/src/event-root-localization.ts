import type { EventSpec } from "@ballista/engine";
import { brentRoot } from "./brent-root-finder.js";
import type { EventCandidate } from "./event-detection.js";

/**
 * §4.9's event-time tolerance factor: `1e2 * eps_mach * t`, floored against
 * `|t|` growing arbitrarily small (an event at t≈0 would otherwise force a
 * near-zero absolute tolerance) by scaling against `max(|t|, 1)` instead of
 * `|t|` alone.
 */
const EVENT_TIME_TOL_FACTOR = 1e2;

/** A precisely-localized event crossing (§4.9 step 2), refined from an {@link EventCandidate} bracket. */
export interface EventRoot {
  readonly event: EventSpec;
  /** The localized event time. */
  readonly t: number;
  /** `(t - t0) / (t1 - t0)`, in `[0, 1]`, for indexing back into the step. */
  readonly theta: number;
  /** State at `t`, sampled from the dense-output interpolant (a copy, not a view). */
  readonly y: Float64Array;
  /** `event.g(t, y)`, ideally ~0. */
  readonly g: number;
  readonly iterations: number;
  readonly converged: boolean;
}

/**
 * Refines one `scanStepForEvents` bracket (P2.32) to a precise root via
 * Brent's method (§4.9 step 2), evaluating `g` directly against the step's
 * dense output rather than re-integrating. Endpoints reuse the step's own
 * `y0`/`y1` and the candidate's already-computed `gLo`/`gHi` exactly like
 * `scanStepForEvents` does, so the search never has to trust the
 * interpolant to reproduce the step's true endpoints, and never calls it
 * at `theta=0` or `theta=1`. `scratch` is a caller-owned dim-sized buffer
 * reused across Brent's iterations (ADR-004); the returned `y` is always a
 * fresh copy so it stays valid after `scratch` is overwritten by later
 * calls.
 */
export function localizeEventRoot(
  candidate: EventCandidate,
  t0: number,
  t1: number,
  y0: Float64Array,
  y1: Float64Array,
  interpolant: (theta: number, out: Float64Array) => void,
  scratch: Float64Array,
): EventRoot {
  const h = t1 - t0;
  const { event, thetaLo, thetaHi, gLo, gHi } = candidate;
  const ta = t0 + thetaLo * h;
  const tb = t0 + thetaHi * h;

  const g = (t: number): number => {
    if (t === t0) return event.g(t0, y0);
    if (t === t1) return event.g(t1, y1);
    interpolant((t - t0) / h, scratch);
    return event.g(t, scratch);
  };

  const tol = (t: number): number =>
    EVENT_TIME_TOL_FACTOR * Number.EPSILON * Math.max(Math.abs(t), 1);

  const result = brentRoot(g, ta, tb, gLo, gHi, tol);

  const theta = (result.x - t0) / h;
  let y: Float64Array;
  if (result.x === t0) {
    y = Float64Array.from(y0);
  } else if (result.x === t1) {
    y = Float64Array.from(y1);
  } else {
    interpolant(theta, scratch);
    y = Float64Array.from(scratch);
  }

  return {
    event,
    t: result.x,
    theta,
    y,
    g: result.fx,
    iterations: result.iterations,
    converged: result.converged,
  };
}
