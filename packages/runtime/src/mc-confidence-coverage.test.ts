import { describe, expect, it } from "vitest";
import {
  G_STD,
  PRESET_SCENARIOS,
  normalQuantile,
  uncertainScenarioSpecSchema,
  type ScenarioSpec,
  type UncertainScenarioSpec,
} from "@ballista/engine";
import { coverageOfMean, meanConfidenceInterval, standardErrorOfMean } from "@ballista/analysis";
import { createMcColumns, runMcRange, type McJob } from "./mc-job.js";

/**
 * P6.08's validation criterion, measured on the real range observable:
 * **a 95% confidence interval covers the truth about 95% of the time over 200
 * repeats, against the drag-free analytic range.**
 *
 * `confidence-interval.test.ts` in analysis exercises the interval against
 * synthetic normals, where coverage is guaranteed by construction and so proves
 * only that the counting is right. This file is the half that matters: the
 * samples are ranges from the actual Monte Carlo pipeline -- P6.03's substream
 * replicate generator, P6.04's observable sink, the same integrator an
 * interactive solve uses -- whose per-replicate distribution is *not* normal.
 * A `t` interval's coverage on non-normal data is an asymptotic claim, so it is
 * a thing to measure rather than to assume.
 *
 * **THE TRUTH IS EXACT, NOT ESTIMATED.** This is the whole reason the criterion
 * names the drag-free case. A coverage test needs something to cover, and for a
 * jittered ensemble the analytic value at the mean inputs is generally the
 * wrong target, because `E[f(X)] != f(E[X])` for nonlinear `f`. Drag-free
 * ground-launch range is the exception: it is
 *
 *     R = v_x0 * (2 * v_y0 / g) = 2 * v_x0 * v_y0 / g
 *
 * which is **bilinear**, not merely nonlinear. So for *independent* jitter on
 * the two components,
 *
 *     E[R] = 2 * E[v_x0] * E[v_y0] / g
 *
 * holds exactly -- no linearisation, no CLT appeal, no error term to bound. The
 * independence is what P6.03's substream-per-pair generator supplies, so the
 * criterion is quietly also a check on that: a seeding scheme that correlated
 * the two overlays would shift `E[R]` off {@link TRUTH} and the coverage would
 * collapse.
 *
 * **Nothing here is random.** Replicate `i` is a pure function of the study's
 * seed and `i`, and each repeat is a fixed disjoint index window, so the
 * measured coverage is a fixed number rather than a draw and the test cannot
 * flake. The assertion band is nonetheless written against the binomial spread
 * rather than tuned to the number this run produces -- see
 * {@link COVERAGE_SIGMA}.
 */

/** The criterion's repeat count. */
const REPEATS = 200;

/**
 * Replicates per repeat. Small on purpose: at `n = 64` the `t` multiplier is
 * 1.998 against the normal's 1.960, so the interval is genuinely `t`-shaped
 * rather than a normal band in disguise, while still being wide enough that the
 * CLT has visibly done its work on a non-normal per-replicate distribution.
 */
const SAMPLE_SIZE = 64;

const POOL = REPEATS * SAMPLE_SIZE;

/**
 * One standard deviation of the observed coverage proportion *if* coverage were
 * exactly nominal: `sqrt(0.95 * 0.05 / 200) = 0.0154`, about 3 successes out of
 * 200.
 *
 * Every assertion on coverage below is written in these units. A proportion
 * compared directly against 0.95 gives a test that either never fails (loose
 * tolerance) or fails on an irrelevant fluctuation (tight one); neither says
 * anything about the interval.
 */
const COVERAGE_SIGMA = Math.sqrt((0.95 * 0.05) / REPEATS);

const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!;

/**
 * Ground-level drag-free base. `y0` is forced to 0 because the closed form
 * above is the *ground-launch* one: a raised launch carries a
 * `sqrt(v_y0^2 + 2*g*y0)` term that is not bilinear, and {@link TRUTH} would
 * silently stop being the truth.
 */
const BASE: ScenarioSpec = {
  ...DRAG_FREE,
  initialConditions: { ...DRAG_FREE.initialConditions, x0: 0, y0: 0 },
};

