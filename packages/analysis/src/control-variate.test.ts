/**
 * Unit properties of {@link controlVariateMean}. The *measured* half of
 * P6.13's criterion — the variance reduction factor and unbiasedness against
 * plain MC — lives in `control-variate-variance-reduction.test.ts`, because
 * those are statements about a sampling distribution and need many studies to
 * make, not one array.
 */

import { describe, expect, it } from "vitest";
import {
  controlVariateMean,
  dragFreeRangeControlMean,
  formatControlVariateEstimate,
} from "./control-variate.js";
import { dragFreeRange } from "./range-root.js";

const G_STD = 9.80665;

describe("controlVariateMean: the identity that makes the method work", () => {
  it("returns the plain mean exactly when the control's sample mean equals its known mean", () => {
    // x̄ − E[X] = 0, so the correction term vanishes for ANY c. This is the
    // algebraic reason the estimator is unbiased and is worth pinning
    // directly rather than only observing it statistically.
    const control = [1, 2, 3, 4, 5];
    const observable = [10, 21, 29, 41, 52];
    const r = controlVariateMean(observable, control, 3);
    const plain = observable.reduce((a, b) => a + b, 0) / observable.length;
    expect(r.estimate).toBeCloseTo(plain, 12);
    expect(r.plainMean).toBeCloseTo(plain, 12);
  });

  it("corrects by exactly c times the control's deviation", () => {
    const control = [1, 2, 3, 4, 5]; // x̄ = 3
    const observable = [10, 21, 29, 41, 52];
    const r = controlVariateMean(observable, control, 2, { coefficient: 4 });
    // ȳ − 4(3 − 2) = ȳ − 4
    expect(r.estimate).toBeCloseTo(r.plainMean - 4, 12);
    expect(r.coefficient).toBe(4);
    expect(r.coefficientEstimated).toBe(false);
  });

  it("reduces to plain MC when handed c = 0, whatever the control says", () => {
    const r = controlVariateMean([1, 5, 9], [100, 200, 300], -1e6, { coefficient: 0 });
    expect(r.estimate).toBeCloseTo(5, 12);
  });
});

describe("controlVariateMean: the optimal coefficient", () => {
  it("recovers the exact slope when the observable is an affine function of the control", () => {
    // y = 3x + 7 exactly, so Cov(x,y)/Var(x) = 3 and rho = 1. With c = c* the
    // corrected estimate is the truth with zero residual variance -- the
    // limiting case the whole method approaches.
    const control = [1, 2, 3, 4, 5, 6, 7, 8];
    const observable = control.map((x) => 3 * x + 7);
    const r = controlVariateMean(observable, control, 10);
    expect(r.coefficient).toBeCloseTo(3, 12);
    expect(r.correlation).toBeCloseTo(1, 12);
    expect(r.varianceReductionFactor).toBeCloseTo(0, 12);
    // E[X] = 10 => E[Y] = 37, recovered exactly from a sample whose own mean is 20.5.
    expect(r.estimate).toBeCloseTo(37, 10);
    expect(r.plainMean).toBeCloseTo(20.5, 12);
    expect(r.coefficientEstimated).toBe(true);
  });

  it("recovers a negative slope, and the factor still reads as a near-total reduction", () => {
    const control = [1, 2, 3, 4, 5, 6, 7, 8];
    const observable = control.map((x) => -2 * x + 1);
    const r = controlVariateMean(observable, control, 4);
    expect(r.coefficient).toBeCloseTo(-2, 12);
    expect(r.correlation).toBeCloseTo(-1, 12);
    expect(r.varianceReductionFactor).toBeCloseTo(0, 12);
    expect(r.estimate).toBeCloseTo(-7, 10);
  });

  it("reports the variance reduction factor as 1 − rho², which is the whole story", () => {
    // Constructed so rho is a round number: y = x + noise orthogonal to x.
    const control = [-3, -1, 1, 3];
    const observable = [-3, 1, -1, 3]; // Sxy = 16, Sxx = 20, Syy = 20 => rho = 0.8
    const r = controlVariateMean(observable, control, 0);
    expect(r.correlation).toBeCloseTo(0.8, 12);
    expect(r.varianceReductionFactor).toBeCloseTo(1 - 0.64, 12);
  });
});

describe("controlVariateMean: a bad coefficient is reported, not hidden", () => {
  it("reports a factor above 1 when the supplied c makes things worse", () => {
    const control = [-3, -1, 1, 3];
    const observable = [-3, 1, -1, 3];
    // c* = 0.8. A c of the wrong sign must inflate the variance, and the
    // factor is the field that has to say so -- clamping it to <= 1 would
    // present a harmful control as a harmless one.
    const bad = controlVariateMean(observable, control, 0, { coefficient: -3 });
    expect(bad.varianceReductionFactor).toBeGreaterThan(1);
    const good = controlVariateMean(observable, control, 0);
    expect(good.varianceReductionFactor).toBeLessThan(1);
  });

  it("is still unbiased with a bad c, because unbiasedness does not depend on c", () => {
    const control = [1, 2, 3];
    const observable = [10, 20, 30];
    // x̄ = E[X], so every c gives the same answer. That is the property that
    // makes a wrong c a precision problem and never a correctness one.
    for (const c of [-5, 0, 0.5, 17]) {
      expect(controlVariateMean(observable, control, 2, { coefficient: c }).estimate).toBeCloseTo(
        20,
        12,
      );
    }
  });
});

