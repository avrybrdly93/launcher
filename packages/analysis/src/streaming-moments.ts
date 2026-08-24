/**
 * Streaming moments and streaming quantiles for a Monte Carlo batch (P6.06).
 *
 * Two estimators, both single-pass and both O(1) in storage per stream:
 *
 * - {@link WelfordAccumulator} — running count, mean and second central
 *   moment (`M2`), by Welford's recurrence. Variance is `M2 / (n - 1)`.
 * - {@link P2QuantileEstimator} — Jain & Chlamtac's P² algorithm: a running
 *   estimate of one quantile from five markers, with no sample retained.
 *
 * **Why not just `sumSquares`.** `mc-stats.ts` reduces to `sum` and
 * `sumSquares`, and `var = (sumSquares - sum^2/n) / (n - 1)` is one line from
 * those. It is also the textbook example of catastrophic cancellation: when
 * the mean is large relative to the spread, `sumSquares` and `sum^2/n` agree
 * in their leading digits and the subtraction keeps only the noise. This is
 * not a hypothetical for this project's observables — an impact-speed column
 * around 30 m/s with a 0.05 m/s spread has `sumSquares/n ≈ 900` against a
 * variance of `2.5e-3`, i.e. five leading digits cancel before the answer
 * begins. `streaming-moments.test.ts` measures the failure on exactly that
 * shape. Welford subtracts the running mean *first*, so nothing large is ever
 * subtracted from anything large.
 *
 * **Why not sort for the quantile.** Sorting is exact and is what the
 * fixture's reference values are; it also needs the whole sample resident,
 * which is precisely what P6.04's {@link ObservableSink} exists to avoid, and
 * P6.10's quantile bands want one estimator per time-grid point over a batch
 * that is not retained. P² keeps five markers per quantile and converges to
 * within a fraction of a percent on the sample sizes this project runs; the
 * committed fixture measures how far, rather than the module claiming it.
 *
 * **Order.** Both estimators are order-*dependent* by construction, which is
 * the point of P6.05 sitting underneath them: the caller feeds replicates in
 * canonical index order, so the result is reproducible. {@link
 * WelfordAccumulator.merge} additionally lets two chunk-local accumulators be
 * combined without revisiting their values (Chan, Golub & LeVeque 1979), so a
 * worker pool can reduce locally and still land on one deterministic answer —
 * provided the merges themselves are performed in a fixed order, which is the
 * caller's job and is documented on the method.
 *
 * References: Welford (1962), *Technometrics* 4(3); Chan, Golub & LeVeque
 * (1979), Stanford STAN-CS-79-773; Jain & Chlamtac (1985), *CACM* 28(10).
 */

/**
 * Welford's single-pass mean and variance.
 *
 * Push values one at a time; read {@link mean}, {@link variance} (sample,
 * `n-1`) or {@link populationVariance} (`n`) at any point. No value is
 * retained.
 */
export class WelfordAccumulator {
  private n = 0;
  private runningMean = 0;
  /** Sum of squared deviations from the running mean. */
  private m2 = 0;

  /** How many values have been pushed. */
  get count(): number {
    return this.n;
  }

  /**
   * The running arithmetic mean, or `NaN` for an empty accumulator — not `0`,
   * which is a legitimate mean and would let an empty batch masquerade as a
   * centred one.
   */
  get mean(): number {
    return this.n === 0 ? Number.NaN : this.runningMean;
  }

  /**
   * Sample variance (`M2 / (n - 1)`, Bessel-corrected). `NaN` for `n < 2`:
   * one sample carries no information about spread, and returning `0` there
   * would report a perfectly precise estimate from a single observation.
   */
  get variance(): number {
    return this.n < 2 ? Number.NaN : this.m2 / (this.n - 1);
  }

  /** Population variance (`M2 / n`). `NaN` for `n === 0`. */
  get populationVariance(): number {
    return this.n === 0 ? Number.NaN : this.m2 / this.n;
  }

