/**
 * P6.12's validation criterion, measured: *"variance reduction measured > 0 on
 * a monotone observable (range vs v0)"*.
 *
 * The observable is {@link dragFreeRange} at a fixed launch angle, which is
 * `v0^2 sin(2 theta) / g` -- strictly increasing in `v0` over the positive
 * speeds a study draws, and therefore exactly the monotone case the criterion
 * names. Using the closed form rather than an integrated trajectory keeps the
 * measurement about the sampler: an integrator's own error would sit inside
 * every figure below and the comparison would be measuring two things at once.
 *
 * The estimator being compared is the mean range over `N` replicates. What is
 * measured is the variance of *that estimator* across many independent studies,
 * because that is the quantity a variance-reduction option exists to shrink --
 * the spread of individual draws is unchanged by construction, since both halves
 * of a pair have the same marginal law.
 *
 * This file also measures the counterexample. Antithetic sampling is not free:
 * on an observable symmetric about the mean of the draw it does nothing useful
 * and can do harm, and a test suite that only demonstrated the win would be
 * making the option look unconditionally good.
 */

import { describe, expect, it } from "vitest";
import {
  antitheticReplicates,
  distributionSpecSchema,
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

/** Independent studies per measurement -- the sample the estimator variance is taken over. */
const STUDIES = 400;

function study(seed: number, overrides: Record<string, unknown> = {}): UncertainScenarioSpec {
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: BASE,
    overlays: [
      {
        path: "initialConditions.vx0",
        distribution: distributionSpecSchema.parse({ kind: "normal", mean: 40, stdDev: 6 }),
      },
    ],
    replicates: N,
    seed,
    ...overrides,
  });
}

/** Mean of `observable` over one study, drawn with or without the antithetic option. */
function studyMean(
  spec: UncertainScenarioSpec,
  antithetic: boolean,
  observable: (v0: number) => number,
): number {
  const source = antithetic ? antitheticReplicates(spec) : replicates(spec);
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

/**
 * Estimator variance with the option off and on, over {@link STUDIES} studies
 * that differ only in their seed.
 */
function estimatorVariances(observable: (v0: number) => number): {
  plain: number;
  antithetic: number;
} {
  const plainMeans: number[] = [];
  const antitheticMeans: number[] = [];
  for (let seed = 1; seed <= STUDIES; seed += 1) {
    const spec = study(seed);
    plainMeans.push(studyMean(spec, false, observable));
    antitheticMeans.push(studyMean(spec, true, observable));
  }
  return { plain: variance(plainMeans), antithetic: variance(antitheticMeans) };
}

const rangeAt = (v0: number): number => dragFreeRange(v0, THETA);

describe("P6.12 validation: antithetic variance reduction on range vs v0", () => {
  it("reduces the variance of the mean-range estimator", () => {
    // THE CRITERION. Measured, not asserted from theory: the reduction below is
    // whatever the sampler actually delivers on this observable at N = 64.
    const { plain, antithetic } = estimatorVariances(rangeAt);
    expect(antithetic).toBeLessThan(plain);
    // Stated as a ratio so a regression that halves the benefit fails here
    // rather than sliding under a bare "> 0". MEASURED: variance ratio 0.0246,
    // a 97.5% reduction. That is unusually large and it has a closed-form
    // reason -- for v0 = mu + d and range proportional to v0^2, the pair mean is
    //
    //   ((mu+d)^2 + (mu-d)^2) / 2 = mu^2 + d^2
    //
    // so the linear 2 mu d term, which carries almost all the variance at
    // mu = 40, sigma = 6, cancels exactly and only the d^2 term survives. The
    // bound is set at 0.10 rather than at the measured value: loose enough to
    // absorb the Monte Carlo error of a 400-study sample, tight enough that
    // losing the mirror (ratio ~1) or halving its benefit cannot pass.
    expect(antithetic / plain).toBeLessThan(0.1);
  });

  it("does so without moving the estimate itself", () => {
    // A variance reduction that shifted the mean would be a bias, not a
    // reduction. E[range] under a normal v0 is (mu^2 + sigma^2) sin(2 theta)/g,
    // available in closed form, so both estimators are checked against the truth
    // rather than only against each other.
    const truth = ((40 * 40 + 6 * 6) * Math.sin(2 * THETA)) / 9.80665;
    let plainTotal = 0;
    let antitheticTotal = 0;
    for (let seed = 1; seed <= STUDIES; seed += 1) {
      const spec = study(seed);
      plainTotal += studyMean(spec, false, rangeAt);
      antitheticTotal += studyMean(spec, true, rangeAt);
    }
    expect(plainTotal / STUDIES).toBeCloseTo(truth, 0);
    expect(antitheticTotal / STUDIES).toBeCloseTo(truth, 0);
  });

  it("leaves the spread of the individual draws alone", () => {
    // The option changes the estimator's variance, not the population's. Both
    // halves of a pair have the same marginal law, so the expected sample
    // variance of the drawn ranges must agree between the two modes.
    //
    // Averaged over STUDIES seeds rather than read off one. A single 64-draw
    // sample variance carries about 18% standard error on its own, so a
    // one-seed ratio lands anywhere in roughly [0.75, 1.25] and a tight bound on
    // it would be a wrong belief about the noise rather than a check on the
    // code. The first draft asserted [0.85, 1.15] on one seed and drew 1.161 --
    // no defect, just an interval narrower than the statistic.
    let plainTotal = 0;
    let pairedTotal = 0;
    for (let seed = 1; seed <= STUDIES; seed += 1) {
      const spec = study(seed);
      plainTotal += variance([...replicates(spec)].map((r) => rangeAt(r.values[0]!)));
      pairedTotal += variance([...antitheticReplicates(spec)].map((r) => rangeAt(r.values[0]!)));
    }
    expect(pairedTotal / plainTotal).toBeGreaterThan(0.95);
    expect(pairedTotal / plainTotal).toBeLessThan(1.05);
  });

  it("does NOT help on an observable symmetric about the draw's mean", () => {
    // The honest counterexample, measured rather than warned about. For
    // f(v0) = (v0 - 40)^2 the pair contributes 2 f(mu + d) whatever the sign of
    // d, so mirroring cancels nothing and the paired estimator is no better --
    // it is a 32-pair average where the plain run is a 64-draw average.
    //
    // This is why `replicates` stays the default and the option is opt-in.
    const symmetric = (v0: number): number => (v0 - 40) ** 2;
    const { plain, antithetic } = estimatorVariances(symmetric);
    expect(antithetic).toBeGreaterThan(plain);
  });
});
