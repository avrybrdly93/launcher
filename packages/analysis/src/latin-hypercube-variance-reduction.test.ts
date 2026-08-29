/**
 * P6.14's validation criterion, second half, measured: *"SE improvement on a
 * smooth observable"*. (The first half, per-dimension stratification, is
 * verified structurally in `packages/engine/src/latin-hypercube.test.ts`.)
 *
 * The observable is {@link dragFreeRange} at a fixed launch angle,
 * `v0^2 sin(2 theta) / g` -- smooth in `v0`, which is the case Latin hypercube
 * sampling exists to help with. As in the antithetic measurement next door, the
 * closed form is used rather than an integrated trajectory so that an
 * integrator's own error does not sit inside every figure and turn this into a
 * measurement of two things at once.
 *
 * What is measured is the standard error of the *estimator* -- the spread of
 * the mean-range estimate across many independent studies -- because that is
 * the quantity a variance-reduction option exists to shrink. The spread of
 * individual draws is unchanged by construction: every marginal law is exactly
 * as specified, which is separately asserted below.
 *
 * This file also measures where the method has little to offer. LHS stratifies
 * one-dimensional projections, so it removes the part of the variance that a
 * function's additive structure carries. On an observable dominated by a
 * threshold it does much less, and a test that only showed the win would make
 * the option look unconditionally good.
 */

import { describe, expect, it } from "vitest";
import {
  distributionSpecSchema,
  latinHypercubeReplicates,
  replicates,
  scenarioSpecSchema,
  uncertainScenarioSpecSchema,
  type ScenarioSpec,
  type UncertainScenarioSpec,
  PRESET_SCENARIOS,
} from "@ballista/engine";
import { dragFreeRange } from "./range-root.js";

const BASE: ScenarioSpec = scenarioSpecSchema.parse(PRESET_SCENARIOS[0]);

/** Launch angle held fixed, so `dragFreeRange` is a function of `v0` alone. */
const THETA = Math.PI / 4;

/** Replicates per study. Small on purpose: the win has to show at a size a user would run. */
const N = 64;

/** Independent studies per measurement -- the sample the estimator spread is taken over. */
const STUDIES = 400;

const MU = 40;
const SIGMA = 6;

/** Mean of the second drawn dimension, used only by the interaction counterexample. */
const MU2 = 20;

function study(seed: number): UncertainScenarioSpec {
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: BASE,
    overlays: [
      {
        path: "initialConditions.vx0",
        distribution: distributionSpecSchema.parse({
          kind: "normal",
          mean: MU,
          stdDev: SIGMA,
        }),
      },
    ],
    replicates: N,
    seed,
  });
}

/** A study over two independent dimensions, for the interaction counterexample. */
function twoDimensionalStudy(seed: number): UncertainScenarioSpec {
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: BASE,
    overlays: [
      {
        path: "initialConditions.vx0",
        distribution: distributionSpecSchema.parse({ kind: "normal", mean: MU, stdDev: SIGMA }),
      },
      {
        path: "initialConditions.vy0",
        distribution: distributionSpecSchema.parse({ kind: "normal", mean: MU2, stdDev: SIGMA }),
      },
    ],
    replicates: N,
    seed,
  });
}

/** Mean of `observable` over one study, drawn with or without the LHS option. */
function studyMean(
  spec: UncertainScenarioSpec,
  latin: boolean,
  observable: (v0: number) => number,
): number {
  const source = latin ? latinHypercubeReplicates(spec) : replicates(spec);
  let total = 0;
  let count = 0;
  for (const replicate of source) {
    total += observable(replicate.values[0]!);
    count += 1;
  }
  return total / count;
}

function variance(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (values.length - 1);
}

/** Estimator standard error with the option off and on, over {@link STUDIES} studies. */
function estimatorStandardErrors(observable: (v0: number) => number): {
  plain: number;
  latin: number;
} {
  const plainMeans: number[] = [];
  const latinMeans: number[] = [];
  for (let seed = 1; seed <= STUDIES; seed += 1) {
    const spec = study(seed);
    plainMeans.push(studyMean(spec, false, observable));
    latinMeans.push(studyMean(spec, true, observable));
  }
  return { plain: Math.sqrt(variance(plainMeans)), latin: Math.sqrt(variance(latinMeans)) };
}

const rangeAt = (v0: number): number => dragFreeRange(v0, THETA);

