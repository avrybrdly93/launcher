/**
 * k-means clustering of trajectory ensembles (P6.21, §7 phase-6 table:
 * "k-means clustering of trajectories (feature vector: resampled y(t) +
 * observables)", validation "bimodal two-arc ensemble separates into 2
 * clusters (ARI > 0.9 on labeled fixture)").
 *
 * A Monte Carlo ensemble is often not one population. Sample a launch angle
 * across the 45° optimum and the ensemble splits into a flat, fast arc and a
 * lofted, slow one that reach the same range by different routes; a bimodal
 * wind input does the same thing. A fan chart (P6.10) averages the two into a
 * single wide band and reports the median of a distribution that has no mass
 * near its median. This module answers "how many populations, and which
 * replicate belongs to which" so P6.22 can draw them apart.
 *
 * **Nothing here draws.** Every function returns plain typed arrays; P6.22
 * renders them, the same split `ensemble-fan.ts` used for P6.10.
 *
 * ## The feature vector, and the two traps in building one
 *
 * The task names the feature vector: resampled `y(t)` plus observables. Both
 * halves are needed — the shape distinguishes a lofted arc from a flat one,
 * and the scalars (range, time of flight, impact speed) distinguish arcs whose
 * shapes are similar but whose endpoints are not. Building it naively fails
 * twice, and both failures are silent.
 *
 * **Trap 1: NaN.** Replicates do not share a support. `buildCommonGrid`
 * (P6.10) spans the *union* of the ensemble's time ranges, so a replicate that
 * landed at 8.2 s is `NaN` from 8.2 s to the grid's end — deliberately, since
 * a fan chart must thin rather than clamp. Feed those `NaN`s into a Euclidean
 * distance and every distance involving that replicate is `NaN`; `NaN < best`
 * is `false`, so the point silently sticks to whichever centroid it was
 * compared against first, and k-means returns a confident, meaningless
 * answer. This module therefore samples the shape on the **intersection** of
 * the ensemble's supports ({@link buildCommonSupportGrid}), where every
 * replicate has a real value, and lets the *observables* carry what happens
 * after the first replicate lands. {@link buildTrajectoryFeatures} additionally
 * refuses to return a non-finite feature at all, rather than letting one
 * through to be discovered as a strange cluster.
 *
 * **Trap 2: scale and dimension count.** `y(t)` is in metres and runs to
 * hundreds; time of flight is in seconds and runs to tens. Unstandardised,
 * Euclidean distance is a statement about metres and the observables are
 * decoration. Standardising each column to zero mean and unit variance fixes
 * the units but not the *count*: 64 resampled shape columns against 3
 * observables means the shape still supplies 95% of the total variance, and
 * the shape columns are strongly correlated with each other, so that 95% is
 * not 64 independent facts. {@link TrajectoryFeatureOptions.blockWeights}
 * exists for that reason and defaults to equalising the two blocks' total
 * weight, which is a choice and is documented as one — not a law. A caller who
 * wants raw columns can say so.
 *
 * ## Why k-means, given that it assumes something false
 *
 * k-means minimises within-cluster sum of squares, which is a spherical,
 * equal-variance model in the feature space. Trajectory clusters are not
 * spherical. It is still the right tool at this stage: the blueprint asks for
 * it, it is O(nki) and runs inside an interactive session, and after
 * standardisation the two-arc case is close to linearly separable — which is
 * exactly what the ARI criterion measures. What it cannot do is *discover* k;
 * {@link clusterTrajectories} takes k from the caller and
 * {@link KMeansResult.inertia} is what an elbow or silhouette sweep would
 * consume. Do not read a k-means partition as evidence that k populations
 * exist.
 *
 * ## Determinism
 *
 * §8.5/ADR-011 require reproducibility, and P6.22's criterion asks for stable
 * colours across reruns. Three things deliver it here: k-means++ seeding draws
 * from a seeded {@link PCG32} rather than `Math.random`; the Lloyd loop is
 * deterministic given its start; and the returned labels are **canonicalised**
 * ({@link canonicaliseLabels}) so that cluster 0 is always the one containing
 * the lowest-indexed member, regardless of which centroid the seeding happened
 * to place first. Without that last step the same partition can come back
 * under permuted labels from an equivalent run, and a colour legend flickers
 * while the mathematics is unchanged.
 */

