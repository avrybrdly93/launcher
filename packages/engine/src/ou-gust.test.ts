import { describe, expect, it } from "vitest";
import { PCG32 } from "./random.js";
import {
  generateOuGustPath,
  ouGustStep,
  sampleStationaryOuGust,
  type OuGustParams,
} from "./ou-gust.js";

describe("ouGustStep / generateOuGustPath (P4.16)", () => {
  it("is a no-op decay to zero noise (xi=0): pure e^{-Δ/τ} attenuation", () => {
    const params: OuGustParams = { tau: 2, sigma: 3 };
    const next = ouGustStep(5, params, 1, 0);
    expect(next).toBeCloseTo(5 * Math.exp(-1 / 2), 15);
  });

  it("at Δ=0 the state is unchanged regardless of xi (decay=1, noise term=0)", () => {
    const params: OuGustParams = { tau: 2, sigma: 3 };
    expect(ouGustStep(7, params, 0, 5)).toBeCloseTo(7, 15);
  });

  it("generateOuGustPath produces exactly steps+1 samples starting at the given w0", () => {
    const rng = new PCG32(1n, 1n);
    const path = generateOuGustPath(rng, { tau: 1, sigma: 1 }, 0.1, 50, 2.5);
    expect(path.length).toBe(51);
    expect(path[0]).toBe(2.5);
  });

  it("sampleStationaryOuGust scales a standard-normal draw by sigma", () => {
    const rngA = new PCG32(42n, 3n);
    const rngB = new PCG32(42n, 3n);
    const sigma = 4;
    expect(sampleStationaryOuGust(rngA, { tau: 1, sigma })).toBeCloseTo(
      sigma * rngB.nextGaussian(),
      15,
    );
  });

  /**
   * Validation criterion (blueprint P4.16): "sample ACF matches e^{-t/τ}
   * (χ² test, 1e4 samples)".
   *
   * The exact discretization implies the process's autocorrelation at lag
   * L steps (t = L*Δ) is theoretically rho(L) = e^{-LΔ/τ}. Rather than
   * estimating the ACF from one long dependent time series (whose sampling
   * variance under an AR(1)-type model has no simple closed form), this
   * test draws `perLag` *independent* stationary realizations per lag and
   * measures the sample correlation between each realization's w'_0 and
   * w'_L -- an i.i.d.-pairs design, so Fisher's z-transform applies
   * directly: z = atanh(r) is asymptotically N(atanh(rho), 1/(n-3)).
   *
   * Each lag draws from its own disjoint slice of the RNG stream (a fresh
   * substream per lag), so the four per-lag z-scores are independent and
   * their squared, standardized sum is a chi-square statistic with
   * dof = lags.length = 4. The critical value for dof=4 at alpha=0.001 is
   * 18.47 (standard chi-square table); this test uses a threshold of 30 for
   * headroom against the Fisher approximation's finite-sample bias while
   * still failing hard on a wrong discretization (a broken sqrt(1-e^{-2Δ/τ})
   * factor, e.g. sqrt(1-e^{-Δ/τ}), was verified during development to blow
   * the statistic up to several hundred -- see 14_CHANGELOG equivalent
   * commit message for this task).
   */
  it("sample ACF at several lags matches the theoretical e^{-t/tau} decay (chi-square test)", () => {
    const params: OuGustParams = { tau: 0.7, sigma: 2.0 };
    const dt = 0.05;
    const lagsInSteps = [1, 2, 4, 8];
    const perLag = 2500; // 4 lags * 2500 = 1e4 samples total, per the P4.16 validation criterion.
    const rng = new PCG32(12345n, 1n);

    let chiSquare = 0;
    for (const lag of lagsInSteps) {
      const lagRng = rng.substream(BigInt(lag));
      const w0 = new Float64Array(perLag);
      const wLag = new Float64Array(perLag);
      for (let i = 0; i < perLag; i++) {
        let w = sampleStationaryOuGust(lagRng, params);
        w0[i] = w;
        for (let k = 0; k < lag; k++) {
          w = ouGustStep(w, params, dt, lagRng.nextGaussian());
        }
        wLag[i] = w;
      }

      const r = sampleCorrelation(w0, wLag);
      const targetRho = Math.exp(-(lag * dt) / params.tau);
      const z = Math.atanh(r);
      const targetZ = Math.atanh(targetRho);
      const variance = 1 / (perLag - 3);
      chiSquare += (z - targetZ) ** 2 / variance;
    }

    expect(chiSquare).toBeLessThan(30);
  });
});

function sampleCorrelation(xs: Float64Array, ys: Float64Array): number {
  const n = xs.length;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += xs[i]!;
    meanY += ys[i]!;
  }
  meanX /= n;
  meanY /= n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}
