/**
 * Hit probability against a {@link Target}, with a Wilson score interval. (P6.11)
 *
 * A Monte Carlo ensemble of shots produces a stream of impact points; this
 * module reduces that stream to "how often did we hit, and how sure are we?".
 * The counting half is one line over {@link isHit}. The interval half is the
 * part with a decision in it.
 *
 * **Why Wilson and not Wald.** The textbook interval is Wald,
 * `p̂ ± z·√(p̂(1-p̂)/n)`. Its width is proportional to `√(p̂(1-p̂))`, so at
 * `p̂ = 0` or `p̂ = 1` it collapses to **exactly zero** — 0 hits in 20 shots
 * reports "hit probability 0, ± 0", which claims certainty from twenty
 * observations. That is not a rare corner here: a hit probability is a number
 * that *lives* near its endpoints. A tight ring at long range is missed every
 * time until it isn't, and an over-wide tolerance is hit every time; the two
 * configurations a user is most likely to try are precisely the two Wald cannot
 * report on. It also routinely produces bounds below 0 or above 1, which are
 * not probabilities.
 *
 * Wilson's interval is the set of `p` the score test does not reject, which is
 * to say it solves `|p̂ - p| = z·√(p(1-p)/n)` for `p` rather than evaluating the
 * standard error at `p̂` and hoping. Three consequences, all of which matter at
 * the sample sizes an interactive run affords:
 *
 * 1. It has **non-zero width at `k = 0` and `k = n`**. Zero hits in 20 gives
 *    `[0, 0.161]` at 95%, which is the honest statement: the truth could be as
 *    high as one shot in six and still produce this sample.
 * 2. Its bounds are **always inside `[0, 1]`**, by construction rather than by
 *    clamping. A clamped Wald interval is a different, worse estimator wearing
 *    the same numbers.
 * 3. Its coverage is close to nominal across the whole range of `p`, where
 *    Wald's is badly under-nominal for small `n` or extreme `p`. That is a
 *    measurable claim, and `hit-probability.test.ts` measures it against a
 *    seeded binomial simulation rather than asserting it from theory — which is
 *    P6.11's validation criterion.
 *
 * **The interval is not centred on `p̂`, and that is not a bug.** Wilson's
 * centre is `(k + z²/2) / (n + z²)`, the observed count shrunk toward `1/2` by
 * `z²/2` pseudo-counts on each side. So `p̂` is generally *not* the midpoint of
 * `[lower, upper]`, and the asymmetry is largest exactly where it should be —
 * near the endpoints. {@link HitProbability} therefore reports `pHat` and the
 * interval as separate fields and never implies one is the middle of the other.
 * A plotting layer that draws a symmetric error bar around `p̂` from these
 * numbers is drawing something this module did not say.
 *
 * **What is *not* modelled: correlated replicates.** Every interval here
 * assumes the `n` shots are independent Bernoulli trials with a common `p`.
 * That holds for an ensemble whose replicates draw from independent streams
 * (ADR-011's per-replicate substreams give exactly that). It does **not** hold
 * for an ensemble sharing one frozen wind path, or one sweeping a parameter on
 * a grid, where the trials are neither independent nor identically distributed.
 * Nothing in the arithmetic can detect that, so the caller carries it. The
 * interval will be too narrow, not too wide, which is the dangerous direction.
 */

import { normalQuantile } from "@ballista/engine";
import { PLANAR_LAYOUT, type TrajectoryLayout } from "./observables.js";
import { isHit, validateTarget, type Target } from "./targets.js";

/** Default two-sided confidence level. 95%, matching `confidence-interval.ts`'s default for a Monte Carlo mean. */
export const DEFAULT_HIT_PROBABILITY_LEVEL = 0.95;

/**
 * A two-sided Wilson score interval for a binomial proportion.
 *
 * Carries `successes`, `trials` and `level` alongside the bounds for the same
 * reason `MeanConfidenceInterval` (in `confidence-interval.ts`) carries its
 * sample size: `[0, 0.16]` means something very different from 20 trials than
 * from 2000, and a reader handed only the bounds cannot tell which.
 */
