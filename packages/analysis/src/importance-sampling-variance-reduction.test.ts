// P6.23's validation criterion, measured:
//
//   "IS estimate matches brute force at 10x fewer samples (constructed tail)"
//
// The shape is the one `control-variate-variance-reduction.test.ts` and
// `antithetic-variance-reduction.test.ts` established: a study over many
// independent replications, comparing two estimators of the same quantity,
// with the thresholds set from measured values and the measurement quoted
// beside each.
//
// ---------------------------------------------------------------------------
// THE CONSTRUCTED TAIL, AND WHY THE EXACT ANSWER IS AVAILABLE
// ---------------------------------------------------------------------------
//
// A gun with a muzzle velocity that varies shot to shot, `v0 ~ N(mu, sigma)`,
// fired at a fixed elevation. The rare event is "the shot carries past a
// no-go line at R_t metres" -- a safety-template question, and the sort of
// tail probability nobody can afford to estimate by firing.
//
// Drag-free range is `R(v0) = v0^2 sin(2 theta) / g`, which is **strictly
// increasing in v0** over the physical range v0 > 0. So
//
//     R(v0) > R_t   <=>   v0 > sqrt(R_t g / sin 2theta)
//
// exactly. The event is a Gaussian upper tail in v0 after all, and its
// probability is `normalUpperTail((v_crit - mu)/sigma)` in closed form. That
// is the whole point of constructing it this way: **both estimators are
// checked against an exact number**, not merely against each other. An
// agreement between two wrong estimators is not evidence, and a brute-force
// estimate at these sample sizes is far too noisy to serve as a reference.
//
// The monotonicity is asserted below rather than assumed, because it is the
// step that makes the closed form legitimate.
//
// ---------------------------------------------------------------------------
// WHAT "MATCHES" HAS TO MEAN HERE
// ---------------------------------------------------------------------------
//
// At p ~ 1.4e-4, a single brute-force study of 20,000 draws sees about 3 hits.
// Its estimate is 3/20000, or 2/20000, or 5/20000 -- it cannot be close to the
// truth in relative terms, and roughly a quarter of such studies see 0 or 1
// hits. So "matches" cannot mean "one IS study lands near one brute-force
// study": that would be a test of two noise sources agreeing, and it would
// pass or fail on the seed.
//
// It is read instead as the comparison that has content, over 200 independent
// replications of each estimator:
//
//   * the IS estimator at N/10 draws has a SMALLER ROOT-MEAN-SQUARE ERROR
//     against the exact p than the brute-force estimator at N draws;
//   * both are UNBIASED -- their means over the replications agree with the
//     exact p, so IS is not buying its precision with a systematic error;
//   * the IS estimator's per-study spread is small enough that a SINGLE study
//     is informative, which the brute-force one at ten times the cost is not.
//
// All three are required. The first alone would be satisfied by an estimator
// that always returned the same wrong constant.

import { describe, it, expect } from "vitest";
import { G_STD, PCG32, normalUpperTail } from "@ballista/engine";
import { dragFreeRange } from "./range-root.js";
import {
  bruteForceSampleSize,
  importanceSamplingProbability,
  normalShiftLikelihoodRatio,
  normalShiftProposal,
  normalTailProbability,
} from "./importance-sampling.js";

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

/** Muzzle velocity, m/s. A field gun's shot-to-shot spread is a percent or so. */
const MU_V0 = 300;
const SIGMA_V0 = 3;
/** Elevation, radians. 20 degrees. */
const THETA = (20 * Math.PI) / 180;
/** The no-go line, metres. Chosen to put the event out at ~3.6 sigma. */
const R_LIMIT = dragFreeRange(MU_V0 + 3.6 * SIGMA_V0, THETA);

/** The critical muzzle velocity, from inverting the monotone range map. */
const V_CRIT = Math.sqrt((R_LIMIT * G_STD) / Math.sin(2 * THETA));

/** The exact tail probability. */
const P_EXACT = normalTailProbability(MU_V0, SIGMA_V0, V_CRIT);

