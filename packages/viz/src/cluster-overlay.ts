/**
 * Cluster overlay for a clustered trajectory ensemble (P6.22, §6 phase-6
 * table: "Cluster visualization: per-cluster median trajectory + membership
 * coloring", validation "legend/count per cluster; stable colors across
 * reruns (seeded)").
 *
 * P6.21 partitions an ensemble; this turns that partition into the three
 * things a chart needs to show it: a colour per replicate, a legend row per
 * cluster carrying its count, and one representative curve per cluster.
 *
 * **Nothing here draws.** Every function returns plain arrays and typed
 * arrays -- the same split `impact-scatter.ts` used for P6.09 and
 * `ensemble-fan.ts` states for P6.10. P6.24's dashboard route renders them.
 *
 * ## Why this module lives in `@ballista/viz` and not next to P6.21
 *
 * Colour is the reason. The palette below comes from `@ballista/runtime`, and
 * `@ballista/runtime` already depends on `@ballista/analysis`, so putting a
 * palette-aware module in `analysis` would close a dependency cycle. The
 * split is the honest one anyway: the partition is analysis, its appearance
 * is presentation.
 *
 * ## "Stable colors across reruns" is inherited, not created here
 *
 * The criterion's second half is satisfied one layer down, and it is worth
 * being precise about where, because this module could not fix it if it were
 * broken. k-means labels are arbitrary names for the same partition: two runs
 * can agree perfectly on which replicates group together and still return
 * `[0,0,1,1]` and `[1,1,0,0]`. Colouring by label would then flicker between
 * reruns that had in fact found the identical answer.
 *
 * `kMeans` already returns labels canonicalised by first appearance
 * (`canonicaliseLabels`), which is a total order independent of the feature
 * values. So a fixed label-to-slot mapping -- which is all
 * {@link clusterColor} is -- is stable for the same seed, and this module
 * adds a test that says so by running the clustering twice.
 *
 * The corollary is a caveat a caller can trip over: hand these functions raw
 * labels from somewhere that has *not* canonicalised them and colours will
 * move even though nothing about the partition did. `cluster-overlay.test.ts`
 * asserts that failure mode directly rather than leaving it as a comment.
 *
 * ## The palette is categorical and it runs out
 *
 * {@link CLUSTER_PALETTE} is Okabe & Ito's (2008) "Color Universal Design"
 * eight-colour set, reused verbatim from `@ballista/runtime`'s
 * `COMPARE_PALETTE` rather than redefined -- one palette, already covered by
 * the colourblind-safety check, and no second definition for
 * `colormap-enforcement.test.ts` to find. It is a categorical palette, not a
 * colormap: cluster indices are names, not magnitudes, so §6.1's viridis-only
 * rule does not apply to them (viridis is the *scalar*-to-colour mapping).
 *
 * Asking for more clusters than the palette holds **throws** rather than
 * cycling. That follows `compare-store.ts`, which refuses a ninth pin for the
 * same reason: a cycled hue makes two distinct clusters look like one, and a
 * legend that says otherwise is worse than no legend. Nine clusters of
 * trajectories is also well past the point where a colour-coded overlay
 * communicates anything, so the limit is a real one, not an implementation
 * shortcut.
 *
 * ## An empty cluster keeps its row
 *
 * k-means can return a cluster with no members. The temptation is to drop it,
 * and dropping it is wrong twice over: it renumbers everything after it, so
 * cluster 3's colour silently becomes cluster 2's, and it hides the fact that
 * the caller asked for a `k` the data does not support. Empty clusters keep
 * their legend row with `size: 0`, and their median is an all-`NaN` series
 * with `sampleCount` zero throughout -- a curve a renderer draws as nothing,
 * which is the truthful picture.
 *
 * ## Each cluster's median stops where that cluster stops
 *
 * {@link buildClusterMedians} reports {@link ClusterMedian.commonSupportEnd}
 * and {@link ClusterMedian.sampleCount} per cluster, not once for the
 * ensemble, and for clustered data that distinction is the whole point rather
 * than pedantry. The fixture P6.21's criterion is stated against launches two
 * modes at complementary angles, whose times of flight differ by a factor of
 * `sin 60° / sin 30° = 1.73`. Past the short mode's impact its median is
 * `NaN` while the long mode's is still a real curve, and past the *short*
 * mode's first impact its median is conditional on survival exactly as a fan
 * band is. A chart drawing both medians on one grid without knowing where
 * each one stops draws a line through empty air.
 */

