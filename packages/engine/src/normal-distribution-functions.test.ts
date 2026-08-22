import { describe, expect, it } from "vitest";
import {
  erf,
  erfc,
  normalCdf,
  normalPdf,
  normalQuantile,
  normalUpperTail,
  standardNormalIntervalMass,
} from "./normal-distribution-functions.js";

/**
 * An independent reference for `erf`, from its Taylor series
 * `erf(x) = 2/sqrt(pi) * sum (-1)^n x^(2n+1) / (n! (2n+1))`.
 *
 * Deliberately a different algorithm from the implementation's incomplete
 * gamma: agreeing with a rearrangement of your own formula proves nothing. The
 * series alternates, so it loses accuracy as |x| grows and is only used below
 * |x| = 2.5, where the terms stay well-conditioned.
 */
function erfBySeries(x: number): number {
  let term = x;
  let sum = x;
  for (let n = 1; n < 200; n += 1) {
    term *= (-x * x) / n;
    const contribution = term / (2 * n + 1);
    sum += contribution;
    if (Math.abs(contribution) < 1e-18) break;
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}

describe("erf", () => {
  it("matches its Taylor series across the range where the series is well-conditioned", () => {
    for (let x = -2.5; x <= 2.5; x += 0.05) {
      expect(erf(x)).toBeCloseTo(erfBySeries(x), 13);
    }
  });

  it("reproduces erf(1) to full double precision", () => {
    expect(erf(1)).toBeCloseTo(0.8427007929497149, 15);
  });

  it("is zero at the origin and odd about it", () => {
    expect(erf(0)).toBe(0);
    for (const x of [0.3, 1, 2, 4, 10]) {
      expect(erf(-x)).toBeCloseTo(-erf(x), 15);
    }
  });

  it("saturates to +-1 far from the origin without overshooting", () => {
    expect(erf(10)).toBe(1);
    expect(erf(-10)).toBe(-1);
    expect(erf(6)).toBeLessThanOrEqual(1);
  });

  it("propagates NaN rather than returning a plausible number", () => {
    expect(erf(Number.NaN)).toBeNaN();
    expect(erfc(Number.NaN)).toBeNaN();
  });
});

describe("erfc", () => {
  it("complements erf where both are well-conditioned", () => {
    for (let x = -2; x <= 2; x += 0.1) {
      expect(erf(x) + erfc(x)).toBeCloseTo(1, 15);
    }
  });

  it("keeps its digits in the tail, where 1 - erf(x) has none left", () => {
    // erfc(6) is order 1e-17, i.e. below the resolution of `1 - erf(6)`, which
    // is exactly 0 in double precision. This is the whole reason erfc exists.
    expect(1 - erf(6)).toBe(0);
    expect(erfc(6)).toBeGreaterThan(0);
    expect(erfc(6)).toBeLessThan(1e-16);
    // Asymptotically erfc(x) ~ exp(-x^2)/(x sqrt(pi)) * (1 - 1/(2x^2) +
    // 3/(4x^4) - ...). The series is asymptotic, so its error is about the
    // first omitted term: at x = 6 that is 15/(8 x^6) = 4.0e-5 relative, and
    // the measured agreement below lands there. Two terms would only reach
    // 5.5e-4, which is the third term, not the implementation's error.
    const x = 6;
    const asymptotic =
      (Math.exp(-x * x) / (x * Math.sqrt(Math.PI))) * (1 - 1 / (2 * x ** 2) + 3 / (4 * x ** 4));
    expect(Math.abs(erfc(x) / asymptotic - 1)).toBeLessThan(1e-4);
  });

  it("crosses the series/continued-fraction branch without a step", () => {
    // The implementation switches branch at x^2 = 1.5, i.e. x = 1.2247...
    // Both sides are checked against the same external reference rather than
    // against each other: erfc's own slope there is -2/sqrt(pi) * exp(-1.5) =
    // -0.2518, so two points 2e-9 apart differ by 5e-10 whether or not there
    // is a discontinuity, and comparing them proves nothing.
    const branch = Math.sqrt(1.5);
    for (const x of [branch - 1e-9, branch, branch + 1e-9]) {
      expect(erf(x)).toBeCloseTo(erfBySeries(x), 15);
    }
    // And the step itself is the analytic one, to the resolution a first-order
    // expansion supports.
    const slope = (-2 / Math.sqrt(Math.PI)) * Math.exp(-1.5);
    const measured = erfc(branch + 1e-9) - erfc(branch - 1e-9);
    // Relative, not absolute: the first-order expansion drops a second-order
    // term worth about 1e-6 of the step, which is the accuracy limit here.
    expect(measured / (slope * 2e-9)).toBeCloseTo(1, 5);
  });
});

describe("normalCdf", () => {
  it("is 1/2 at the mean and symmetric about it", () => {
    expect(normalCdf(0)).toBe(0.5);
    for (const z of [0.25, 1, 2.5, 5]) {
      expect(normalCdf(-z) + normalCdf(z)).toBeCloseTo(1, 15);
    }
  });

  it("reproduces the textbook two-sided 95% point", () => {
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 15);
  });

  it("matches a Simpson integral of its own density", () => {
    // Independent of the incomplete-gamma path: integrate phi numerically.
    // Simpson rather than trapezoid deliberately -- the trapezoid rule's own
    // O(h^2) truncation error is 8e-11 here, which would set the tolerance
    // instead of the function under test.
    const target = 1.3;
    const steps = 20000; // even, as Simpson requires
    const lo = -12;
    const h = (target - lo) / steps;
    let integral = normalPdf(lo) + normalPdf(target);
    for (let i = 1; i < steps; i += 1) {
      integral += (i % 2 === 0 ? 2 : 4) * normalPdf(lo + i * h);
    }
    // The missing mass below z = -12 is order 1e-33 and far under the tolerance.
    expect(normalCdf(target)).toBeCloseTo((integral * h) / 3, 14);
  });

  it("handles infinite arguments", () => {
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalUpperTail(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalUpperTail(Number.NEGATIVE_INFINITY)).toBe(1);
  });
});