  /** Sample standard deviation. `NaN` for `n < 2`. */
  get standardDeviation(): number {
    return Math.sqrt(this.variance);
  }

  /**
   * Standard error of the mean, `s / sqrt(n)` — the quantity P6.07's
   * `SE ∝ N^{-1/2}` check measures and P6.08's confidence intervals are built
   * from. `NaN` for `n < 2`.
   */
  get standardError(): number {
    return this.n < 2 ? Number.NaN : Math.sqrt(this.variance / this.n);
  }

  /** The raw second central moment, exposed for {@link merge} and for tests. */
  get sumOfSquaredDeviations(): number {
    return this.m2;
  }

  /**
   * Folds one value in. `NaN` and `±Infinity` are pushed as given rather than
   * rejected: this is a reduction primitive and silently dropping a
   * non-finite would turn a broken upstream solve into a plausible-looking
   * statistic. Callers that mean to exclude something (`mc-stats.ts` excludes
   * non-landing replicates) must not push it.
   */
  push(value: number): void {
    this.n += 1;
    const delta = value - this.runningMean;
    this.runningMean += delta / this.n;
    // Second delta uses the UPDATED mean; the product of the two deltas is
    // what makes this algebraically exact for M2 while never forming a large
    // squared sum.
    this.m2 += delta * (value - this.runningMean);
  }

  /**
   * Merges `other` into this accumulator, as if every value `other` saw had
   * been pushed here (Chan, Golub & LeVeque's parallel formula).
   *
   * **Not bit-identical to sequential pushing, and it cannot be**: the merge
   * evaluates a different expression, so it lands within rounding of the
   * sequential answer rather than on it. What it *is* is deterministic for a
   * fixed merge order — so a worker pool that reduces per chunk and then
   * merges chunks **in canonical chunk order** gets the same answer every
   * run. Merging in arrival order does not, and is the same fault P6.05's
   * `assembleMcColumns` exists to prevent one level down.
   */
  merge(other: WelfordAccumulator): void {
    if (other.n === 0) return;
    if (this.n === 0) {
      this.n = other.n;
      this.runningMean = other.runningMean;
      this.m2 = other.m2;
      return;
    }
    const total = this.n + other.n;
    const delta = other.runningMean - this.runningMean;
    this.runningMean += (delta * other.n) / total;
    this.m2 += other.m2 + (delta * delta * this.n * other.n) / total;
    this.n = total;
  }

  /** Resets to the empty state, so one instance can be reused across a batch. */
  reset(): void {
    this.n = 0;
    this.runningMean = 0;
    this.m2 = 0;
  }
}

/**
 * Convenience wrapper: mean and variance of an array in one pass, for callers
 * that already hold the values and only want the numerically stable answer.
 * Identical arithmetic to pushing each element in index order.
 */
export function welfordMoments(values: ArrayLike<number>): {
  count: number;
  mean: number;
  variance: number;
} {
  const acc = new WelfordAccumulator();
  for (let i = 0; i < values.length; i++) {
    acc.push(values[i] as number);
  }
  return { count: acc.count, mean: acc.mean, variance: acc.variance };
}

/**
 * Jain & Chlamtac's P² estimator for a single quantile `p`, computed in one
 * pass with five markers and no retained sample.
 *
 * The markers track the running estimates of the `0`, `p/2`, `p`, `(1+p)/2`
 * and `1` quantiles. Each new observation shifts the marker heights and the
 * desired positions; markers that drift more than one position away from
 * where they should be are moved by a parabolic (hence P²) prediction,
 * falling back to linear when the parabola would break the ordering.
 *
 * **What it is not.** It is an estimator, not a computation: on a finite
 * sample it does not in general return the exact order statistic, and its
 * error depends on the distribution's shape near `p` and on how many samples
 * it has seen. For `n < 5` it degenerates to exact interpolation over the
 * retained values, which is why {@link value} is exact there and only there.
 * The committed fixture in `packages/validation` measures the error against
 * numpy on a realistic sample rather than this comment asserting a bound.
 */
