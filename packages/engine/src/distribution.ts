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
 * Split out so that {@link standardBounds}, which the refinement calls, can be
 * typed against the union without the type of the exported schema depending on
 * a function that depends on the type of the exported schema.
 */
const distributionSpecUnion = z.discriminatedUnion("kind", [
  normalSpecSchema,
  lognormalSpecSchema,
  uniformSpecSchema,
]);

/** Parsed type of {@link distributionSpecSchema}. */
export type DistributionSpec = z.infer<typeof distributionSpecUnion>;

/** Serializable description of one uncertain scalar parameter. */
export const distributionSpecSchema = distributionSpecUnion.superRefine((spec, ctx) => {
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
function sampleTruncatedStandardNormal(rng: PCG32, alpha: number, beta: number): number {
  if (isUntruncated(alpha, beta)) return rng.nextGaussian();
  const u = rng.nextF64();
  if (beta <= 0) {
    // Reflect: the mirrored interval has a non-negative lower bound, so the
    // branch below applies and its accuracy carries over.
    return -placeUniformInTruncatedNormal(u, -beta, -alpha);
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
  if (spec.kind === "uniform") {
    return spec.min + (spec.max - spec.min) * rng.nextF64();
  }
  const [alpha, beta] = standardBounds(spec);
  const z = sampleTruncatedStandardNormal(rng, alpha, beta);
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