export interface WilsonInterval {
  /** Number of successes observed, `k`. */
  readonly successes: number;
  /** Number of trials, `n`. */
  readonly trials: number;
  /** The point estimate `k / n`. **Not** the centre of `[lower, upper]`; see the module doc. */
  readonly pHat: number;
  /** Wilson's shrunk centre, `(k + z²/2) / (n + z²)`. Exposed because the asymmetry is otherwise invisible. */
  readonly center: number;
  /** Lower bound, always `>= 0`. */
  readonly lower: number;
  /** Upper bound, always `<= 1`. */
  readonly upper: number;
  /** The two-sided confidence level this interval was computed at, e.g. `0.95`. */
  readonly level: number;
}

/**
 * The Wilson score interval for `successes` out of `trials` at `level`.
 *
 * @param successes - `k`, an integer in `[0, trials]`.
 * @param trials - `n`, a positive integer.
 * @param level - two-sided confidence level in `(0, 1)`. Defaults to
 *   {@link DEFAULT_HIT_PROBABILITY_LEVEL}.
 * @throws RangeError if the counts are not integers, are negative, if
 *   `successes > trials`, if `trials` is 0, or if `level` is outside `(0, 1)`.
 *
 * `trials === 0` throws rather than returning `[0, 1]`. The vacuous interval is
 * arithmetically defensible — with no data every `p` is consistent — but it is
 * indistinguishable from a real result at a glance, and an empty ensemble is a
 * caller bug (a solve that produced no impacts) far more often than it is a
 * question about probability. Failing loudly is the same policy P0.99 and
 * P0.103 were filed to enforce elsewhere in the repo.
 */
export function wilsonInterval(
  successes: number,
  trials: number,
  level: number = DEFAULT_HIT_PROBABILITY_LEVEL,
): WilsonInterval {
  if (!Number.isInteger(successes) || successes < 0) {
    throw new RangeError(
      `wilsonInterval: successes must be a non-negative integer, got ${successes}`,
    );
  }
  if (!Number.isInteger(trials) || trials <= 0) {
    throw new RangeError(`wilsonInterval: trials must be a positive integer, got ${trials}`);
  }
  if (successes > trials) {
    throw new RangeError(`wilsonInterval: successes (${successes}) exceeds trials (${trials})`);
  }
  if (!(level > 0 && level < 1)) {
    throw new RangeError(`wilsonInterval: level must be in (0, 1), got ${level}`);
  }

  // Two-sided: the upper quantile at 1 - alpha/2.
  const z = normalQuantile(1 - (1 - level) / 2);
  const zz = z * z;
  const n = trials;
  const k = successes;
  const pHat = k / n;

  const denom = n + zz;
  const center = (k + zz / 2) / denom;
  // Half-width written as sqrt(k(n-k)/n + z^2/4) / denom rather than the
  // algebraically equal z*sqrt(pHat*(1-pHat)/n + z^2/(4n^2))/(1 + z^2/n): the
  // first form is a sum of two non-negative integers-scaled terms and cannot go
  // negative under rounding at k = 0 or k = n, where the second form subtracts
  // quantities of similar size.
  const halfWidth = (z * Math.sqrt((k * (n - k)) / n + zz / 4)) / denom;

  // The two endpoints are exact analytically and are returned exactly.
  //
  // At `k = 0`, `center` and `halfWidth` are both `(z²/2)/denom` -- the same
  // expression -- so their difference is already exactly 0 in floating point.
  // At `k = n` they are `(n + z²/2)/denom` and `(z²/2)/denom`, whose exact sum
  // is `denom/denom = 1` but whose *rounded* sum lands one ulp low
  // (0.9999999999999999). Measured, not assumed: `toBe(1)` at `k = n = 20`
  // fails without this branch.
  //
  // One ulp is numerically irrelevant and semantically not: "every shot hit, so
  // the upper bound is 1" is a statement a caller may reasonably test for, and
  // an interval that never quite reaches 1 makes that test silently false. The
  // `Math.max`/`Math.min` on the interior branch stay as belt-and-braces so no
  // rounding can hand back a "probability" of -1e-17.
  const lower = k === 0 ? 0 : Math.max(0, center - halfWidth);
  const upper = k === n ? 1 : Math.min(1, center + halfWidth);

  return { successes: k, trials: n, pHat, center, lower, upper, level };
}

