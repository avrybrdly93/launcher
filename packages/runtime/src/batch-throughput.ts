/**
 * Batch throughput benchmark definition (§2.6 "Batch throughput (CPU): ≥1e4
 * full trajectories/s (RK4, fixed step, typical flight) on 4 workers by end
 * of Phase 6"; P6.26).
 *
 * This module is the benchmark's *definition* -- which scenario, which
 * solver, how the replicate range is split across workers, and how a
 * measured elapsed time becomes a throughput number. It spawns nothing and
 * measures nothing: `scripts/measure-batch-throughput.mjs` owns the threads,
 * the clock and the artifact, exactly as `worker-pool.ts` is the only piece
 * of the sweep path that knows about `postMessage`. Keeping the definition
 * here is what lets the test suite assert the benchmark's *accuracy*
 * claim without spawning a worker.
 *
 * **`runMcRange` is the primitive, and `runSweepRange` is not.** "Observables
 * only" is the criterion's own phrase and it excludes the sweep path:
 * `sweep-job.ts` attaches a `TrajectoryRecorder` and reads the finished
 * trajectory, which is affordable for an 11x11 grid and is precisely the
 * thing P6.04's batch was built not to do. `runMcRange` attaches an
 * `ObservableSink` whose footprint is O(model.dim) for a whole solve. A
 * throughput number measured with a recorder attached would be measuring a
 * different workload than the budget names.
 *
 * **THE STEP SIZE IS THE ONE KNOB THAT DECIDES PASS/FAIL, so it is not a
 * constant chosen after seeing a number.** Fixed-step RK4 throughput is very
 * nearly inversely proportional to the step, so any step size can be
 * defended after the fact and the temptation to pick the one that clears
 * 1e4 is the whole integrity risk in this task. The rule, fixed in
 * `ROADMAP.json` before the harness existed:
 *
 *   the artifact publishes, for EVERY step on {@link THROUGHPUT_STEP_LADDER},
 *   both the measured relative range error against a tight adaptive
 *   reference and the measured throughput; the budget verdict is read at the
 *   coarsest step whose error is within {@link ACCURACY_CEILING} -- two
 *   orders inside §2.6's own 1e-6 accuracy budget.
 *
 * So the trade-off is in the artifact rather than hidden in a constant, and
 * a reader can see what every other step would have given.
 *
 * Deliberately DOM-free and dependency-light for the same reason
 * `mc-job.ts` is: the worker entry bundles this module, and a bundle that
 * dragged in a framework would be measuring the bundler.
 */

import {
  findCuratedScenario,
  uncertainScenarioSpecSchema,
  type ScenarioSpec,
  type UncertainScenarioSpec,
} from "@ballista/engine";

/**
 * The step sizes the benchmark measures, coarsest first. Fixed rather than
 * derived so a run cannot quietly extend the ladder until something passes;
 * changing it is a visible diff.
 *
 * Coarsest is 0.1 s because that is already about 78 steps over this
 * scenario's ~7.8 s flight, and a ladder whose top entry resolves the flight
 * with fewer steps than that is measuring a trajectory nobody would run.
 */
export const THROUGHPUT_STEP_LADDER: readonly number[] = [0.1, 0.05, 0.02, 0.01];

/**
 * The accuracy a step must reach to be eligible for the budget verdict:
 * relative error in the replicate's range against a tight adaptive
 * reference. Two orders inside §2.6's accuracy budget ("global error < 1e-6
 * relative"), so no throughput number here is bought by loosening accuracy
 * to the edge of what the blueprint permits.
 */
export const ACCURACY_CEILING = 1e-8;

/** §2.6's CPU batch throughput budget, in full trajectories per second on 4 workers. */
export const THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND = 1e4;

/** The worker count §2.6 states the budget at. */
export const THROUGHPUT_WORKERS = 4;

/**
 * The reference solver the ladder's accuracy is measured against: adaptive
 * DOPRI5 at a tolerance far tighter than anything the ladder can reach, so
 * the measured differences are the fixed-step scheme's own truncation error
 * and not the reference's.
 */
export const THROUGHPUT_REFERENCE_SOLVER = {
  stepper: "dopri5",
  rtol: 1e-11,
  atol: 1e-13,
  maxSteps: 2_000_000,
  controller: "PI",
} as const;

