import { describe, expect, it } from "vitest";
import { restitutionBounceAction } from "./restitution.js";

describe("restitutionBounceAction (P4.11)", () => {
  it("negates v_y by e and scales v_x by muF, leaving every other channel untouched", () => {
    const action = restitutionBounceAction(2, 3, { e: 0.8, muF: 0.6, vRest: 0 });
    const y = new Float64Array([1, 2, 10, -5]);
    const out = new Float64Array(4);

    action(0, y, out);

    expect(out[0]).toBe(1); // x passed through
    expect(out[1]).toBe(2); // y passed through
    expect(out[2]).toBeCloseTo(6, 15); // vx <- muF*vx = 0.6*10
    expect(out[3]).toBeCloseTo(4, 15); // vy <- -e*vy = -0.8*-5
  });

  it("with e=1, muF=1 the transform is a sign flip and a no-op, exact to the bit", () => {
    const action = restitutionBounceAction(2, 3, { e: 1, muF: 1, vRest: 0 });
    const y = new Float64Array([1.23456789, 0, 3.14159265, -2.71828182]);
    const out = new Float64Array(4);

    action(0, y, out);

    expect(out[2]).toBe(y[2]);
    expect(out[3]).toBe(-y[3]!);
  });

  it("supports arbitrary channel indices (e.g. a 5-channel spin model's velocity slots)", () => {
    const action = restitutionBounceAction(3, 4, { e: 1, muF: 1, vRest: 0 });
    const y = new Float64Array([0, 0, 99, 10, -5]);
    const out = new Float64Array(5);

    action(0, y, out);

    expect(out[2]).toBe(99); // untouched extra channel (e.g. spin)
    expect(out[3]).toBe(10);
    expect(out[4]).toBe(5);
  });

  it("does not mutate its input `y`", () => {
    const action = restitutionBounceAction(2, 3, { e: 1, muF: 1, vRest: 0 });
    const y = new Float64Array([0, 0, 10, -5]);
    const out = new Float64Array(4);

    action(0, y, out);

    expect(Array.from(y)).toEqual([0, 0, 10, -5]);
  });
});

describe("restitutionBounceAction: the rest condition (ADR-021, P0.103)", () => {
  it('returns "continue" while the rebound speed is above vRest, and reflects as always', () => {
    const action = restitutionBounceAction(2, 3, { e: 0.5, muF: 1, vRest: 1e-3 });
    const y = new Float64Array([0, 0, 7, -4]);
    const out = new Float64Array(4);

    // Rebound speed 0.5 * 4 = 2 m/s, three orders above the threshold.
    expect(action(0, y, out)).toBe("continue");
    expect(out[3]).toBe(2);
    expect(out[2]).toBe(7);
  });

  it('returns "stop" and zeroes v_y once the REBOUND speed reaches vRest', () => {
    const action = restitutionBounceAction(2, 3, { e: 0.5, muF: 0.9, vRest: 1e-3 });
    // Approach speed 1.9e-3 is ABOVE vRest; the rebound speed 9.5e-4 is not.
    // Testing the approach speed instead would keep this impact a bounce and
    // launch a flight of 1.9e-4 s -- which is the thing the threshold exists
    // to prevent.
    const y = new Float64Array([0, 0, 2, -1.9e-3]);
    const out = new Float64Array(4);

    expect(action(0, y, out)).toBe("stop");
    expect(out[3]).toBe(0);
    // The tangential impulse still happens: a resting contact is still an
    // impact, and muF is a property of the surface pair, not of the bounce.
    expect(out[2]).toBe(1.8);
  });

  it("fires exactly at the threshold, not just below it", () => {
    const action = restitutionBounceAction(2, 3, { e: 0.5, muF: 1, vRest: 1 });
    const out = new Float64Array(4);

    // Rebound speed exactly 1 = vRest.
    expect(action(0, new Float64Array([0, 0, 0, -2]), out)).toBe("stop");
    // One ulp of approach speed more, and it is a bounce again. The ulp of
    // 2 is exactly 2 * Number.EPSILON, so this is the next representable
    // double and not an approximation of one.
    const justAbove = new Float64Array([0, 0, 0, -(2 + 2 * Number.EPSILON)]);
    expect(action(0, justAbove, out)).toBe("continue");
  });

  it("vRest: 0 never fires, which is what makes the Zeno sequence opt-in", () => {
    const action = restitutionBounceAction(2, 3, { e: 0.5, muF: 1, vRest: 0 });
    const out = new Float64Array(4);

    // Absurdly small but nonzero: still a bounce, forever, by construction.
    expect(action(0, new Float64Array([0, 0, 0, -1e-300]), out)).toBe("continue");
    expect(out[3]).toBe(5e-301);
  });

  it("an exactly-zero normal velocity rests rather than bouncing, even at vRest: 0", () => {
    const action = restitutionBounceAction(2, 3, { e: 0.5, muF: 1, vRest: 0 });
    const out = new Float64Array(4);

    // 0 <= 0. A ball arriving with no normal velocity has no bounce to make,
    // and reflecting it would re-arm the event on a state that is already at
    // the surface with nowhere to go -- the P0.97 shape.
    expect(action(0, new Float64Array([0, 0, 3, 0]), out)).toBe("stop");
    expect(out[3]).toBe(0);
  });

  it("rejects a vRest that is negative or not finite, rather than silently never firing", () => {
    for (const vRest of [-1e-9, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => restitutionBounceAction(2, 3, { e: 0.5, muF: 1, vRest })).toThrow(RangeError);
    }
    // The message names the deliberate opt-out, so the fix is discoverable
    // from the error rather than from the ADR.
    expect(() => restitutionBounceAction(2, 3, { e: 0.5, muF: 1, vRest: -1 })).toThrow(
      /Pass 0 to opt out/,
    );
  });
});