import {
  buildEnsembleFan,
  type ResampleOptions,
  type TrajectoryClustering,
} from "@ballista/analysis";
import { COMPARE_PALETTE } from "@ballista/runtime";
import type { Trajectory } from "@ballista/solverkit";

/**
 * The categorical palette cluster colours are drawn from, in slot order.
 *
 * Aliased from `@ballista/runtime`'s `COMPARE_PALETTE` rather than copied:
 * the Okabe-Ito set is already the platform's one categorical palette and is
 * already covered by `runtime/colorblind-safety.test.ts`. A second copy here
 * would be a second thing to keep colourblind-safe.
 */
export const CLUSTER_PALETTE: readonly string[] = COMPARE_PALETTE;

/** The largest `k` this module will colour. See the module note on cycling. */
export const MAX_CLUSTERS = CLUSTER_PALETTE.length;

/**
 * The colour for cluster `cluster` of a `k`-cluster partition.
 *
 * Depends only on the label, so it is stable across reruns for as long as the
 * labels are (see the module note).
 *
 * @throws RangeError if `k` exceeds {@link MAX_CLUSTERS}, or if `cluster` is
 *   not an integer in `[0, k)`.
 */
export function clusterColor(cluster: number, k: number): string {
  assertClusterCount(k);
  if (!Number.isInteger(cluster) || cluster < 0 || cluster >= k) {
    throw new RangeError(`cluster must be an integer in [0, ${k}), got ${cluster}`);
  }
  return CLUSTER_PALETTE[cluster] as string;
}

/** One legend row: what to draw as the swatch, what to write beside it. */
export interface ClusterLegendEntry {
  /** Canonical cluster index, equal to this entry's position in the array. */
  readonly cluster: number;
  /** Human-facing name. Defaults to one-based, because legends are read by people. */
  readonly label: string;
  /** Swatch colour, from {@link clusterColor}. */
  readonly color: string;
  /** Members. Zero for an empty cluster, whose row is kept -- see the module note. */
  readonly size: number;
  /** `size / total`, in `[0, 1]`. Exactly `0` for an empty cluster. */
  readonly fraction: number;
}

/** Options for {@link buildClusterLegend}. */
export interface ClusterLegendOptions {
  /**
   * Names a cluster. Receives the zero-based canonical index; the default is
   * `Cluster ${cluster + 1}`.
   *
   * Offered because the useful name is usually domain-specific ("steep arc",
   * "flat arc") and this module has no way to know it -- a cluster index
   * carries no meaning of its own, which is the same reason
   * `canonicaliseLabels` picks an arbitrary but *fixed* order.
   */
  readonly labelFor?: (cluster: number) => string;
}

/**
 * Builds one legend row per cluster, in canonical label order.
 *
 * Reads `sizes` only, so it can be called on a `KMeansResult` without the
 * features attached.
 *
 * @throws RangeError if there are no clusters, if `k` exceeds
 *   {@link MAX_CLUSTERS}, or if every cluster is empty (an ensemble of no
 *   replicates, for which a legend would be a table of zeroes).
 */
export function buildClusterLegend(
  clustering: Pick<TrajectoryClustering, "sizes">,
  options: ClusterLegendOptions = {},
): readonly ClusterLegendEntry[] {
  const sizes = clustering.sizes;
  const k = sizes.length;
  assertClusterCount(k);

  let total = 0;
  for (let c = 0; c < k; c++) total += sizes[c] as number;
  if (total === 0) throw new RangeError("clustering has no members; nothing to put in a legend");

  const labelFor = options.labelFor ?? ((cluster: number) => `Cluster ${cluster + 1}`);
  const entries: ClusterLegendEntry[] = [];
  for (let c = 0; c < k; c++) {
    const size = sizes[c] as number;
    entries.push(
      Object.freeze({
        cluster: c,
        label: labelFor(c),
        color: clusterColor(c, k),
        size,
        fraction: size / total,
      }),
    );
  }
  return Object.freeze(entries);
}

/**
 * The colour for each replicate, parallel to `labels`.
 *
 * This is the "membership coloring" half of the task: a renderer drawing the
 * raw ensemble reads replicate `i`'s colour straight out of position `i`.
 *
 * @throws RangeError if `k` exceeds {@link MAX_CLUSTERS} or a label is not an
 *   integer in `[0, k)`. A label out of range is not clamped -- it means the
 *   caller paired a labelling with the wrong `k`, and quietly colouring it
 *   would hide that.
 */