/** The scenario the benchmark integrates: the library's golf drive, launched from the origin. */
function benchmarkBaseScenario(): ScenarioSpec {
  const curated = findCuratedScenario("golf-drive");
  if (!curated)
    throw new Error("batch-throughput: the scenario library has no `golf-drive` preset");
  const spec = curated.spec;
  return { ...spec, initialConditions: { ...spec.initialConditions, x0: 0, y0: 0 } };
}

/**
 * The benchmark study at one step size: the golf drive with three uncertain
 * launch inputs, integrated with fixed-step classical RK4.
 *
 * **The overlays are not decoration.** A study with no overlays draws the
 * same parameter vector every replicate, and a JIT is entitled to notice
 * that; the throughput would then be of a workload no real batch runs.
 * These are the same three inputs the dashboard study varies (ball speed,
 * the vertical component, backspin), so the benchmark measures the ensemble
 * the application actually produces.
 *
 * The spreads are illustrative and are not measurements of any golfer --
 * same caveat as `monte-carlo-route.tsx`'s study, and for the same reason.
 */
export function benchmarkStudy(stepSize: number, replicates: number): UncertainScenarioSpec {
  const base = benchmarkBaseScenario();
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: {
      ...base,
      // Fixed-step RK4, and nothing adaptive: no `rtol`, no `atol`, no
      // controller. `batch-throughput.test.ts` asserts that, because an
      // adaptive field surviving here would silently change the workload
      // the number describes.
      solver: { stepper: "classical-rk4", h: stepSize, maxSteps: 500_000 },
    },
    overlays: [
      {
        path: "initialConditions.vx0",
        distribution: { kind: "normal", mean: base.initialConditions.vx0, stdDev: 1.5 },
      },
      {
        path: "initialConditions.vy0",
        distribution: { kind: "normal", mean: base.initialConditions.vy0, stdDev: 1.0 },
      },
      { path: "initialConditions.spin0", distribution: { kind: "normal", mean: 300, stdDev: 25 } },
    ],
    replicates,
    seed: 20260902,
  });
}

/** The same study with the reference solver, for the accuracy leg. */
export function benchmarkReferenceStudy(replicates: number): UncertainScenarioSpec {
  const study = benchmarkStudy(THROUGHPUT_STEP_LADDER[0]!, replicates);
  return uncertainScenarioSpecSchema.parse({
    ...study,
    base: { ...study.base, solver: THROUGHPUT_REFERENCE_SOLVER },
  });
}

/** One worker's assignment: replicate indices `[startIndex, endIndex)`. */
export interface ThroughputChunk {
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Splits `replicates` into `workers` contiguous chunks, largest-first by one
 * replicate when the division is uneven.
 *
 * Contiguous and index-addressed rather than round-robin, mirroring
 * `worker-pool.ts`: §5.6's determinism-under-parallelism principle is that a
 * result is reassembled by its own index and never by arrival order, so the
 * partition cannot change any number. `batch-throughput.test.ts` asserts
 * that by running one study under three different partitions and requiring
 * bit-identical columns.
 *
 * A worker count exceeding the replicate count yields empty trailing chunks
 * rather than throwing: an empty chunk is a worker with nothing to do, which
 * is a scheduling fact and not an error.
 */
export function partitionReplicates(replicates: number, workers: number): ThroughputChunk[] {
  if (!Number.isInteger(replicates) || replicates < 0) {
    throw new Error(
      `partitionReplicates: replicates must be a non-negative integer, got ${replicates}`,
    );
  }
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`partitionReplicates: workers must be a positive integer, got ${workers}`);
  }

  const base = Math.floor(replicates / workers);
  const remainder = replicates % workers;
  const chunks: ThroughputChunk[] = [];
  let cursor = 0;
  for (let w = 0; w < workers; w++) {
    const size = base + (w < remainder ? 1 : 0);
    chunks.push({ startIndex: cursor, endIndex: cursor + size });
    cursor += size;
  }
  return chunks;
}

/** A measured throughput: what was run, how long it took, and the rate that implies. */
export interface ThroughputMeasurement {
  readonly stepSize: number;
  readonly replicates: number;
  readonly workers: number;
  readonly elapsedSeconds: number;
  readonly trajectoriesPerSecond: number;
}

