import { median } from "./benchmark-trend.js";

/**
 * Load-invariant timing helpers for performance assertions in the test suite.
 *
 * WHY THIS MODULE EXISTS. A raw wall-clock assertion -- `expect(elapsedMs)
 * .toBeLessThan(N)` -- inside a parallel vitest pool measures the runner as
 * much as it measures the code. It turns `main` red on a busy machine with
 * nothing having regressed, and it does so intermittently, which is the
 * expensive kind: the failure attaches itself to whatever landed alongside it.
 * P0.96, P0.112 and P0.123 are three separate filings of that same defect.
 *
 * THE FIX, ESTABLISHED BY P0.123 AND GENERALISED HERE. Express the budget as a
 * ratio against a calibration workload measured in the SAME process moments
 * before. Contention multiplies the measurement and the calibration alike and
 * leaves the ratio alone; code that genuinely got slower moves the ratio and
 * does not move the calibration. The raw figure from the blueprint is then
 * still checked, but only on a machine whose calibration shows it is actually
 * free to run -- see {@link isIdleEnoughForWallClock}.
 *
 * AND THE CONDITION THAT FIX SILENTLY DEPENDS ON, WHICH P0.147 MEASURED. "
 * Contention multiplies the measurement and the calibration alike" is true only
 * where the calibration is long enough to be descheduled. At
 * {@link CALIBRATION_ITERATIONS} it is ~0.65 ms -- shorter than a timeslice --
 * and under 8-way sustained load it stretched 0.99x while the work it was
 * calibrating stretched 2.19-2.53x. Below a timeslice the ratio cancels
 * nothing. {@link LOAD_TRACKING_CALIBRATION_ITERATIONS} carries the measured
 * table and {@link pairedCost} is the pairing that holds under load; the
 * smaller size is still correct where it is paired with {@link bestOfMs},
 * because a minimum over a minimum is symmetric.
 *
 * THE GATE KEYS ON THE CALIBRATION, NEVER ON THE MEASUREMENT IT GUARDS. That
 * distinction is what stops this being a way to hide a regression: slower code
 * does not move the calibration, so the raw check still runs and still fails.
 * Only a demonstrably busy -- or simply slow -- machine skips it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. A ratio detects a smaller class of
 * regression than a tight wall-clock budget; P0.123 measured its own floor at
 * roughly a 2.2x per-step cost increase. That is a real trade and it is made
 * knowingly: an assertion that cannot be measured on the machine it runs on is
 * a flake with a number attached, and detects nothing at all once someone
 * starts re-running it until it goes green.
 */

/**
 * A pure-arithmetic workload with a data dependency between iterations, so an
 * optimiser cannot vectorise or hoist it away, and no allocation, so it does
 * not measure the garbage collector.
 *
 * The accumulator is returned so the caller can consume it; a loop whose
 * result is discarded is a loop an optimiser is entitled to delete.
 */
export function calibrationWorkload(iterations: number): number {
  let acc = 0;
  for (let i = 0; i < iterations; i++) {
    acc += Math.sqrt(i + 1) / (i + 2);
  }
  return acc;
}

/**
 * Sized so one calibration run costs the same order as one typical measured
 * sample (~0.6 ms on the machine these numbers were taken on), which keeps the
 * ratios callers compute near 1 and easy to read.
 */
export const CALIBRATION_ITERATIONS = 200_000;

/** Repeats to take the minimum over; see {@link measureCalibrationMs}. */
export const CALIBRATION_REPEATS = 5;

/**
 * Above this calibration cost the machine is too busy -- or simply too slow --
 * for a raw wall-clock figure to say anything about the code. ~5x the idle
 * calibration observed on the development container (0.59-0.62 ms), so a
 * genuinely idle but slower machine is still held to the figure.
 */
export const IDLE_CALIBRATION_CEILING_MS = 3;

/**
 * A source of monotonically non-decreasing milliseconds. Defaults to
 * `performance.now`; injectable so that the helpers below can be tested
 * against a deterministic fake cost rather than against the wall clock. A
 * module that exists to keep load-sensitive assertions out of the correctness
 * suite must not need one in its own tests (P0.96).
 */
export type Clock = () => number;

/** Wall-clock duration of `fn`, in milliseconds, on `now`. */
export function elapsedMs(fn: () => void, now: Clock = performance.now.bind(performance)): number {
  const before = now();
  fn();
  return now() - before;
}