import { PCG32 } from "@ballista/engine";
import type { Trajectory } from "@ballista/solverkit";
import { resampleOnGrid, type ResampleOptions } from "./ensemble-fan.js";

/**
 * A time grid covering only the interval on which **every** trajectory has a
 * recorded value: `[max(start_i), min(end_i)]`.
 *
 * The counterpart to `buildCommonGrid`, which spans the union. The union is
 * right for a fan chart, which thins its bands honestly past the first impact;
 * the intersection is right for a feature matrix, which has no way to express
 * "this replicate has no value here" that a distance metric would respect.
 *
 * @throws RangeError if `trajectories` is empty, `pointCount < 2`, or the
 *   supports do not overlap in a positive interval — the latter meaning the
 *   ensemble has no shared window to compare shapes on, which is a caller
 *   error rather than an empty result.
 */
export function buildCommonSupportGrid(
  trajectories: readonly Trajectory[],
  pointCount: number,
): Float64Array {
  if (trajectories.length === 0) throw new RangeError("need at least one trajectory");
  if (!Number.isInteger(pointCount) || pointCount < 2) {
    throw new RangeError(`pointCount must be an integer >= 2, got ${pointCount}`);
  }
  let start = Number.NEGATIVE_INFINITY;
  let end = Number.POSITIVE_INFINITY;
  for (const trajectory of trajectories) {
    if (trajectory.nSteps === 0) {
      throw new RangeError("a trajectory with no recorded steps has no support to intersect");
    }
    start = Math.max(start, trajectory.t[0] as number);
    end = Math.min(end, trajectory.t[trajectory.nSteps - 1] as number);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    throw new RangeError(
      `trajectory supports do not overlap in a positive interval (start ${start}, end ${end})`,
    );
  }
  const grid = new Float64Array(pointCount);
  const last = pointCount - 1;
  for (let i = 0; i < pointCount; i++) {
    // Endpoint-anchored, as buildCommonGrid is and for the same reason: the
    // final point must be exactly `end` so the shortest replicate's last
    // recorded row is hit rather than missed by an ulp and turned into NaN.
    grid[i] = i === last ? end : start + ((end - start) * i) / last;
  }
  return grid;
}

/** A scalar summary of one trajectory, contributing one feature column. */
export interface NamedObservable {
  /** Column label, surfaced in {@link TrajectoryFeatures.columnNames}. */
  readonly name: string;
  /** Must return a finite number for every trajectory in the ensemble. */
  readonly of: (trajectory: Trajectory) => number;
}

/** How the two blocks of the feature vector are weighted against each other. */
export interface BlockWeights {
  /** Multiplier applied to every resampled-shape column. */
  readonly shape: number;
  /** Multiplier applied to every observable column. */
  readonly observable: number;
}

export interface TrajectoryFeatureOptions extends ResampleOptions {
  /** Number of grid points the shape block is sampled at. Default 32. */
  readonly gridPointCount?: number;
  /**
   * Grid to sample the shape on. Defaults to
   * {@link buildCommonSupportGrid} over the ensemble at `gridPointCount`
   * points. Supplying a grid that leaves any replicate's support is an error,
   * not a source of `NaN`.
   */
  readonly grid?: Float64Array;
  /** Scalar columns appended after the shape block. Default: none. */
  readonly observables?: readonly NamedObservable[];
  /**
   * Standardise each column to zero mean and unit variance before weighting.
   * Default `true`; see the module doc for why raw columns make the
   * observables decorative. A zero-variance column is centred and left at
   * zero rather than divided by zero.
   */
  readonly standardise?: boolean;
  /**
   * Per-block multipliers applied after standardisation.
   *
   * Default equalises the two blocks: each shape column is scaled by
   * `1/sqrt(nShape)` and each observable column by `1/sqrt(nObservables)`, so
   * the shape block and the observable block contribute equal total variance
   * regardless of how many grid points were requested. **This is a modelling
   * choice, not a fact** — it says "the shape matters as much as the
   * endpoints" — and a caller who disagrees should pass explicit weights.
   * With no observables the default is a pure rescale and changes nothing
   * about the partition.
   */
  readonly blockWeights?: BlockWeights;
}

