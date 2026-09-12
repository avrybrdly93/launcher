/**
 * Heterogeneous executor (P7.10): one ensemble job spec, dispatched in
 * contiguous chunks across a set of interchangeable backends -- TypeScript,
 * WASM, or a worker carrying either -- and reassembled by each chunk's own
 * `startIndex`.
 *
 * **The scheduler is the deliverable; a backend is an interface, not a
 * branch.** The task's title names a worker-pool scheduler and its validation
 * line names the end: "same job spec runs on both; results within stated FP
 * tolerance". Those meet in one place -- {@link EnsembleBackend} -- and once a
 * backend is an object with a `runRange`, "run it on a worker" stops being a
 * second dispatch path inside the scheduler and becomes
 * {@link createWorkerEnsembleBackend}, one implementation among others. The
 * scheduler never learns which kind it is holding.
 *
 * **THE STATED FP TOLERANCE IS ZERO ULP.** Not "1e-12", not `toBeCloseTo`.
 * P7.07 measured the TypeScript stepper and the scalar WASM kernel at 0 ULP
 * over this model, and P7.09 measured the scalar and SIMD kernels at 0 ULP over
 * the batch path; the composition is bit-identity, so that is what
 * {@link ENSEMBLE_BACKEND_TOLERANCE_ULP} states and what
 * `heterogeneous-executor.test.ts` asserts under `Object.is`. A tolerance
 * adopted before a divergence was measured would hide exactly what P7.11's
 * golden suite exists to find. If a divergence ever *is* measured, it is a
 * finding to report and root-cause, not a bound to widen.
 *
 * **Reassembly is by index and never by arrival order** (§2.1 §5.6's
 * determinism-under-parallelism rule, the same one `worker-pool.ts`'s sweep
 * path follows). Two consequences that are tested rather than asserted: the
 * observables of a job do not depend on how it was partitioned, and they do not
 * depend on which backend ran which chunk.
 */

import {
  ENSEMBLE_DIM,
  ENSEMBLE_OBS_COUNT,
  ENSEMBLE_PARAM_COUNT,
  lowerEnsembleRange,
  runTsEnsembleRange,
  validateEnsembleJob,
  type EnsembleJobSpec,
} from "./ensemble-job.js";
import { partitionReplicates } from "./batch-throughput.js";
import type { WorkerLike } from "./worker-pool.js";
// Type-only, deliberately: a value import would pull `wasm-rk4-backend.ts` --
// and its `node:fs/promises` import, which exists to read the committed
// artifact from disk -- into every browser bundle that touches this package.
// `.dependency-cruiser.cjs` still has to allow runtime -> wasm-core for it,
// because `tsPreCompilationDeps` sees type imports; that entry is P7.10's, and
// the comment in that file has anticipated it since P7.07.
import type { WasmRk4Kernel } from "@ballista/wasm-core";

/**
 * The floating-point tolerance backends are held to, in ULP.
 *
 * Zero. See this module's header for why it is stated rather than discovered,
 * and `ROADMAP.json`'s P7.10 notes for the two measurements it composes.
 */
export const ENSEMBLE_BACKEND_TOLERANCE_ULP = 0;

/** One chunk's result, still carrying the grid position it belongs at. */
export interface EnsembleChunk {
  readonly startIndex: number;
  /** `(endIndex - startIndex) * ENSEMBLE_OBS_COUNT` observables, row-major. */
  readonly rows: Float64Array;
}

/**
 * A thing that can integrate a contiguous range of an ensemble.
 *
 * `runRange` returns the range's rows **plus the `startIndex` it was given**,
 * rather than just the rows. That is not redundancy: it is what lets the
 * scheduler place a chunk by its own position instead of by the order its
 * promise settled, and it is what makes "reassembled by arrival order" a defect
 * a test can inject (it is one of this task's negative controls).
 */
