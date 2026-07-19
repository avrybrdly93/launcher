import { describe, expect, it } from "vitest";
import { kahanAdd } from "./compensated-summation.js";

describe("kahanAdd (P2.20)", () => {
  it("accumulates a long run of small increments with far less error than naive summation", () => {
    // Classic Kahan-summation demonstration: repeatedly adding a small
    // increment into a much larger running total is exactly the shape of a
    // fixed-step state update (§4.7). increment=0.1 has no exact binary
    // representation, so each naive addition loses a fraction of a ULP;
    // over many additions that compounds into O(n * eps) error, while
    // Kahan summation should hold it to roughly O(eps).
    const n = 2_000_000;
    const increment = 0.1;
    const exact = n * increment;

    let naive = 0;
    for (let i = 0; i < n; i++) naive += increment;

    let compensated = 0;
    const compensation = new Float64Array(1);
    for (let i = 0; i < n; i++) compensated = kahanAdd(compensated, increment, compensation, 0);

    const naiveError = Math.abs(naive - exact);
    const compensatedError = Math.abs(compensated - exact);

    // Naive summation's error grows with n; at n=2e6 it's well above 1e-6.
    expect(naiveError).toBeGreaterThan(1e-6);
    // Kahan summation stays within a few ULP of the exact sum, regardless of n.
    expect(compensatedError).toBeLessThan(1e-9);
    expect(compensatedError).toBeLessThan(naiveError / 1000);
  });

  it("is equivalent to a plain add for a single call with zero compensation", () => {
    const compensation = new Float64Array(1);
    expect(kahanAdd(10, 0.5, compensation, 0)).toBe(10.5);
  });

  it("tracks per-channel compensation independently in a shared buffer", () => {
    const compensation = new Float64Array(3);
    const a = kahanAdd(1, 0.001, compensation, 0);
    const b = kahanAdd(100, -0.001, compensation, 1);
    const c = kahanAdd(-5, 2, compensation, 2);
    expect(a).toBeCloseTo(1.001, 12);
    expect(b).toBeCloseTo(99.999, 12);
    expect(c).toBeCloseTo(-3, 12);
  });
});