/** A row-major feature matrix, one row per trajectory. */
export interface TrajectoryFeatures {
  /** `rowCount * dimension` values, row-major. */
  readonly data: Float64Array;
  readonly rowCount: number;
  readonly dimension: number;
  /** The grid the shape block was sampled on. */
  readonly grid: Float64Array;
  /** One label per column, `y(t=...)` for shape columns then observable names. */
  readonly columnNames: readonly string[];
  /** Per-column mean removed by standardisation, or zeros if it was off. */
  readonly means: Float64Array;
  /** Per-column standard deviation divided out, or ones if it was off. */
  readonly deviations: Float64Array;
}

/**
 * Builds the feature matrix the task specifies: resampled `y(t)` on a grid
 * every replicate covers, followed by the caller's scalar observables,
 * standardised and block-weighted.
 *
 * @throws RangeError if the ensemble is empty, or if any feature comes out
 *   non-finite. The latter is deliberate and is the module's main safety
 *   property: a `NaN` here would not throw downstream, it would quietly
 *   corrupt every distance the point takes part in.
 */
export function buildTrajectoryFeatures(
  trajectories: readonly Trajectory[],
  options: TrajectoryFeatureOptions,
): TrajectoryFeatures {
  if (trajectories.length === 0) throw new RangeError("need at least one trajectory");

  const observables = options.observables ?? [];
  const grid = options.grid ?? buildCommonSupportGrid(trajectories, options.gridPointCount ?? 32);
  const shapeCount = grid.length;
  const dimension = shapeCount + observables.length;
  if (dimension === 0) {
    throw new RangeError("feature vector would be empty: no grid points and no observables");
  }

  const rowCount = trajectories.length;
  const data = new Float64Array(rowCount * dimension);
  const columnNames: string[] = [];
  for (let j = 0; j < shapeCount; j++)
    columnNames.push(`y(t=${(grid[j] as number).toPrecision(4)})`);
  for (const observable of observables) columnNames.push(observable.name);

  for (let i = 0; i < rowCount; i++) {
    const trajectory = trajectories[i] as Trajectory;
    const sampled = resampleOnGrid(trajectory, grid, options);
    const base = i * dimension;
    for (let j = 0; j < shapeCount; j++) {
      const value = sampled[j] as number;
      if (!Number.isFinite(value)) {
        // Almost always a grid outside this replicate's support. Naming the
        // replicate and the time is the difference between a five-second fix
        // and an afternoon.
        throw new RangeError(
          `trajectory ${i} has no finite value at t=${grid[j] as number}: the grid must lie ` +
            `within every replicate's support (see buildCommonSupportGrid)`,
        );
      }
      data[base + j] = value;
    }
    for (let k = 0; k < observables.length; k++) {
      const observable = observables[k] as NamedObservable;
      const value = observable.of(trajectory);
      if (!Number.isFinite(value)) {
        throw new RangeError(
          `observable "${observable.name}" returned ${value} for trajectory ${i}`,
        );
      }
      data[base + shapeCount + k] = value;
    }
  }

  const means = new Float64Array(dimension);
  const deviations = new Float64Array(dimension).fill(1);
  if (options.standardise ?? true) {
    for (let j = 0; j < dimension; j++) {
      let sum = 0;
      for (let i = 0; i < rowCount; i++) sum += data[i * dimension + j] as number;
      const mean = sum / rowCount;
      let sumSquares = 0;
      for (let i = 0; i < rowCount; i++) {
        const d = (data[i * dimension + j] as number) - mean;
        sumSquares += d * d;
      }
      // Population deviation, not sample: this is a rescaling of the data in
      // hand, not an estimate of a wider population's spread.
      const deviation = Math.sqrt(sumSquares / rowCount);
      means[j] = mean;
      // A constant column carries no information to cluster on. Centring it
      // to zero removes it from every distance; dividing by zero would put
      // NaN into all of them.
      deviations[j] = deviation > 0 ? deviation : 1;
      const scale = 1 / (deviations[j] as number);
      for (let i = 0; i < rowCount; i++) {
        data[i * dimension + j] = ((data[i * dimension + j] as number) - mean) * scale;
      }
    }
  }

  const weights =
    options.blockWeights ??
    ({
      shape: shapeCount > 0 ? 1 / Math.sqrt(shapeCount) : 1,
      observable: observables.length > 0 ? 1 / Math.sqrt(observables.length) : 1,
    } satisfies BlockWeights);
  if (weights.shape !== 1 || weights.observable !== 1) {
    for (let i = 0; i < rowCount; i++) {
      const base = i * dimension;
      for (let j = 0; j < shapeCount; j++) {
        data[base + j] = (data[base + j] as number) * weights.shape;
      }
      for (let k = 0; k < observables.length; k++) {
        data[base + shapeCount + k] = (data[base + shapeCount + k] as number) * weights.observable;
      }
    }
  }

  return { data, rowCount, dimension, grid, columnNames, means, deviations };
}