export interface EnsembleBackend {
  /** Stable identifier, surfaced in {@link EnsembleAssignment} so a run can be shown to have been heterogeneous. */
  readonly id: string;
  runRange(job: EnsembleJobSpec, startIndex: number, endIndex: number): Promise<EnsembleChunk>;
}

/** Which backend ran which replicates. Empty chunks are not dispatched and do not appear. */
export interface EnsembleAssignment {
  readonly chunkIndex: number;
  readonly backendId: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

/** A completed run: the observables, and the record of how they were produced. */
export interface EnsembleRunReport {
  /** `replicates * ENSEMBLE_OBS_COUNT`, row-major. */
  readonly observables: Float64Array;
  readonly assignments: readonly EnsembleAssignment[];
}

export interface HeterogeneousExecutorOptions {
  /** At least one backend. Chunk `i` goes to `backends[assign(i, backends.length)]`. */
  readonly backends: readonly EnsembleBackend[];
  /**
   * How many contiguous chunks to split a job into. Defaults to the backend
   * count, which is the partition that uses every backend exactly once.
   *
   * More chunks than replicates yields empty trailing chunks, which are
   * skipped rather than dispatched -- an empty chunk is a backend with nothing
   * to do, which is a scheduling fact and not an error (the same reading
   * `partitionReplicates` already takes).
   */
  readonly chunks?: number;
  /**
   * Chunk-to-backend assignment. Defaults to round-robin, so a two-backend
   * executor genuinely alternates rather than sending everything to the first.
   *
   * Injectable because it is the knob the equivalence tests turn: the same job
   * run all-TS, all-WASM and alternating must produce bit-identical
   * observables, and that is only checkable if the assignment can be stated.
   */
  readonly assign?: (chunkIndex: number, backendCount: number) => number;
}

export interface HeterogeneousExecutor {
  run(job: EnsembleJobSpec): Promise<EnsembleRunReport>;
}

const roundRobin = (chunkIndex: number, backendCount: number): number => chunkIndex % backendCount;

/**
 * Builds the scheduler.
 *
 * Chunks are dispatched concurrently and awaited together: a backend may be a
 * worker or a WASM instance whose `runRange` genuinely yields, and serialising
 * them would make a two-backend executor slower than either backend alone for
 * no correctness gain. Nothing about the result depends on the order they
 * settle in -- see the module header.
 */
export function createHeterogeneousExecutor(
  options: HeterogeneousExecutorOptions,
): HeterogeneousExecutor {
  const { backends } = options;
  if (backends.length === 0) {
    throw new Error("createHeterogeneousExecutor: needs at least one backend");
  }
  const chunkCount = options.chunks ?? backends.length;
  if (!Number.isInteger(chunkCount) || chunkCount < 1) {
    throw new Error(
      `createHeterogeneousExecutor: chunks must be a positive integer, got ${chunkCount}`,
    );
  }
  const assign = options.assign ?? roundRobin;

  async function run(job: EnsembleJobSpec): Promise<EnsembleRunReport> {
    validateEnsembleJob(job);

    const total = job.replicates.length;
    const observables = new Float64Array(total * ENSEMBLE_OBS_COUNT);
    if (total === 0) return { observables, assignments: [] };

    const assignments: EnsembleAssignment[] = [];
    const pending: Promise<EnsembleChunk>[] = [];

    partitionReplicates(total, chunkCount).forEach((chunk, chunkIndex) => {
      if (chunk.endIndex <= chunk.startIndex) return;
      const slot = assign(chunkIndex, backends.length);
      const backend = backends[slot];
      if (backend === undefined) {
        throw new RangeError(
          `createHeterogeneousExecutor: assign() returned ${slot} for chunk ${chunkIndex}, ` +
            `outside [0, ${backends.length})`,
        );
      }
      assignments.push({
        chunkIndex,
        backendId: backend.id,
        startIndex: chunk.startIndex,
        endIndex: chunk.endIndex,
      });
      pending.push(backend.runRange(job, chunk.startIndex, chunk.endIndex));
    });

    const results = await Promise.all(pending);
    for (const result of results) {
      // By `result.startIndex`, not by the loop index: see the module header.
      observables.set(result.rows, result.startIndex * ENSEMBLE_OBS_COUNT);
    }
    return { observables, assignments };
  }

  return { run };
}

/** The pure-TypeScript backend: `ClassicalRK4Stepper` over the planar projectile model. */
export function createTsEnsembleBackend(id = "ts"): EnsembleBackend {
  return {
    id,
    runRange(job, startIndex, endIndex) {
      return Promise.resolve({
        startIndex,
        rows: runTsEnsembleRange(job, startIndex, endIndex),
      });
    },
  };
}

/**
 * The WASM backend, over an already-instantiated kernel.
 *
 * **The kernel is injected rather than instantiated here, for the same reason
 * `worker-pool.ts` takes a `WorkerFactory`**: obtaining one means reading a
 * committed `.wasm` off disk (Node) or fetching it (browser), and this package
 * is DOM-free and bundler-agnostic by construction. `WasmRk4Kernel.
 * instantiateBest()` already picks the SIMD artifact where the engine supports
 * it, so backend selection is the caller's one-line decision and not a second
 * feature detect in here.
 *
 * `batchInit` is called lazily and only when a chunk needs more capacity than
 * is reserved, because it is the one call that can grow linear memory -- which
 * detaches every view the kernel holds and preserves no arena contents. Growing
 * once for the largest chunk and never again is the documented way to use it.
 *
 * **`runRange` reaches its `return` without an `await`, and that is an
 * invariant rather than an accident.** One kernel has one arena, the scheduler
 * dispatches chunks concurrently, and a suspension point anywhere between
 * `lowerEnsembleRange` and the `slice` would let a second chunk overwrite the
 * parameters of the first between its write and its read. The promise is
 * `Promise.resolve` over already-computed rows for exactly that reason. Two
 * chunks may safely share a kernel only while that holds; if a future backend
 * needs to await (a worker, a GPU queue), give it its own kernel instead of
 * adding a lock.
 */
export function createWasmEnsembleBackend(kernel: WasmRk4Kernel, id = "wasm"): EnsembleBackend {
  if (kernel.obsCount !== ENSEMBLE_OBS_COUNT) {
    throw new Error(
      `createWasmEnsembleBackend: kernel reports ${kernel.obsCount} observable slots, ` +
        `this package's ENSEMBLE_OBS describes ${ENSEMBLE_OBS_COUNT}`,
    );
  }
  return {
    id,
    runRange(job, startIndex, endIndex) {
      const n = Math.max(0, endIndex - startIndex);
      if (n === 0) return Promise.resolve({ startIndex, rows: new Float64Array(0) });

      if (kernel.batchCapacity < n) kernel.batchInit(n);
      // Re-read the views after any possible grow: a reference cached across
      // `batchInit` is detached, and writes to it go nowhere.
      lowerEnsembleRange(job, startIndex, endIndex, kernel.batchParams, kernel.batchStates);
      kernel.batchRun(job.t0, job.h, job.steps, n);
      // Copied out rather than handed back as a view: the arena is reused by
      // the next chunk, so a view would be overwritten before the caller read
      // it -- and `observables.set` on a live view would be copying from
      // memory the next `batchRun` is about to touch.
      const rows = kernel.batchObservables.slice(0, n * ENSEMBLE_OBS_COUNT);
      return Promise.resolve({ startIndex, rows });
    },
  };
}

/** Sent to a worker that carries an ensemble backend. Plain numbers: structured-cloneable as-is. */
export interface EnsembleChunkRequest {
  readonly kind: "ensemble-chunk";
  readonly job: EnsembleJobSpec;
  readonly startIndex: number;
  readonly endIndex: number;
}

/** A worker's reply, still tagged with its own `startIndex`. */
export interface EnsembleChunkResponse {
  readonly kind: "ensemble-chunk-result";
  readonly startIndex: number;
  readonly rows: Float64Array;
}

/**
 * Runs one chunk request against `backend`. The worker side's whole body, kept
 * here so the request/response shape has exactly one definition -- the same
 * arrangement `handleSweepChunkRequest` has for sweeps.
 */
export async function handleEnsembleChunkRequest(
  request: EnsembleChunkRequest,
  backend: EnsembleBackend,
): Promise<EnsembleChunkResponse> {
  const chunk = await backend.runRange(request.job, request.startIndex, request.endIndex);
  return { kind: "ensemble-chunk-result", startIndex: chunk.startIndex, rows: chunk.rows };
}

/**
 * What a real ensemble worker entry wires to `self.onmessage`: runs the chunk
 * and posts the result with its `Float64Array`'s buffer in the transfer list --
 * a genuine zero-copy handover rather than a structured-clone copy, exactly as
 * `postSweepChunkResult` does.
 *
 * Returns the response too, purely so a test can inspect the object that was
 * transferred; its buffer is detached as a side effect of `post`, by design.
 */
export async function postEnsembleChunkResult(
  post: (message: unknown, transfer?: readonly ArrayBufferLike[]) => void,
  request: EnsembleChunkRequest,
  backend: EnsembleBackend,
): Promise<EnsembleChunkResponse> {
  const response = await handleEnsembleChunkRequest(request, backend);
  post(response, [response.rows.buffer]);
  return response;
}

/**
 * Wraps a worker as a backend, so the scheduler dispatches to it through the
 * same `runRange` it uses for an in-process backend.
 *
 * **One chunk in flight at a time, enforced rather than assumed.** `WorkerLike`
 * has a single `onmessage` slot, so a second concurrent request would overwrite
 * the first one's handler and silently strand it. The executor never does that
 * -- it gives each chunk its own backend slot -- but a caller reusing one
 * worker-backed backend for two chunks would, and a rejected promise says so
 * where a lost one would not.
 *
 * Which backend the worker actually carries is the worker entry's decision (see
 * {@link postEnsembleChunkResult}); this side only knows it is talking to one.
 * That is the seam P7.12 would widen if wasm threads ever land.
 */
export function createWorkerEnsembleBackend(worker: WorkerLike, id = "worker"): EnsembleBackend {
  let busy = false;
  return {
    id,
    runRange(job, startIndex, endIndex) {
      if (busy) {
        return Promise.reject(
          new Error(
            `createWorkerEnsembleBackend(${id}): a chunk is already in flight; ` +
              "give each concurrent chunk its own worker-backed backend",
          ),
        );
      }
      busy = true;
      return new Promise<EnsembleChunk>((resolve, reject) => {
        const settle = (): void => {
          busy = false;
          worker.onmessage = null;
          worker.onerror = null;
        };
        worker.onmessage = (event) => {
          const data = event.data as EnsembleChunkResponse;
          settle();
          resolve({ startIndex: data.startIndex, rows: data.rows });
        };
        worker.onerror = (event) => {
          settle();
          reject(event instanceof Error ? event : new Error(String(event)));
        };
        const request: EnsembleChunkRequest = { kind: "ensemble-chunk", job, startIndex, endIndex };
        worker.postMessage(request);
      });
    },
  };
}

/**
 * Bytes one chunk of `n` replicates occupies in the kernel's arena.
 *
 * Exported so a caller sizing a batch can see the cost before calling
 * `batchInit`, which is the only thing that can grow linear memory.
 */
export function ensembleArenaBytes(n: number): number {
  return n * (ENSEMBLE_PARAM_COUNT + ENSEMBLE_DIM + ENSEMBLE_OBS_COUNT) * 8;
}
