/**
 * P6.13's validation criterion, measured: *"variance reduction factor
 * reported; estimator unbiased (test vs plain MC)"*.
 *
 * Two claims, and they need different evidence. The **factor** is a property
 * of one sample and {@link controlVariateMean} reports it directly. The
 * **unbiasedness** is a property of the estimator's sampling distribution and
 * cannot be seen in a single study at all — so it is measured here the way
 * `antithetic-variance-reduction.test.ts` measures its own: many independent
 * studies, and the spread of the estimator *across* them.
 *
 * **The observable is a drag-affected range and the control is the drag-free
 * one.** That is the pairing P6.13 names and the only one that makes the
 * exercise honest: a control perfectly correlated with the observable would
 * make the method look flawless, and one uncorrelated with it would make the
 * method look useless. The real question is what a *physically motivated*
 * control buys. The answer here is a measured **99.9% variance cut** (ratio
 * 0.00115) at `N = 64`, from a correlation of 0.99952 — high because the drag
 * penalty at these speeds is a smooth, strongly monotone distortion of the
 * drag-free law, so most of a replicate's deviation from the mean is deviation
 * the control can see.
 *
 * **The drag model is a closed form, deliberately.** A numerically integrated
 * trajectory would fold an integrator's own error into every figure below and
 * the comparison would be measuring two things at once — the same reasoning
 * P6.12's exhibit gives for using `dragFreeRange` rather than a solve. What is
 * under test is the estimator, not the physics; `range-root.ts` and the
 * shooting solvers are where the physics is validated.
 */

import { describe, expect, it } from "vitest";
import { controlVariateMean, dragFreeRangeControlMean } from "./control-variate.js";
import { dragFreeRange } from "./range-root.js";

/** Launch angle held fixed, so both range functions depend on `v0` alone. */
const THETA = Math.PI / 4;

/** `v0 ~ N(MU, SIGMA)`. Matches P6.12's exhibit so the two are comparable. */
const MU = 40;
const SIGMA = 6;

/** Replicates per study. Small on purpose: the win has to show at a size a user would run. */
const N = 64;

/** Independent studies per measurement — the sample the estimator variance is taken over. */
const STUDIES = 400;

/**
 * A coefficient the sample did not produce, standing in for one a pilot run
 * would supply. Near the optimal `c*` for this pair but deliberately not equal
 * to it — `ĉ` averages 0.7533, so this is about 10% high — which is the
 * realistic case, since a pilot estimates `c*` too and lands near it rather
 * than on it. Its exact value is irrelevant to unbiasedness (that holds for
 * *any* fixed `c`) and a test asserts as much; what it costs is variance, and
 * that is measured too.
 */
const FIXED_C = 0.83;

/** Strength of the cubic range penalty in {@link drageyRange}. */
const DRAG_B = 0.004;

/**
 * A stand-in for the expensive observable: the drag-free range with a cubic
 * penalty that grows with launch speed, standing for the range a real
 * quadratic-drag flight loses relative to the vacuum law.
 *
 * ```
 *   R(v₀) = (v₀² − b v₀³) sin(2θ) / g
 * ```
 *
 * **Chosen for one property above realism: its mean is exact.** For
 * `v₀ ~ N(μ, σ)` the third moment is `E[v₀³] = μ³ + 3μσ²`, so
 * {@link TRUTH} below is a closed form and the unbiasedness test compares
 * against an analytic value rather than against a larger Monte Carlo run —
 * this package's standard, and the difference between a test that can resolve
 * a small bias and one whose own reference error swamps it.
 *
 * It is strongly correlated with the drag-free range and *not* an affine
 * function of it, which is what leaves a non-zero residual variance and makes
 * the measurement worth taking. It is monotone over every speed a study draws:
 * `dR/dv₀ = 0` at `v₀ = 2/(3b) = 167 m/s`, far above `μ + 4σ = 64`.
 *
 * A numerically integrated trajectory would fold an integrator's own error
 * into every figure here and the comparison would be measuring two things at
 * once — the same reasoning P6.12's exhibit gives. What is under test is the
 * estimator, not the physics.
 */
