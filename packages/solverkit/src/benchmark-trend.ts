/**
 * P7.31's benchmark trend: a series of recorded micro-benchmark runs, the
 * chart over it, and the rule that decides when one of them is an alert.
 *
 * Everything here is pure. No benchmark is run, no file is read and no clock
 * is consulted — `scripts/plot-benchmark-trend.mjs` does the I/O and this
 * module decides what the numbers mean, the same separation
 * `wgsl-workgroup-sweep.ts` makes and for the same reason.
 *
 * ## Why this exists when `scripts/check-benchmark-regression.mjs` already does
 *
 * That script (P2.43) compares today's run against **one** recorded snapshot.
 * That is a difference, not a trend, and it cannot tell a real regression from
 * a noisy run — it has nothing to compare the noise against. Everything below
 * is about the two facts that makes it get wrong.
 *
 * ## Fact one: the metric is noisier than the gate that watches it
 *
 * `benchmark-baseline.json` gates `relativeToEuler`, each method's steps/sec
 * over explicit-euler's on the same run, at 15%. Measured on this project's
 * container, 2026-09-19, seven consecutive runs of that very script minutes
 * apart with no code change between them: `dopri5` spans 0.1838 to 0.2537 and
 * `bogacki-shampine-32` spans 0.3294 to 0.4388 — **spreads of 34.8% and 29.9%
 * of their own medians.** A 15% threshold against a single point is therefore
 * below the metric's own noise floor.
 *
 * So the reference here is the **median of the preceding samples**, not the
 * previous one and not a fixed snapshot: a median is unmoved by one bad run,
 * which is the whole reason for keeping a series rather than a number.
 *
 * ## Fact one, continued: a median helps, and it is not enough on its own
 *
 * The number that matters for a threshold is not the metric's spread — it is
 * **how far this rule's own statistic can fall on noise alone**. Measured over
 * those same seven runs, taking every subset of the given size as the
 * reference median and every remaining point as the latest:
 *
 * | reference samples | worst downward excursion on pure noise |
 * |---|---|
 * | 2 | −26.8% |
 * | 3 | −26.0% |
 * | 4 | −21.7% |
 * | 5 | −16.8% |
 * | 6 | −12.9% |
 *
 * `dopri5` is the worst case at every size; the trend is monotone, which is
 * the median doing its job. **This is why both knobs exist and why neither can
 * be chosen without the other**: a 20% threshold is a false-alarm generator at
 * three reference samples and comfortable at six. See
 * {@link DEFAULT_TREND_THRESHOLDS} for what was picked and why.
 *
 * The rows are an under-estimate of the true tail and are read that way. With
 * seven points there are 21 subsets of size 2 and only 7 of size 6, so the
 * larger-reference rows have barely sampled their own distribution. The
 * thresholds below are therefore set against the **worst row**, not the row
 * matching their own `minSamples`.
 *
 * ## Fact two: the ratio is not as hardware-invariant as it was thought to be
 *
 * `benchmark-baseline.json`'s provenance says the ratio is "largely
 * hardware-invariant, since it mostly reflects rhs-evaluations-per-step".
 * Measured against that same baseline on this container, `classical-rk4` reads
 * **0.45–0.48 against a recorded 0.2484** and `dopri5` **0.18–0.25 against
 * 0.1364**: every ratio is compressed toward 1. That is what happens when
 * per-step overhead, rather than rhs evaluation, is the larger share of a step
 * — the rhs-count argument holds only where rhs evaluation dominates on both
 * machines, and it does not here.
 *
 * The consequence for a trend is structural, not cosmetic: **points recorded
 * on different machines are not points on one curve.** So every sample carries
 * a `machineId`, comparisons are made only within one, and
 * {@link renderBenchmarkTrendSvg} breaks its polylines at each boundary rather
 * than drawing a line across a discontinuity it knows about.
 *
 * ## What is deliberately not here
 *
 * Absolute steps/sec is carried in the history for context and is never
 * charted or alerted on. It is a property of the machine in a way the ratio at
 * least tries not to be, and a trend line over it would be a trend line over
 * which container the run landed in.
 */

/** One recorded run: the ratios, plus what makes them comparable. */
export interface BenchmarkTrendSample {
  /** ISO date, `YYYY-MM-DD`. Labels the point; ordering comes from array position. */
  readonly recordedAt: string;
  /**
   * Fingerprint of the machine the run was measured on.
   *
   * Two samples are comparable when and only when these are equal. It is a
   * free-form string rather than an enum because what matters is that it
   * changes when the hardware does, not that this module can interpret it.
   */
  readonly machineId: string;
  /** `relativeToEuler` per method id. The charted and alerted quantity. */
  readonly ratios: Readonly<Record<string, number>>;
  /** Absolute steps/sec per method id. Context only — never charted, never alerted. */
  readonly stepsPerSec?: Readonly<Record<string, number>>;
  /** Free-form note about the run, e.g. what changed. */
  readonly note?: string;
}

