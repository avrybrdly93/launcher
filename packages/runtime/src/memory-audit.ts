/**
 * Memory audit definition for the 1e5-replicate study (§7 phase-7 table,
 * P7.06: "Memory audit for 1e5-replicate study; pooled buffers", validation
 * "peak < 300 MB; zero GC major collections mid-run").
 *
 * This module is the audit's *definition* — which workload, how it is
 * chunked, what a reading consists of, and how a reading becomes a verdict.
 * It observes nothing and allocates no instrument: `PerformanceObserver`,
 * `process.memoryUsage()` and `process.resourceUsage()` are all the
 * measuring script's business, exactly as `batch-throughput.ts` owns the
 * throughput benchmark's definition while `measure-batch-throughput.mjs`
 * owns the clock. That split is what lets the suite assert the audit's
 * arithmetic and its chunking at a replicate count a test can afford.
 *
 * ## The workload is the real study, not an allocation loop
 *
 * {@link memoryAuditStudy} is {@link benchmarkStudy} at a fixed step — the
 * same `UncertainScenarioSpec` the throughput benchmark measures and the
 * same one `runMcRange` serves the dashboard from. A synthetic loop that
 * allocated the same *shapes* would answer a different question: the
 * criterion is about what a 1e5-replicate study costs, and a study's cost
 * includes every transient the solve path creates per replicate, which is
 * precisely the part a hand-written loop would omit.
 *
 * ## Why the study is chunked, and why chunking is not the same as pooling
 *
 * `runMcRange` writes at *chunk-local* indices, so a chunked run needs one
 * destination per chunk. {@link chunkColumns} hands out `subarray` views
 * into a single whole-study {@link McColumns} rather than fresh arrays:
 * a view shares its buffer, so the study's results live in exactly one
 * allocation regardless of how many chunks it is cut into.
 *
 * Chunking exists for the *instrument*, not for the memory: a reading taken
 * only at the end cannot distinguish a run that held 200 MB throughout from
 * one that peaked at 200 MB for a millisecond, and "zero major collections
 * **mid-run**" is a claim about the middle of the run. The chunk boundary is
 * where a sample can be taken without putting a `memoryUsage()` call on the
 * per-replicate path, where it would both cost more than the thing it
 * measures and perturb it.
 *
 * ## What "peak" means here, and why one number is not an audit
 *
 * Three quantities are recorded because they answer three different
 * questions and disagree in informative ways:
 *
 * - `heapUsed` — live JS objects. What pooling would move.
 * - `rss` — resident set. What the machine actually gives up, including
 *   V8's un-returned heap, external buffers and the binary itself.
 * - `maxRss` from `process.resourceUsage()` — the high-water mark the kernel
 *   observed, which no sampling loop can miss between samples.
 *
 * The criterion says "peak", and the honest reading of a memory budget is
 * the resident set: {@link meetsPeakBudget} is written against `maxRss` for
 * that reason, with the sampled values kept so a reader can see the shape
 * rather than one number.
 */

import { benchmarkStudy } from "./batch-throughput.js";
import { createMcColumns, runMcRange, type McColumns, type McJob } from "./mc-job.js";

import type { UncertainScenarioSpec } from "@ballista/engine";

/** The replicate count the criterion names. */
export const MEMORY_AUDIT_REPLICATES = 100_000;

/**
 * §7's peak budget in bytes. 300 MB, read as 300 * 1024^2 — the binary
 * megabyte, which is the larger and therefore the more permissive of the two
 * readings. Stated rather than left implicit so a future run cannot recover
 * a failing measurement by re-reading "MB".
 */
export const MEMORY_AUDIT_PEAK_BUDGET_BYTES = 300 * 1024 * 1024;

/**
 * The step size the audit runs at: the throughput benchmark's second rung.
 *
 * Unlike that benchmark, the step here is **not** a knob that decides
 * pass/fail in either direction that matters. A finer step multiplies the
 * *work* per replicate but not the *live set*: the solve path's footprint is
 * O(model.dim) per replicate whatever the step, since `runMcRange` attaches
 * an `ObservableSink` and no recorder. It is fixed anyway, because a run
 * that chose its own step could quietly measure a cheaper study than the one
 * the criterion names.
 */
export const MEMORY_AUDIT_STEP_SIZE = 0.05;

/**
 * Replicates per chunk. 5000 gives 20 samples over the full study — enough
 * to see a trend and few enough that the sampling itself is not part of the
 * measurement.
 */
export const MEMORY_AUDIT_CHUNK_SIZE = 5000;

/** The study the audit runs: the throughput benchmark's scenario at a fixed step. */
export function memoryAuditStudy(replicates: number): UncertainScenarioSpec {
  return benchmarkStudy(MEMORY_AUDIT_STEP_SIZE, replicates);
}

/**
 * A `McColumns` addressing `[start, end)` of `columns`, as `subarray` views.
 *
 * Views, not copies: every returned array shares `columns`' buffer, so a
 * chunked run's results occupy the one whole-study allocation. Writing
 * through a view at chunk-local index `i` therefore lands at study index
 * `start + i`, which is what makes chunking invisible in the output.
 *
 * @throws if the range is not a valid half-open range inside `columns`.
 */
