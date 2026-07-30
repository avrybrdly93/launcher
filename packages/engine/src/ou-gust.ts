import { PCG32 } from "./random.js";

/**
 * Ornstein-Uhlenbeck gust fluctuation parameters (§3.5 eq. 3.14):
 *
 *   dw' = -(w'/tau) dt + sigma*sqrt(2/tau) dW_t
 *
 * `tau` is the correlation time (s); `sigma` is the process's stationary
 * standard deviation (m/s) -- the diffusion coefficient is fixed to
 * sigma*sqrt(2/tau) so that Var(w') -> sigma^2 at stationarity, not an
 * independent third parameter.
 */
export interface OuGustParams {
  readonly tau: number;
  readonly sigma: number;
}

/**
 * Exact discretization of (3.14) (P4.16):
 *
 *   w'_{k+1} = w'_k * e^{-Δ/τ} + σ*sqrt(1 - e^{-2Δ/τ}) * ξ
 *
 * with ξ a standard-normal draw. This is not an Euler-Maruyama approximation
 * of the SDE -- it is the OU process's exact transition density, so it is
 * unconditionally stable and exact for any step Δ, including Δ >> τ.
 */
export function ouGustStep(
  prev: number,
  { tau, sigma }: OuGustParams,
  dt: number,
  xi: number,
): number {
  const decay = Math.exp(-dt / tau);
  return prev * decay + sigma * Math.sqrt(1 - decay * decay) * xi;
}

/**
 * Draws a sample from the process's own stationary marginal, w' ~ N(0,
 * sigma^2). A path started from this draw is statistically stationary from
 * step 0, with no burn-in needed.
 */
export function sampleStationaryOuGust(rng: PCG32, { sigma }: OuGustParams): number {
  return sigma * rng.nextGaussian();
}

/**
 * Generates a length-`steps+1` OU sample path (P4.16) on a uniform Δ=`dt`
 * grid, starting from `w0` (a fresh stationary draw by default). This is
 * the raw stochastic generator only: per ADR-011, wrapping a path into a
 * seeded, PCHIP-interpolated `WindModel` is P4.17 -- SolverKit never calls
 * this directly.
 */
export function generateOuGustPath(
  rng: PCG32,
  params: OuGustParams,
  dt: number,
  steps: number,
  w0: number = sampleStationaryOuGust(rng, params),
): Float64Array {
  const path = new Float64Array(steps + 1);
  path[0] = w0;
  for (let k = 0; k < steps; k++) {
    path[k + 1] = ouGustStep(path[k]!, params, dt, rng.nextGaussian());
  }
  return path;
}
