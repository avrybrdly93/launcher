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
 * Extra samples used *only* when an event is already active at the step's
 * start -- i.e. $g_j(t_k,\mathbf y_k)$ is exactly zero. See
 * {@link scanStepForEvents} for why that case needs its own ladder.
 *
 * A geometric ladder rather than an even spread, because the excursion being
 * resolved can be arbitrarily short relative to the step: the whole point is
 * a launch whose flight fits inside the first quarter-step, and halving is
 * what makes the cost logarithmic in how short that is. Twelve rungs reach
 * $\theta = 0.25 \cdot 2^{-12} \approx 6.1\times10^{-5}$ of a step; on the
 * default 6 s initial step that resolves a flight of about 0.37 ms, which at
 * 60 m/s is an elevation of roughly $3\times10^{-6}$ rad.
 *
 * The floor is real and is not papered over: an excursion shorter than the
 * last rung is not bracketed, so no terminal root is reported and the solve
 * runs on to `tspan` — which the shooting layer reports as `ok: false`. A
 * loud failure at an absurd aim is the intended trade against the silent
 * wrong answer this ladder exists to remove (P0.97).
 */
const DEPARTURE_THETAS: readonly number[] = (() => {
  const ladder: number[] = [];
  for (let k = 12; k >= 1; k--) ladder.push(INTERIOR_THETAS[0]! * 2 ** -k);
  return ladder;
})();

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
    const g0 = event.g(t0, y0);

    // An event already *active* at the step's start (P0.97). The zero here is
    // the state being departed from, not a crossing to report -- a launcher
    // standing on the deck satisfies g_gnd = y = 0 exactly at t=0, and so does
    // the post-bounce state of a restitution impact, which resumes from the
    // surface it just left.
    //
    // Two things go wrong if it is treated as an ordinary sample, and they
    // have to be fixed together:
    //
    //   1. the pair (0 at theta=0, negative at the next sample) reads as a
    //      falling crossing, and localization is handed gLo = 0 -- so Brent
    //      returns the left endpoint without iterating and the event fires at
    //      t0. That is a *silently wrong* trajectory: ok, terminal, flight
    //      time zero, impact at the launch point.
    //
    //   2. the crossing that genuinely exists can lie entirely inside the
    //      first sub-interval, where nothing is sampled. Suppressing (1)
    //      alone therefore replaces a wrong answer with a missed event, which
    //      is not an improvement worth making on its own.
    //
    // So the zero at theta=0 never anchors a bracket, and the first
    // sub-interval gains the DEPARTURE_THETAS ladder to bracket the real
    // return crossing. Both cost nothing on an ordinary step: g0 !== 0 skips
    // the ladder and leaves the original five-sample scan exactly as it was.
    const activeAtStart = g0 === 0;
    const thetas = activeAtStart ? [...DEPARTURE_THETAS, ...INTERIOR_THETAS] : INTERIOR_THETAS;

    let thetaPrev = 0;
    let gPrev = g0;
    // While this holds, `gPrev` is still the initial zero and no bracket may
    // be anchored on it. It clears at the first sample that has actually
    // departed the event surface.
    let anchoredOnInitialZero = activeAtStart;

    for (let k = 0; k <= thetas.length; k++) {
      const isLast = k === thetas.length;
      const theta = isLast ? 1 : thetas[k]!;
      const t = isLast ? t1 : t0 + theta * h;
      const y = isLast ? y1 : (interpolant(theta, scratch), scratch);
      const g = event.g(t, y);

      if (anchoredOnInitialZero) {
        // Still sitting on the initial zero. What happens at the first sample
        // that is *not* zero decides whether that zero was a crossing:
        //
        // moved to the side `direction` counts as a crossing -- the state
        //   went straight *through* the surface, so t0 really is the crossing
        //   and it is reported exactly as before. A horizontal launch from
        //   exactly ground level lands at t=0 with zero range, and that is
        //   the right answer rather than a defect.
        //
        // moved to the other side -- the state *left* the surface. The zero
        //   at t0 anchors nothing; scanning resumes normally and the return
        //   crossing is bracketed by the ordinary rule below.
        //
        // `crossesInDirection` is the whole test, which is what makes this
        // correct for every event rather than for the ground: `direction` is
        // precisely the declaration of which transitions count, so it is
        // already the statement of which side is "through". An event
        // declaring `"any"` fires at t0 either way, and that is its
        // declaration honoured, not this case leaking back in.
        if (g !== 0) {
          anchoredOnInitialZero = false;
          if (crossesInDirection(gPrev, g, event.direction)) {
            candidates.push({ event, thetaLo: thetaPrev, thetaHi: theta, gLo: gPrev, gHi: g });
          }
        }
      } else if (crossesInDirection(gPrev, g, event.direction)) {
        candidates.push({ event, thetaLo: thetaPrev, thetaHi: theta, gLo: gPrev, gHi: g });
      }

      thetaPrev = theta;
      gPrev = g;
    }
  }

  return candidates;
}
