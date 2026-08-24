import { describe, expect, it } from "vitest";
import {
  PRESET_SCENARIOS,
  uncertainScenarioSpecSchema,
  type ScenarioSpec,
  type UncertainScenarioSpec,
} from "@ballista/engine";
import { mcConvergenceStudy } from "@ballista/analysis";
import { createMcColumns, runMcRange, type McJob } from "./mc-job.js";

/**
 * P6.07's validation criterion, measured on the real range observable:
 * **log-log slope of the estimator's standard error against batch size is
 * -0.50 +/- 0.05.**
 *
 * `mc-convergence.test.ts` in analysis exercises the estimator itself against
 * synthetic normals. This file is the half that matters for the criterion: the
 * samples are ranges produced by the actual Monte Carlo pipeline -- P6.03's
 * substream replicate generator, P6.04's observable sink, the same integrator
 * an interactive solve uses -- so what is measured is that *this pipeline's*
 * replicates are independent enough for the Monte Carlo rate to hold end to
 * end. A seeding scheme that accidentally aligned substreams would still
 * produce ranges, still produce a mean, and would fail here.
 *
 * **Nothing in this file is random.** Replicate `i` is a pure function of the
 * study's seed and `i` (P6.03), and the pool is a fixed index range, so the
 * measured slope is a fixed number rather than a draw -- the test cannot flake.
 * The multi-seed robustness argument lives in the analysis suite, where a pool
 * costs microseconds instead of an integration each; here a second pool would
 * double the slowest test in the package for a property already established.
 */

/** Pool size. Divides evenly by every entry of {@link BATCH_SIZES}. */
const POOL = 49152;

/**
 * Seven sizes spanning a factor of 64. The span is what buys slope precision:
 * the standard-error estimate at size `N` is itself noisy (it comes from
 * `POOL/N` batch means, so the largest size is the least certain, here 48
 * batches for ~10% relative error), and widening the lever arm in `log N`
 * divides that noise down. Seven points over 16..1024 put the expected slope
 * uncertainty near 0.02, comfortably inside the criterion's 0.05.
 *
 * Starting as low as 16 is legitimate and not a small-sample cheat:
 * `Var(mean of N) = sigma^2/N` is exact for iid samples of finite variance, so
 * the law under test holds at every `N` and needs no appeal to the CLT.
 */
const BATCH_SIZES = [16, 32, 64, 128, 256, 512, 1024];

const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!;

/**
 * Ground-level drag-free base with normal jitter on both velocity components.
 * Drag-free keeps a replicate cheap enough to afford {@link POOL} of them, and
 * gives the range observable a closed form, so the pooled spread below can be
 * sanity-checked against something other than itself.
 */
const BASE: ScenarioSpec = {
  ...DRAG_FREE,
  initialConditions: { ...DRAG_FREE.initialConditions, x0: 0, y0: 0 },
};

const STUDY: UncertainScenarioSpec = uncertainScenarioSpecSchema.parse({
  schemaVersion: 1,
  base: BASE,
  overlays: [
    {
      path: "initialConditions.vx0",
      distribution: { kind: "normal", mean: BASE.initialConditions.vx0, stdDev: 2 },
    },
    {
      path: "initialConditions.vy0",
      distribution: { kind: "normal", mean: BASE.initialConditions.vy0, stdDev: 2 },
    },
  ],
  replicates: POOL,
  seed: 20260824,
});