export class P2QuantileEstimator {
  private readonly p: number;
  /** Marker heights `q[0..4]`, non-decreasing once initialised. */
  private readonly q = new Float64Array(5);
  /** Actual marker positions `n[0..4]`, integers. */
  private readonly pos = new Float64Array(5);
  /** Desired marker positions `n'[0..4]`, real-valued. */
  private readonly desired = new Float64Array(5);
  /** Increments of the desired positions per observation. */
  private readonly increment = new Float64Array(5);
  /** Observations seen; the first five are buffered in `q` and sorted. */
  private seen = 0;

  /**
   * @param p Quantile to estimate, strictly between 0 and 1. The endpoints
   *   are rejected rather than special-cased: the exact min and max are what
   *   `mcStats` already reports, and P²'s outer markers are those values, so
   *   asking this class for them would be a slower way to get the same
   *   number and would hide that fact.
   */
  constructor(p: number) {
    if (!(p > 0 && p < 1)) {
      throw new RangeError(`quantile p must be strictly between 0 and 1, got ${p}`);
    }
    this.p = p;
    this.increment[0] = 0;
    this.increment[1] = p / 2;
    this.increment[2] = p;
    this.increment[3] = (1 + p) / 2;
    this.increment[4] = 1;
  }

  /** The quantile this estimator was constructed for. */
  get quantile(): number {
    return this.p;
  }

  /** How many observations have been pushed. */
  get count(): number {
    return this.seen;
  }

  push(value: number): void {
    if (Number.isNaN(value)) {
      throw new RangeError("P2QuantileEstimator: NaN has no position in an ordering");
    }
    if (this.seen < 5) {
      this.q[this.seen] = value;
      this.seen += 1;
      if (this.seen === 5) {
        // Insertion sort of five elements; the algorithm's initialisation
        // step requires the first five observations in ascending order.
        const first = Array.from(this.q.subarray(0, 5)).sort((a, b) => a - b);
        for (let i = 0; i < 5; i++) {
          this.q[i] = first[i] as number;
          this.pos[i] = i;
          this.desired[i] = i;
        }
        // Desired positions for markers 1..3 start at their p-scaled places.
        this.desired[1] = 2 * this.p;
        this.desired[2] = 4 * this.p;
        this.desired[3] = 2 + 2 * this.p;
      }
      return;
    }

    // 1. Locate the cell the observation falls into, extending the outer
    //    markers if it lies beyond the running min or max.
    let k: number;
    if (value < (this.q[0] as number)) {
      this.q[0] = value;
      k = 0;
    } else if (value < (this.q[1] as number)) {
      k = 0;
    } else if (value < (this.q[2] as number)) {
      k = 1;
    } else if (value < (this.q[3] as number)) {
      k = 2;
    } else if (value <= (this.q[4] as number)) {
      k = 3;
    } else {
      this.q[4] = value;
      k = 3;
    }

    // 2. Increment positions above the cell, and every desired position.
    for (let i = k + 1; i < 5; i++) {
      this.pos[i] = (this.pos[i] as number) + 1;
    }
    for (let i = 0; i < 5; i++) {
      this.desired[i] = (this.desired[i] as number) + (this.increment[i] as number);
    }
    this.seen += 1;

    // 3. Adjust the three interior markers toward their desired positions.
    for (let i = 1; i <= 3; i++) {
      const d = (this.desired[i] as number) - (this.pos[i] as number);
      const gapUp = (this.pos[i + 1] as number) - (this.pos[i] as number);
      const gapDown = (this.pos[i] as number) - (this.pos[i - 1] as number);
      // A marker moves only if it is at least a full position out of place
      // AND there is room to move without colliding with its neighbour --
      // markers may never cross, which is what keeps `q` sorted and the
      // parabolic prediction meaningful.
      if ((d >= 1 && gapUp > 1) || (d <= -1 && gapDown > 1)) {
        const step = Math.sign(d);
        const parabolic = this.parabolic(i, step);
        this.q[i] =
          (this.q[i - 1] as number) < parabolic && parabolic < (this.q[i + 1] as number)
            ? parabolic
            : this.linear(i, step);
        this.pos[i] = (this.pos[i] as number) + step;
      }
    }
  }

