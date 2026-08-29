/**
 * P6.15's validation criterion, measured: *"error ~N^(-1) slope on a smooth
 * 2-param problem (measured vs MC)"*. (The structural properties the rate
 * rests on — the direction numbers, the net, the scramble's nesting — are
 * verified separately in `packages/engine/src/sobol.test.ts`.)
 *
 * ## The problem
 *
 * Two drawn parameters, launch speed and elevation angle, both uniform; the
 * observable is {@link dragFreeRange}, `v0^2 sin(2 theta) / g`. It is chosen
 * for three reasons.
 *
 * - **Smooth, and genuinely two-dimensional.** QMC's advantage is a statement
 *   about integrands of bounded variation; a discontinuous one would measure
 *   the method's weakness instead, which the last test here does deliberately.
 * - **The truth is a closed form**, so the error being fitted is the real
 *   error against an exact value rather than a difference from a reference
 *   estimate that carries its own noise. With `v0 ~ U(a, b)` and
 *   `theta ~ U(c, d)` independent, the mean factorises:
 *   `E[v0^2] * E[sin 2theta] / g`, with `E[v0^2] = (b^3 - a^3) / (3(b - a))`
 *   and `E[sin 2theta] = (cos 2c - cos 2d) / (2(d - c))`.
 * - **The closed form, not an integrated trajectory**, for the same reason the
 *   antithetic and LHS measurements next door use it: an integrator's own
 *   error inside every figure would turn this into a measurement of two things
 *   at once.
 *
 * ## What is being fitted, and why it is an RMSE rather than one error
 *
 * A *scrambled* Sobol' estimate is random — that is the entire point of
 * scrambling — so a single study's error at one `N` is a draw, not a rate. The
 * quantity with a rate is the root-mean-square error over independent scramble
 * seeds, and that is what is regressed against `N` on log-log axes. Plain
 * Monte Carlo is measured identically, over the same number of independent
 * studies at the same sizes, so the two slopes are comparable by construction
 * rather than by argument.
 *
 * The sampling here goes through `sobolUniform` and `distributionQuantile`
 * rather than through `sobolReplicates`, because a rate needs many sizes times
 * many seeds and full replicate construction re-parses a scenario schema per
 * draw. The wired-up path is checked to agree with this one, on a small case,
 * in the last test but one — so the shortcut is verified rather than assumed.
 */

import { describe, expect, it } from "vitest";
import {
  distributionQuantile,
  distributionSpecSchema,
  scenarioSpecSchema,
  sobolReplicates,
  sobolUniform,
  uncertainScenarioSpecSchema,
  PRESET_SCENARIOS,
  type DistributionSpec,
  type ScenarioSpec,
  type UncertainScenarioSpec,
} from "@ballista/engine";
import { dragFreeRange } from "./range-root.js";

/** Standard gravity, matching `dragFreeRange`'s own default. */
const G = 9.80665;

const SPEED_MIN = 30;
const SPEED_MAX = 50;
const ANGLE_MIN = Math.PI / 8;
const ANGLE_MAX = (3 * Math.PI) / 8;

const SPEED: DistributionSpec = distributionSpecSchema.parse({
  kind: "uniform",
  min: SPEED_MIN,
  max: SPEED_MAX,
});
const ANGLE: DistributionSpec = distributionSpecSchema.parse({
  kind: "uniform",
  min: ANGLE_MIN,
  max: ANGLE_MAX,
});

/** `E[v0^2 sin(2 theta) / g]` for independent uniforms — the exact value fitted against. */
const EXACT_MEAN =
  ((SPEED_MAX ** 3 - SPEED_MIN ** 3) / (3 * (SPEED_MAX - SPEED_MIN))) *
  ((Math.cos(2 * ANGLE_MIN) - Math.cos(2 * ANGLE_MAX)) / (2 * (ANGLE_MAX - ANGLE_MIN))) *
  (1 / G);

/** Study sizes. Powers of two, where a Sobol' sequence's balance is exact. */
const SIZES = [64, 128, 256, 512, 1024, 2048, 4096, 8192] as const;

/** Independent scramble seeds (or independent MC studies) per size. */
const TRIALS = 24;

/** A deterministic uniform stream for the plain-MC comparison. */
function makeRng(seed: number): () => number {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function observable(u0: number, u1: number): number {
  return dragFreeRange(distributionQuantile(SPEED, u0), distributionQuantile(ANGLE, u1), G);
}

function sobolMean(scrambleSeed: number, n: number): number {
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    total += observable(sobolUniform(scrambleSeed, i, 0), sobolUniform(scrambleSeed, i, 1));
  }
  return total / n;
}

