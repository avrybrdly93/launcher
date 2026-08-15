import { describe, expect, it } from "vitest";
import type { EventSpec } from "@ballista/engine";
import { scanStepForEvents } from "./event-detection.js";

/**
 * A synthetic dense-output interpolant tracing a downward parabolic dip in
 * a single scalar channel: `g(theta) = peak - 4*amplitude*theta*(1-theta)`,
 * so both endpoints (`theta=0,1`) equal `peak` while the interior minimum at
 * `theta=0.5` equals `peak - amplitude`. With `peak > 0 < amplitude - peak`
 * the endpoints are both positive but the dip crosses zero and back --
 * exactly the "grazing" shape a naive `g(t0)*g(t1) < 0` check cannot see.
 */
function dipInterpolant(
  peak: number,
  amplitude: number,
): (theta: number, out: Float64Array) => void {
  return (theta: number, out: Float64Array) => {
    out[0] = peak - 4 * amplitude * theta * (1 - theta);
  };
}

const SCALAR_EVENT_ANY: EventSpec = {
  name: "scalar",
  g: (_t: number, y: Float64Array) => y[0]!,
};

function withDirection(direction: "rising" | "falling"): EventSpec {
  return { ...SCALAR_EVENT_ANY, direction };
}

describe("scanStepForEvents (P2.32, §4.9)", () => {
  it("detects an ordinary endpoint sign change", () => {
    const t0 = 0;
    const t1 = 1;
    const y0 = new Float64Array([-1]);
    const y1 = new Float64Array([1]);
    // Cubic (not linear) so the crossing doesn't land exactly on theta=0.5,
    // one of the interior sample points -- keeps this test unambiguous
    // about which single sub-interval brackets the crossing.
    const interpolant = (theta: number, out: Float64Array) => {
      out[0] = -1 + 2 * theta * theta * theta;
    };
    const scratch = new Float64Array(1);

    const candidates = scanStepForEvents([SCALAR_EVENT_ANY], t0, y0, t1, y1, interpolant, scratch);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.event).toBe(SCALAR_EVENT_ANY);
    expect(candidates[0]!.thetaLo).toBeCloseTo(0.75, 12);
    expect(candidates[0]!.thetaHi).toBe(1);
  });

  it("finds nothing when g never crosses zero", () => {
    const y0 = new Float64Array([1]);
    const y1 = new Float64Array([2]);
    const interpolant = (theta: number, out: Float64Array) => {
      out[0] = 1 + theta;
    };
    const scratch = new Float64Array(1);

    const candidates = scanStepForEvents([SCALAR_EVENT_ANY], 0, y0, 1, y1, interpolant, scratch);

    expect(candidates).toHaveLength(0);
  });

  it("detects a contrived grazing dip missed by the naive endpoint sign check", () => {
    const peak = 0.1;
    const amplitude = 1.0;
    const t0 = 0;
    const t1 = 1;
    const y0 = new Float64Array([peak]);
    const y1 = new Float64Array([peak]);
    const interpolant = dipInterpolant(peak, amplitude);
    const scratch = new Float64Array(1);

    // The naive check a driver without the grazing guard would run:
    // g(t0,y0) and g(t1,y1) share a sign, so it reports no crossing at all.
    const gAtT0 = SCALAR_EVENT_ANY.g(t0, y0);
    const gAtT1 = SCALAR_EVENT_ANY.g(t1, y1);
    expect(gAtT0 * gAtT1).toBeGreaterThan(0);

    const candidates = scanStepForEvents([SCALAR_EVENT_ANY], t0, y0, t1, y1, interpolant, scratch);

    // The guard's 3 interior samples catch both the fall into the dip and
    // the rise back out of it, which the endpoint-only check above missed
    // entirely.
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    for (const c of candidates) {
      expect(c.gLo * c.gHi).toBeLessThanOrEqual(0);
    }
  });

  it("respects the direction filter across a grazing dip", () => {
    const peak = 0.1;
    const amplitude = 1.0;
    const y0 = new Float64Array([peak]);
    const y1 = new Float64Array([peak]);
    const interpolant = dipInterpolant(peak, amplitude);
    const scratch = new Float64Array(1);

    const fallingOnly = scanStepForEvents(
      [withDirection("falling")],
      0,
      y0,
      1,
      y1,
      interpolant,
      scratch,
    );
    const risingOnly = scanStepForEvents(
      [withDirection("rising")],
      0,
      y0,
      1,
      y1,
      interpolant,
      scratch,
    );

    expect(fallingOnly.length).toBeGreaterThanOrEqual(1);
    expect(fallingOnly.every((c) => c.gHi < c.gLo)).toBe(true);

    expect(risingOnly.length).toBeGreaterThanOrEqual(1);
    expect(risingOnly.every((c) => c.gHi > c.gLo)).toBe(true);
  });

  it("scans multiple events independently within one step", () => {
    const y0 = new Float64Array([-1, 5]);
    const y1 = new Float64Array([1, 5]);
    const interpolant = (theta: number, out: Float64Array) => {
      out[0] = -1 + 2 * theta * theta * theta;
      out[1] = 5;
    };
    const scratch = new Float64Array(2);

    const crossingEvent: EventSpec = { name: "crossing", g: (_t, y) => y[0]! };
    const flatEvent: EventSpec = { name: "flat", g: (_t, y) => y[1]! - 5 };

    const candidates = scanStepForEvents(
      [crossingEvent, flatEvent],
      0,
      y0,
      1,
      y1,
      interpolant,
      scratch,
    );

    expect(candidates.filter((c) => c.event === crossingEvent)).toHaveLength(1);
    // flatEvent's g is identically zero across the whole step: degenerate,
    // not a crossing to localize.
    expect(candidates.filter((c) => c.event === flatEvent)).toHaveLength(0);
  });
});