export interface KMeansOptions {
  /** Seed for k-means++ initialisation. Same seed ⇒ same partition. */
  readonly seed?: bigint;
  /** Lloyd iterations before giving up. Default 100. */
  readonly maxIterations?: number;
  /**
   * Independent k-means++ restarts; the lowest-inertia partition wins.
   * Default 10. k-means converges to a local minimum, and which one depends
   * entirely on the seeding, so a single run is a coin flip on a hard
   * ensemble. Restarts are the standard remedy and are cheap here.
   */
  readonly restarts?: number;
}

export interface KMeansResult {
  /** Cluster index per row, canonicalised — see {@link canonicaliseLabels}. */
  readonly labels: Int32Array;
  /** `k * dimension` centroid coordinates, row-major, in label order. */
  readonly centroids: Float64Array;
  /** Within-cluster sum of squared distances of the winning restart. */
  readonly inertia: number;
  /** Member count per cluster, in label order. */
  readonly sizes: Int32Array;
  /** Lloyd iterations the winning restart used. */
  readonly iterations: number;
  /** False if the winning restart hit `maxIterations` with labels still moving. */
  readonly converged: boolean;
}

function squaredDistance(
  data: Float64Array,
  rowBase: number,
  centroids: Float64Array,
  centroidBase: number,
  dimension: number,
): number {
  let sum = 0;
  for (let j = 0; j < dimension; j++) {
    const d = (data[rowBase + j] as number) - (centroids[centroidBase + j] as number);
    sum += d * d;
  }
  return sum;
}

/**
 * Relabels a partition so cluster 0 contains the lowest-indexed row, cluster 1
 * the lowest-indexed row not in cluster 0, and so on.
 *
 * k-means labels are arbitrary names for the same partition: two runs can
 * agree perfectly and still return `[0,0,1,1]` and `[1,1,0,0]`. Every metric
 * worth computing is invariant to that, but a colour legend is not (P6.22's
 * "stable colors across reruns"), and neither is a human comparing two runs.
 * Canonicalising by first appearance is the cheapest total order that does not
 * depend on the feature values, so it stays stable under a rescale.
 *
 * Returns the permutation applied, so centroids and sizes can be reordered to
 * match.
 */
export function canonicaliseLabels(labels: Int32Array, k: number): Int32Array {
  const oldToNew = new Int32Array(k).fill(-1);
  let next = 0;
  for (let i = 0; i < labels.length && next < k; i++) {
    const old = labels[i] as number;
    if ((oldToNew[old] as number) < 0) oldToNew[old] = next++;
  }
  // Clusters that ended up empty never appear in `labels`; give them the
  // remaining names so the map stays a bijection.
  for (let c = 0; c < k; c++) if ((oldToNew[c] as number) < 0) oldToNew[c] = next++;
  for (let i = 0; i < labels.length; i++) {
    labels[i] = oldToNew[labels[i] as number] as number;
  }
  return oldToNew;
}

/**
 * Lloyd's algorithm with k-means++ seeding, seeded and restarted.
 *
 * Empty clusters are re-seeded onto the point currently furthest from its own
 * centroid rather than dropped, so the result always has exactly `k`
 * centroids and a caller asking for k gets k.
 *
 * @throws RangeError if `k` is not an integer in `[1, rowCount]`, or if the
 *   feature data contains a non-finite value.
 */
