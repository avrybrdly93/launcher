// Unit tests for the importance-sampling estimator and the mean-shift
// proposal (P6.23).
//
// The variance-reduction claim the task's validation criterion names -- "IS
// estimate matches brute force at 10x fewer samples (constructed tail)" -- is
// a study over many replications and lives in
// `importance-sampling-variance-reduction.test.ts`, the shape
// `control-variate-variance-reduction.test.ts` established. This file covers
// the algebra, the argument checking and the diagnostics, all of which are
// deterministic.

import { describe, it, expect } from "vitest";
import { normalPdf } from "@ballista/engine";
import {
  DEFAULT_IS_LEVEL,
  bruteForceSampleSize,
  formatImportanceSamplingEstimate,
  importanceSamplingProbability,
  normalShiftLikelihoodRatio,
  normalShiftProposal,
  normalTailProbability,
  validateNormalShiftProposal,
  type NormalShiftProposal,
} from "./importance-sampling.js";

describe("importanceSamplingProbability: argument checking", () => {
  it("refuses arrays of different lengths", () => {
    expect(() => importanceSamplingProbability([true, false], [1])).toThrow(RangeError);
  });

  it("refuses an empty sample", () => {
    expect(() => importanceSamplingProbability([], [])).toThrow(RangeError);
  });

  it("refuses a negative weight", () => {
    expect(() => importanceSamplingProbability([true, true], [1, -1])).toThrow(/non-negative/);
  });

  it("refuses a non-finite weight", () => {
    // The realistic source is an overflowed exp() in a caller's own likelihood
    // ratio. Propagating it would give pHat = Infinity, which is a
    // "probability" no downstream check would question.
    expect(() =>
      importanceSamplingProbability([true, true], [1, Number.POSITIVE_INFINITY]),
    ).toThrow(RangeError);
    expect(() => importanceSamplingProbability([true, true], [1, Number.NaN])).toThrow(RangeError);
  });

  it("refuses a level outside (0, 1)", () => {
    expect(() => importanceSamplingProbability([true], [1], { level: 0 })).toThrow(RangeError);
    expect(() => importanceSamplingProbability([true], [1], { level: 1 })).toThrow(RangeError);
  });

  it("accepts a weight of exactly zero", () => {
    // Legal and meaningful: the proposal visited somewhere the nominal
    // distribution puts no mass.
    const e = importanceSamplingProbability([true, true], [0, 2]);
    expect(e.pHat).toBe(1);
  });
});

describe("importanceSamplingProbability: the estimator", () => {
  it("reduces to the plain hit fraction when every weight is 1", () => {
    // w == 1 is g == f, i.e. no importance sampling at all. The estimator must
    // then be exactly the brute-force one -- this is the identity that makes
    // the two comparable in the demo.
    const indicators = [true, false, true, false, false, false, false, false];
    const e = importanceSamplingProbability(
      indicators,
      indicators.map(() => 1),
    );
    expect(e.pHat).toBe(2 / 8);
    expect(e.hits).toBe(2);
    expect(e.trials).toBe(8);
  });

  it("averages the weights of the draws that hit, over all draws", () => {
    const e = importanceSamplingProbability([true, false, true, false], [0.5, 99, 1.5, 99]);
    expect(e.pHat).toBeCloseTo((0.5 + 1.5) / 4, 15);
  });

  it("ignores the weights of draws that missed", () => {
    // A near-certain proof that the indicator gates the weight rather than the
    // other way round: changing a missing draw's weight to something enormous
    // must not move the estimate at all.
    const a = importanceSamplingProbability([true, false], [2, 1]);
    const b = importanceSamplingProbability([true, false], [2, 1e12]);
    expect(b.pHat).toBe(a.pHat);
  });

  it("reports NaN diagnostics, not zeros, when nothing contributed", () => {
    // The distinction matters: 0 would read as "perfectly concentrated" or
    // "no uncertainty", and this sample supports neither statement.
    const e = importanceSamplingProbability([false, false, false], [1, 1, 1]);
    expect(e.pHat).toBe(0);
    expect(e.hits).toBe(0);
    expect(e.effectiveSampleSize).toBeNaN();
    expect(e.weightEfficiency).toBeNaN();
    expect(e.maxWeightShare).toBeNaN();
  });

  it("clamps the interval into [0, 1]", () => {
    const e = importanceSamplingProbability([true, false, true, false], [1, 1, 1, 1]);
    expect(e.lower).toBeGreaterThanOrEqual(0);
    expect(e.upper).toBeLessThanOrEqual(1);
    expect(e.level).toBe(DEFAULT_IS_LEVEL);
  });
});