/**
 * Turns a measured wall-clock elapsed time into a throughput.
 *
 * Wall clock across the whole batch, deliberately: the budget is a
 * throughput a user waits on, so worker spawn, message round trips and the
 * slowest chunk's tail all count against it. Summing per-worker CPU time
 * would report a number no user experiences.
 */
export function throughputFrom(
  stepSize: number,
  replicates: number,
  workers: number,
  elapsedSeconds: number,
): ThroughputMeasurement {
  if (!(elapsedSeconds > 0) || !Number.isFinite(elapsedSeconds)) {
    throw new Error(
      `throughputFrom: elapsedSeconds must be positive and finite, got ${elapsedSeconds}`,
    );
  }
  return {
    stepSize,
    replicates,
    workers,
    elapsedSeconds,
    trajectoriesPerSecond: replicates / elapsedSeconds,
  };
}

/** One ladder rung, once both legs have been measured. */
export interface LadderRung extends ThroughputMeasurement {
  /** Relative error in this step's range against the adaptive reference. */
  readonly relativeRangeError: number;
}

/**
 * The rung the budget verdict is read at: the **coarsest** (so the fastest)
 * step whose accuracy is within {@link ACCURACY_CEILING}.
 *
 * Returns `undefined` when no rung qualifies. That is not a pass and not a
 * "budget missed" either -- it means the ladder never reached the accuracy
 * the verdict requires, and the caller must say so rather than fall back to
 * the fastest rung it has.
 */
export function verdictRung(rungs: readonly LadderRung[]): LadderRung | undefined {
  const eligible = rungs.filter((rung) => rung.relativeRangeError <= ACCURACY_CEILING);
  if (eligible.length === 0) return undefined;
  return eligible.reduce((coarsest, rung) => (rung.stepSize > coarsest.stepSize ? rung : coarsest));
}

/** Whether a rung clears §2.6's budget. */
export function meetsBudget(rung: LadderRung): boolean {
  return rung.trajectoriesPerSecond >= THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND;
}

/**
 * How many times the verdict rung is measured inside one job before the
 * budget verdict is read. The verdict takes the **best** sample.
 *
 * **Why this exists (P0.122).** A single timing was reporting which machine
 * CI drew rather than whether the code is fast enough. Three jobs at the
 * same h=0.05 rung, with `relativeRangeError` identical to every digit --
 * so the identical workload -- reported 7916.57, 8871.89 and 15423.96
 * traj/s. About 1.05x of that spread was a real code change, measured
 * locally as 8 interleaved A/B pairs; the remaining ~1.65x was not. The
 * budget of 1e4 sits inside a 1.95x spread, so the same commit passed or
 * failed depending on the draw.
 *
 * **Why the best sample and not the mean or the median.** A benchmark
 * sample can only be slowed down by interference, never sped up by it, so
 * the distribution's fast tail is the machine and its slow tail is
 * everything else running on the machine. The maximum is therefore the
 * least contaminated estimate, not the luckiest one. This repository
 * already reasons that way: P0.116 takes a per-sample minimum in
 * `Query.test.ts` for exactly this reason.
 *
 * **What this does NOT fix, stated here because the number would otherwise
 * overclaim.** Sampling inside one job removes contention *within* that
 * job. It cannot remove a runner that is uniformly slower than another
 * runner, and P0.122's evidence is three separate jobs, so an unknown share
 * of that 1.65x is machine class rather than a noisy neighbour. That is why
 * {@link sampledVerdict} also reports {@link SampledVerdict.unanimous} and
 * why a straddling sample set is published as indeterminate: when a job's
 * own samples disagree about the budget, the honest output is that this
 * machine cannot decide, not a coin flip dressed as a verdict.
 *
 * **The two options not taken, named here as P0.122 requires.**
 *
 * - *(b) Normalise against a cheap in-job calibration loop*, so the verdict
 *   is work-per-unit-of-that-machine rather than wall clock -- decision
 *   0023's in-process-control pattern. This is the most correct option and
 *   the only one that addresses machine class directly. It is not taken
 *   here because it needs a reference calibration constant, and that
 *   constant decides where the verdict lands exactly the way the step size
 *   does. Choosing it after seeing a throughput number is the integrity
 *   risk this module's header is written against, so it needs its own row
 *   and its own measurement campaign rather than a corner of this one.
 * - *(c) Keep the absolute number but require it on two consecutive runs.*
 *   Cheapest of the three, and it is still a coin flip -- twice. Two draws
 *   from a 1.95x spread agreeing is an event with a probability, not a
 *   property of the code, which is the same mistake P0.122 was filed to
 *   correct: the 71st and 72nd runs read two consistent measurements as a
 *   property of the runner class and they were two draws from a wide
 *   distribution.
 *
 * Five samples rather than three: the cost is five timings of one rung in a
 * job that already times four rungs, and three samples of a noisy statistic
 * is not many. It is not derived from a target hit rate, and no run should
 * raise it until a measurement says the sample count is what is limiting.
 */