export function buildMembershipColors(labels: ArrayLike<number>, k: number): readonly string[] {
  assertClusterCount(k);
  const colors: string[] = new Array<string>(labels.length);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] as number;
    if (!Number.isInteger(label) || label < 0 || label >= k) {
      throw new RangeError(`labels[${i}] must be an integer in [0, ${k}), got ${label}`);
    }
    colors[i] = CLUSTER_PALETTE[label] as string;
  }
  return Object.freeze(colors);
}

/** One cluster's representative curve, on the shared grid. */
export interface ClusterMedian {
  /** Canonical cluster index, equal to this entry's position in the array. */
  readonly cluster: number;
  /** Line colour, matching this cluster's legend swatch. */
  readonly color: string;
  /** Members contributing to this curve. */
  readonly size: number;
  /** The grid, shared by every cluster so the curves are directly comparable. */
  readonly grid: Float64Array;
  /**
   * The pointwise median over this cluster's members, `NaN` where none of
   * them is in flight. All `NaN` for an empty cluster.
   */
  readonly median: Float64Array;
  /** How many of this cluster's members contributed at each grid point. */
  readonly sampleCount: Int32Array;
  /**
   * The last grid time at which **every** member of this cluster still
   * contributed, or `NaN` if none does. Past it the median is conditional on
   * survival -- see the module note on why this is per cluster.
   */
  readonly commonSupportEnd: number;
}

/**
 * Builds one median curve per cluster, in canonical label order.
 *
 * The median is computed by {@link buildEnsembleFan} at a single level of
 * 0.5, rather than by a median routine written here. That is deliberate: it
 * reuses the tested quantile-of-sorted path, the tested dense-output
 * resampling, and -- most importantly -- the tested `NaN` handling, which is
 * the part a fresh implementation would get subtly wrong.
 *
 * @throws RangeError if `labels` and `trajectories` disagree in length, if
 *   `k` exceeds {@link MAX_CLUSTERS}, or for anything `buildEnsembleFan`
 *   rejects (a non-ascending grid, a bad channel index).
 */
export function buildClusterMedians(
  trajectories: readonly Trajectory[],
  clustering: Pick<TrajectoryClustering, "labels" | "sizes">,
  grid: ArrayLike<number>,
  options: ResampleOptions,
): readonly ClusterMedian[] {
  const { labels, sizes } = clustering;
  const k = sizes.length;
  assertClusterCount(k);
  if (labels.length !== trajectories.length) {
    throw new RangeError(
      `labels has ${labels.length} entries but ${trajectories.length} trajectories were supplied`,
    );
  }

  const members: Trajectory[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] as number;
    if (!Number.isInteger(label) || label < 0 || label >= k) {
      throw new RangeError(`labels[${i}] must be an integer in [0, ${k}), got ${label}`);
    }
    (members[label] as Trajectory[]).push(trajectories[i] as Trajectory);
  }

  const gridCopy = Float64Array.from(grid as ArrayLike<number>);
  const medians: ClusterMedian[] = [];
  for (let c = 0; c < k; c++) {
    const group = members[c] as Trajectory[];
    const color = clusterColor(c, k);

    if (group.length === 0) {
      // buildEnsembleFan rejects an empty ensemble, and rightly so. An empty
      // cluster still gets its row: see the module note on why dropping it
      // would renumber every colour after it.
      medians.push(
        Object.freeze({
          cluster: c,
          color,
          size: 0,
          grid: gridCopy,
          median: new Float64Array(gridCopy.length).fill(Number.NaN),
          sampleCount: new Int32Array(gridCopy.length),
          commonSupportEnd: Number.NaN,
        }),
      );
      continue;
    }

    const fan = buildEnsembleFan(group, gridCopy, { ...options, levels: [0.5] });
    medians.push(
      Object.freeze({
        cluster: c,
        color,
        size: group.length,
        grid: fan.grid,
        median: fan.bands[0] as Float64Array,
        sampleCount: fan.sampleCount,
        commonSupportEnd: fan.commonSupportEnd,
      }),
    );
  }
  return Object.freeze(medians);
}

function assertClusterCount(k: number): void {
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`need at least one cluster, got ${k}`);
  }
  if (k > MAX_CLUSTERS) {
    throw new RangeError(
      `cannot colour ${k} clusters: the categorical palette holds ${MAX_CLUSTERS} and cycling it ` +
        `would make two clusters indistinguishable in the overlay and its legend`,
    );
  }
}
