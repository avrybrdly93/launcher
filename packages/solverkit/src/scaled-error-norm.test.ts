import { describe, expect, it } from "vitest";
import { scaledErrorNorm } from "./scaled-error-norm.js";

describe("scaledErrorNorm (P2.26, eq. 4.9)", () => {
  it("matches a hand-computed scalar-atol case to 1e-15", () => {
    const y = new Float64Array([1, 2]);
    const yNext = new Float64Array([1.1, 2.2]);
    const delta = new Float64Array([0.001, -0.002]);
    const rtol = 1e-3;
    const atol = 1e-6;

    // sc_0 = 1e-6 + 1e-3*max(1, 1.1)   = 0.001101
    // sc_1 = 1e-6 + 1e-3*max(2, 2.2)   = 0.002201
    // err = sqrt(((0.001/0.001101)^2 + (-0.002/0.002201)^2) / 2)
    const expected = 0.9084715669986798;

    expect(scaledErrorNorm(delta, y, yNext, rtol, atol)).toBeCloseTo(expected, 15);
  });

  it("matches a hand-computed per-channel atol vector case to 1e-15", () => {
    const y = new Float64Array([1, 2]);
    const yNext = new Float64Array([1.1, 2.2]);
    const delta = new Float64Array([0.001, -0.002]);
    const rtol = 1e-3;
    const atol = new Float64Array([1e-6, 1e-3]);

    // sc_0 = 1e-6 + 1e-3*max(1, 1.1)   = 0.001101
    // sc_1 = 1e-3 + 1e-3*max(2, 2.2)   = 0.0032
    // err = sqrt(((0.001/0.001101)^2 + (-0.002/0.0032)^2) / 2)
    const expected = 0.779605893368384;

    expect(scaledErrorNorm(delta, y, yNext, rtol, atol)).toBeCloseTo(expected, 15);
  });

  it("returns 0 when delta is exactly zero, regardless of tolerance", () => {
    const y = new Float64Array([1, -5, 100]);
    const yNext = new Float64Array([1.5, -4, 99]);
    const delta = new Float64Array([0, 0, 0]);

    expect(scaledErrorNorm(delta, y, yNext, 1e-6, 1e-9)).toBe(0);
  });

  it("returns 1 when every component's error exactly equals its tolerance", () => {
    const y = new Float64Array([0, 0]);
    const yNext = new Float64Array([0, 0]);
    const atol = 1e-3;
    const delta = new Float64Array([atol, -atol]);

    expect(scaledErrorNorm(delta, y, yNext, 1e-6, atol)).toBeCloseTo(1, 15);
  });

  it("uses max(|y|, |yNext|) so a shrinking-magnitude channel doesn't loosen its own tolerance", () => {
    const y = new Float64Array([1000]);
    const yNext = new Float64Array([1]);
    const delta = new Float64Array([1]);
    const rtol = 1e-2;
    const atol = 0;

    // sc = 0 + 1e-2*max(1000,1) = 10, err = |1/10| = 0.1 -- not 1/(1e-2*1)=100.
    expect(scaledErrorNorm(delta, y, yNext, rtol, atol)).toBeCloseTo(0.1, 15);
  });
});