export function chunkColumns(columns: McColumns, start: number, end: number): McColumns {
  const total = columns.range.length;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new RangeError(`chunk bounds must be integers, got [${start}, ${end})`);
  }
  if (start < 0 || end > total || start > end) {
    throw new RangeError(`chunk [${start}, ${end}) is not inside [0, ${total})`);
  }
  return {
    range: columns.range.subarray(start, end),
    apexHeight: columns.apexHeight.subarray(start, end),
    timeOfFlight: columns.timeOfFlight.subarray(start, end),
    impactSpeed: columns.impactSpeed.subarray(start, end),
    landed: columns.landed.subarray(start, end),
  };
}

/** Half-open replicate range of one chunk. */
export interface AuditChunk {
  readonly start: number;
  readonly end: number;
}

/**
 * Cuts `[0, replicates)` into chunks of at most `chunkSize`, in order.
 *
 * The last chunk is short rather than the load being spread evenly, because
 * the samples are meant to sit at equal *work* intervals; an even partition
 * would move every boundary as the replicate count changed and make two
 * runs' sample series incomparable.
 */
export function auditChunks(replicates: number, chunkSize: number): AuditChunk[] {
  if (!Number.isInteger(replicates) || replicates < 0) {
    throw new RangeError(`replicates must be a non-negative integer, got ${replicates}`);
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }
  const chunks: AuditChunk[] = [];
  for (let start = 0; start < replicates; start += chunkSize) {
    chunks.push({ start, end: Math.min(start + chunkSize, replicates) });
  }
  return chunks;
}

/** One memory sample, taken at a chunk boundary. */
export interface MemorySample {
  /** Replicates completed when the sample was taken. */
  readonly completed: number;
  /** `process.memoryUsage().rss` in bytes. */
  readonly rss: number;
  /** `process.memoryUsage().heapUsed` in bytes. */
  readonly heapUsed: number;
}

/** What one audit run observed. */
export interface MemoryAuditReading {
  readonly replicates: number;
  readonly chunkSize: number;
  /** `process.resourceUsage().maxRSS`, converted to bytes. The kernel's high-water mark. */
  readonly maxRssBytes: number;
  /** Major (mark-compact) collections observed strictly between the first and last chunk. */
  readonly majorCollections: number;
  /** Minor (scavenge) collections over the same interval. Recorded, not budgeted. */
  readonly minorCollections: number;
  readonly samples: readonly MemorySample[];
}

/** The largest sampled `rss`, or 0 if nothing was sampled. */
export function peakSampledRss(samples: readonly MemorySample[]): number {
  return samples.reduce((peak, s) => Math.max(peak, s.rss), 0);
}

/** The largest sampled `heapUsed`, or 0 if nothing was sampled. */
export function peakSampledHeapUsed(samples: readonly MemorySample[]): number {
  return samples.reduce((peak, s) => Math.max(peak, s.heapUsed), 0);
}

/** Whether `reading`'s peak resident set is inside {@link MEMORY_AUDIT_PEAK_BUDGET_BYTES}. */
export function meetsPeakBudget(reading: MemoryAuditReading): boolean {
  return reading.maxRssBytes < MEMORY_AUDIT_PEAK_BUDGET_BYTES;
}

/** Whether `reading` saw no major collection mid-run. */
export function meetsMajorGcBudget(reading: MemoryAuditReading): boolean {
  return reading.majorCollections === 0;
}

/** Both halves of P7.06's criterion, reported separately and together. */
export interface MemoryAuditVerdict {
  readonly peakOk: boolean;
  readonly majorGcOk: boolean;
  readonly pass: boolean;
}

/**
 * P7.06's verdict.
 *
 * Both halves are reported, and `pass` is their conjunction — a run that
 * cleared the byte budget while triggering major collections has met half of
 * a two-part criterion, and reducing that to one boolean would lose the half
 * that says which.
 */
export function memoryAuditVerdict(reading: MemoryAuditReading): MemoryAuditVerdict {
  const peakOk = meetsPeakBudget(reading);
  const majorGcOk = meetsMajorGcBudget(reading);
  return { peakOk, majorGcOk, pass: peakOk && majorGcOk };
}

/** Everything a chunked audit run needs beyond its instruments. */
export interface MemoryAuditWorkloadOptions {
  readonly replicates?: number;
  readonly chunkSize?: number;
  /**
   * Called after each chunk with the replicates completed so far. The
   * measuring script samples here; the workload itself never calls
   * `process.memoryUsage()`, so this module stays runnable anywhere.
   */
  readonly onChunk?: (completed: number) => void;
}

/**
 * Runs the audit's study to completion, chunk by chunk, into one
 * whole-study {@link McColumns} which it returns.
 *
 * Allocates the destination once and hands each chunk a `subarray` view of
 * it, so the result buffer does not grow with the chunk count. Everything
 * else it allocates is `runMcRange`'s, which is the point: this function is
 * the workload under audit, not a model of it.
 */
export function runMemoryAuditWorkload(options: MemoryAuditWorkloadOptions = {}): McColumns {
  const replicates = options.replicates ?? MEMORY_AUDIT_REPLICATES;
  const chunkSize = options.chunkSize ?? MEMORY_AUDIT_CHUNK_SIZE;
  const job: McJob = { study: memoryAuditStudy(replicates) };
  const columns = createMcColumns(replicates);

  for (const chunk of auditChunks(replicates, chunkSize)) {
    runMcRange(job, chunk.start, chunk.end, chunkColumns(columns, chunk.start, chunk.end));
    options.onChunk?.(chunk.end);
  }

  return columns;
}