/** The two numbers that decide when a point is an alert. */
export interface BenchmarkTrendThresholds {
  /**
   * Alert when the latest ratio is at least this far **below** the reference
   * median, as a percentage of that median. Set above the measured
   * same-machine spread, not below it; see this file's header.
   */
  readonly regressionPct: number;
  /**
   * Fewest preceding same-machine samples that can produce a reference.
   *
   * Below this the verdict is `insufficient-history` and **nothing alerts**.
   * A median of one point is that point, so alerting there is the
   * single-snapshot comparison this module exists to replace, wearing a
   * different name.
   */
  readonly minSamples: number;
}

/** A history file's contents. */
export interface BenchmarkTrendHistory {
  readonly schemaVersion: number;
  readonly metric: string;
  readonly alert: BenchmarkTrendThresholds;
  /** Oldest first. */
  readonly samples: readonly BenchmarkTrendSample[];
}

/**
 * What the trend says about one method.
 *
 * - `ok` — a reference existed and the latest point is not below it by more
 *   than the threshold. Includes improvements.
 * - `regressed` — a reference existed and the latest point is below it by more
 *   than the threshold. The only kind that alerts.
 * - `insufficient-history` — fewer than `minSamples` preceding samples on this
 *   machine. Not an alert and not an all-clear; there is nothing to say yet.
 * - `new-method` — present in the latest sample and in no preceding one on
 *   this machine. Not an alert: a method's first appearance is not a change.
 */
export type BenchmarkTrendVerdict = "ok" | "regressed" | "insufficient-history" | "new-method";

/** One method's row in the summary. */
export interface BenchmarkMethodTrend {
  readonly id: string;
  readonly verdict: BenchmarkTrendVerdict;
  readonly latest: number;
  /** Median of the preceding same-machine samples, or `null` when there is none. */
  readonly reference: number | null;
  /** How many preceding same-machine samples carried this method. */
  readonly referenceSamples: number;
  /** Signed change from the reference, positive for faster. `null` without a reference. */
  readonly changePct: number | null;
}

/** The whole verdict over a history. */
export interface BenchmarkTrendSummary {
  /** The machine the latest sample was recorded on; comparisons are within it. */
  readonly machineId: string;
  /** Samples on that machine, including the latest. */
  readonly machineSamples: number;
  readonly thresholds: BenchmarkTrendThresholds;
  /** One row per method in the latest sample, sorted by id. */
  readonly methods: readonly BenchmarkMethodTrend[];
  /** The subset of `methods` whose verdict is `regressed`. */
  readonly alerts: readonly BenchmarkMethodTrend[];
}

/**
 * Median of a non-empty list, by the usual average-the-middle-two convention.
 *
 * Exported because the threshold discussion above is about this choice: a mean
 * over seven runs whose spread is 30% is moved by any one of them.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The runs of consecutive samples that share a `machineId`, oldest first.
 *
 * A *run* rather than a grouping: samples that return to an earlier machine
 * after an excursion start a new segment. That is deliberate — the chart draws
 * one polyline per segment, and re-joining a machine's points across a gap
 * would draw exactly the line across a discontinuity this module refuses to
 * draw across a boundary.
 */
export function machineSegments(
  samples: readonly BenchmarkTrendSample[],
): readonly (readonly BenchmarkTrendSample[])[] {
  const segments: BenchmarkTrendSample[][] = [];
  for (const sample of samples) {
    const last = segments[segments.length - 1];
    if (last && last[0]!.machineId === sample.machineId) last.push(sample);
    else segments.push([sample]);
  }
  return segments;
}

/**
 * Grade the newest sample against the ones before it on the same machine.
 *
 * Throws on an empty history rather than returning an empty summary: "no
 * samples" is a broken history file, and the all-clear is the one answer a
 * benchmark check must never produce by accident.
 */