describe("controlVariateMean: degenerate inputs", () => {
  it("degrades to plain MC on a constant control rather than dividing by zero", () => {
    const r = controlVariateMean([1, 2, 3], [7, 7, 7], 7);
    expect(r.coefficient).toBe(0);
    expect(r.estimate).toBeCloseTo(2, 12);
    expect(Number.isNaN(r.correlation)).toBe(true);
  });

  it("reports NaN correlation on a constant observable, not a measured zero", () => {
    const r = controlVariateMean([5, 5, 5], [1, 2, 3], 2);
    expect(Number.isNaN(r.correlation)).toBe(true);
    expect(Number.isNaN(r.varianceReductionFactor)).toBe(true);
  });

  it("returns null standard errors for a single sample", () => {
    const r = controlVariateMean([4], [1], 1);
    expect(r.standardError).toBeNull();
    expect(r.plainStandardError).toBeNull();
    expect(r.sampleSize).toBe(1);
  });

  it("never returns a negative standard error when the reduction is near-total", () => {
    const control = [1, 2, 3, 4, 5, 6, 7, 8];
    const observable = control.map((x) => 3 * x + 7);
    const r = controlVariateMean(observable, control, 10);
    expect(r.standardError).not.toBeNull();
    expect(r.standardError!).toBeGreaterThanOrEqual(0);
  });
});

describe("controlVariateMean: rejected inputs", () => {
  it("rejects mismatched lengths rather than truncating to the shorter", () => {
    expect(() => controlVariateMean([1, 2, 3], [1, 2], 1)).toThrow(/paired element-wise/);
  });

  it("rejects an empty sample", () => {
    expect(() => controlVariateMean([], [], 0)).toThrow(/at least one sample/);
  });

  it("rejects a NaN observable rather than averaging a diverged solve into the estimate", () => {
    expect(() => controlVariateMean([1, Number.NaN, 3], [1, 2, 3], 2)).toThrow(/observable\[1\]/);
  });

  it("rejects a non-finite control", () => {
    expect(() => controlVariateMean([1, 2, 3], [1, Number.POSITIVE_INFINITY, 3], 2)).toThrow(
      /control\[1\]/,
    );
  });

  it("rejects a non-finite known mean", () => {
    expect(() => controlVariateMean([1, 2, 3], [1, 2, 3], Number.NaN)).toThrow(/knownControlMean/);
  });

  it("rejects a non-finite supplied coefficient", () => {
    expect(() => controlVariateMean([1, 2, 3], [1, 2, 3], 2, { coefficient: Number.NaN })).toThrow(
      /coefficient/,
    );
  });
});

describe("dragFreeRangeControlMean", () => {
  it("carries the sigma² term, which is the whole reason it is not just dragFreeRange(mu)", () => {
    const mu = 40;
    const sigma = 6;
    const theta = Math.PI / 4;
    const withSigma = dragFreeRangeControlMean(mu, sigma, theta);
    const naive = dragFreeRange(mu, theta);
    // E[v0²] = mu² + sigma² = 1636, not 1600.
    expect(withSigma).toBeCloseTo(((mu * mu + sigma * sigma) * Math.sin(2 * theta)) / G_STD, 9);
    // The gap a caller would introduce by using dragFreeRange(mu) instead:
    // sigma² sin(2θ)/g, which at these parameters is 2.25% of the range.
    expect(withSigma - naive).toBeCloseTo((sigma * sigma * Math.sin(2 * theta)) / G_STD, 9);
    expect((withSigma - naive) / withSigma).toBeCloseTo(0.022, 3);
  });

  it("collapses to the deterministic range at sigma = 0", () => {
    expect(dragFreeRangeControlMean(40, 0, Math.PI / 4)).toBeCloseTo(
      dragFreeRange(40, Math.PI / 4),
      12,
    );
  });

  it("honours a non-standard gravity", () => {
    const earth = dragFreeRangeControlMean(40, 6, Math.PI / 4);
    const moon = dragFreeRangeControlMean(40, 6, Math.PI / 4, 1.62);
    expect(moon / earth).toBeCloseTo(G_STD / 1.62, 9);
  });

  it("rejects a negative standard deviation", () => {
    expect(() => dragFreeRangeControlMean(40, -1, Math.PI / 4)).toThrow(/non-negative/);
  });

  it("rejects non-finite parameters", () => {
    expect(() => dragFreeRangeControlMean(Number.NaN, 6, Math.PI / 4)).toThrow(/finite/);
  });
});

describe("formatControlVariateEstimate", () => {
  it("shows both estimates, both standard errors, the factor and rho", () => {
    const control = [-3, -1, 1, 3];
    const observable = [-3, 1, -1, 3];
    const text = formatControlVariateEstimate(controlVariateMean(observable, control, 0));
    expect(text).toMatch(
      /^-?\d+\.\d ± \d+\.\d \(plain -?\d+\.\d ± \d+\.\d\), factor \d\.\d{3}, rho \d\.\d{3}, n=4$/,
    );
  });

  it("renders n/a rather than a bare number when the sample cannot support an SE", () => {
    expect(formatControlVariateEstimate(controlVariateMean([4], [1], 1))).toContain("n/a");
  });
});