const MEAN_VX0 = BASE.initialConditions.vx0;
const MEAN_VY0 = BASE.initialConditions.vy0;

/** `E[range] = 2 * E[vx0] * E[vy0] / g`, exactly. See the header. */
const TRUTH = (2 * MEAN_VX0 * MEAN_VY0) / G_STD;

const STUDY: UncertainScenarioSpec = uncertainScenarioSpecSchema.parse({
  schemaVersion: 1,
  base: BASE,
  overlays: [
    {
      path: "initialConditions.vx0",
      distribution: { kind: "normal", mean: MEAN_VX0, stdDev: 2 },
    },
    {
      path: "initialConditions.vy0",
      distribution: { kind: "normal", mean: MEAN_VY0, stdDev: 2 },
    },
  ],
  replicates: POOL,
  seed: 20260825,
});

/**
 * The whole pool of ranges, and how many replicates landed.
 *
 * Computed once. The integration is the expensive part and every assertion
 * below reads the same pool, sliced into repeats.
 */
function rangePool(): { ranges: number[]; landed: number } {
  const job: McJob = { study: STUDY };
  const out = createMcColumns(POOL);
  runMcRange(job, 0, POOL, out);
  const ranges: number[] = [];
  let landed = 0;
  for (let i = 0; i < POOL; i++) {
    if (out.landed[i] === 1) {
      landed++;
      ranges.push(out.range[i]!);
    }
  }
  return { ranges, landed };
}

const POOLED = rangePool();

/** Disjoint consecutive windows of {@link SAMPLE_SIZE}, one per repeat. */
function repeats(size = SAMPLE_SIZE): number[][] {
  const out: number[][] = [];
  for (let r = 0; r * size + size <= POOLED.ranges.length; r++) {
    out.push(POOLED.ranges.slice(r * size, r * size + size));
  }
  return out;
}

const SAMPLES = repeats();
const COVERAGE = coverageOfMean(SAMPLES, TRUTH, 0.95);

