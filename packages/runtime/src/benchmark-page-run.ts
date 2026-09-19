/**
 * Driving the batch-throughput ladder from a page (P7.32).
 *
 * **Why this is a generator and not a function that returns a result.** The
 * work is CPU-bound JavaScript, and on a page it runs on the thread that also
 * paints. A single synchronous call would block the event loop for the whole
 * run: no progress bar, no Cancel, no repaint. `monte-carlo-route.tsx` hit
 * exactly this and solved it the same way -- `mcDashboardStudySteps` yields so
 * the route can hand the event loop back. This module is that pattern applied
 * to the benchmark, and the route below it owns the yielding and the clock.
 *
 * **The workload is the CI benchmark's, not a re-creation of it.** Each rung
 * drives `benchmarkStudy` through `runMcRange`, the very calls
 * `batch-throughput-worker-entry.ts` makes. A page that reimplemented the
 * study would be free to drift from the thing its number claims to describe.
 *
 * **Smaller by default, and the card says so.** {@link PAGE_REPLICATES} is far
 * below the CI script's 40 000 because a user is waiting. That makes the
 * figure more startup-sensitive, not less, which is precisely why
 * `ResultCard` carries its replicate count: a small-N rate read beside
 * `scripts/batch-throughput-results.json` would otherwise look comparable to
 * it.
 */

import {
  THROUGHPUT_STEP_LADDER,
  benchmarkReferenceStudy,
  benchmarkStudy,
  throughputFrom,
  type LadderRung,
} from "./batch-throughput.js";
import { createMcColumns, runMcRange, runMcReplicate } from "./mc-job.js";

/**
 * Replicates per rung on the page.
 *
 * Chosen so a whole ladder finishes in a few seconds on a mid-range laptop
 * rather than so the number looks good: a benchmark a user abandons reports
 * nothing at all.
 */
export const PAGE_REPLICATES = 2_000;

/** How many replicates run between two yields to the event loop. */
export const PAGE_CHUNK = 250;

/** One step of a page run: how far along it is, and what it has finished. */
export interface BenchmarkPageStep {
  /** Replicates completed across the whole ladder, including the accuracy leg. */
  readonly completed: number;
  /** Replicates the whole ladder will run. */
  readonly total: number;
  /** Set on the step that completes a rung; `undefined` on progress-only steps. */
  readonly rung?: LadderRung;
}

/** Total replicates a page run executes, for a progress denominator that does not move. */
export function pageRunTotal(replicates: number = PAGE_REPLICATES): number {
  // One accuracy replicate per rung, plus the reference replicate.
  return THROUGHPUT_STEP_LADDER.length * (replicates + 1) + 1;
}

/** Measures one rung's accuracy against the reference range. Injectable so a test can price it. */
export type AccuracyMeasurement = (stepSize: number, referenceRange: number) => number;

/** Injected collaborators. A page passes a real clock; tests pass ones they control. */
export interface BenchmarkPageRunOptions {
  /** A page passes `performance.now.bind(performance)`. */
  readonly now?: () => number;
  /**
   * How a rung's relative range error is obtained.
   *
   * **Injectable specifically so a test can make it expensive on the injected
   * clock.** That is the only way to assert the accuracy leg is outside the
   * timed section: counting clock reads cannot distinguish "read the end of
   * the timer, then measure accuracy" from "measure accuracy, then read the
   * end of the timer" -- both are two reads per rung. A control run proved
   * that, so the weaker assertion was replaced rather than kept.
   */
  readonly measureAccuracy?: AccuracyMeasurement;
}

/**
 * Runs the ladder, yielding between chunks.
 *
 * The clock is read around the timed section of each rung and nowhere else:
 * the accuracy leg is a separate, single replicate and must not be inside the
 * timing, or the rate would be of a workload that includes an adaptive solve
 * no batch runs. `measure-batch-throughput.mjs` draws the same line, and for
 * the same reason.
 */
export function* benchmarkPageSteps(
  replicates: number = PAGE_REPLICATES,
  options: BenchmarkPageRunOptions = {},
): Generator<BenchmarkPageStep, void, void> {
  const now = options.now ?? ((): number => Date.now());
  const measureAccuracy: AccuracyMeasurement =
    options.measureAccuracy ??
    ((stepSize, referenceRange): number => {
      const run = runMcReplicate({ study: benchmarkStudy(stepSize, 1) }, 0);
      return Math.abs(run.range - referenceRange) / Math.abs(referenceRange);
    });
  const total = pageRunTotal(replicates);
  let completed = 0;

  // The reference leg first: every rung's accuracy is measured against it, so
  // it has to exist before any rung can be reported.
  const reference = runMcReplicate({ study: benchmarkReferenceStudy(1) }, 0);
  completed += 1;
  yield { completed, total };

  for (const stepSize of THROUGHPUT_STEP_LADDER) {
    const study = benchmarkStudy(stepSize, replicates);
    const columns = createMcColumns(replicates);

    const start = now();
    let done = 0;
    while (done < replicates) {
      const end = Math.min(done + PAGE_CHUNK, replicates);
      runMcRange({ study }, done, end, columns);
      completed += end - done;
      done = end;
      // Progress is yielded from inside the timed section, so the elapsed time
      // this rung reports includes whatever the page did with the yields. That
      // is the honest number for a page: it is what the user actually waited.
      yield { completed, total };
    }
    const elapsedSeconds = Math.max(now() - start, 1) / 1000;

    // Checksum for the same reason the worker entry posts one: a value has to
    // be observed or a runtime is entitled to elide the work the rate counts.
    let checksum = 0;
    for (const value of columns.range) checksum += value;
    if (!Number.isFinite(checksum) || checksum === 0) {
      throw new Error(
        `benchmarkPageSteps: step ${stepSize} produced a checksum of ${checksum}; no ensemble was computed`,
      );
    }

    const relativeRangeError = measureAccuracy(stepSize, reference.range);
    completed += 1;

    const measurement = throughputFrom(stepSize, replicates, 1, elapsedSeconds);
    yield { completed, total, rung: { ...measurement, relativeRangeError } };
  }
}
