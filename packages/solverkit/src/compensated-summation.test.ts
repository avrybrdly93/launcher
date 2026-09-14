import { describe, expect, it } from "vitest";
import { kahanAdd, roundedKahanAdd } from "./compensated-summation.js";
import { identity, toF32 } from "./planar-rk4-precision-reference.js";

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

describe("roundedKahanAdd (P7.18)", () => {
  it("reduces to kahanAdd under identity, step for step and bit for bit", () => {
    // The f64 path must not change when this routine is introduced. Asserted
    // over a run rather than on one call, because the two implementations
    // could agree on a first call with zero compensation and diverge once the
    // residual is carrying something.
    const plainComp = new Float64Array(1);
    const roundedComp = new Float64Array(1);
    let plain = 0;
    let rounded = 0;
    for (let i = 0; i < 10_000; i++) {
      plain = kahanAdd(plain, 0.1, plainComp, 0);
      rounded = roundedKahanAdd(rounded, 0.1, roundedComp, 0, identity);
      expect(rounded).toBe(plain);
      expect(roundedComp[0]).toBe(plainComp[0]);
    }
  });

  it("holds an f32 accumulator near the exact sum where a plain f32 add drifts", () => {
    // The control this routine exists to pass, at the width it exists for:
    // 100000 increments of 0.1 into a total reaching 1e4. The increment is
    // still ~100x the running value's ULP here, so the plain accumulator does
    // not stall -- it drifts, by 1.4e-4 relative, which is already an order of
    // magnitude past the 1e-5 budget the planar study certifies against.
    //
    // The first version of this test predicted a >20% error and measured
    // 1.4e-4. The prediction was wrong, not the code: a stall needs the
    // increment to fall below half a ULP of the running value, which at 1e4
    // and 0.1 it does not. The stall case is the test below; this one is the
    // drift case, and the number here is the measured one.
    const n = 100_000;
    const increment = Math.fround(0.1);
    const exact = n * 0.1;

    let plain = 0;
    for (let i = 0; i < n; i++) plain = Math.fround(plain + increment);

    const compensation = new Float64Array(1);
    let compensated = 0;
    for (let i = 0; i < n; i++) {
      compensated = roundedKahanAdd(compensated, increment, compensation, 0, toF32);
    }

    const plainError = Math.abs(plain - exact);
    const compensatedError = Math.abs(compensated - exact);

    expect(plainError / exact).toBeGreaterThan(1e-5);
    expect(compensatedError).toBeLessThan(plainError / 1000);
  });

  it("keeps advancing where a plain f32 accumulator stops moving entirely", () => {
    // The failure mode in its undisguised form, and the reason this is worth a
    // separate test from the drift case: when the increment drops below half a
    // ULP of the running value, every plain add rounds straight back to the
    // running value and the accumulator freezes. 200000 increments of 0.01 onto
    // 1e6, where ulp32 is 0.0625, move a plain f32 sum by exactly ZERO instead
    // of by 2000 -- a 100% error that no tolerance on the result would catch,
    // because the answer stays a clean, plausible 1000000.
    const start = Math.fround(1e6);
    const n = 200_000;
    const increment = Math.fround(0.01);
    const expected = 2000;

    let plain = start;
    for (let i = 0; i < n; i++) plain = Math.fround(plain + increment);
    expect(plain - start).toBe(0);

    const compensation = new Float64Array(1);
    let compensated = start;
    for (let i = 0; i < n; i++) {
      compensated = roundedKahanAdd(compensated, increment, compensation, 0, toF32);
    }
    // Recovers the movement to within the resolution of the format it is held
    // in: one ULP at 1.002e6 is 0.0625, so this is a few ULP of the answer.
    expect(compensated - start).toBeGreaterThan(expected * 0.999);
    expect(compensated - start).toBeLessThan(expected * 1.001);
  });

  it("keeps the running value and its residual both representable in binary32", () => {
    // "Two-float" is the claim, so it is checked rather than described: if
    // either the sum or the compensation ever left binary32, the routine would
    // be smuggling f64 information into a result that is supposed to model a
    // shader.
    const compensation = new Float64Array(1);
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      sum = roundedKahanAdd(sum, Math.fround(0.001), compensation, 0, toF32);
      expect(Math.fround(sum)).toBe(sum);
      expect(Math.fround(compensation[0]!)).toBe(compensation[0]);
    }
  });

  it("is a plain add on its first call, when the residual is still zero", () => {
    const compensation = new Float64Array(1);
    expect(roundedKahanAdd(10, 0.5, compensation, 0, toF32)).toBe(10.5);
  });

  it("tracks per-channel residuals independently in a shared buffer", () => {
    const compensation = new Float64Array(3);
    const a = roundedKahanAdd(1, 0.001, compensation, 0, toF32);
    const b = roundedKahanAdd(100, -0.001, compensation, 1, toF32);
    const c = roundedKahanAdd(-5, 2, compensation, 2, toF32);
    expect(a).toBeCloseTo(1.001, 6);
    expect(b).toBeCloseTo(99.999, 4);
    expect(c).toBe(-3);
  });
});