export function kMeans(
  features: TrajectoryFeatures,
  k: number,
  options: KMeansOptions = {},
): KMeansResult {
  const { data, rowCount, dimension } = features;
  if (!Number.isInteger(k) || k < 1 || k > rowCount) {
    throw new RangeError(`k must be an integer in [1, ${rowCount}], got ${k}`);
  }
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i] as number)) {
      throw new RangeError(`feature matrix contains a non-finite value at index ${i}`);
    }
  }
  const maxIterations = options.maxIterations ?? 100;
  const restarts = options.restarts ?? 10;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new RangeError(`maxIterations must be a positive integer, got ${maxIterations}`);
  }
  if (!Number.isInteger(restarts) || restarts < 1) {
    throw new RangeError(`restarts must be a positive integer, got ${restarts}`);
  }

  const rng = new PCG32(options.seed ?? 0n);
  let best: KMeansResult | null = null;

  for (let restart = 0; restart < restarts; restart++) {
    const centroids = kMeansPlusPlusSeed(data, rowCount, dimension, k, rng);
    const labels = new Int32Array(rowCount).fill(-1);
    const sizes = new Int32Array(k);
    let iterations = 0;
    let converged = false;

    for (; iterations < maxIterations; iterations++) {
      let moved = false;
      sizes.fill(0);
      for (let i = 0; i < rowCount; i++) {
        const rowBase = i * dimension;
        let bestCluster = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let c = 0; c < k; c++) {
          const d = squaredDistance(data, rowBase, centroids, c * dimension, dimension);
          if (d < bestDistance) {
            bestDistance = d;
            bestCluster = c;
          }
        }
        if ((labels[i] as number) !== bestCluster) {
          labels[i] = bestCluster;
          moved = true;
        }
        sizes[bestCluster] = (sizes[bestCluster] as number) + 1;
      }
      if (!moved) {
        converged = true;
        break;
      }
      recomputeCentroids(data, labels, sizes, centroids, rowCount, dimension, k);
    }

    const inertia = totalInertia(data, labels, centroids, rowCount, dimension);
    if (best === null || inertia < best.inertia) {
      const canonicalLabels = Int32Array.from(labels);
      const permutation = canonicaliseLabels(canonicalLabels, k);
      const orderedCentroids = new Float64Array(k * dimension);
      const orderedSizes = new Int32Array(k);
      for (let c = 0; c < k; c++) {
        const target = permutation[c] as number;
        orderedSizes[target] = sizes[c] as number;
        for (let j = 0; j < dimension; j++) {
          orderedCentroids[target * dimension + j] = centroids[c * dimension + j] as number;
        }
      }
      best = {
        labels: canonicalLabels,
        centroids: orderedCentroids,
        inertia,
        sizes: orderedSizes,
        iterations,
        converged,
      };
    }
  }

  return best as KMeansResult;
}

/**
 * k-means++ (Arthur & Vassilvitskii 2007): first centre uniform, each
 * subsequent centre drawn with probability proportional to its squared
 * distance from the nearest chosen centre. Cheap, and it is what gives the
 * O(log k) approximation guarantee that uniform seeding lacks.
 */
function kMeansPlusPlusSeed(
  data: Float64Array,
  rowCount: number,
  dimension: number,
  k: number,
  rng: PCG32,
): Float64Array {
  const centroids = new Float64Array(k * dimension);
  const first = Math.min(rowCount - 1, Math.floor(rng.nextF64() * rowCount));
  for (let j = 0; j < dimension; j++) centroids[j] = data[first * dimension + j] as number;

  const nearest = new Float64Array(rowCount).fill(Number.POSITIVE_INFINITY);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < rowCount; i++) {
      const d = squaredDistance(data, i * dimension, centroids, (c - 1) * dimension, dimension);
      if (d < (nearest[i] as number)) nearest[i] = d;
      total += nearest[i] as number;
    }
    let chosen: number;
    if (!(total > 0)) {
      // Every remaining point coincides with a chosen centre — a duplicated
      // ensemble. Any index is as good as any other; take a uniform one so the
      // draw stays seeded rather than falling into a fixed corner.
      chosen = Math.min(rowCount - 1, Math.floor(rng.nextF64() * rowCount));
    } else {
      let target = rng.nextF64() * total;
      chosen = rowCount - 1;
      for (let i = 0; i < rowCount; i++) {
        target -= nearest[i] as number;
        if (target <= 0) {
          chosen = i;
          break;
        }
      }
    }
    for (let j = 0; j < dimension; j++) {
      centroids[c * dimension + j] = data[chosen * dimension + j] as number;
    }
  }
  return centroids;
}