  /**
   * The current estimate. Exact for fewer than five observations (the sample
   * is still resident, so this interpolates it the way numpy's default
   * `linear` method does); an estimate thereafter.
   *
   * `NaN` for an empty estimator, for the same reason
   * {@link WelfordAccumulator.mean} is.
   */
  get value(): number {
    if (this.seen === 0) return Number.NaN;
    if (this.seen < 5) {
      const sample = Array.from(this.q.subarray(0, this.seen)).sort((a, b) => a - b);
      const h = this.p * (this.seen - 1);
      const lo = Math.floor(h);
      const hi = Math.ceil(h);
      const low = sample[lo] as number;
      if (lo === hi) return low;
      return low + (h - lo) * ((sample[hi] as number) - low);
    }
    return this.q[2] as number;
  }

  /** The five marker heights, ascending — for tests and for diagnostics. */
  markers(): number[] {
    return Array.from(this.q.subarray(0, Math.min(this.seen, 5)));
  }

  private parabolic(i: number, step: number): number {
    const qi = this.q[i] as number;
    const qUp = this.q[i + 1] as number;
    const qDown = this.q[i - 1] as number;
    const ni = this.pos[i] as number;
    const nUp = this.pos[i + 1] as number;
    const nDown = this.pos[i - 1] as number;
    return (
      qi +
      (step / (nUp - nDown)) *
        ((ni - nDown + step) * ((qUp - qi) / (nUp - ni)) +
          (nUp - ni - step) * ((qi - qDown) / (ni - nDown)))
    );
  }

  private linear(i: number, step: number): number {
    const qi = this.q[i] as number;
    const neighbour = this.q[i + step] as number;
    const ni = this.pos[i] as number;
    const nNeighbour = this.pos[i + step] as number;
    return qi + (step * (neighbour - qi)) / (nNeighbour - ni);
  }
}

/**
 * Streams `values` through one {@link P2QuantileEstimator} per requested
 * quantile and returns the estimates in the order the quantiles were given.
 *
 * One pass over the data, `5 * quantiles.length` numbers of state — so the
 * five-band set P6.10 wants (5/25/50/75/95%) costs 25 numbers regardless of
 * how many replicates the batch has.
 */
export function p2Quantiles(values: ArrayLike<number>, quantiles: readonly number[]): number[] {
  const estimators = quantiles.map((p) => new P2QuantileEstimator(p));
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    for (const estimator of estimators) {
      estimator.push(v);
    }
  }
  return estimators.map((estimator) => estimator.value);
}

/**
 * The exact quantile of a sample, by sorting — numpy's default `linear`
 * interpolation, `h = p (n - 1)`.
 *
 * Present because a streaming estimator needs something to be graded
 * against, and grading it against a *different* definition of "the quantile"
 * would confuse estimator error with convention mismatch. It sorts a copy, so
 * it is O(n log n) in time and O(n) in space and is deliberately not what the
 * Monte Carlo path uses.
 */
export function exactQuantile(values: ArrayLike<number>, p: number): number {
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(`quantile p must be in [0, 1], got ${p}`);
  }
  const n = values.length;
  if (n === 0) return Number.NaN;
  const sorted = Array.from(values as ArrayLike<number>).sort((a, b) => a - b);
  const h = p * (n - 1);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const low = sorted[lo] as number;
  if (lo === hi) return low;
  return low + (h - lo) * ((sorted[hi] as number) - low);
}