export function summariseBenchmarkTrend(
  history: BenchmarkTrendHistory,
  thresholds: BenchmarkTrendThresholds = history.alert,
): BenchmarkTrendSummary {
  const samples = history.samples;
  if (samples.length === 0) throw new RangeError("cannot summarise an empty benchmark history");

  const latest = samples[samples.length - 1]!;
  const priorOnMachine = samples
    .slice(0, -1)
    .filter((sample) => sample.machineId === latest.machineId);

  const methods = Object.keys(latest.ratios)
    .sort()
    .map((id): BenchmarkMethodTrend => {
      const latestRatio = latest.ratios[id]!;
      const priorRatios = priorOnMachine
        .map((sample) => sample.ratios[id])
        .filter((ratio): ratio is number => typeof ratio === "number");

      if (priorRatios.length === 0) {
        const verdict: BenchmarkTrendVerdict =
          priorOnMachine.length === 0 ? "insufficient-history" : "new-method";
        return {
          id,
          verdict,
          latest: latestRatio,
          reference: null,
          referenceSamples: 0,
          changePct: null,
        };
      }

      const reference = median(priorRatios);
      const changePct = ((latestRatio - reference) / reference) * 100;
      const enoughHistory = priorRatios.length >= thresholds.minSamples;
      const verdict: BenchmarkTrendVerdict = !enoughHistory
        ? "insufficient-history"
        : changePct < -thresholds.regressionPct
          ? "regressed"
          : "ok";
      return {
        id,
        verdict,
        latest: latestRatio,
        reference,
        referenceSamples: priorRatios.length,
        changePct,
      };
    });

  return {
    machineId: latest.machineId,
    machineSamples: priorOnMachine.length + 1,
    thresholds,
    methods,
    alerts: methods.filter((method) => method.verdict === "regressed"),
  };
}

/**
 * The shipped thresholds. Both numbers come out of the table in this file's
 * header, and the table is a measurement rather than a declaration — which is
 * the distinction P0.131 is filed about.
 *
 * `minSamples` is **5**: the worst noise excursion falls monotonically with
 * reference size, and five is where it drops clearly below the threshold
 * (−16.8%) while still being reachable by a series a human actually records.
 *
 * `regressionPct` is **30**: above the worst excursion observed at *any*
 * reference size (−26.8%, at two), not merely above the −16.8% at five. Set
 * that way on purpose — the large-reference rows are estimated from very few
 * subsets, so trusting them would be reading precision out of the part of the
 * table with the least data behind it.
 *
 * **30% is coarse, and saying so is part of the result.** A gate this wide
 * catches only gross regressions. It is wide because the metric is noisy, not
 * because a wide gate is desirable, and the way to narrow it is to make the
 * measurement quieter (longer runs, more trials, a pinned CPU) rather than to
 * type a smaller number here. Until then a 15%-looking threshold would be
 * precision this data does not support.
 *
 * Both are overridable per call, so a history recorded somewhere quieter is not
 * stuck with this container's noise floor.
 */
export const DEFAULT_TREND_THRESHOLDS: BenchmarkTrendThresholds = {
  regressionPct: 30,
  minSamples: 5,
};

/** Layout constants for {@link renderBenchmarkTrendSvg}. */
const CHART = {
  width: 900,
  height: 460,
  padLeft: 64,
  padRight: 190,
  padTop: 40,
  padBottom: 56,
} as const;

/**
 * Distinct hues for up to nine series, which is how many steppers the
 * micro-benchmark registers. A tenth wraps rather than throwing: a chart that
 * refuses to render because a method was added is worse than one with a
 * repeated colour.
 */