function monteCarloMean(seed: number, n: number): number {
  const rng = makeRng(seed);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    // Guard the open interval `distributionQuantile` requires; `rng` can
    // return exactly 0.
    const u0 = rng() || Number.MIN_VALUE;
    const u1 = rng() || Number.MIN_VALUE;
    total += observable(u0, u1);
  }
  return total / n;
}

function rootMeanSquareError(means: readonly number[]): number {
  const squared = means.reduce((acc, mean) => acc + (mean - EXACT_MEAN) ** 2, 0);
  return Math.sqrt(squared / means.length);
}

/** Least-squares slope of `log2(error)` against `log2(N)`. */
function logLogSlope(sizes: readonly number[], errors: readonly number[]): number {
  const xs = sizes.map((n) => Math.log2(n));
  const ys = errors.map((e) => Math.log2(e));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let numerator = 0;
  let denominator = 0;
  xs.forEach((x, i) => {
    numerator += (x - meanX) * ((ys[i] ?? 0) - meanY);
    denominator += (x - meanX) ** 2;
  });
  return numerator / denominator;
}

function sobolErrors(): number[] {
  return SIZES.map((n) =>
    rootMeanSquareError(
      Array.from({ length: TRIALS }, (_, trial) => sobolMean(0x51b0 + trial * 7919, n)),
    ),
  );
}

function monteCarloErrors(): number[] {
  return SIZES.map((n) =>
    rootMeanSquareError(
      Array.from({ length: TRIALS }, (_, trial) => monteCarloMean(0x4d43 + trial * 7907, n)),
    ),
  );
}