function recomputeCentroids(
  data: Float64Array,
  labels: Int32Array,
  sizes: Int32Array,
  centroids: Float64Array,
  rowCount: number,
  dimension: number,
  k: number,
): void {
  centroids.fill(0);
  for (let i = 0; i < rowCount; i++) {
    const base = (labels[i] as number) * dimension;
    const rowBase = i * dimension;
    for (let j = 0; j < dimension; j++) {
      centroids[base + j] = (centroids[base + j] as number) + (data[rowBase + j] as number);
    }
  }
  for (let c = 0; c < k; c++) {
    const size = sizes[c] as number;
    if (size > 0) {
      const scale = 1 / size;
      for (let j = 0; j < dimension; j++) {
        centroids[c * dimension + j] = (centroids[c * dimension + j] as number) * scale;
      }
    }
  }
  // Empty clusters: re-seed onto the worst-fitting point. Leaving a centroid
  // at the origin instead would make it a magnet for whatever is nearest the
  // origin next round, which in standardised coordinates is the most *typical*
  // point — the opposite of what an unused cluster should claim.
  for (let c = 0; c < k; c++) {
    if ((sizes[c] as number) > 0) continue;
    let worstRow = 0;
    let worstDistance = -1;
    for (let i = 0; i < rowCount; i++) {
      const own = (labels[i] as number) * dimension;
      const d = squaredDistance(data, i * dimension, centroids, own, dimension);
      if (d > worstDistance) {
        worstDistance = d;
        worstRow = i;
      }
    }
    for (let j = 0; j < dimension; j++) {
      centroids[c * dimension + j] = data[worstRow * dimension + j] as number;
    }
  }
}

function totalInertia(
  data: Float64Array,
  labels: Int32Array,
  centroids: Float64Array,
  rowCount: number,
  dimension: number,
): number {
  let sum = 0;
  for (let i = 0; i < rowCount; i++) {
    sum += squaredDistance(
      data,
      i * dimension,
      centroids,
      (labels[i] as number) * dimension,
      dimension,
    );
  }
  return sum;
}

/**
 * Adjusted Rand index between two partitions of the same n items.
 *
 * The Rand index counts agreeing pairs, which sounds like an accuracy and is
 * not: two random partitions of the same sizes already agree on most pairs, so
 * an unadjusted Rand index of 0.7 can mean nothing at all. The ARI subtracts
 * the expected agreement under a hypergeometric null and normalises by the
 * maximum, giving **0 for chance agreement and 1 for identity**; it can go
 * negative for partitions that agree less than chance. It is invariant to
 * relabelling, which is why it — and not an accuracy — is what P6.21's
 * criterion is stated in.
 *
 * @throws RangeError if the partitions differ in length or are empty.
 */
export function adjustedRandIndex(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new RangeError(`partitions must be the same length, got ${a.length} and ${b.length}`);
  }
  const n = a.length;
  if (n === 0) throw new RangeError("cannot compare empty partitions");

  const contingency = new Map<string, number>();
  const rowTotals = new Map<number, number>();
  const columnTotals = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    const key = `${ai} ${bi}`;
    contingency.set(key, (contingency.get(key) ?? 0) + 1);
    rowTotals.set(ai, (rowTotals.get(ai) ?? 0) + 1);
    columnTotals.set(bi, (columnTotals.get(bi) ?? 0) + 1);
  }

  const choose2 = (x: number): number => (x * (x - 1)) / 2;
  let sumCells = 0;
  for (const count of contingency.values()) sumCells += choose2(count);
  let sumRows = 0;
  for (const count of rowTotals.values()) sumRows += choose2(count);
  let sumColumns = 0;
  for (const count of columnTotals.values()) sumColumns += choose2(count);

  const totalPairs = choose2(n);
  const expected = (sumRows * sumColumns) / totalPairs;
  const maximum = (sumRows + sumColumns) / 2;
  if (maximum === expected) {
    // Both partitions put everything in one cluster (or each item in its own).
    // Agreement is total and the normaliser vanishes; 1 is the conventional
    // and correct answer, and it is what scikit-learn returns.
    return 1;
  }
  return (sumCells - expected) / (maximum - expected);
}

/** A clustering of an ensemble, plus the features it was computed from. */
export interface TrajectoryClustering extends KMeansResult {
  readonly features: TrajectoryFeatures;
}

/**
 * Convenience wrapper: build the feature matrix, then cluster it.
 *
 * Separate from {@link buildTrajectoryFeatures} and {@link kMeans} rather
 * than replacing them, because a caller sweeping k wants to build features
 * once and cluster many times.
 */
export function clusterTrajectories(
  trajectories: readonly Trajectory[],
  k: number,
  options: TrajectoryFeatureOptions & KMeansOptions,
): TrajectoryClustering {
  const features = buildTrajectoryFeatures(trajectories, options);
  return { ...kMeans(features, k, options), features };
}