describe("normalUpperTail", () => {
  it("beats 1 - normalCdf in the far tail", () => {
    // At z = 8 the subtraction keeps roughly one significant digit; the direct
    // computation keeps all of them. Assert the gap rather than describing it.
    const direct = normalUpperTail(8);
    const subtracted = 1 - normalCdf(8);
    expect(direct).toBeGreaterThan(0);
    expect(Math.abs(subtracted - direct) / direct).toBeGreaterThan(1e-2);
  });
});

describe("normalQuantile", () => {
  it("inverts normalCdf across four decades of tail probability", () => {
    for (const p of [1e-8, 1e-6, 1e-4, 0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1 - 1e-8]) {
      const z = normalQuantile(p);
      expect(normalCdf(z)).toBeCloseTo(p, 14);
    }
  });

  it("reproduces the standard critical values", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 12);
    expect(normalQuantile(0.95)).toBeCloseTo(1.6448536269514722, 12);
    expect(normalQuantile(0.9)).toBeCloseTo(1.2815515655446004, 12);
    expect(normalQuantile(0.5)).toBe(0);
  });

  it("is antisymmetric about p = 1/2", () => {
    for (const p of [0.01, 0.2, 0.4]) {
      expect(normalQuantile(1 - p)).toBeCloseTo(-normalQuantile(p), 12);
    }
  });

  it("returns infinities at the endpoints and rejects everything outside [0, 1]", () => {
    expect(normalQuantile(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(normalQuantile(1)).toBe(Number.POSITIVE_INFINITY);
    expect(() => normalQuantile(-0.001)).toThrow(RangeError);
    expect(() => normalQuantile(1.001)).toThrow(RangeError);
    expect(() => normalQuantile(Number.NaN)).toThrow(RangeError);
  });

  it("does not depend on the accuracy of its seed approximation", () => {
    // The seed is good to 4.5e-4; the results above are asserted to 1e-12. If
    // refinement were not happening, this would fail by eight orders.
    const z = normalQuantile(0.999);
    expect(Math.abs(normalCdf(z) - 0.999)).toBeLessThan(1e-15);
  });
});

describe("standardNormalIntervalMass", () => {
  it("agrees with the naive CDF difference where the naive one is fine", () => {
    expect(standardNormalIntervalMass(-1, 1)).toBeCloseTo(normalCdf(1) - normalCdf(-1), 15);
    expect(standardNormalIntervalMass(-1, 1)).toBeCloseTo(0.6826894921370859, 14);
  });

  it("keeps its precision on an interval sitting entirely in the tail", () => {
    // Both Phi(4) and Phi(5) are within 3.2e-5 of 1, so the naive difference
    // loses about five digits. The tail-side computation loses none.
    const mass = standardNormalIntervalMass(4, 5);
    const naive = normalCdf(5) - normalCdf(4);
    expect(mass).toBeGreaterThan(0);
    expect(mass).toBeCloseTo(normalUpperTail(4) - normalUpperTail(5), 20);
    expect(Math.abs(naive - mass) / mass).toBeGreaterThan(1e-12);
  });

  it("is 1 for the whole line and 0 for an empty or inverted interval", () => {
    expect(
      standardNormalIntervalMass(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
    ).toBeCloseTo(1, 15);
    expect(standardNormalIntervalMass(1, 1)).toBe(0);
    expect(standardNormalIntervalMass(2, 1)).toBe(0);
  });
});