/**
 * An event already *active* at the step's start: `g(t0)` is exactly zero
 * (P0.97). A launcher standing on the deck satisfies `g_gnd = y = 0` at
 * `t=0`, and so does the post-bounce state of a restitution impact.
 *
 * These cases pin both halves of the fix, because either alone is wrong.
 * Reporting the zero at `t0` as a crossing makes the solve end at the launch
 * instant with zero flight time. Merely refusing to report it makes the solve
 * *miss* an excursion that is entirely inside the first sub-interval, where
 * the original five-sample scan never looked -- a wrong answer replaced by no
 * answer.
 *
 * The trajectory used throughout is `g(theta) = departure(theta) `, a
 * parabolic arc leaving zero at `theta=0` and returning at `theta=tof`, which
 * is exactly the shape of `y(t)` under gravity.
 */
describe("scanStepForEvents with an event active at the step start (P0.97)", () => {
  /**
   * `g` rises from exactly zero and comes back down through it at
   * `theta = returnTheta`, staying negative thereafter -- a launch and its
   * impact, in dense-output coordinates.
   */
  function arcInterpolant(returnTheta: number): (theta: number, out: Float64Array) => void {
    return (theta: number, out: Float64Array) => {
      out[0] = theta * (returnTheta - theta);
    };
  }

  const FALLING = withDirection("falling");

  it("does not report the initial zero as a crossing when the state departs", () => {
    // The bug: (g=0 at theta=0, g<0 at theta=0.25) reads as a falling
    // crossing, and localization handed gLo=0 returns t0 without iterating.
    const y0 = new Float64Array([0]);
    const y1 = new Float64Array([-1]);
    const candidates = scanStepForEvents(
      [FALLING],
      0,
      y0,
      1,
      y1,
      arcInterpolant(0.1),
      new Float64Array(1),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.thetaLo).toBeGreaterThan(0);
    expect(candidates[0]!.gLo).toBeGreaterThan(0);
  });

  it("brackets a return crossing that lies entirely inside the first sub-interval", () => {
    // The half that a bare suppression would break: the whole excursion is
    // inside [0, 0.25], which the original scan never sampled.
    const y0 = new Float64Array([0]);
    const y1 = new Float64Array([-1]);
    const candidates = scanStepForEvents(
      [FALLING],
      0,
      y0,
      1,
      y1,
      arcInterpolant(0.02),
      new Float64Array(1),
    );

    expect(candidates).toHaveLength(1);
    const { thetaLo, thetaHi, gLo, gHi } = candidates[0]!;
    expect(thetaLo).toBeGreaterThan(0);
    expect(thetaHi).toBeLessThanOrEqual(0.25);
    // A genuine sign-bracketed interval, so Brent has a root to find rather
    // than an endpoint to return.
    expect(gLo).toBeGreaterThan(0);
    expect(gHi).toBeLessThan(0);
    expect(thetaLo).toBeLessThan(0.02);
    expect(thetaHi).toBeGreaterThan(0.02);
  });

  it("resolves an excursion three decades shorter than the step", () => {
    const y0 = new Float64Array([0]);
    const y1 = new Float64Array([-1]);
    const candidates = scanStepForEvents(
      [FALLING],
      0,
      y0,
      1,
      y1,
      arcInterpolant(1e-3),
      new Float64Array(1),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.gLo).toBeGreaterThan(0);
    expect(candidates[0]!.gHi).toBeLessThan(0);
  });

  it("still fires at t0 when the state leaves through the surface", () => {
    // Not a defect and deliberately preserved: a horizontal launch from
    // exactly ground level has vy=0 and goes straight down, so it lands at
    // t=0 with zero range. Suppressing this case is what broke solveArcs'
    // theta=0 bound while the first draft of the fix was in place.
    const y0 = new Float64Array([0]);
    const y1 = new Float64Array([-1]);
    const candidates = scanStepForEvents(
      [FALLING],
      0,
      y0,
      1,
      y1,
      (theta, out) => {
        out[0] = -theta * theta;
      },
      new Float64Array(1),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.thetaLo).toBe(0);
    expect(candidates[0]!.gLo).toBe(0);
  });

  it("honours a declared direction at the initial zero", () => {
    // The mirror of the case above for a rising event: departing downward and
    // returning upward through zero is a rising crossing, and the zero at t0
    // is the departure rather than the crossing.
    const y0 = new Float64Array([0]);
    const y1 = new Float64Array([1]);
    const candidates = scanStepForEvents(
      [withDirection("rising")],
      0,
      y0,
      1,
      y1,
      (theta, out) => {
        out[0] = -theta * (0.02 - theta);
      },
      new Float64Array(1),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.thetaLo).toBeGreaterThan(0);
    expect(candidates[0]!.gLo).toBeLessThan(0);
    expect(candidates[0]!.gHi).toBeGreaterThan(0);
  });

  it("adds no samples and no candidates when the event is not active at the start", () => {
    // The ladder must cost nothing on an ordinary step. Counting `g` calls is
    // the only way to see that from outside.
    let calls = 0;
    const counting: EventSpec = {
      name: "counting",
      g: (_t: number, y: Float64Array) => {
        calls++;
        return y[0]!;
      },
      direction: "falling",
    };
    const y0 = new Float64Array([1]);
    const y1 = new Float64Array([-1]);
    const candidates = scanStepForEvents(
      [counting],
      0,
      y0,
      1,
      y1,
      // Quadratic, so the crossing at theta = 1/sqrt(2) misses every sample
      // point -- a root landing exactly on one produces two brackets, which
      // is pre-existing behaviour and not what this case is about.
      (theta, out) => {
        out[0] = 1 - 2 * theta * theta;
      },
      new Float64Array(1),
    );

    expect(candidates).toHaveLength(1);
    // Endpoints plus the three interior samples: the original five.
    expect(calls).toBe(5);
  });

  it("reports nothing when g is identically zero across the step", () => {
    const y0 = new Float64Array([0]);
    const y1 = new Float64Array([0]);
    const candidates = scanStepForEvents(
      [FALLING],
      0,
      y0,
      1,
      y1,
      (_theta, out) => {
        out[0] = 0;
      },
      new Float64Array(1),
    );

    expect(candidates).toHaveLength(0);
  });
});
