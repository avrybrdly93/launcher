import { describe, expect, it } from "vitest";
import { restitutionBounceAction } from "./restitution.js";

describe("restitutionBounceAction (P4.11)", () => {
  it("negates v_y by e and scales v_x by muF, leaving every other channel untouched", () => {
    const action = restitutionBounceAction(2, 3, { e: 0.8, muF: 0.6 });
    const y = new Float64Array([1, 2, 10, -5]);
    const out = new Float64Array(4);

    action(0, y, out);

    expect(out[0]).toBe(1); // x passed through
    expect(out[1]).toBe(2); // y passed through
    expect(out[2]).toBeCloseTo(6, 15); // vx <- muF*vx = 0.6*10
    expect(out[3]).toBeCloseTo(4, 15); // vy <- -e*vy = -0.8*-5
  });

  it("with e=1, muF=1 the transform is a sign flip and a no-op, exact to the bit", () => {
    const action = restitutionBounceAction(2, 3, { e: 1, muF: 1 });
    const y = new Float64Array([1.23456789, 0, 3.14159265, -2.71828182]);
    const out = new Float64Array(4);

    action(0, y, out);

    expect(out[2]).toBe(y[2]);
    expect(out[3]).toBe(-y[3]!);
  });

  it("supports arbitrary channel indices (e.g. a 5-channel spin model's velocity slots)", () => {
    const action = restitutionBounceAction(3, 4, { e: 1, muF: 1 });
    const y = new Float64Array([0, 0, 99, 10, -5]);
    const out = new Float64Array(5);

    action(0, y, out);

    expect(out[2]).toBe(99); // untouched extra channel (e.g. spin)
    expect(out[3]).toBe(10);
    expect(out[4]).toBe(5);
  });

  it("does not mutate its input `y`", () => {
    const action = restitutionBounceAction(2, 3, { e: 1, muF: 1 });
    const y = new Float64Array([0, 0, 10, -5]);
    const out = new Float64Array(4);

    action(0, y, out);

    expect(Array.from(y)).toEqual([0, 0, 10, -5]);
  });
});