/**
 * The range column for replicates `[0, POOL)`, and how many of them landed.
 *
 * Computed once and shared: the integration is the expensive part and every
 * assertion below reads the same pool.
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
const STUDY_RESULT = mcConvergenceStudy(POOLED.ranges, BATCH_SIZES);

describe("P6.07 MC convergence on the range observable", () => {
  /**
   * `mc-job.ts` defers to this task the question of what to do with a replicate
   * that never reached the ground inside `MC_T_MAX_SECONDS`: its "impact point"
   * is wherever it happened to be at the horizon, so averaging it in biases the
   * estimator invisibly. **The decision is to exclude it from the pool.**
   *
   * Asserting that this study loses none of them is what makes that decision
   * free here rather than a silent change of batch size: with every replicate
   * landing, a batch of `N` really does hold `N` samples. A study that did
   * truncate would need the batch sizes recomputed against the landed count,
   * which is why the exclusion happens before {@link mcConvergenceStudy} sees
   * the pool rather than inside it.
   */
  it("lands every replicate, so the batch sizes mean what they say", () => {
    expect(POOLED.landed).toBe(POOL);
    expect(POOLED.ranges).toHaveLength(POOL);
  });

  it("meets the criterion: log-log slope of SE against N is -0.50 +/- 0.05", () => {
    expect(STUDY_RESULT.slope).not.toBeNull();
    expect(
      Math.abs(STUDY_RESULT.slope! + 0.5),
      `measured slope ${STUDY_RESULT.slope}`,
    ).toBeLessThan(0.05);
  });

  it("uses every requested batch size with whole disjoint batches", () => {
    expect(STUDY_RESULT.points.map((p) => p.batchSize)).toEqual(BATCH_SIZES);
    for (const p of STUDY_RESULT.points) {
      expect(p.batchCount).toBe(POOL / p.batchSize);
      expect(p.batchCount * p.batchSize).toBe(POOL);
    }
  });

  it("shrinks the measured standard error monotonically as the batch grows", () => {
    // The slope is a fit and could in principle be met by a curve that wobbles;
    // on this pool the ordering is clean, and asserting it catches a pipeline
    // change that widens the estimator at some size while leaving the fit
    // nominally inside tolerance.
    for (let i = 1; i < STUDY_RESULT.points.length; i++) {
      expect(STUDY_RESULT.points[i]!.standardError).toBeLessThan(
        STUDY_RESULT.points[i - 1]!.standardError,
      );
    }
  });

  it("agrees with the derived sigma/sqrt(N) at every batch size", () => {
    // Independent confirmation from the other direction: the measured spread
    // and the spread the 1/sqrt(N) law predicts from the per-replicate sigma
    // track each other. They would part company if the replicates were
    // correlated -- that is the case the analysis suite asserts explicitly.
    for (const p of STUDY_RESULT.points) {
      const ratio = p.standardError / p.predictedStandardError;
      expect(ratio, `batch ${p.batchSize} ratio ${ratio}`).toBeGreaterThan(0.75);
      expect(ratio, `batch ${p.batchSize} ratio ${ratio}`).toBeLessThan(1.25);
    }
  });

  it("estimates the same per-replicate sigma at every batch size", () => {
    // pooledStdDev is computed over the whole pool each time, so this is really
    // a check that no batch size silently truncates the pool.
    const first = STUDY_RESULT.points[0]!.pooledStdDev;
    expect(first).toBeGreaterThan(0);
    for (const p of STUDY_RESULT.points) {
      expect(p.pooledStdDev).toBeCloseTo(first, 12);
    }
  });

  it("is reproducible: the same index range gives a bit-identical slope", () => {
    // P6.03's guarantee is that replicate i does not depend on how the work was
    // partitioned. Re-running the pool in two halves must therefore reproduce
    // the pool exactly, and with it the slope -- which is what lets this test
    // assert a fixed number instead of a tolerance band around a random draw.
    const job: McJob = { study: STUDY };
    const half = POOL / 2;
    const a = createMcColumns(half);
    const b = createMcColumns(half);
    runMcRange(job, 0, half, a);
    runMcRange(job, half, POOL, b);
    const rejoined = [...a.range.subarray(0, half), ...b.range.subarray(0, half)];
    expect(rejoined).toEqual(POOLED.ranges);
    expect(mcConvergenceStudy(rejoined, BATCH_SIZES).slope).toBe(STUDY_RESULT.slope);
  });
});