/**
 * This machine's current cost for one {@link calibrationWorkload}, in ms.
 *
 * Warms the workload first, then takes the MINIMUM of several repeats: the
 * minimum is the least-preempted sample, so it is the best available estimate
 * of what this machine can currently do.
 *
 * THIS DOC USED TO CLAIM "under sustained load every repeat is stretched, so
 * the minimum is stretched too", AND P0.147 MEASURED THAT AS FALSE. The
 * minimum is a preemption-AVOIDING statistic by construction, and at the
 * default size each repeat is shorter than a timeslice, so under 8-way
 * sustained load this returned 0.6398 ms against 0.6067 ms idle -- 1.05x,
 * while the work being calibrated stretched 2.19-2.53x. Even at 9M iterations
 * the interleaved minimum stretched 1.17x where the median of the same samples
 * stretched 2.18x.
 *
 * So this remains sound ONLY against a numerator that is itself a minimum --
 * which is how {@link bestOfMs}'s callers use it, and is why they have not
 * failed. Against a median, or any statistic that includes preemption, use
 * {@link pairedCost}. Behaviour is deliberately unchanged here: the sizing is
 * wrong for load tracking in every caller, which is a wider audit than P0.147
 * and is filed as P0.148.
 */
export function measureCalibrationMs(
  iterations: number = CALIBRATION_ITERATIONS,
  repeats: number = CALIBRATION_REPEATS,
  now: Clock = performance.now.bind(performance),
): number {
  calibrationWorkload(iterations);

  let best = Infinity;
  let acc = 0;
  for (let r = 0; r < repeats; r++) {
    const ms = elapsedMs(() => {
      acc += calibrationWorkload(iterations);
    }, now);
    if (ms < best) best = ms;
  }
  // Consume the accumulator so the loop above cannot be optimised away.
  if (!Number.isFinite(acc)) throw new Error("calibration workload did not run");
  return best;
}

/**
 * Whether a raw wall-clock budget is meaningful on this machine right now.
 *
 * Callers use this to gate the blueprint figure while always enforcing the
 * ratio, so a busy runner loses the figure but never loses the regression
 * check.
 */
export function isIdleEnoughForWallClock(
  calibrationMs: number,
  ceilingMs: number = IDLE_CALIBRATION_CEILING_MS,
): boolean {
  return calibrationMs <= ceilingMs;
}

// NOTE: no `median` here on purpose. `benchmark-trend.ts` already exports one
// with identical semantics and it is already part of this package's public
// surface; a second copy would be two functions to keep in agreement and a
// name collision at the index. Callers import that one.
// `pairedCost` below imports it for exactly that reason.

/**
 * Minimum wall-clock cost of `fn` over `trials` runs, after `warmups` untimed
 * ones. The minimum is the least-preempted sample; the warmups keep JIT
 * compile and deopt cost out of the steady-state number a render loop or a
 * solver step actually pays.
 */
export function bestOfMs(
  fn: () => void,
  trials: number,
  warmups: number,
  now: Clock = performance.now.bind(performance),
): number {
  for (let w = 0; w < warmups; w++) fn();

  let best = Infinity;
  for (let t = 0; t < trials; t++) {
    const ms = elapsedMs(fn, now);
    if (ms < best) best = ms;
  }
  return best;
}

/**
 * Iterations for a calibration that is long enough to be preempted.
 *
 * WHY A SECOND, MUCH LARGER SIZE EXISTS. {@link CALIBRATION_ITERATIONS} costs
 * ~0.65 ms, which is shorter than a scheduler timeslice, so that workload
 * almost always runs start to finish without being descheduled. It therefore
 * measures what the machine can do *while it is running*, not what this
 * process is actually getting — and a ratio against it cancels no contention
 * at all. P0.147 measured the stretch from idle to 8-way sustained load on a
 * 4-core container, as the median of fifteen interleaved samples at each size,
 * against a measured workload that stretched 2.19–2.53x:
 *
 * | iterations | idle cost | stretch under load |
 * | ---------: | --------: | -----------------: |
 * |       0.2M |   0.66 ms |      0.99x / 1.03x |
 * |         1M |   3.20 ms |      2.26x / 2.17x |
 * |         3M |   9.61 ms |      2.25x / 2.22x |
 * |         9M |  28.76 ms |      2.18x / 1.98x |
 * |        20M |  63.97 ms |      2.07x / 2.07x |
 *
 * The transition sits between 0.66 ms and 3.2 ms — around one timeslice, which
 * is the mechanism rather than a coincidence. 3M is chosen as comfortably past
 * it while still cheap enough to interleave: ~9.6 ms here, so fifteen of them
 * cost ~144 ms. This does NOT supersede {@link CALIBRATION_ITERATIONS}, whose
 * callers pair it with {@link bestOfMs} — minimum over minimum, a symmetric
 * pairing that is a different question from this one.
 */