function drageyRange(v0: number): number {
  return ((v0 * v0 - DRAG_B * v0 * v0 * v0) * Math.sin(2 * THETA)) / G_STD;
}

/** Standard gravity, matching `range-root.ts`. */
const G_STD = 9.80665;

/**
 * `E[R(v₀)]` in closed form: `(E[v₀²] − b E[v₀³]) sin(2θ)/g` with
 * `E[v₀²] = μ² + σ²` and `E[v₀³] = μ³ + 3μσ²`.
 */
const TRUTH =
  ((MU * MU + SIGMA * SIGMA - DRAG_B * (MU ** 3 + 3 * MU * SIGMA * SIGMA)) * Math.sin(2 * THETA)) /
  G_STD;

/**
 * SplitMix64-seeded uniform stream, local to this file.
 *
 * A private generator rather than the engine's, for the reason `mc-stats.ts`
 * gives about its private `splitmix64`: this file needs *a* reproducible
 * stream, not *the* project's sampling semantics, and coupling an exhibit's
 * numbers to the engine's RNG would mean a future change to seed derivation
 * silently moves figures that are quoted in a changelog entry.
 */
function makeRng(seed: number): () => number {
  let state = BigInt(seed) & 0xffffffffffffffffn;
  const MASK = (1n << 64n) - 1n;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    z = (z ^ (z >> 31n)) & MASK;
    // 53 bits is exactly what an IEEE-754 double's mantissa holds.
    return Number(z >> 11n) / 2 ** 53;
  };
}