describe("P6.08 confidence-interval coverage on the range observable", () => {
  it("lands every replicate, so each repeat holds the sample size it claims", () => {
    expect(POOLED.landed).toBe(POOL);
    expect(SAMPLES).toHaveLength(REPEATS);
    expect(COVERAGE.repeats).toBe(REPEATS);
    expect(COVERAGE.skipped).toBe(0);
  });

  /**
   * The truth is asserted before it is used. If `E[range]` were not
   * `2*E[vx0]*E[vy0]/g` -- because the overlays were correlated, or the
   * integrator carried a bias, or `y0` were not 0 -- then every coverage figure
   * below would be measuring the wrong thing while still looking plausible.
   *
   * The whole pool's mean is compared to {@link TRUTH} in units of its own
   * standard error, so this is a real bias check rather than a tolerance
   * guessed at: 12800 replicates put the standard error near 0.11 m, and a
   * systematic error large enough to matter for coverage (a few percent of the
   * ~3 m half-width) would show up as many sigma here.
   */
  it("has the analytic truth the criterion names: E[range] = 2*E[vx0]*E[vy0]/g", () => {
    const wholePool = POOLED.ranges;
    let mean = 0;
    for (const r of wholePool) mean += r;
    mean /= wholePool.length;
    const se = standardErrorOfMean(wholePool)!;
    const deviation = Math.abs(mean - TRUTH) / se;
    expect(
      deviation,
      `pool mean ${mean} vs analytic ${TRUTH}, ${deviation.toFixed(2)} SE away`,
    ).toBeLessThan(3);
  });

  it("meets the criterion: a 95% interval covers the truth ~95% of the time over 200 repeats", () => {
    const deviation = Math.abs(COVERAGE.coverage - 0.95) / COVERAGE_SIGMA;
    expect(
      deviation,
      `coverage ${COVERAGE.covered}/${REPEATS} = ${COVERAGE.coverage}, ` +
        `${deviation.toFixed(2)} binomial sigma from nominal`,
    ).toBeLessThan(3);
  });

  it("reports the binomial scale the assertion above is written in", () => {
    expect(COVERAGE.standardError).toBeCloseTo(COVERAGE_SIGMA, 15);
    expect(COVERAGE.nominal).toBe(0.95);
  });

  /**
   * The counterexample. A criterion that only ever checks the passing case
   * cannot distinguish a working interval from one that is simply very wide --
   * an interval of infinite width would score 100% coverage and pass a
   * one-sided reading of "covers ~95%".
   *
   * Displacing the truth by four standard errors of a single repeat's mean must
   * drop coverage to nothing.
   */
  it("collapses when the truth is displaced, so width alone cannot pass it", () => {
    const oneRepeatSe = standardErrorOfMean(SAMPLES[0]!)!;
    const displaced = coverageOfMean(SAMPLES, TRUTH + 4 * oneRepeatSe, 0.95);
    expect(displaced.coverage).toBeLessThan(0.5);
  });

  /**
   * The level is a dial, not a decoration: an 80% interval must cover about
   * 80%. A multiplier that ignored `level` -- always returning the 95% one --
   * would pass the criterion above and fail here.
   */
  it("tracks the requested level: an 80% interval covers about 80%", () => {
    const eighty = coverageOfMean(SAMPLES, TRUTH, 0.8);
    const sigma = Math.sqrt((0.8 * 0.2) / REPEATS);
    const deviation = Math.abs(eighty.coverage - 0.8) / sigma;
    expect(
      deviation,
      `80% coverage ${eighty.covered}/${REPEATS} = ${eighty.coverage}`,
    ).toBeLessThan(3);
  });

  /**
   * **Why the task says "t-based" rather than just "CI".** At `n = 5` the 95%
   * `t` multiplier is 2.776 and the normal's is 1.960, so a `z` band is 29% too
   * narrow. This measures the resulting under-coverage on the real pipeline
   * instead of asserting it from theory: the `t` interval should sit near 95%
   * while the `z` one falls clearly short of it.
   *
   * 5 replicates per repeat, so `df = 4` where the gap is largest.
   */
  it("under-covers if the normal multiplier is used instead of the t one", () => {
    const small = repeats(5).slice(0, REPEATS);
    expect(small).toHaveLength(REPEATS);

    const tCoverage = coverageOfMean(small, TRUTH, 0.95);

    // The same intervals rebuilt with z = 1.96 in place of t = 2.776.
    const z = normalQuantile(0.975);
    let zCovered = 0;
    for (const sample of small) {
      const ci = meanConfidenceInterval(sample, 0.95)!;
      const half = z * ci.standardError;
      if (TRUTH >= ci.mean - half && TRUTH <= ci.mean + half) zCovered++;
    }
    const zCoverage = zCovered / REPEATS;

    expect(
      tCoverage.coverage,
      `t coverage at n=5: ${tCoverage.covered}/${REPEATS}`,
    ).toBeGreaterThan(zCoverage);
    expect(zCoverage, `z coverage at n=5: ${zCovered}/${REPEATS}`).toBeLessThan(0.93);
    expect(Math.abs(tCoverage.coverage - 0.95) / COVERAGE_SIGMA).toBeLessThan(3);
  });

  /**
   * Every interval must actually contain its own point estimate, and the
   * reported half-width must be the distance to each end. Cheap, and it catches
   * a sign or ordering error that coverage statistics would average away.
   */
  it("brackets its own estimate symmetrically in every repeat", () => {
    for (const sample of SAMPLES) {
      const ci = meanConfidenceInterval(sample)!;
      expect(ci.sampleSize).toBe(SAMPLE_SIZE);
      expect(ci.degreesOfFreedom).toBe(SAMPLE_SIZE - 1);
      expect(ci.lower).toBeLessThan(ci.mean);
      expect(ci.upper).toBeGreaterThan(ci.mean);
      expect(ci.upper - ci.mean).toBeCloseTo(ci.halfWidth, 12);
      expect(ci.mean - ci.lower).toBeCloseTo(ci.halfWidth, 12);
    }
  });
});
