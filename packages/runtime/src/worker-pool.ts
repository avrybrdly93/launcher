/**
 * Worker pool v1 (§5.6 Concurrency Architecture; P3.39): `size` long-lived
 * workers, each loading the pure L0/L1 (+ this package's own DOM-free
 * `sweep-job.ts`/`scenario-resolver.ts`) bundle, dispatching a `sweep`
 * job's grid across them in contiguous chunks and reassembling the result
 * by each chunk's own `startIndex` -- not arrival order (§5.6's
 * determinism-under-parallelism principle, generalized here from MC
 * replicate-index reduction to sweep grid-index reduction).
 *
 * Deliberately DOM-agnostic: {@link WorkerLike}/{@link WorkerFactory} are
 * structural types this file defines itself (no "dom"/"webworker" lib
 * needed), so the real `new Worker(new URL(...))` construction -- which
 * does need a bundler + DOM lib to resolve/typecheck -- lives at the app
 * edge (`sweep-worker-factory.ts`) and is injected in here, keeping this
 * module (and its tests) runnable in plain Node with a fake `WorkerLike`.
 */

import {
  runOptimizeJob,
  type OptimizeIteration,
  type OptimizeJob,
  type OptimizeJobResult,
} from "./optimize-job.js";
import { runSweepRange, sweepPointCount, type SweepJob, type SweepResult } from "./sweep-job.js";

/**
 * The subset of the DOM `Worker` interface this pool needs -- structural,
 * not the real DOM type (see module docs for why). `postMessage` only ever
 * needs its single-argument form here: the pool only sends plain
 * JSON-serializable `SweepChunkRequest`s to a worker (no typed-array
 * transfer list on that side); the transferable `.buffer` optimization is
 * for the worker's *reply*, which goes through the real DOM `self.postMessage`
 * inside `sweep-worker-entry.ts`, not through this interface.
 */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Constructs one fresh {@link WorkerLike} (a real browser `Worker` at the app edge, or a fake for tests). */
export type WorkerFactory = () => WorkerLike;

/** One worker's assignment: run grid points `[startIndex, endIndex)` of `job`. */
export interface SweepChunkRequest {
  readonly kind: "sweep-chunk";
  readonly job: SweepJob;
  readonly startIndex: number;
  readonly endIndex: number;
}

/** A worker's reply to a {@link SweepChunkRequest}: the chunk's results, still tagged with its own `startIndex` so the pool can reassemble by grid position. */
export interface SweepChunkResponse {
  readonly kind: "sweep-chunk-result";
  readonly startIndex: number;
  readonly range: Float64Array;
  readonly apexHeight: Float64Array;
}

/**
 * A throttled interim progress report for one chunk (§5.6 "progress via
 * streamed messages (throttled)"; P3.40) -- `completed` is chunk-local
 * (out of that chunk's own `endIndex - startIndex`), not the full sweep's
 * total; `runSweep`'s `onProgress` option aggregates across every chunk.
 */
export interface SweepChunkProgress {
  readonly kind: "sweep-chunk-progress";
  readonly startIndex: number;
  readonly completed: number;
}

/** One worker's assignment: run `job` to convergence, streaming its iterations back. */
export interface OptimizeRequest {
  readonly kind: "optimize";
  readonly job: OptimizeJob;
}

/** One streamed Newton iteration, posted the moment the solver produces it (P5.18). */
export interface OptimizeIterationMessage {
  readonly kind: "optimize-iteration";
  readonly iteration: OptimizeIteration;
}

/** The terminal reply to an {@link OptimizeRequest}. */
export interface OptimizeResponse {
  readonly kind: "optimize-result";
  readonly result: OptimizeJobResult;
}

/** Raised by {@link WorkerPool.runOptimize} when its `signal` aborts. */
export class OptimizeCancelledError extends Error {
  constructor() {
    super("the optimize job was cancelled");
    this.name = "OptimizeCancelledError";
  }
}