/** Brute-force draws per replication. */
const N_BRUTE = 20000;
/** Importance-sampling draws per replication -- ten times fewer, as the criterion says. */
const N_IS = N_BRUTE / 10;
/** Independent replications of each estimator. */
const REPLICATIONS = 200;

/** Did this shot carry past the line? Evaluated through the range model, not the shortcut. */
function carriesPast(v0: number): boolean {
  return dragFreeRange(v0, THETA) > R_LIMIT;
}

function rootMeanSquare(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v * v;
  return Math.sqrt(sum / values.length);
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function stdDev(values: readonly number[]): number {
  const m = mean(values);
  let sum = 0;
  for (const v of values) sum += (v - m) * (v - m);
  return Math.sqrt(sum / (values.length - 1));
}

/** One brute-force replication: draw from the nominal distribution and count. */
function bruteForceStudy(rng: PCG32, n: number): number {
  let hits = 0;
  for (let i = 0; i < n; i += 1) {
    if (carriesPast(MU_V0 + SIGMA_V0 * rng.nextGaussian())) hits += 1;
  }
  return hits / n;
}

/** One importance-sampling replication under the tilted proposal. */
function importanceStudy(rng: PCG32, n: number): ReturnType<typeof importanceSamplingProbability> {
  const proposal = normalShiftProposal(MU_V0, SIGMA_V0, V_CRIT);
  const indicators = new Array<boolean>(n);
  const weights = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const v0 = proposal.proposalMean + SIGMA_V0 * rng.nextGaussian();
    indicators[i] = carriesPast(v0);
    weights[i] = normalShiftLikelihoodRatio(v0, proposal);
  }
  return importanceSamplingProbability(indicators, weights);
}

// ---------------------------------------------------------------------------
// The construction itself
// ---------------------------------------------------------------------------

describe("the constructed tail (P6.23)", () => {
  it("has a range map that is strictly increasing in v0, which is what makes the closed form exact", () => {
    // The step the whole exercise rests on. If R were not monotone, "carries
    // past R_t" would not be an interval in v0 and normalUpperTail would not
    // be the answer.
    let previous = -Infinity;
    for (let v0 = 250; v0 <= 350; v0 += 0.5) {
      const r = dragFreeRange(v0, THETA);
      expect(r).toBeGreaterThan(previous);
      previous = r;
    }
  });

  it("agrees that the velocity threshold and the range threshold describe the same event", () => {
    // Checked either side of V_CRIT, through the range model rather than
    // through the algebra that produced V_CRIT.
    expect(carriesPast(V_CRIT * (1 + 1e-9))).toBe(true);
    expect(carriesPast(V_CRIT * (1 - 1e-9))).toBe(false);
  });

  it("is genuinely rare, and rare enough that brute force is the wrong tool", () => {
    // Guard the guard. If a later edit moved R_LIMIT in and made the event
    // common, every comparison below would still "pass" while measuring
    // nothing -- IS has no advantage on a coin flip.
    expect(P_EXACT).toBeLessThan(2e-4);
    expect(P_EXACT).toBeGreaterThan(1e-5);

    // Measured: P_EXACT = 1.59109e-4, so brute force needs 6.28e5 draws for
    // 10% relative error -- 31x this test's entire brute-force budget, and
    // that is at a merely 3.6-sigma event. That number is the case for the
    // module.
    expect(bruteForceSampleSize(P_EXACT, 0.1)).toBeGreaterThan(5e5);
  });

  it("puts about half the tilted proposal's draws inside the event", () => {
    // What the tilt buys, stated directly: under the proposal the rare event
    // is a coin flip. Exactly half in the limit, since the proposal is
    // centred on the threshold.
    const study = importanceStudy(new PCG32(20260901n, 7n), 4000);
    expect(study.hits / study.trials).toBeGreaterThan(0.45);
    expect(study.hits / study.trials).toBeLessThan(0.55);
  });
});

// ---------------------------------------------------------------------------
// The criterion
// ---------------------------------------------------------------------------

