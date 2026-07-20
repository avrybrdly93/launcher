import type { EventSpec } from "@ballista/engine";

/**
 * Interior dense-output sample points (§4.9's "3 interior points") added
 * between a step's two endpoints for the grazing guard: a $g_j(t,\mathbf y)$
 * that dips through zero and back within a step can leave both endpoints
 * the same sign, invisible to the naive $g_j(t_k)\,g_j(t_{k+1}) < 0$ check.
 * Sampling here too turns that dip into an ordinary sign change between two
 * *adjacent* samples, at the cost of 3 extra `interpolant` + `g` calls per
 * event per step. Not a completeness guarantee (a dip narrower than the
 * quarter-step spacing can still slip through all 5 samples) -- "adequate"
 * per the blueprint, not exhaustive root isolation.
 */
const INTERIOR_THETAS: readonly number[] = [0.25, 0.5, 0.75];

/**
 * A candidate zero-crossing of one event's $g_j$ found within a step,
 * bracketed to a sub-interval of $\theta \in [0,1]$ narrower than the full
 * step: `thetaLo`/`thetaHi` and their already-computed `gLo`/`gHi` are handed
 * to P2.33's Brent localization so it never has to re-evaluate `g` at the
 * bracket endpoints. Multiple candidates for the same event within one step
 * are possible (e.g. a grazing dip produces two: one falling into it, one
 * rising back out) -- P2.35 orders and re-scans across events, not this
 * module's concern.
 */
export interface EventCandidate {
  readonly event: EventSpec;
  readonly thetaLo: number;
  readonly thetaHi: number;
  readonly gLo: number;
  readonly gHi: number;
}

/**
 * True iff `gLo` and `gHi` bracket a zero crossing (differ in sign, or
 * either is exactly zero) whose direction matches `direction` ("any" or
 * `undefined` matches either). A crossing with both samples at exactly zero
 * is degenerate ($g$ identically zero across the sub-interval, no motion to
 * localize) and is not reported.
 */
function crossesInDirection(gLo: number, gHi: number, direction: EventSpec["direction"]): boolean {
  const sameSign = (gLo > 0 && gHi > 0) || (gLo < 0 && gHi < 0);
  if (sameSign) return false;
  if (gLo === 0 && gHi === 0) return false;
  const rising = gHi > gLo;
  if (direction === "rising") return rising;
  if (direction === "falling") return !rising;
  return true;
}

/**
 * Event framework core (§4.9 step 1): scans every declared event $g_j$
 * across one accepted step $(t_k, \mathbf y_k) \to (t_{k+1}, \mathbf
 * y_{k+1})$ for candidate zero-crossings, combining the naive endpoint sign
 * check with the 3-interior-point grazing guard above so a dip-and-return
 * that leaves both endpoints the same sign is still caught as a sign change
 * between two of the 5 total samples. `interpolant` is the last accepted
 * step's dense-output evaluator (any {@link Stepper} that implements one,
 * e.g. {@link HermiteDenseOutputStepper} or DOPRI5's own); the two endpoint
 * samples reuse the step's own `y0`/`y1` directly rather than querying the
 * interpolant at $\theta=0,1$, since a caller shouldn't have to trust the
 * interpolant to reproduce its own endpoints exactly. `scratch` is a
 * caller-owned buffer sized to the model's `dim`, reused across the 3
 * interior samples (ADR-004: no per-sample state allocation, though the
 * returned candidate list and its objects are not on that hot path -- events
 * fire far less often than rhs evaluations).
 *
 * Root localization (P2.33), terminal truncation (P2.34), and multi-event
 * ordering (P2.35) are deliberately out of scope here: this function only
 * answers "did anything cross, and roughly where" via brackets.
 */
export function scanStepForEvents(
  events: readonly EventSpec[],
  t0: number,
  y0: Float64Array,
  t1: number,
  y1: Float64Array,
  interpolant: (theta: number, out: Float64Array) => void,
  scratch: Float64Array,
): EventCandidate[] {
  const h = t1 - t0;
  const candidates: EventCandidate[] = [];

  for (const event of events) {
    let thetaPrev = 0;
    let gPrev = event.g(t0, y0);

    for (let k = 0; k <= INTERIOR_THETAS.length; k++) {
      const isLast = k === INTERIOR_THETAS.length;
      const theta = isLast ? 1 : INTERIOR_THETAS[k]!;
      const t = isLast ? t1 : t0 + theta * h;
      const y = isLast ? y1 : (interpolant(theta, scratch), scratch);
      const g = event.g(t, y);

      if (crossesInDirection(gPrev, g, event.direction)) {
        candidates.push({ event, thetaLo: thetaPrev, thetaHi: theta, gLo: gPrev, gHi: g });
      }

      thetaPrev = theta;
      gPrev = g;
    }
  }

  return candidates;
}