/**
 * The abort surface {@link RunOptimizeOptions} needs — structural, like
 * {@link WorkerLike}, so this module keeps needing no DOM lib. A real
 * `AbortSignal` satisfies it.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface RunOptimizeOptions {
  /** Called for each Newton iteration as it arrives, oldest first. */
  readonly onIteration?: (iteration: OptimizeIteration) => void;
  /**
   * Cancels the solve. On abort the promise rejects with
   * {@link OptimizeCancelledError} — see {@link WorkerPool.runOptimize} for
   * why cancelling means terminating the worker rather than asking it to stop.
   */
  readonly signal?: AbortSignalLike;
}

export interface RunSweepOptions {
  /** Called with `(completed, total)` -- both full-sweep-wide counts -- as chunks report progress and as each chunk finishes. Best-effort: a chunk's interim reports are throttled (see {@link postSweepChunkResult}), so `completed` jumps in bursts rather than incrementing by exactly 1. */
  readonly onProgress?: (completed: number, total: number) => void;
}

export interface WorkerPool {
  /** Runs `job`'s full grid across the pool, one contiguous chunk per worker, and resolves once every chunk has returned. */
  runSweep(job: SweepJob, options?: RunSweepOptions): Promise<SweepResult>;
  /**
   * Runs one optimize job (P5.18) on a single worker, invoking
   * `options.onIteration` for each Newton iteration as it streams back.
   *
   * **It uses one worker rather than the pool, and that is inherent rather
   * than lazy.** Newton iteration `k + 1` starts from iteration `k`'s
   * iterate, so the solve is strictly sequential — there is nothing to fan
   * out. What the pool contributes is the same thing it contributes to a
   * sweep: the work is off the main thread, so the frame keeps rendering
   * while it runs.
   *
   * **Cancelling terminates that worker and replaces it.** A running solve is
   * a synchronous loop of trajectory integrations inside the worker's single
   * thread, so an incoming `postMessage` sits in a queue the worker will not
   * drain until it has finished — the one thing a cancel must not wait for.
   * The alternatives are a `SharedArrayBuffer` flag the loop polls (needs
   * cross-origin isolation, i.e. COOP/COEP response headers this app does not
   * set) or chunking the solve into macrotasks (restructures a solver that is
   * correct). Termination is immediate, needs neither, and the pool stays
   * usable afterwards because the slot is refilled from the same factory.
   */
  runOptimize(job: OptimizeJob, options?: RunOptimizeOptions): Promise<OptimizeJobResult>;
  /** Terminates every worker in the pool. Safe to call once the pool is no longer needed (e.g. a page/component teardown). */
  terminate(): void;
}

export interface WorkerPoolOptions {
  readonly createWorker: WorkerFactory;
  /**
   * Number of workers to spawn. This package has no DOM `navigator` to
   * default from (§5.6's `navigator.hardwareConcurrency - 1` is a
   * browser-only figure); the app edge is expected to pass it in. Defaults
   * to 1 (correct, just not parallel) if omitted.
   */
  readonly size?: number;
}

const DEFAULT_POOL_SIZE = 1;

/**
 * A pool of `options.size` long-lived workers, each spawned once (via
 * `options.createWorker`) and reused across every `runSweep` call rather
 * than per-job. v1 scope: exactly one job type (`sweep`); `mc`/
 * `convergence`/`optimize` (§5.6) are future extensions of the same
 * request/response shape, not this pool's concern yet.
 */