describe("importance sampling beats brute force at 10x fewer samples (P6.23)", () => {
  // Both estimator families are run once here and shared by the assertions
  // below; 200 replications x 20,000 draws is the expensive half and there is
  // no reason to pay for it three times.
  const bruteErrors: number[] = [];
  const bruteEstimates: number[] = [];
  const isErrors: number[] = [];
  const isEstimates: number[] = [];
  const isEfficiencies: number[] = [];

  const bruteRng = new PCG32(20260901n, 1n);
  const isRng = new PCG32(20260901n, 2n);
  for (let r = 0; r < REPLICATIONS; r += 1) {
    const b = bruteForceStudy(bruteRng, N_BRUTE);
    bruteEstimates.push(b);
    bruteErrors.push(b - P_EXACT);

    const s = importanceStudy(isRng, N_IS);
    isEstimates.push(s.pHat);
    isErrors.push(s.pHat - P_EXACT);
    isEfficiencies.push(s.weightEfficiency);
  }

  const bruteRmse = rootMeanSquare(bruteErrors);
  const isRmse = rootMeanSquare(isErrors);

  it("has a smaller RMS error at one tenth the sample size", () => {
    // THE CRITERION. Measured on this seed: brute-force RMSE 8.935e-5 at
    // N = 20000, IS RMSE 7.761e-6 at N = 2000 -- an 11.5x reduction in error
    // for a 10x reduction in cost. Since a Monte Carlo error falls as
    // 1/sqrt(N), matching that error by brute force alone would take 11.5^2
    // = 132x more draws than the 20000 it already spent, so the tilted
    // estimator is worth roughly three orders of magnitude in sample size
    // here.
    //
    // The threshold is a floor under a measured ratio, set well below it
    // rather than at it: the ratio is itself a random quantity over 200
    // replications and pinning it tightly would make this a flaky test rather
    // than a strict one.
    expect(isRmse).toBeLessThan(bruteRmse / 5);
  });

  it("costs ten times fewer draws while doing so", () => {
    // Stated as an assertion so the comparison cannot silently stop being the
    // one the criterion asks for.
    expect(N_IS * 10).toBe(N_BRUTE);
  });

  it("is unbiased -- it is not buying precision with a systematic error", () => {
    // The control that makes the RMSE comparison mean something. An estimator
    // that always returned P_EXACT/2 would have a beautiful variance and be
    // useless; one that returned a constant would have zero variance.
    //
    // Tested as a two-sided z-test on the mean over replications, at 4 SE.
    // Measured: IS mean 1.58735e-4 against P_EXACT 1.59109e-4, |z| = 0.68;
    // brute-force mean 1.49250e-4, |z| = 1.57.
    const isMean = mean(isEstimates);
    const isSe = stdDev(isEstimates) / Math.sqrt(REPLICATIONS);
    expect(Math.abs(isMean - P_EXACT)).toBeLessThan(4 * isSe);

    // And the same for brute force, which is unbiased by construction -- this
    // half is a check on the harness rather than on the estimator.
    const bruteMean = mean(bruteEstimates);
    const bruteSe = stdDev(bruteEstimates) / Math.sqrt(REPLICATIONS);
    expect(Math.abs(bruteMean - P_EXACT)).toBeLessThan(4 * bruteSe);
  });

  it("makes a single study informative, which brute force at ten times the cost does not", () => {
    // The practical claim, and the one a user would actually feel. A single
    // brute-force study of 20,000 draws sees ~3 hits, so its estimate is a
    // small integer over 20,000 and lands within 25% of the truth only
    // occasionally. A single IS study of 2,000 draws is within 25% almost
    // always.
    //
    // Measured on this seed: brute force 39/200 studies within 25%, IS
    // 200/200.
    const within = (errors: readonly number[]): number =>
      errors.filter((e) => Math.abs(e) < 0.25 * P_EXACT).length;

    expect(within(isErrors)).toBeGreaterThan(0.9 * REPLICATIONS);
    expect(within(bruteErrors)).toBeLessThan(0.6 * REPLICATIONS);
  });

  it("keeps its weights healthy, so the win is not a degenerate sample", () => {
    // The diagnostic that separates "this worked" from "this got lucky once".
    // A tilted-to-threshold proposal on a Gaussian tail is well conditioned:
    // measured weight efficiency 0.197 on average and 0.172 at its worst over
    // the 200 replications, i.e. an ESS around 395 of 2000 draws. If a future
    // change made the weights degenerate
    // the RMSE comparison could still pass on a seed while the estimator had
    // become a one-draw lottery.
    const worst = Math.min(...isEfficiencies);
    expect(worst).toBeGreaterThan(0.15);
  });
});

