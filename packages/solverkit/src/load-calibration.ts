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
 * of what this machine can currently do. Under sustained load every repeat is
 * stretched, so the minimum is stretched too -- which is precisely the
 * behaviour that makes a ratio against it load-invariant rather than merely
 * noisy.
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