describe("P6.15 — scrambled Sobol' convergence on a smooth two-parameter problem", () => {
  it("converges at a rate near N^(-1), where plain Monte Carlo manages N^(-1/2)", () => {
    const qmc = sobolErrors();
    const mc = monteCarloErrors();
    const qmcSlope = logLogSlope(SIZES, qmc);
    const mcSlope = logLogSlope(SIZES, mc);

    // Recorded so a future regression reads as a number rather than a verdict.
    console.log(
      `sobol RMSE: ${qmc.map((e) => e.toExponential(3)).join(", ")}\n` +
        `mc    RMSE: ${mc.map((e) => e.toExponential(3)).join(", ")}\n` +
        `slopes: sobol ${qmcSlope.toFixed(4)}, mc ${mcSlope.toFixed(4)}`,
    );

    // The criterion as stated: ~N^(-1), and a slope this steep is unreachable
    // for any independent-sampling estimator.
    expect(qmcSlope).toBeLessThan(-0.85);

    // The criterion is comfortably beaten, and the margin is not luck -- it is
    // the signature of the scramble being *nested* rather than a plain digital
    // shift. Owen (1997) gives RMSE = O(N^(-3/2) (log N)^((s-1)/2)) for a
    // smooth integrand under nested uniform scrambling, against O(N^(-1)) for
    // a shift, and that is what shows up here. Measured on this machine:
    //
    //   nested scramble, five independent seed families:
    //     -1.4598, -1.3749, -1.3648, -1.4044, -1.3888
    //   the same points under a digital (XOR) shift instead:
    //     -1.0297
    //
    // So this bound is a real regression guard, not a restatement of the one
    // above: replacing `nestedUniformScramble` with a shift -- the easy
    // simplification, and one that would leave every structural test in
    // `sobol.test.ts` passing -- lands at -1.03 and fails here. -1.2 sits
    // clear of both the worst nested figure and the shift.
    expect(qmcSlope).toBeLessThan(-1.2);

    // Plain MC at the same sizes, for the "measured vs MC" half of the
    // criterion. Its -1/2 is a theorem, so this is really a check that the
    // comparison is like for like.
    expect(mcSlope).toBeGreaterThan(-0.65);
    expect(mcSlope).toBeLessThan(-0.35);

    // And the gap, which is the thing a user actually gets.
    expect(qmcSlope).toBeLessThan(mcSlope - 0.3);
  });

  it("is far more accurate than Monte Carlo at the largest size measured", () => {
    const n = SIZES[SIZES.length - 1] ?? 8192;
    const qmc = rootMeanSquareError(
      Array.from({ length: TRIALS }, (_, trial) => sobolMean(0x51b0 + trial * 7919, n)),
    );
    const mc = rootMeanSquareError(
      Array.from({ length: TRIALS }, (_, trial) => monteCarloMean(0x4d43 + trial * 7907, n)),
    );
    console.log(`at N=${n}: sobol ${qmc.toExponential(3)}, mc ${mc.toExponential(3)}`);
    expect(qmc).toBeLessThan(mc / 8);
  });

  it("is unbiased — the scramble is what buys this, and it is the reason for it", () => {
    // An unscrambled Sobol' estimate has a fixed error and no distribution.
    // Scrambled, the estimate is a random variable with the right mean, so the
    // average over independent scrambles converges on the truth. Held to the
    // estimator's own standard error, which is what makes this an assertion
    // about bias rather than about accuracy.
    const n = 1024;
    const trials = 64;
    const means = Array.from({ length: trials }, (_, trial) => sobolMean(0x7c00 + trial * 6971, n));
    const mean = means.reduce((a, b) => a + b, 0) / trials;
    const variance = means.reduce((acc, m) => acc + (m - mean) ** 2, 0) / (trials - 1);
    const standardError = Math.sqrt(variance / trials);
    expect(Math.abs(mean - EXACT_MEAN)).toBeLessThan(3 * standardError);
  });

  it("agrees with the wired-up replicate path", () => {
    // Verifies the shortcut this file takes: sampling through `sobolUniform` +
    // `distributionQuantile` gives the same draws as `sobolReplicates`.
    const base: ScenarioSpec = scenarioSpecSchema.parse(PRESET_SCENARIOS[0]);
    const seed = 0x51b0;
    const study: UncertainScenarioSpec = uncertainScenarioSpecSchema.parse({
      schemaVersion: 1,
      base,
      overlays: [
        { path: "initialConditions.vx0", distribution: SPEED },
        { path: "initialConditions.vy0", distribution: ANGLE },
      ],
      seed,
      replicates: 32,
    });
    const viaReplicates = Array.from(sobolReplicates(study)).map((r) => r.values);
    const viaUniforms = Array.from({ length: 32 }, (_, i) => [
      distributionQuantile(SPEED, sobolUniform(seed, i, 0)),
      distributionQuantile(ANGLE, sobolUniform(seed, i, 1)),
    ]);
    expect(viaReplicates).toEqual(viaUniforms);
  });

  it("gives up its rate on a discontinuous observable, which is the honest caveat", () => {
    // QMC's advantage is a bounded-variation statement. An indicator function
    // has unbounded variation in the Hardy-Krause sense, and the rate falls
    // back toward Monte Carlo's. Recording where the method does NOT help is
    // what stops the option from looking unconditionally good.
    const threshold = EXACT_MEAN;
    const indicator = (u0: number, u1: number): number => (observable(u0, u1) > threshold ? 1 : 0);
    const exact = (() => {
      // Reference probability, by a deterministic midpoint grid far finer than
      // any size under test. 1024 x 1024 is chosen by measurement, not by
      // eye: the grid converges to 0.471588135, 0.471549988, 0.471559525,
      // 0.471562386, 0.471561432, 0.471560806 at m = 256 .. 8192, so m = 1024
      // sits within 1.3e-6 of m = 8192 -- some three orders of magnitude
      // below the smallest RMSE being fitted, and so invisible to the slope.
      // The size matters beyond accuracy: this grid is the dominant cost of
      // the whole file, and at 4096 it loads the parallel test pool enough to
      // push a wall-clock assertion elsewhere in the suite over its budget.
      const m = 1024;
      let hits = 0;
      for (let a = 0; a < m; a += 1) {
        for (let b = 0; b < m; b += 1) {
          hits += indicator((a + 0.5) / m, (b + 0.5) / m);
        }
      }
      return hits / (m * m);
    })();

    const errors = SIZES.map((n) =>
      Math.sqrt(
        Array.from({ length: TRIALS }, (_, trial) => {
          const seed = 0x3a10 + trial * 7883;
          let total = 0;
          for (let i = 0; i < n; i += 1) {
            total += indicator(sobolUniform(seed, i, 0), sobolUniform(seed, i, 1));
          }
          return (total / n - exact) ** 2;
        }).reduce((a, b) => a + b, 0) / TRIALS,
      ),
    );
    const slope = logLogSlope(SIZES, errors);
    console.log(`discontinuous observable: sobol slope ${slope.toFixed(4)}`);
    // Still better than -1/2 — a scrambled net does help a bit even here — but
    // nowhere near the -1 the smooth case reaches. The upper bound is the
    // claim; the lower bound records that it has not collapsed to plain MC.
    expect(slope).toBeGreaterThan(-0.9);
    expect(slope).toBeLessThan(-0.5);
  });
});
