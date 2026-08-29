/**
 * Serializable probability distributions for uncertain scenario parameters
 * (P6.01, blueprint §7 phase 6).
 *
 * Three families, each optionally truncated: `normal`, `lognormal` and
 * `uniform`. A distribution here describes *one* scalar parameter. Attaching
 * distributions to named fields of a `ScenarioSpec` is P6.02's job
 * (`UncertainScenarioSpec`), deliberately not this module's -- this one has no
 * opinion about what the number means, which is what lets the same four kinds
 * cover a launch angle, a drag coefficient and an air density.
 *
 * Truncation is by inverse-CDF rather than rejection. Rejection is simpler but
 * its cost is unbounded as the interval moves into the tail -- a `sigma`-wide
 * window at four sigma accepts about one draw in thirty thousand -- and Monte
 * Carlo work (P6.04 runs 1e4 replicates) cannot afford a sampler whose runtime
 * depends on how unlikely the region is. Inverse-CDF is O(1) everywhere.
 *
 * Every distribution reports its analytic {@link distributionMoments}. That is
 * not decoration: it is the reference P6.01's validation criterion ("sampling
 * moments match analytics, 1e5 draws, 3-sigma bands") compares against, and
 * the truncated moments are exactly the part a hand-rolled sampler tends to
 * get subtly wrong.
 */

import { z } from "zod";
import {
  normalCdf,
  normalPdf,
  normalQuantile,
  normalUpperTail,
  standardNormalIntervalMass,
} from "./normal-distribution-functions.js";
import type { PCG32 } from "./random.js";

/**
 * A normal distribution, optionally truncated to `[min, max]`.
 *
 * `mean` and `stdDev` describe the *untruncated* parent. Truncating changes
 * both moments -- see {@link distributionMoments} -- so a truncated spec's
 * `mean` is not the mean of what it samples, and is not meant to be.
 */
const normalSpecSchema = z.object({
  kind: z.literal("normal"),
  mean: z.number().finite(),
  stdDev: z.number().positive().finite(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
});

/**
 * A lognormal distribution, optionally truncated to `[min, max]` in the value
 * domain (not the log domain).
 *
 * `logMean` and `logStdDev` are the parameters of the underlying normal, i.e.
 * `X = exp(logMean + logStdDev * Z)`. This is the parameterisation that makes
 * the moment formulae clean; the distribution's own mean is
 * `exp(logMean + logStdDev^2 / 2)`, which {@link distributionMoments} reports.
 * Bounds are in the value domain because that is where a caller thinks -- "the
 * drag coefficient is positive and below 2", not "below 0.693 in logs".
 */
const lognormalSpecSchema = z.object({
  kind: z.literal("lognormal"),
  logMean: z.number().finite(),
  logStdDev: z.number().positive().finite(),
  min: z.number().positive().finite().optional(),
  max: z.number().positive().finite().optional(),
});

/**
 * A uniform distribution on `[min, max)`.
 *
 * Bounded by construction, so it has no separate truncated variant: truncating
 * a uniform yields a uniform on the intersection, which the caller can write
 * directly.
 */
const uniformSpecSchema = z.object({
  kind: z.literal("uniform"),
  min: z.number().finite(),
  max: z.number().finite(),
});

/**
 * The three families before the cross-field checks below.
 *
 * Split out so that the bound-standardising helper the refinement calls can be
 * typed against the union, without the type of the exported schema depending on
 * a function that depends on the type of the exported schema.
 *
 * Exported because {@link DistributionSpec} is inferred from it, following the
 * same convention as `scenario-spec.ts`'s component schemas. Parse with
 * {@link distributionSpecSchema}, not this: this one accepts an inverted
 * interval and an unsampleable tail window.
 */
export const distributionSpecUnionSchema = z.discriminatedUnion("kind", [
  normalSpecSchema,
  lognormalSpecSchema,
  uniformSpecSchema,
]);

/** Parsed type of {@link distributionSpecSchema}. */
export type DistributionSpec = z.infer<typeof distributionSpecUnionSchema>;

/** Serializable description of one uncertain scalar parameter. */
export const distributionSpecSchema = distributionSpecUnionSchema.superRefine((spec, ctx) => {
  const { min, max } = spec;
  if (min !== undefined && max !== undefined && !(max > min)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `max (${max}) must be greater than min (${min})`,
      path: ["max"],
    });
    return;
  }
  // A truncation window can be legal on its face and still keep no
  // representable probability mass -- [40 sigma, 41 sigma] underflows to
  // zero. Rejecting it here turns a silent NaN at sample time into a parse
  // error at configuration time, which is where a study's author can see it.
  if (spec.kind !== "uniform" && (min !== undefined || max !== undefined)) {
    const [alpha, beta] = standardBounds(spec);
    if (standardNormalIntervalMass(alpha, beta) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "truncation bounds retain no representable probability mass; " +
          "they sit too far into the tail to sample from",
        path: ["min"],
      });
    }
  }
});