/** The outcome of scoring an ensemble of impact points against a target. */
export interface HitProbability extends WilsonInterval {
  /** Number of ensemble members that hit, `k`. Alias of {@link WilsonInterval.successes}. */
  readonly hits: number;
  /** Number of ensemble members scored, `n`. Alias of {@link WilsonInterval.trials}. */
  readonly shots: number;
}

/** Options for {@link hitProbability}. */
export interface HitProbabilityOptions {
  /** Two-sided confidence level. Defaults to {@link DEFAULT_HIT_PROBABILITY_LEVEL}. */
  readonly level?: number;
  /** Position-space layout the impact points are expressed in. Defaults to {@link PLANAR_LAYOUT}. */
  readonly layout?: TrajectoryLayout;
}

/**
 * Estimate `P(hit)` for `target` from an ensemble of impact points.
 *
 * Each point is scored by {@link isHit}, so the hit criterion is the target's
 * own `tolerance` and the nearest-point geometry of `targets.ts` — this module
 * introduces no second definition of "hit".
 *
 * @param impacts - one position vector per ensemble member. Must be non-empty.
 * @throws RangeError if `impacts` is empty, or via {@link wilsonInterval} /
 *   {@link validateTarget} for a malformed level or target.
 *
 * **A `NaN` coordinate is an error, not a miss.** A replicate whose solve
 * diverged produces `NaN` impacts, and `NaN <= tolerance` is `false`, so
 * scoring it naively would silently record a *miss* and bias `p̂` downward by
 * exactly the failure rate. Since a failed solve is not evidence about where
 * the shot lands, such a point throws rather than voting. Callers who mean to
 * exclude failures must filter them out deliberately, which also keeps `n`
 * honest.
 */
export function hitProbability(
  impacts: readonly (readonly number[])[],
  target: Target,
  options: HitProbabilityOptions = {},
): HitProbability {
  const layout = options.layout ?? PLANAR_LAYOUT;
  validateTarget(target, layout);

  if (impacts.length === 0) {
    throw new RangeError(
      "hitProbability: impacts is empty; an ensemble must have at least one member",
    );
  }

  let hits = 0;
  for (let i = 0; i < impacts.length; i += 1) {
    const point = impacts[i]!;
    for (let axis = 0; axis < point.length; axis += 1) {
      if (Number.isNaN(point[axis]!)) {
        throw new RangeError(
          `hitProbability: impacts[${i}] has a NaN coordinate at axis ${axis}. ` +
            "A diverged solve is not a miss -- filter failed replicates out explicitly.",
        );
      }
    }
    if (isHit(target, point, layout)) hits += 1;
  }

  const interval = wilsonInterval(
    hits,
    impacts.length,
    options.level ?? DEFAULT_HIT_PROBABILITY_LEVEL,
  );
  return { ...interval, hits, shots: impacts.length };
}

/**
 * Render a hit probability the way it must be displayed: the estimate, the
 * interval, and the `n` that produced it.
 *
 * Mirrors `formatMeanConfidenceInterval`'s policy — an interval detached from
 * its sample size is unreadable, so the formatter will not produce one.
 */
export function formatHitProbability(hp: HitProbability, digits = 1): string {
  const pct = (x: number): string => `${(100 * x).toFixed(digits)}%`;
  return `${pct(hp.pHat)} [${pct(hp.lower)}, ${pct(hp.upper)}] at ${100 * hp.level}% (${hp.hits}/${hp.shots})`;
}
