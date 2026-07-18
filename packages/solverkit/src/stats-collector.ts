import type { Sink, SolveReport, StepResult } from "./types.js";

/** Frozen diagnostic summary produced by {@link StatsCollector.stats} (§5.1). */
export interface SolveStats {
  readonly nSteps: number;
  readonly nRHS: number;
  readonly nRejected: number;
  readonly hMin: number;
  readonly hMax: number;
  /** log10-spaced bin edges, length `histogramCounts.length + 1`. */
  readonly histogramBinEdges: readonly number[];
  readonly histogramCounts: readonly number[];
}

const DEFAULT_BIN_COUNT = 20;
const DEFAULT_MIN_H = 1e-9;
const DEFAULT_MAX_H = 1e3;

/**
 * Records solve diagnostics without retaining the trajectory (§5.1):
 * nSteps, nRHS, nRejected, and a step-size histogram. A fixed-size,
 * log10-spaced histogram is used rather than one derived from the observed
 * range, so accumulation is O(1) per step with no growing storage -- this
 * is the sink Monte Carlo batches attach instead of `TrajectoryRecorder`
 * when only aggregate diagnostics matter (§5.1 "the difference between 1e3
 * and 1e5 runs/s").
 */
export class StatsCollector implements Sink {
  readonly id = "stats-collector";

  private nStepsCount = 0;
  private nRHSCount = 0;
  private nRejectedCount = 0;
  private hMinObserved = Infinity;
  private hMaxObserved = -Infinity;
  private readonly histogramCounts: Uint32Array;
  private readonly logMinH: number;
  private readonly logMaxH: number;
  private readonly binCount: number;
  private summary: SolveStats | undefined;

  constructor(
    binCount: number = DEFAULT_BIN_COUNT,
    minH: number = DEFAULT_MIN_H,
    maxH: number = DEFAULT_MAX_H,
  ) {
    this.binCount = binCount;
    this.logMinH = Math.log10(minH);
    this.logMaxH = Math.log10(maxH);
    this.histogramCounts = new Uint32Array(binCount);
  }

  /** @inheritDoc */
  accept(_t: number, _y: Float64Array, step: StepResult): void {
    this.nRHSCount += step.nRHS;

    if (!step.accepted) {
      this.nRejectedCount++;
      return;
    }

    this.nStepsCount++;
    if (step.h < this.hMinObserved) this.hMinObserved = step.h;
    if (step.h > this.hMaxObserved) this.hMaxObserved = step.h;
    this.recordHistogram(step.h);
  }

  /** @inheritDoc */
  finish(_report: SolveReport): void {
    const binEdges: number[] = [];
    for (let i = 0; i <= this.binCount; i++) {
      binEdges.push(10 ** (this.logMinH + (i / this.binCount) * (this.logMaxH - this.logMinH)));
    }

    this.summary = Object.freeze({
      nSteps: this.nStepsCount,
      nRHS: this.nRHSCount,
      nRejected: this.nRejectedCount,
      hMin: this.hMinObserved,
      hMax: this.hMaxObserved,
      histogramBinEdges: Object.freeze(binEdges),
      histogramCounts: Object.freeze(Array.from(this.histogramCounts)),
    });
  }

  /** The frozen diagnostic summary; only valid after `finish` has run. */
  get stats(): SolveStats {
    if (!this.summary) {
      throw new Error("StatsCollector.stats read before finish()");
    }
    return this.summary;
  }

  private recordHistogram(h: number): void {
    if (h <= 0 || !Number.isFinite(h)) return;
    const logH = Math.log10(h);
    const clamped = Math.min(Math.max(logH, this.logMinH), this.logMaxH);
    const fraction = (clamped - this.logMinH) / (this.logMaxH - this.logMinH);
    const bin = Math.min(Math.floor(fraction * this.binCount), this.binCount - 1);
    this.histogramCounts[bin]!++;
  }
}
