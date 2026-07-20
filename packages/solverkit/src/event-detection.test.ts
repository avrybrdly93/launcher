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