describe("importanceSamplingProbability: the degeneracy diagnostics", () => {
  it("gives ESS equal to the count when every contributing weight is equal", () => {
    // Kish's ESS is (sum w)^2 / sum w^2, which for k equal weights is exactly
    // k regardless of their common value.
    const e = importanceSamplingProbability([true, true, true, false], [3, 3, 3, 0]);
    expect(e.effectiveSampleSize).toBeCloseTo(3, 12);
    expect(e.weightEfficiency).toBeCloseTo(3 / 4, 12);
    expect(e.maxWeightShare).toBeCloseTo(1 / 3, 12);
  });

  it("collapses ESS towards 1 when one weight dominates", () => {
    // This is the failure mode the diagnostics exist for: 100 draws, 100 hits,
    // a perfectly ordinary-looking pHat, and an answer that is one draw.
    const n = 100;
    const indicators = Array.from({ length: n }, () => true);
    const weights = Array.from({ length: n }, (_, i) => (i === 0 ? 1e6 : 1));
    const e = importanceSamplingProbability(indicators, weights);

    expect(e.hits).toBe(n);
    expect(e.effectiveSampleSize).toBeLessThan(1.001);
    expect(e.maxWeightShare).toBeGreaterThan(0.99);
  });

  it("keeps ESS at or below the number of hits", () => {
    // A structural bound worth pinning: no weighting can carry more
    // information than the number of draws that actually contributed.
    const e = importanceSamplingProbability([true, true, false, false, false], [1, 4, 9, 9, 9]);
    expect(e.effectiveSampleSize).toBeLessThanOrEqual(2 + 1e-12);
  });
});

describe("normalShiftLikelihoodRatio", () => {
  it("is exactly 1 for a zero shift", () => {
    // Exactly, not approximately -- the closed form short-circuits rather than
    // subtracting two equal squared z-scores. Checked at a point far from the
    // mean, where the difference form loses the most.
    const proposal: NormalShiftProposal = { mean: 30, sigma: 2, proposalMean: 30 };
    expect(normalShiftLikelihoodRatio(1e6, proposal)).toBe(1);
  });

  it("matches the ratio of the two densities, computed independently", () => {
    // The negative control on the algebra: normalPdf is the engine's own
    // density and knows nothing about this module's exponent.
    const proposal: NormalShiftProposal = { mean: 40, sigma: 3, proposalMean: 46 };
    for (const x of [30, 40, 46, 50, 58]) {
      const direct =
        normalPdf((x - proposal.mean) / proposal.sigma) /
        normalPdf((x - proposal.proposalMean) / proposal.sigma);
      expect(normalShiftLikelihoodRatio(x, proposal)).toBeCloseTo(direct, 10);
    }
  });

  it("is below 1 out in the direction of the shift, and above 1 behind it", () => {
    // The sign convention, stated as behaviour: the proposal over-samples the
    // tail, so draws out there must be discounted.
    const proposal: NormalShiftProposal = { mean: 0, sigma: 1, proposalMean: 4 };
    expect(normalShiftLikelihoodRatio(5, proposal)).toBeLessThan(1);
    expect(normalShiftLikelihoodRatio(-1, proposal)).toBeGreaterThan(1);
    // The crossing is at the midpoint of the two means, where the densities agree.
    expect(normalShiftLikelihoodRatio(2, proposal)).toBeCloseTo(1, 12);
  });

  it("refuses an invalid proposal", () => {
    expect(() => normalShiftLikelihoodRatio(0, { mean: 0, sigma: 0, proposalMean: 1 })).toThrow(
      RangeError,
    );
    expect(() => normalShiftLikelihoodRatio(0, { mean: 0, sigma: -1, proposalMean: 1 })).toThrow(
      RangeError,
    );
    expect(() =>
      normalShiftLikelihoodRatio(0, { mean: Number.NaN, sigma: 1, proposalMean: 1 }),
    ).toThrow(RangeError);
  });
});