/** The first two moments of a distribution, including any truncation. */
export interface DistributionMoments {
  /** `E[X]`. */
  mean: number;
  /** `Var[X]`. */
  variance: number;
  /** `sqrt(Var[X])`, for comparing against a sample standard deviation. */
  stdDev: number;
}

/**
 * Truncation bounds expressed in standard units of the underlying normal.
 *
 * For a lognormal that means the bounds' logarithms, since `X <= max` and
 * `log X <= log max` are the same event. Absent bounds become infinities,
 * which every formula below is written to accept.
 */
function standardBounds(spec: DistributionSpec): [alpha: number, beta: number] {
  if (spec.kind === "uniform") return [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  const center = spec.kind === "normal" ? spec.mean : spec.logMean;
  const scale = spec.kind === "normal" ? spec.stdDev : spec.logStdDev;
  const toStandard = (value: number): number =>
    ((spec.kind === "normal" ? value : Math.log(value)) - center) / scale;
  return [
    spec.min === undefined ? Number.NEGATIVE_INFINITY : toStandard(spec.min),
    spec.max === undefined ? Number.POSITIVE_INFINITY : toStandard(spec.max),
  ];
}

/** `phi(z)`, and 0 at an infinite bound where the density has no mass. */
function densityAt(z: number): number {
  return Number.isFinite(z) ? normalPdf(z) : 0;
}

/** `z phi(z)`, and 0 at an infinite bound, where `z phi(z) -> 0`. */
function weightedDensityAt(z: number): number {
  return Number.isFinite(z) ? z * normalPdf(z) : 0;
}

/** True when a spec carries no truncation and its parent moments apply as-is. */
function isUntruncated(alpha: number, beta: number): boolean {
  return alpha === Number.NEGATIVE_INFINITY && beta === Number.POSITIVE_INFINITY;
}

/**
 * Draw one standard normal restricted to `[alpha, beta]`, by inverse CDF.
 *
 * The interval's probability mass is computed in whichever tail keeps it away
 * from 1, and the draw is placed in that same tail, so an interval at four
 * sigma is sampled with the same relative accuracy as one at the mean. Doing
 * this in the `Phi` domain throughout would resolve `[4, 5]` to about eleven
 * digits and `[10, 11]` to none at all.
 */
function sampleTruncatedStandardNormal(
  rng: PCG32,
  alpha: number,
  beta: number,
  sense: AntitheticSense = "direct",
): number {
  if (isUntruncated(alpha, beta)) {
    // Symmetric support, so the antithetic partner is the negation. Box-Muller
    // is *not* monotone in its two uniforms -- `1 - u` on the pair does not give
    // `-z`, it gives an unrelated normal -- so the mirror has to be taken on the
    // variate, which is the whole reason this sense parameter is threaded down
    // here rather than wrapped around `nextF64` at the top.
    const z = rng.nextGaussian();
    return sense === "direct" ? z : -z;
  }
  const drawn = rng.nextF64();
  // Every branch below places `u` through an increasing inverse CDF, so `1 - u`
  // is exactly the mirrored quantile of the *truncated* law and stays inside the
  // support. `-z` would not: a distribution truncated to `[1, 3]` has no mass at
  // `-z`, so the negation used above is correct only for the untruncated case.
  const u = sense === "direct" ? drawn : 1 - drawn;
  if (beta <= 0) {
    // Reflect: the mirrored interval has a non-negative lower bound, so the
    // branch below applies and its accuracy carries over.
    return -placeUniformInTruncatedNormal(u, -beta, -alpha);
  }
  return placeUniformInTruncatedNormal(u, alpha, beta);
}

/**
 * The **increasing** inverse CDF of the standard normal restricted to
 * `[alpha, beta]`.
 *
 * ## Why this is a separate function and not a reuse
 *
 * {@link placeUniformInTruncatedNormal} is not consistently oriented, and
 * cannot simply be called here. Its two branches run in opposite directions:
 *
 * - `alpha < 0`: works in the `Phi` domain and returns
 *   `Phi^-1(Phi(alpha) + u (Phi(beta) - Phi(alpha)))`, which **increases** from
 *   `alpha` to `beta`.
 * - `alpha >= 0`: works in the upper tail, interpolating from `Q(beta)` up to
 *   `Q(alpha)` as `u` goes 0 -> 1. More mass above means a smaller value, so it
 *   **decreases**, from `beta` down to `alpha`. In quantile terms it is
 *   `F^-1(1 - u)`.
 *
 * For a *draw* the inconsistency is invisible and harmless: `u` and `1 - u` are
 * both uniform, so each branch samples exactly the right law, and the
 * antithetic mirror still mirrors because a decreasing map is still monotone.
 * For a *quantile* it is fatal -- stratum `k` of `N` would land in band
 * `N - 1 - k` whenever the truncation happened to sit above zero, silently
 * transposing a Latin hypercube along that one dimension while leaving every
 * marginal law correct and every histogram looking right.
 *
 * So each branch is oriented explicitly here, and the sampler above is left
 * bit-for-bit alone rather than reoriented -- every recorded draw, golden
 * trajectory and determinism test in the repository depends on its exact
 * output.
 *
 * Correct with infinite bounds: `alpha = -inf`, `beta = +inf` takes the middle
 * branch and reduces to `normalQuantile(u)`.
 */
function standardNormalQuantileInInterval(u: number, alpha: number, beta: number): number {
  if (beta <= 0) {
    // Reflect onto `Y = -Z`, whose interval `[-beta, -alpha]` has a
    // non-negative lower bound and so takes the decreasing branch below.
    // `place(u, -beta, -alpha) = F_Y^-1(1 - u)`, and `F_Z^-1(u) =
    // -F_Y^-1(1 - u)`, so the negation of the unflipped call is already the
    // increasing quantile of `Z`.
    return -placeUniformInTruncatedNormal(u, -beta, -alpha);
  }
  if (alpha >= 0) {
    // The decreasing branch: feed it `1 - u` to get `F^-1(u)`.
    return placeUniformInTruncatedNormal(1 - u, alpha, beta);
  }
  return placeUniformInTruncatedNormal(u, alpha, beta);
}

/**
 * The inverse-CDF placement itself, split out so the reflection above can
 * reuse it with an already-drawn uniform.
 */
function placeUniformInTruncatedNormal(u: number, alpha: number, beta: number): number {
  if (alpha >= 0) {
    // Upper-tail domain: both endpoint probabilities are small, so their
    // difference keeps all of its digits.
    const upperAtAlpha = normalUpperTail(alpha);
    const upperAtBeta = normalUpperTail(beta);
    const q = upperAtBeta + u * (upperAtAlpha - upperAtBeta);
    return -normalQuantile(q);
  }
  const cdfAtAlpha = normalCdf(alpha);
  const cdfAtBeta = normalCdf(beta);
  return normalQuantile(cdfAtAlpha + u * (cdfAtBeta - cdfAtAlpha));
}

/** Clamp into the spec's own support, absorbing the last ulp of rounding. */
function clampToSupport(spec: DistributionSpec, value: number): number {
  let clamped = value;
  if (spec.min !== undefined && clamped < spec.min) clamped = spec.min;
  if (spec.max !== undefined && clamped > spec.max) clamped = spec.max;
  return clamped;
}

/**
 * Draw one sample.
 *
 * Consumes a fixed number of draws from `rng` per call for a given spec shape
 * -- one uniform for a truncated or uniform draw, one Box-Muller pair (cached,
 * so one every other call) for an untruncated normal or lognormal. That
 * matters for P6.03's replicate substreams: a sampler whose consumption
 * depended on the value would make replicate `i` depend on replicate `i - 1`.
 *
 * @param spec - a parsed {@link distributionSpecSchema}.
 * @param rng - a seeded generator; see `random.ts`.
 */
export function sampleDistribution(spec: DistributionSpec, rng: PCG32): number {
  return sampleWithSense(spec, rng, "direct");
}

/**
 * Which half of an antithetic pair a draw is (P6.12).
 *
 * `"direct"` reproduces {@link sampleDistribution} exactly. `"reflected"`
 * consumes the *same* number of raw draws from the same stream and returns the
 * partner variate -- the value the same underlying randomness maps to under the
 * distribution's own mirror.
 */
export type AntitheticSense = "direct" | "reflected";

/**
 * Draw the antithetic partner of the sample {@link sampleDistribution} would
 * take from this generator state (P6.12).
 *
 * Pass a generator in the *same* state the direct draw started from -- in
 * practice the same `(replicate, overlay)` substream, which is what
 * `generateAntitheticReplicate` does -- and the two values are a matched pair:
 * identical marginal law, and negatively correlated by construction.
 *
 * ## Why the mirror is taken on the variate and not on the uniform stream
 *
 * The textbook description of antithetic variates is "use `1 - u`", and for an
 * inverse-CDF sampler that is exactly right. This module is only *partly* an
 * inverse-CDF sampler: an untruncated normal or lognormal goes through
 * Box-Muller ({@link PCG32.nextGaussian}), which is **not monotone** in either
 * of its two uniforms. Feeding it `1 - u1, 1 - u2` yields a perfectly good
 * standard normal that has no particular relationship to the direct draw --
 * near-zero correlation rather than -1, so the variance reduction the option
 * exists to deliver would silently not happen. A stream-level wrapper is the
 * obvious implementation and it is the wrong one; hence the sense is threaded
 * down to each sampler, which mirrors in whichever domain is correct for it:
 *
 * | spec | direct | reflected | why |
 * | --- | --- | --- | --- |
 * | `uniform` | `min + (max-min) u` | `min + (max-min) (1-u)` | linear, so `1-u` is the exact mirror |
 * | untruncated `normal`/`lognormal` | `z` | `-z` | support is symmetric about the mean; Box-Muller has no single `u` to invert |
 * | truncated any | `F^-1(u)` | `F^-1(1-u)` | `-z` would leave a one-sided support; the truncated quantile map is increasing, so `1-u` mirrors within it |
 *
 * ## What this does not promise
 *
 * Antithetic sampling reduces variance when the observable is **monotone** in
 * the drawn parameters, and can *increase* it when the observable is symmetric
 * about the mean of the draw (a pair either side of a parabola's vertex gives
 * the same value, so the pair average has no cancellation at all). It is an
 * option, defaulted off, for that reason. The measured reduction on the
 * criterion's monotone case lives in
 * `packages/analysis/src/antithetic-variance-reduction.test.ts`, and that file
 * also measures the non-monotone counterexample rather than merely warning
 * about it.
 */
export function sampleDistributionAntithetic(spec: DistributionSpec, rng: PCG32): number {
  return sampleWithSense(spec, rng, "reflected");
}

/**
 * The single definition of the draw, parameterised by which half of the pair it
 * is. Both public entry points route through here so that a change to the
 * mapping cannot apply to one half and not the other.
 */
function sampleWithSense(spec: DistributionSpec, rng: PCG32, sense: AntitheticSense): number {
  if (spec.kind === "uniform") {
    const drawn = rng.nextF64();
    const u = sense === "direct" ? drawn : 1 - drawn;
    return spec.min + (spec.max - spec.min) * u;
  }
  const [alpha, beta] = standardBounds(spec);
  const z = sampleTruncatedStandardNormal(rng, alpha, beta, sense);
  if (spec.kind === "normal") {
    return clampToSupport(spec, spec.mean + spec.stdDev * z);
  }
  return clampToSupport(spec, Math.exp(spec.logMean + spec.logStdDev * z));
}

/**
 * The distribution's inverse CDF: the value with probability `u` below it.
 *
 * Increasing in `u` for every spec this module accepts, which is the property
 * stratified samplers rest on -- P6.14's Latin hypercube needs stratum `k` of
 * `N` to map into the `k`th `1/N` band of probability mass, and P6.15's Sobol'
 * sequence needs the same guarantee. Consumes no randomness; the caller
 * decides where in `(0, 1)` to look.
 *
 * Unlike {@link sampleDistribution} this is inverse-CDF *throughout*. The
 * untruncated normal and lognormal are drawn by Box-Muller there, which is a
 * perfectly good sampler but not a quantile: it consumes two uniforms and is
 * monotone in neither, so there is no `u` to hand it. Here they go through
 * `normalQuantile` instead. The two therefore produce different numbers from
 * the same generator state, by design -- this is a map, not a draw.
 *
 * @param u - a probability in `(0, 1)`. The open interval is required: the
 *   endpoints are at infinity for any unbounded spec, and silently clamping
 *   them would put a spike of mass on a bound that the distribution gives
 *   probability zero.
 * @throws if `u` is not a finite number strictly inside `(0, 1)`.
 */
export function distributionQuantile(spec: DistributionSpec, u: number): number {
  if (!Number.isFinite(u) || u <= 0 || u >= 1) {
    throw new Error(`distributionQuantile: u must be a finite probability in (0, 1), got ${u}`);
  }
  if (spec.kind === "uniform") {
    return spec.min + (spec.max - spec.min) * u;
  }
  const [alpha, beta] = standardBounds(spec);
  const z = standardNormalQuantileInInterval(u, alpha, beta);
  if (spec.kind === "normal") {
    return clampToSupport(spec, spec.mean + spec.stdDev * z);
  }
  return clampToSupport(spec, Math.exp(spec.logMean + spec.logStdDev * z));
}

/**
 * The distribution's analytic mean and variance, accounting for truncation.
 *
 * Truncated normal (standardised bounds `alpha`, `beta`, retained mass `Z`):
 *
 * ```
 * E[X]   = mu + sigma (phi(alpha) - phi(beta)) / Z
 * Var[X] = sigma^2 [1 + (alpha phi(alpha) - beta phi(beta)) / Z - ((phi(alpha) - phi(beta)) / Z)^2]
 * ```
 *
 * Truncated lognormal, from the same standardised bounds on `log X`:
 *
 * ```
 * E[X^k] = exp(k m + k^2 s^2 / 2) [Phi(beta - k s) - Phi(alpha - k s)] / Z
 * ```
 *
 * with the variance following as `E[X^2] - E[X]^2`. Both reduce to the
 * familiar untruncated forms when `Z = 1`.
 */
export function distributionMoments(spec: DistributionSpec): DistributionMoments {
  if (spec.kind === "uniform") {
    const width = spec.max - spec.min;
    const variance = (width * width) / 12;
    return { mean: (spec.min + spec.max) / 2, variance, stdDev: Math.sqrt(variance) };
  }

  const [alpha, beta] = standardBounds(spec);
  const untruncated = isUntruncated(alpha, beta);

  if (spec.kind === "normal") {
    if (untruncated) {
      return {
        mean: spec.mean,
        variance: spec.stdDev * spec.stdDev,
        stdDev: spec.stdDev,
      };
    }
    const mass = standardNormalIntervalMass(alpha, beta);
    const shift = (densityAt(alpha) - densityAt(beta)) / mass;
    const spread = 1 + (weightedDensityAt(alpha) - weightedDensityAt(beta)) / mass - shift * shift;
    const variance = spec.stdDev * spec.stdDev * spread;
    return {
      mean: spec.mean + spec.stdDev * shift,
      variance,
      stdDev: Math.sqrt(variance),
    };
  }

  const { logMean: m, logStdDev: s } = spec;
  const mass = untruncated ? 1 : standardNormalIntervalMass(alpha, beta);
  const rawMoment = (k: number): number => {
    const shiftedMass = untruncated ? 1 : standardNormalIntervalMass(alpha - k * s, beta - k * s);
    return (Math.exp(k * m + (k * k * s * s) / 2) * shiftedMass) / mass;
  };
  const mean = rawMoment(1);
  // Clamped at zero: for an extremely narrow truncation the two raw moments
  // agree to within rounding and the difference can go slightly negative.
  const variance = Math.max(0, rawMoment(2) - mean * mean);
  return { mean, variance, stdDev: Math.sqrt(variance) };
}

/**
 * The interval a sample is guaranteed to land in.
 *
 * Infinite where a distribution is unbounded, except that a lognormal is
 * always positive whether or not a `min` was given.
 */
export function distributionSupport(spec: DistributionSpec): { min: number; max: number } {
  const naturalMin = spec.kind === "lognormal" ? 0 : Number.NEGATIVE_INFINITY;
  return {
    min: spec.min ?? naturalMin,
    max: spec.max ?? Number.POSITIVE_INFINITY,
  };
}