export const THROUGHPUT_VERDICT_SAMPLES = 5;

/** The verdict rung's throughput, read across several samples rather than one. */
export interface SampledVerdict {
  readonly stepSize: number;
  readonly relativeRangeError: number;
  readonly replicates: number;
  readonly workers: number;
  /** Every sample's throughput, in the order measured. Never empty. */
  readonly samples: readonly number[];
  /** The fastest sample: the estimate the verdict is read from. */
  readonly best: number;
  /** The slowest sample, published so the spread is visible rather than implied. */
  readonly worst: number;
  /** `best / worst`. 1 means the job was quiet; a large value means it was not. */
  readonly spreadRatio: number;
  /** Whether the best sample clears §2.6's budget. */
  readonly meetsBudget: boolean;
  /**
   * Whether every sample landed on the same side of the budget.
   *
   * `false` means this job straddled the threshold and cannot support a
   * verdict at all -- the caller must report that rather than
   * {@link meetsBudget}, which would be reporting one draw.
   */
  readonly unanimous: boolean;
  /**
   * The single field a reader should look at, and the reason it exists
   * rather than leaving {@link meetsBudget} as the headline.
   *
   * `meetsBudget` is still a boolean and a boolean has no way to say "this
   * machine could not tell". Publishing one next to `unanimous: false`
   * leaves a footgun: anything that reads the boolean alone is back to
   * reporting a single draw, which is the defect P0.122 is about. `state`
   * cannot be misread that way.
   */
  readonly state: "meets" | "misses" | "indeterminate";
}

/**
 * Builds the sampled verdict from the ladder pass's measurement of the
 * verdict rung plus its resamples.
 *
 * Throws when a resample describes a different workload. Comparing samples
 * taken at different step sizes, replicate counts or worker counts would
 * produce a "best" that is merely the cheapest configuration, which is the
 * failure this whole row is about wearing different clothes.
 */
export function sampledVerdict(
  rung: LadderRung,
  resamples: readonly ThroughputMeasurement[],
): SampledVerdict {
  for (const resample of resamples) {
    if (
      resample.stepSize !== rung.stepSize ||
      resample.replicates !== rung.replicates ||
      resample.workers !== rung.workers
    ) {
      throw new Error(
        `sampledVerdict: resample (h=${resample.stepSize}, ${resample.replicates} replicates, ` +
          `${resample.workers} workers) does not match the verdict rung ` +
          `(h=${rung.stepSize}, ${rung.replicates} replicates, ${rung.workers} workers)`,
      );
    }
  }

  const samples = [rung.trajectoriesPerSecond, ...resamples.map((r) => r.trajectoriesPerSecond)];
  const best = Math.max(...samples);
  const worst = Math.min(...samples);
  const clears = samples.map((rate) => rate >= THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND);

  const meetsBudget = best >= THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND;
  const unanimous = clears.every((c) => c === clears[0]);

  return {
    stepSize: rung.stepSize,
    relativeRangeError: rung.relativeRangeError,
    replicates: rung.replicates,
    workers: rung.workers,
    samples,
    best,
    worst,
    spreadRatio: best / worst,
    meetsBudget,
    unanimous,
    state: !unanimous ? "indeterminate" : meetsBudget ? "meets" : "misses",
  };
}