/** Box–Muller, returning one standard normal per call from a cached pair. */
function makeNormal(seed: number): () => number {
  const uniform = makeRng(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    // `1 - u` so the log never sees an exact zero.
    const u1 = 1 - uniform();
    const u2 = uniform();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

/** One study: `N` paired draws of (drag-free control, dragey observable). */
function study(normal: () => number): { control: number[]; observable: number[] } {
  const control: number[] = [];
  const observable: number[] = [];
  for (let i = 0; i < N; i++) {
    const v0 = MU + SIGMA * normal();
    control.push(dragFreeRange(v0, THETA));
    observable.push(drageyRange(v0));
  }
  return { control, observable };
}

/** Sample variance (Bessel-corrected) of a list of estimates. */
function variance(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
}

/**
 * Runs `STUDIES` independent studies and collects, per study, the plain mean
 * and the control-variate estimate. Seeds are `base + i` and the generator is
 * re-seeded per study, so every study is independent and the whole measurement
 * is reproducible.
 */
function runStudies(base: number, options?: { coefficient?: number }) {
  const knownMean = dragFreeRangeControlMean(MU, SIGMA, THETA);
  const plain: number[] = [];
  const cv: number[] = [];
  const factors: number[] = [];
  for (let i = 0; i < STUDIES; i++) {
    const { control, observable } = study(makeNormal(base + i));
    const r = controlVariateMean(observable, control, knownMean, options ?? {});
    plain.push(r.plainMean);
    cv.push(r.estimate);
    factors.push(r.varianceReductionFactor);
  }
  return { plain, cv, factors, knownMean };
}

describe("P6.13: control-variate variance reduction, measured", () => {
  it("reports a variance reduction factor, and the factor predicts the measured reduction", () => {
    const { plain, cv, factors } = runStudies(0x6c13_0001);

    const measuredRatio = variance(cv) / variance(plain);
    const meanFactor = factors.reduce((a, b) => a + b, 0) / factors.length;

    // CRITERION, first half: the factor is reported and it is a real
    // reduction. Measured at 0.00115 -- a 99.9% cut, from a mean rho of
    // 0.99952 -- with the pinned bound an order looser so Monte Carlo noise
    // over 400 studies cannot flip it while still being far tighter than a
    // broken control could reach.
    expect(measuredRatio).toBeLessThan(0.02);

    // The reported factor is a PREDICTION of that ratio, not a decoration.
    // Checking the two against each other is what makes the reported number
    // trustworthy: a factor that did not track the measured reduction would be
    // a number the caller could read but not use. Compared on a ratio because
    // both quantities are tiny and an absolute tolerance would be vacuous.
    expect(meanFactor).toBeGreaterThan(0);
    expect(measuredRatio / meanFactor).toBeGreaterThan(0.5);
    expect(measuredRatio / meanFactor).toBeLessThan(2);
  });

  it("is unbiased with a fixed c — to within its OWN standard error, against an analytic truth", () => {
    // CRITERION, second half, and the yardstick matters more than the
    // comparison. Checking the control-variate mean against the PLAIN mean is
    // the weak form of this test: both are computed from the same studies, so
    // their difference has a standard deviation of roughly the plain
    // estimator's own -- which makes any threshold tight enough to be
    // interesting also tight enough to fail on noise, and any threshold loose
    // enough to pass unable to resolve a bias worth finding.
    //
    // The strong form is available here because TRUTH is a closed form: hold
    // the estimate to ITS OWN standard error, ~30x smaller than the plain
    // one. Bias is the failure mode a variance-reduction technique is most
    // likely to conceal, precisely because the tighter spread makes a wrong
    // answer look MORE confident, so this is the tolerance worth using.
    //
    // **With a FIXED c**, deliberately. `E[ȳ − c(x̄ − E[X])] = E[Y]` exactly
    // for any c the sample did not produce, so this is the estimator whose
    // unbiasedness is a theorem rather than an approximation. The default
    // estimated ĉ carries an O(1/N) bias that IS resolvable at this precision;
    // it gets its own measurement below rather than a loosened bound here.
    const { plain, cv } = runStudies(0x6c13_0002, { coefficient: FIXED_C });

    const plainMean = plain.reduce((a, b) => a + b, 0) / plain.length;
    const cvMean = cv.reduce((a, b) => a + b, 0) / cv.length;

    const cvSe = Math.sqrt(variance(cv) / cv.length);
    const plainSe = Math.sqrt(variance(plain) / plain.length);
    // ~9x here. The estimated-ĉ default reaches ~31x on the same studies; a
    // fixed c that is close to c* but not equal to it leaves more residual
    // variance, which is precisely the trade the module documents and the
    // "beats a hand-picked fixed c" test below measures. Asserted at 5x, well
    // clear of both the measurement and its seed-to-seed noise, because what
    // this line exists to establish is only that the tolerance on the next
    // line is a sharp one.
    expect(cvSe).toBeLessThan(plainSe / 5);
    expect(Math.abs(cvMean - TRUTH)).toBeLessThan(4 * cvSe);

    // Plain MC hits the same truth, on its own much looser scale. Asserted so
    // the two are visibly estimating the same quantity and the win is in the
    // spread rather than in the target.
    expect(Math.abs(plainMean - TRUTH)).toBeLessThan(4 * plainSe);
  });

  it("leaves the spread of the individual draws untouched", () => {
    // The control variate acts on the ESTIMATOR, not on the sample. If the
    // per-replicate spread had moved, the method would be reshaping the
    // distribution rather than estimating its mean -- a different and much
    // more alarming thing.
    const knownMean = dragFreeRangeControlMean(MU, SIGMA, THETA);
    const { control, observable } = study(makeNormal(0x6c13_0004));
    const before = variance(observable);
    const r = controlVariateMean(observable, control, knownMean);
    expect(variance(observable)).toBeCloseTo(before, 12);
    expect(r.standardError!).toBeLessThan(r.plainStandardError!);
  });
});

describe("P6.13: what the control variate costs when it is a poor one", () => {
  it("degrades to roughly plain MC on a control uncorrelated with the observable", () => {
    // THE COUNTEREXAMPLE IS MEASURED, NOT WARNED ABOUT -- the standard this
    // package's antithetic exhibit set. A control drawn independently of the
    // observable carries no information about the draw, so ĉ ≈ 0 and the
    // estimator falls back on ȳ. It must not do worse than that by much: the
    // only cost is the noise in ĉ itself.
    const knownMean = dragFreeRangeControlMean(MU, SIGMA, THETA);
    const plain: number[] = [];
    const cv: number[] = [];
    for (let i = 0; i < STUDIES; i++) {
      const obsNormal = makeNormal(0x6c13_0100 + i);
      // A SEPARATE stream for the control: same marginal law, no pairing.
      const ctlNormal = makeNormal(0x7d24_0100 + i);
      const control: number[] = [];
      const observable: number[] = [];
      for (let j = 0; j < N; j++) {
        observable.push(drageyRange(MU + SIGMA * obsNormal()));
        control.push(dragFreeRange(MU + SIGMA * ctlNormal(), THETA));
      }
      const r = controlVariateMean(observable, control, knownMean);
      plain.push(r.plainMean);
      cv.push(r.estimate);
    }
    const ratio = variance(cv) / variance(plain);
    // Measured at 0.994: no win, and none of the loss a poor control could
    // have caused, because ĉ correctly estimates near zero and the estimator
    // falls back on ȳ. This is why the factor is reported -- a caller seeing
    // ≈1 knows the control is not earning its place.
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.2);
  });

  it("shifts the estimate when handed a wrong control mean — the silent failure", () => {
    // The module's most dangerous input, demonstrated rather than described.
    // A control mean that is wrong by `d` shifts the estimate by `c·d` and
    // does NOT widen the standard error, so nothing in the output says the
    // answer moved. This is the concrete reason dragFreeRangeControlMean
    // carries the sigma² term.
    const correct = dragFreeRangeControlMean(MU, SIGMA, THETA);
    const naive = dragFreeRange(MU, THETA); // the sigma² term dropped
    const { control, observable } = study(makeNormal(0x6c13_0005));

    const good = controlVariateMean(observable, control, correct);
    const bad = controlVariateMean(observable, control, naive);

    // The shift is exactly c times the error in the mean, to floating point.
    // Sign: estimate = ȳ − c(x̄ − E[X]), so understating E[X] by d moves the
    // estimate DOWN by c·d. The naive mean drops the sigma² term and is
    // therefore too small, and the bad estimate sits below the good one.
    expect(bad.estimate - good.estimate).toBeCloseTo(good.coefficient * (naive - correct), 9);
    expect(bad.estimate).toBeLessThan(good.estimate);
    // And it is large compared with the standard error that would have to
    // reveal it -- the shift is many SEs, invisible in a reported interval.
    expect(Math.abs(bad.estimate - good.estimate)).toBeGreaterThan(3 * good.standardError!);
    // The SE is identical: nothing in the output changed to signal the error.
    expect(bad.standardError!).toBeCloseTo(good.standardError!, 12);
  });
});

describe("P6.13: the O(1/N) bias from estimating c on the same sample", () => {
  /**
   * Mean of the default (estimated-ĉ) estimator over `studies` studies of
   * `n` replicates each, and that mean's own standard error.
   */
  function biasAt(n: number, studies: number, base: number): { bias: number; se: number } {
    const knownMean = dragFreeRangeControlMean(MU, SIGMA, THETA);
    const estimates: number[] = [];
    for (let i = 0; i < studies; i++) {
      const normal = makeNormal(base + i * 7919);
      const control: number[] = [];
      const observable: number[] = [];
      for (let j = 0; j < n; j++) {
        const v0 = MU + SIGMA * normal();
        control.push(dragFreeRange(v0, THETA));
        observable.push(drageyRange(v0));
      }
      estimates.push(controlVariateMean(observable, control, knownMean).estimate);
    }
    const mean = estimates.reduce((a, b) => a + b, 0) / studies;
    return { bias: mean - TRUTH, se: Math.sqrt(variance(estimates) / studies) };
  }

  it("is real and resolvable — not a rounding artefact to be waved away", () => {
    // The module documents this bias; a test that could not see it would let
    // the documentation drift away from the code. ĉ is computed from the same
    // sample as x̄ and is therefore correlated with it, so
    // `E[ĉ(x̄ − E[X])] ≠ 0` and the estimate is displaced.
    //
    // Averaging 4000 studies puts the mean's standard error far below the
    // displacement, which is what makes the bias visible at all: in ONE study
    // it is ~17% of that study's standard error and could never be seen.
    const { bias, se } = biasAt(16, 4000, 0x6c13_0600);
    expect(Math.abs(bias) / se).toBeGreaterThan(5);
    // Positive here, though the sign is a property of this observable's
    // curvature and is not asserted as a general law.
    expect(bias).toBeGreaterThan(0);
  });

  it("scales as 1/N — the order the module claims, measured across an 8x span", () => {
    // The claim is not "there is a small bias" but "the bias is O(1/N)", and
    // the two differ in what they license: an O(1/N) bias is dominated by the
    // O(N^{-1/2}) standard error at every N and shrinks faster than it, so it
    // never becomes the binding error term. An O(N^{-1/2}) bias would.
    //
    // Measured by holding N x bias roughly constant across an 8x span.
    const small = biasAt(16, 4000, 0x6c13_0601);
    const large = biasAt(128, 4000, 0x6c13_0602);

    const ratio = small.bias / large.bias;
    // Exactly 1/N would give 8. The bound is generous on both sides because
    // each endpoint carries its own Monte Carlo error, and the point is the
    // ORDER: 8x is decisively distinguishable from the sqrt(8) = 2.83 an
    // O(N^{-1/2}) bias would show, and from the 1 of a bias that did not
    // shrink at all.
    expect(ratio).toBeGreaterThan(4);
    expect(ratio).toBeLessThan(16);
  });

  it("is removed by supplying a c the sample did not produce", () => {
    // With a FIXED c the estimator is unbiased exactly, for any c -- so at the
    // same N and the same study count where the estimated-ĉ bias reads at
    // more than 5 standard errors, this one must not.
    const knownMean = dragFreeRangeControlMean(MU, SIGMA, THETA);
    const estimates: number[] = [];
    const STUDY_COUNT = 4000;
    for (let i = 0; i < STUDY_COUNT; i++) {
      const normal = makeNormal(0x6c13_0600 + i * 7919);
      const control: number[] = [];
      const observable: number[] = [];
      for (let j = 0; j < 16; j++) {
        const v0 = MU + SIGMA * normal();
        control.push(dragFreeRange(v0, THETA));
        observable.push(drageyRange(v0));
      }
      estimates.push(
        controlVariateMean(observable, control, knownMean, { coefficient: FIXED_C }).estimate,
      );
    }
    const mean = estimates.reduce((a, b) => a + b, 0) / STUDY_COUNT;
    const se = Math.sqrt(variance(estimates) / STUDY_COUNT);
    expect(Math.abs(mean - TRUTH) / se).toBeLessThan(4);
  });

  it("beats a hand-picked fixed c, which is why the estimated one is the default", () => {
    const { cv: estimated } = runStudies(0x6c13_0007);
    const { cv: fixed } = runStudies(0x6c13_0007, { coefficient: 0.5 });
    // c* is near FIXED_C for this pair; 0.5 is a plausible guess and
    // measurably worse. The O(1/N) bias is the price paid for not guessing.
    expect(variance(estimated)).toBeLessThan(variance(fixed));
  });
});