export function createWorkerPool(options: WorkerPoolOptions): WorkerPool {
  const size = Math.max(1, options.size ?? DEFAULT_POOL_SIZE);
  // Mutable, unlike v1's frozen array: cancelling an optimize job terminates
  // the worker it ran on (see WorkerPool.runOptimize) and puts a fresh one in
  // the slot, so the pool survives a cancel.
  const workers: WorkerLike[] = Array.from({ length: size }, () => options.createWorker());

  function terminate(): void {
    for (const worker of workers) worker.terminate();
  }

  function runOnWorker(
    worker: WorkerLike,
    request: SweepChunkRequest,
    onChunkProgress?: (completed: number) => void,
  ): Promise<SweepChunkResponse> {
    return new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        const data = event.data as SweepChunkResponse | SweepChunkProgress;
        if (data.kind === "sweep-chunk-progress") {
          onChunkProgress?.(data.completed);
          return;
        }
        resolve(data);
      };
      worker.onerror = (event) => reject(event);
      worker.postMessage(request);
    });
  }

  /** Chunk sizes for `total` points across `chunkCount` workers: as even as possible, the first `total % chunkCount` chunks one point larger. */
  function chunkBounds(
    total: number,
    chunkCount: number,
  ): ReadonlyArray<readonly [number, number]> {
    const baseSize = Math.floor(total / chunkCount);
    const remainder = total % chunkCount;
    const bounds: Array<readonly [number, number]> = [];
    let cursor = 0;
    for (let i = 0; i < chunkCount; i++) {
      const chunkSize = baseSize + (i < remainder ? 1 : 0);
      bounds.push([cursor, cursor + chunkSize]);
      cursor += chunkSize;
    }
    return bounds;
  }

  async function runSweep(job: SweepJob, options: RunSweepOptions = {}): Promise<SweepResult> {
    const total = sweepPointCount(job);
    const range = new Float64Array(total);
    const apexHeight = new Float64Array(total);

    if (total > 0) {
      const chunkCount = Math.min(size, total);
      const bounds = chunkBounds(total, chunkCount);
      const completedByChunk = new Array<number>(chunkCount).fill(0);

      function reportProgress(): void {
        if (!options.onProgress) return;
        let completed = 0;
        for (const n of completedByChunk) completed += n;
        options.onProgress(completed, total);
      }

      const chunks = await Promise.all(
        bounds.map(([startIndex, endIndex], i) =>
          runOnWorker(
            workers[i]!,
            { kind: "sweep-chunk", job, startIndex, endIndex },
            (completed) => {
              completedByChunk[i] = completed;
              reportProgress();
            },
          ).then((response) => {
            // A chunk's own progress reports are throttled (may never reach
            // its full size before the terminal result arrives); mark it
            // fully done here regardless, so the aggregate total is exact
            // once every chunk resolves, not dependent on throttling.
            completedByChunk[i] = endIndex - startIndex;
            reportProgress();
            return response;
          }),
        ),
      );
      for (const chunk of chunks) {
        range.set(chunk.range, chunk.startIndex);
        apexHeight.set(chunk.apexHeight, chunk.startIndex);
      }
    }

    return { thetaDegGrid: job.thetaDegGrid, v0Grid: job.v0Grid, range, apexHeight };
  }

  function runOptimize(
    job: OptimizeJob,
    optimizeOptions: RunOptimizeOptions = {},
  ): Promise<OptimizeJobResult> {
    const { onIteration, signal } = optimizeOptions;
    // Slot 0 by convention: an optimize solve is sequential (see the interface
    // docs), so it needs one worker, and the slot is what gets replaced if the
    // job is cancelled.
    const slot = 0;
    const worker = workers[slot]!;

    if (signal?.aborted) return Promise.reject(new OptimizeCancelledError());

    return new Promise<OptimizeJobResult>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        settled = true;
        worker.onmessage = null;
        worker.onerror = null;
        signal?.removeEventListener("abort", onAbort);
      };

      function onAbort(): void {
        if (settled) return;
        cleanup();
        // The worker is mid-solve and will not read another message until it
        // finishes, so stopping it means killing it. Replacing the slot
        // immediately keeps the pool's invariant -- `size` live workers --
        // true for whatever runs next.
        worker.terminate();
        workers[slot] = options.createWorker();
        reject(new OptimizeCancelledError());
      }

      worker.onmessage = (event) => {
        if (settled) return;
        const data = event.data as OptimizeIterationMessage | OptimizeResponse;
        if (data.kind === "optimize-iteration") {
          onIteration?.(data.iteration);
          return;
        }
        cleanup();
        resolve(data.result);
      };
      worker.onerror = (event) => {
        if (settled) return;
        cleanup();
        reject(event);
      };

      signal?.addEventListener("abort", onAbort);
      const request: OptimizeRequest = { kind: "optimize", job };
      worker.postMessage(request);
    });
  }

  return { runSweep, runOptimize, terminate };
}

