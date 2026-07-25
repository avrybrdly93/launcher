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

export interface WorkerPool {
  /** Runs `job`'s full grid across the pool, one contiguous chunk per worker, and resolves once every chunk has returned. */
  runSweep(job: SweepJob): Promise<SweepResult>;
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
  const workers: readonly WorkerLike[] = Array.from({ length: size }, () => options.createWorker());

  function terminate(): void {
    for (const worker of workers) worker.terminate();
  }

  function runOnWorker(
    worker: WorkerLike,
    request: SweepChunkRequest,
  ): Promise<SweepChunkResponse> {
    return new Promise((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data as SweepChunkResponse);
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

  async function runSweep(job: SweepJob): Promise<SweepResult> {
    const total = sweepPointCount(job);
    const range = new Float64Array(total);
    const apexHeight = new Float64Array(total);

    if (total > 0) {
      const chunkCount = Math.min(size, total);
      const bounds = chunkBounds(total, chunkCount);
      const chunks = await Promise.all(
        bounds.map(([startIndex, endIndex], i) =>
          runOnWorker(workers[i]!, { kind: "sweep-chunk", job, startIndex, endIndex }),
        ),
      );
      for (const chunk of chunks) {
        range.set(chunk.range, chunk.startIndex);
        apexHeight.set(chunk.apexHeight, chunk.startIndex);
      }
    }

    return { thetaDegGrid: job.thetaDegGrid, v0Grid: job.v0Grid, range, apexHeight };
  }

  return { runSweep, terminate };
}

/**
 * The message handler a real `sweep-worker-entry.ts` (running inside an
 * actual Worker) wires to `self.onmessage`: computes one chunk in-place
 * and returns the response object a caller should `postMessage` back
 * (with `range.buffer`/`apexHeight.buffer` as the transfer list). Kept
 * here (not duplicated in the worker entry) so the request/response shape
 * has exactly one definition.
 */
export function handleSweepChunkRequest(request: SweepChunkRequest): SweepChunkResponse {
  const size = request.endIndex - request.startIndex;
  const range = new Float64Array(size);
  const apexHeight = new Float64Array(size);
  runSweepRange(request.job, request.startIndex, request.endIndex, range, apexHeight);
  return { kind: "sweep-chunk-result", startIndex: request.startIndex, range, apexHeight };
}