export const LOAD_TRACKING_CALIBRATION_ITERATIONS = 3_000_000;

/**
 * Below this, a calibration is too short to have been preempted and cannot
 * report load — see {@link LOAD_TRACKING_CALIBRATION_ITERATIONS}'s table. 1M
 * already tracked load at 3.2 ms, so 2 ms leaves a machine roughly 4x faster
 * than the development container still able to measure.
 */
export const MIN_LOAD_TRACKING_CALIBRATION_MS = 2;

/** What {@link pairedCost} reports. */
export interface PairedCost {
  /** Median of the measured samples, ms. */
  readonly medianMs: number;
  /** Median of the calibrations interleaved with them, ms. */
  readonly calibrationMs: number;
  /** `medianMs / calibrationMs` — dimensionless, and the thing to assert. */
  readonly costInCalibrations: number;
  /**
   * Whether the calibration was long enough to have felt the same scheduling
   * as the samples. When false the ratio means nothing and the caller should
   * report that it could not measure rather than assert on it.
   */
  readonly tracksLoad: boolean;
}

/**
 * A load-invariant cost, as a ratio of two medians over interleaved series.
 *
 * TWO THINGS MAKE THIS INVARIANT AND BOTH ARE LOAD-BEARING (P0.147).
 *
 * *The calibration must be long enough to be preempted.* See
 * {@link LOAD_TRACKING_CALIBRATION_ITERATIONS}. A sub-timeslice calibration
 * does not move under load, so the ratio inherits the numerator's full
 * sensitivity; `tracksLoad` is the honest report of that case.
 *
 * *Both series must be summarised by the SAME statistic.* The minimum is a
 * preemption-*avoiding* statistic by construction, so pairing a minimum
 * calibration with a median measurement compares a machine's best case against
 * a process's typical one. Measured at 9M iterations under sustained load, the
 * interleaved minimum stretched 1.17x while the median of those very same
 * samples stretched 2.18x. Hence median over median here.
 *
 * The caller interleaves: one calibration per sample, in the same loop, so the
 * two series span the same wall-clock window. Taking them in separate phases
 * is what P0.147 found had made the ratio *more* load-sensitive than the raw
 * clock rather than less.
 *
 * THE GATE KEYS ON THE CALIBRATION, NEVER ON THE MEASUREMENT IT GUARDS — the
 * same rule this module's header states for {@link isIdleEnoughForWallClock}.
 * Code that genuinely got slower does not move an arithmetic workload, so
 * `tracksLoad` stays true and the assertion still fails. Only a machine too
 * fast (or a calibration too small) to be measured this way opts out.
 *
 * @param samplesMs      measured durations, one per case
 * @param calibrationsMs calibration durations interleaved with them
 */
export function pairedCost(
  samplesMs: readonly number[],
  calibrationsMs: readonly number[],
  minCalibrationMs: number = MIN_LOAD_TRACKING_CALIBRATION_MS,
): PairedCost {
  if (samplesMs.length === 0) throw new RangeError("pairedCost of no samples");
  if (samplesMs.length !== calibrationsMs.length) {
    // Unequal lengths mean the two series did not span the same window, which
    // is the one property this function's invariance rests on.
    throw new RangeError(
      `pairedCost needs one calibration per sample; got ${samplesMs.length} samples and ${calibrationsMs.length} calibrations`,
    );
  }

  const medianMs = median(samplesMs);
  const calibrationMs = median(calibrationsMs);
  return {
    medianMs,
    calibrationMs,
    costInCalibrations: medianMs / calibrationMs,
    tracksLoad: calibrationMs >= minCalibrationMs,
  };
}