// ---------------------------------------------------------------------------
// The negative control: the proposal is what does the work
// ---------------------------------------------------------------------------

describe("the tilt is load-bearing (P6.23)", () => {
  it("collapses to brute force when the proposal is not shifted", () => {
    // With proposalMean == mean every weight is exactly 1, so the IS estimator
    // *is* the brute-force estimator -- and at N_IS draws it inherits all of
    // brute force's trouble. This is the control that shows the machinery is
    // not what helps; the choice of proposal is.
    const rng = new PCG32(20260901n, 5n);
    const untilted = { mean: MU_V0, sigma: SIGMA_V0, proposalMean: MU_V0 };
    const indicators = new Array<boolean>(N_IS);
    const weights = new Array<number>(N_IS);
    for (let i = 0; i < N_IS; i += 1) {
      const v0 = MU_V0 + SIGMA_V0 * rng.nextGaussian();
      indicators[i] = carriesPast(v0);
      weights[i] = normalShiftLikelihoodRatio(v0, untilted);
    }
    const study = importanceSamplingProbability(indicators, weights);

    expect(weights.every((w) => w === 1)).toBe(true);
    // 2000 draws at p = 1.59e-4 expects 0.32 hits. Measured on this seed: 1
    // hit, so the study reports 5e-4 against a true 1.59e-4 -- off by a
    // factor of three, and the next seed reports 0. That is what an untilted
    // study of this size honestly delivers.
    expect(study.hits).toBeLessThan(5);
    expect(study.pHat).toBe(study.hits / N_IS);
  });

  it("gets worse, not better, when the tilt overshoots the threshold badly", () => {
    // Importance sampling is not free and this is where its cost shows. A
    // proposal centred far past the threshold makes nearly every draw a hit,
    // but the weights out there are tiny and wildly unequal, so the estimate
    // rests on the few draws nearest the threshold. The diagnostics are what
    // report that; the estimate alone would not.
    const rng = new PCG32(20260901n, 6n);
    const overshoot = {
      mean: MU_V0,
      sigma: SIGMA_V0,
      proposalMean: MU_V0 + 12 * SIGMA_V0,
    };
    const indicators = new Array<boolean>(N_IS);
    const weights = new Array<number>(N_IS);
    for (let i = 0; i < N_IS; i += 1) {
      const v0 = overshoot.proposalMean + SIGMA_V0 * rng.nextGaussian();
      indicators[i] = carriesPast(v0);
      weights[i] = normalShiftLikelihoodRatio(v0, overshoot);
    }
    const study = importanceSamplingProbability(indicators, weights);
    const tuned = importanceStudy(new PCG32(20260901n, 4n), N_IS);

    // Nearly every draw "hits", which on its own looks like a triumph.
    expect(study.hits / study.trials).toBeGreaterThan(0.99);
    // The diagnostics say otherwise: measured weight efficiency 5.47e-4
    // against the tuned proposal's 0.201 -- a factor of 368 -- and a single
    // draw carries 96% of the answer. The estimate itself comes out at
    // 3.0e-16 against a true 1.59e-4, wrong by twelve orders of magnitude,
    // with nothing in pHat alone to say so.
    expect(study.weightEfficiency).toBeLessThan(tuned.weightEfficiency / 100);
    expect(study.maxWeightShare).toBeGreaterThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// The exact anchor
// ---------------------------------------------------------------------------

describe("the reference probability (P6.23)", () => {
  it("agrees with the engine's tail function computed from the raw z-score", () => {
    // normalTailProbability is a thin wrapper; this checks the standardisation
    // it performs rather than the tail function it calls.
    expect(P_EXACT).toBe(normalUpperTail((V_CRIT - MU_V0) / SIGMA_V0));
  });

  it("sits where the scenario says it does, at about 3.6 sigma", () => {
    expect((V_CRIT - MU_V0) / SIGMA_V0).toBeCloseTo(3.6, 6);
  });
});