describe("P6.14 validation: Latin hypercube SE improvement on a smooth observable", () => {
  it("reduces the standard error of the mean-range estimator", () => {
    // THE CRITERION. Measured, not asserted from theory: the improvement below
    // is whatever the sampler actually delivers on this observable at N = 64.
    const { plain, latin } = estimatorStandardErrors(rangeAt);
    expect(latin).toBeLessThan(plain);
    // Stated as a ratio so a regression that erodes the benefit fails here
    // rather than sliding under a bare "improved". MEASURED: SE 6.037 m plain
    // against 0.410 m stratified, a ratio of 0.068 -- a 93% cut in standard
    // error, or a 216x cut in variance.
    //
    // Large, and with a reason: range is v0^2, which is almost entirely
    // additive in the single drawn dimension, and a one-dimensional additive
    // function is exactly what a Latin hypercube integrates near-exactly --
    // stratifying (0,1) into N bands leaves only the within-stratum variation,
    // which falls as O(1/N) per stratum rather than O(1). The bound is set at
    // 0.25 rather than at the measured value: loose enough to absorb the Monte
    // Carlo error of a 400-study sample, tight enough that losing the
    // stratification (ratio ~1) or degrading it to sampling-with-replacement
    // cannot pass.
    expect(latin / plain).toBeLessThan(0.25);
  });

  it("does so without moving the estimate itself", () => {
    // An SE reduction that shifted the mean would be a bias, not an
    // improvement -- and it is the failure mode this design specifically
    // risks, since placing each sample at its stratum's midpoint instead of
    // jittering would look even better here while quietly ceasing to be Monte
    // Carlo at all. E[range] under a normal v0 is
    // (mu^2 + sigma^2) sin(2 theta) / g, in closed form, so both estimators are
    // checked against the truth rather than only against each other.
    const truth = ((MU * MU + SIGMA * SIGMA) * Math.sin(2 * THETA)) / 9.80665;
    let plainTotal = 0;
    let latinTotal = 0;
    for (let seed = 1; seed <= STUDIES; seed += 1) {
      const spec = study(seed);
      plainTotal += studyMean(spec, false, rangeAt);
      latinTotal += studyMean(spec, true, rangeAt);
    }
    expect(plainTotal / STUDIES).toBeCloseTo(truth, 0);
    expect(latinTotal / STUDIES).toBeCloseTo(truth, 0);

    // The LHS estimator is the more accurate of the two, held to its own much
    // tighter standard error rather than to the plain one's.
    const { latin } = estimatorStandardErrors(rangeAt);
    const standardErrorOfTheMean = latin / Math.sqrt(STUDIES);
    expect(Math.abs(latinTotal / STUDIES - truth)).toBeLessThan(5 * standardErrorOfTheMean);
  });

  it("leaves the marginal law of the drawn parameter unchanged", () => {
    // The samples are stratified, not reweighted. Over one large study the
    // drawn values must still look like the specified normal -- otherwise the
    // variance reduction would be coming from sampling a different
    // distribution, which is not a reduction but a different question.
    const spec = uncertainScenarioSpecSchema.parse({
      schemaVersion: 1,
      base: BASE,
      overlays: [
        {
          path: "initialConditions.vx0",
          distribution: distributionSpecSchema.parse({
            kind: "normal",
            mean: MU,
            stdDev: SIGMA,
          }),
        },
      ],
      replicates: 4000,
      seed: 11,
    });
    const drawn = [...latinHypercubeReplicates(spec)].map((r) => r.values[0]!);
    const mean = drawn.reduce((a, b) => a + b, 0) / drawn.length;
    expect(mean).toBeCloseTo(MU, 1);
    expect(Math.sqrt(variance(drawn))).toBeCloseTo(SIGMA, 1);
  });

  it("gives back almost nothing on a pure-interaction observable", () => {
    // Where the method stops helping, measured rather than assumed -- so the
    // large win above is not read as a general property.
    //
    // A Latin hypercube stratifies *one-dimensional projections*. In ANOVA
    // terms it removes the variance carried by the main effects and leaves the
    // interaction variance essentially untouched. So the counterexample is not
    // a rough observable, it is a **purely interactive** one: with two
    // independent centred draws, `f(a, b) = (a - E a)(b - E b)` has both main
    // effects identically zero, and every bit of its variance is interaction.
    //
    // (The first counterexample tried here was a threshold in one dimension,
    // which turned out to be the opposite of a counterexample. With the step at
    // the median it falls exactly on a stratum boundary, so precisely 32 of the
    // 64 strata lie above it in every study and the LHS estimator is *exact*:
    // MEASURED SE 0.0628 plain against 0.0000000 stratified. Worth recording,
    // because it is the sharpest illustration available of what one-dimensional
    // stratification actually does.)
    const interaction = (a: number, b: number): number => (a - MU) * (b - MU2);

    const plainMeans: number[] = [];
    const latinMeans: number[] = [];
    for (let seed = 1; seed <= STUDIES; seed += 1) {
      const spec = twoDimensionalStudy(seed);
      for (const [latin, into] of [
        [false, plainMeans],
        [true, latinMeans],
      ] as const) {
        const source = latin ? latinHypercubeReplicates(spec) : replicates(spec);
        let total = 0;
        let count = 0;
        for (const replicate of source) {
          total += interaction(replicate.values[0]!, replicate.values[1]!);
          count += 1;
        }
        into.push(total / count);
      }
    }
    const ratio = Math.sqrt(variance(latinMeans)) / Math.sqrt(variance(plainMeans));
    // MEASURED: SE ratio 1.10 -- no improvement at all, and in fact a slight
    // cost, against 0.068 on the smooth observable. That the ratio sits a
    // little above 1 is expected rather than alarming: stratifying the margins
    // constrains the design, and with no main effect to remove the constraint
    // shows up as a small penalty. Bounded on both sides: LHS must not badly
    // hurt, and it must not appear to help, which would mean this test had
    // stopped exercising a pure interaction.
    expect(ratio).toBeLessThan(1.3);
    expect(ratio).toBeGreaterThan(0.75);
  });
});