/** Post a progress message at most once every this many completed points within a chunk -- "throttled" per §5.6. */
const PROGRESS_THROTTLE_POINTS = 8;

/**
 * Computes one chunk's result, optionally reporting progress as it goes
 * (chunk-local `completed`, per {@link runSweepRange}). Kept here (not
 * duplicated in the worker entry) so the request/response shape has
 * exactly one definition; {@link postSweepChunkResult} is the version a
 * real worker actually calls (adds throttled posting + the transfer list).
 */
export function handleSweepChunkRequest(
  request: SweepChunkRequest,
  onProgress?: (completed: number) => void,
): SweepChunkResponse {
  const size = request.endIndex - request.startIndex;
  const range = new Float64Array(size);
  const apexHeight = new Float64Array(size);
  runSweepRange(request.job, request.startIndex, request.endIndex, range, apexHeight, onProgress);
  return { kind: "sweep-chunk-result", startIndex: request.startIndex, range, apexHeight };
}

/**
 * The message handler a real `sweep-worker-entry.ts` (running inside an
 * actual Worker) wires to `self.onmessage`: computes `request`'s chunk,
 * posting a throttled {@link SweepChunkProgress} every
 * {@link PROGRESS_THROTTLE_POINTS} completed points (§5.6 "progress via
 * streamed messages (throttled)"; P3.40), then posts the final
 * {@link SweepChunkResponse} with its two `Float64Array`s' buffers as the
 * transfer list -- a genuine zero-copy transfer, not a structured-clone
 * copy (this task's validation criterion; see worker-pool.test.ts's
 * `node:worker_threads` `MessageChannel`-based proof). Returns the
 * response too, purely so a test can inspect the exact object that was
 * transferred (its buffers are detached as a side effect of `post`, by
 * design) -- the real worker entry ignores the return value.
 */
export function postSweepChunkResult(
  post: (message: unknown, transfer?: readonly ArrayBufferLike[]) => void,
  request: SweepChunkRequest,
): SweepChunkResponse {
  const size = request.endIndex - request.startIndex;
  const response = handleSweepChunkRequest(request, (completed) => {
    if (completed < size && completed % PROGRESS_THROTTLE_POINTS === 0) {
      post({ kind: "sweep-chunk-progress", startIndex: request.startIndex, completed });
    }
  });
  post(response, [response.range.buffer, response.apexHeight.buffer]);
  return response;
}

/**
 * The message handler a real `optimize-worker-entry.ts` wires to
 * `self.onmessage`: runs `request.job`, posting an
 * {@link OptimizeIterationMessage} for every Newton iteration as it happens
 * and an {@link OptimizeResponse} at the end.
 *
 * **Iterations are not throttled, unlike a sweep chunk's progress.** A sweep
 * reports thousands of grid points and would flood the channel, hence
 * {@link PROGRESS_THROTTLE_POINTS}. A Newton solve's whole point is that it
 * takes a handful of iterations — `maxIterations` defaults to 20 — and each
 * one is a datum the convergence trace plots rather than a progress tick, so
 * dropping any of them would put holes in the very thing being streamed.
 *
 * No transfer list: an {@link OptimizeIteration} is small plain objects and
 * numbers, with no typed array to hand over.
 */
export function postOptimizeResult(
  post: (message: unknown) => void,
  request: OptimizeRequest,
): OptimizeJobResult {
  const result = runOptimizeJob(request.job, (iteration) => {
    post({ kind: "optimize-iteration", iteration } satisfies OptimizeIterationMessage);
  });
  post({ kind: "optimize-result", result } satisfies OptimizeResponse);
  return result;
}