describe("normalShiftProposal", () => {
  it("puts the proposal mean on the threshold", () => {
    expect(normalShiftProposal(30, 2, 38).proposalMean).toBe(38);
  });

  it("does not tilt towards an event that is not rare", () => {
    // A threshold at or below the mean means the event has probability >= 1/2.
    // Tilting there raises the variance; the honest response is to sample
    // directly, which is what a zero shift is.
    expect(normalShiftProposal(30, 2, 30).proposalMean).toBe(30);
    expect(normalShiftProposal(30, 2, 25).proposalMean).toBe(30);
  });

  it("refuses invalid arguments", () => {
    expect(() => normalShiftProposal(30, 0, 38)).toThrow(RangeError);
    expect(() => normalShiftProposal(30, 2, Number.NaN)).toThrow(RangeError);
  });
});

describe("normalTailProbability", () => {
  it("is 1/2 at the mean and symmetric about it", () => {
    expect(normalTailProbability(30, 2, 30)).toBeCloseTo(0.5, 12);
    expect(normalTailProbability(0, 1, 1) + normalTailProbability(0, 1, -1)).toBeCloseTo(1, 12);
  });

  it("matches the textbook 1, 2, 3 sigma tails", () => {
    expect(normalTailProbability(0, 1, 1)).toBeCloseTo(0.15865525393, 9);
    expect(normalTailProbability(0, 1, 2)).toBeCloseTo(0.02275013195, 9);
    expect(normalTailProbability(0, 1, 3)).toBeCloseTo(0.00134989803, 9);
  });

  it("stays accurate far out, where 1 - cdf has cancelled away", () => {
    // The reason the module imports normalUpperTail rather than doing
    // 1 - normalCdf(z): at z = 8 the latter is exactly 0 in double precision
    // and the whole demo would be comparing estimators against zero.
    expect(normalTailProbability(0, 1, 8)).toBeGreaterThan(0);
    expect(normalTailProbability(0, 1, 8)).toBeCloseTo(6.22096057e-16, 20);
  });

  it("refuses a non-positive sigma", () => {
    expect(() => normalTailProbability(0, 0, 1)).toThrow(RangeError);
  });
});

describe("bruteForceSampleSize", () => {
  it("scales as 1/p for a fixed relative error", () => {
    // The claim the module header opens with, checked rather than asserted in
    // prose: a tenfold rarer event costs about tenfold more draws.
    const a = bruteForceSampleSize(1e-3, 0.1);
    const b = bruteForceSampleSize(1e-4, 0.1);
    expect(b / a).toBeCloseTo(10, 1);
  });

  it("scales as 1/rse^2", () => {
    const a = bruteForceSampleSize(1e-3, 0.1);
    const b = bruteForceSampleSize(1e-3, 0.05);
    expect(b / a).toBeCloseTo(4, 6);
  });

  it("refuses arguments outside its domain", () => {
    expect(() => bruteForceSampleSize(0, 0.1)).toThrow(RangeError);
    expect(() => bruteForceSampleSize(1, 0.1)).toThrow(RangeError);
    expect(() => bruteForceSampleSize(0.1, 0)).toThrow(RangeError);
  });
});

describe("validateNormalShiftProposal", () => {
  it("accepts a well-formed proposal and rejects each malformed field", () => {
    expect(() => validateNormalShiftProposal({ mean: 1, sigma: 2, proposalMean: 3 })).not.toThrow();
    expect(() =>
      validateNormalShiftProposal({ mean: Number.NaN, sigma: 2, proposalMean: 3 }),
    ).toThrow(/mean must be finite/);
    expect(() =>
      validateNormalShiftProposal({ mean: 1, sigma: 2, proposalMean: Number.POSITIVE_INFINITY }),
    ).toThrow(/proposalMean must be finite/);
    expect(() =>
      validateNormalShiftProposal({ mean: 1, sigma: Number.POSITIVE_INFINITY, proposalMean: 3 }),
    ).toThrow(/sigma must be positive and finite/);
  });
});

describe("formatImportanceSamplingEstimate", () => {
  it("renders the estimate and both diagnostics", () => {
    const e = importanceSamplingProbability([true, true, false, false], [0.5, 0.5, 1, 1]);
    const text = formatImportanceSamplingEstimate(e);
    expect(text).toMatch(/^p=2\.50e-1/);
    expect(text).toContain("ESS 2/4 (50%)");
    expect(text).toContain("max share 0.50");
  });

  it("says so rather than printing NaN when nothing contributed", () => {
    const e = importanceSamplingProbability([false, false], [1, 1]);
    const text = formatImportanceSamplingEstimate(e);
    expect(text).toContain("ESS none");
    expect(text).toContain("max share n/a");
    expect(text).not.toContain("NaN%");
  });
});