const SERIES_COLOURS: readonly string[] = [
  "#1f77b4",
  "#d62728",
  "#2ca02c",
  "#9467bd",
  "#ff7f0e",
  "#8c564b",
  "#17becf",
  "#e377c2",
  "#7f7f7f",
];

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render the history as a stand-alone SVG line chart: P7.31's "historical
 * chart artifact".
 *
 * Written by hand rather than with a chart library, as
 * `scripts/plot-stiff-step-size-trace.mjs` is, and for the same reason — a
 * charting dependency for one committed artifact is not worth its weight, and
 * this repo's scope rules treat a new runtime dependency as its own decision.
 *
 * Two things about the rendering are claims rather than styling:
 *
 * 1. **Polylines break at a machine boundary.** One `<polyline>` per method
 *    per {@link machineSegments} segment, never one across the whole series.
 *    A connected line asserts that consecutive points are comparable, and
 *    across a machine change they are not (see this file's header). The
 *    boundary is drawn as a dashed rule so the break is legible as a fact
 *    about the data rather than a gap in it.
 * 2. **The y axis is fixed to [0, 1].** `relativeToEuler` is bounded above by
 *    1 in practice — explicit-euler is the cheapest step registered — and an
 *    auto-scaled axis would make a 2% wobble fill the plot and look like a
 *    cliff. The chart's job is to make a real move visible, not every move.
 */
export function renderBenchmarkTrendSvg(history: BenchmarkTrendHistory): string {
  const samples = history.samples;
  if (samples.length === 0) throw new RangeError("cannot chart an empty benchmark history");

  const methodIds = [...new Set(samples.flatMap((sample) => Object.keys(sample.ratios)))].sort();
  const plotWidth = CHART.width - CHART.padLeft - CHART.padRight;
  const plotHeight = CHART.height - CHART.padTop - CHART.padBottom;
  const x = (index: number): number =>
    samples.length === 1
      ? CHART.padLeft + plotWidth / 2
      : CHART.padLeft + (index / (samples.length - 1)) * plotWidth;
  const y = (ratio: number): number =>
    CHART.padTop + (1 - Math.min(Math.max(ratio, 0), 1)) * plotHeight;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART.width}" height="${CHART.height}" viewBox="0 0 ${CHART.width} ${CHART.height}" font-family="system-ui, sans-serif" font-size="11">`,
    `<rect width="${CHART.width}" height="${CHART.height}" fill="#ffffff"/>`,
    `<text x="${CHART.padLeft}" y="22" font-size="14" font-weight="600">${escapeXml(history.metric)}</text>`,
  );

  for (let tick = 0; tick <= 10; tick += 2) {
    const ratio = tick / 10;
    const yy = y(ratio).toFixed(1);
    parts.push(
      `<line x1="${CHART.padLeft}" y1="${yy}" x2="${CHART.padLeft + plotWidth}" y2="${yy}" stroke="#e6e6e6"/>`,
      `<text x="${CHART.padLeft - 8}" y="${(Number(yy) + 4).toFixed(1)}" text-anchor="end" fill="#555">${ratio.toFixed(1)}</text>`,
    );
  }

  samples.forEach((sample, index) => {
    parts.push(
      `<text x="${x(index).toFixed(1)}" y="${CHART.padTop + plotHeight + 18}" text-anchor="middle" fill="#555">${escapeXml(sample.recordedAt)}</text>`,
    );
  });

  // Machine boundaries: a dashed rule between the last point of one segment
  // and the first of the next, so the polyline break reads as deliberate.
  let boundaryIndex = 0;
  const segments = machineSegments(samples);
  for (let s = 0; s < segments.length - 1; s++) {
    boundaryIndex += segments[s]!.length;
    const bx = ((x(boundaryIndex - 1) + x(boundaryIndex)) / 2).toFixed(1);
    parts.push(
      `<line x1="${bx}" y1="${CHART.padTop}" x2="${bx}" y2="${CHART.padTop + plotHeight}" stroke="#999" stroke-dasharray="4 3"/>`,
      `<text x="${bx}" y="${CHART.padTop - 6}" text-anchor="middle" fill="#777">machine change</text>`,
    );
  }

  methodIds.forEach((id, methodIndex) => {
    const colour = SERIES_COLOURS[methodIndex % SERIES_COLOURS.length]!;
    let offset = 0;
    for (const segment of segments) {
      const points = segment
        .map((sample, i) => ({ ratio: sample.ratios[id], index: offset + i }))
        .filter(
          (point): point is { ratio: number; index: number } => typeof point.ratio === "number",
        )
        .map((point) => `${x(point.index).toFixed(1)},${y(point.ratio).toFixed(1)}`);
      offset += segment.length;
      if (points.length >= 2) {
        parts.push(
          `<polyline fill="none" stroke="${colour}" stroke-width="1.8" points="${points.join(" ")}"/>`,
        );
      }
      for (const point of points) {
        const [cx, cy] = point.split(",");
        parts.push(`<circle cx="${cx}" cy="${cy}" r="2.6" fill="${colour}"/>`);
      }
    }
    const legendY = CHART.padTop + 6 + methodIndex * 16;
    parts.push(
      `<line x1="${CHART.width - CHART.padRight + 16}" y1="${legendY}" x2="${CHART.width - CHART.padRight + 40}" y2="${legendY}" stroke="${colour}" stroke-width="1.8"/>`,
      `<text x="${CHART.width - CHART.padRight + 46}" y="${legendY + 4}" fill="#333">${escapeXml(id)}</text>`,
    );
  });

  parts.push(
    `<text x="${CHART.padLeft}" y="${CHART.height - 14}" fill="#777">alert: &gt; ${history.alert.regressionPct}% below the median of the preceding same-machine samples, minimum ${history.alert.minSamples}</text>`,
    "</svg>",
  );
  return parts.join("\n") + "\n";
}
