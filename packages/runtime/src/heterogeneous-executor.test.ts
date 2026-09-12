import { MessageChannel } from "node:worker_threads";
import {
  GravityForce,
  QuadraticDragForce,
  createEvalContext,
  createPlanarProjectileModel,
} from "@ballista/engine";
import { ClassicalRK4Stepper, RK4_TABLEAU, createStepResult } from "@ballista/solverkit";
import { OBS, PARAM, WasmRk4Kernel, wasmSimdSupported } from "@ballista/wasm-core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { partitionReplicates } from "./batch-throughput.js";
import {
  ENSEMBLE_OBS,
  ENSEMBLE_OBS_COUNT,
  ENSEMBLE_PARAM,
  ENSEMBLE_PARAM_COUNT,
  ensembleEnvironment,
  ensembleReplicateParams,
  runTsEnsembleRange,
  type EnsembleJobSpec,
  type EnsembleReplicate,
} from "./ensemble-job.js";
import {
  ENSEMBLE_BACKEND_TOLERANCE_ULP,
  createHeterogeneousExecutor,
  createTsEnsembleBackend,
  createWasmEnsembleBackend,
  createWorkerEnsembleBackend,
  postEnsembleChunkResult,
  type EnsembleBackend,
  type EnsembleChunkRequest,
  type EnsembleChunkResponse,
} from "./heterogeneous-executor.js";
import type { WorkerLike } from "./worker-pool.js";

/**
 * P7.10's validation criterion: "same job spec runs on both; results within
 * stated FP tolerance".
 *
 * **The stated tolerance is zero ULP, and it was stated in the claim commit
 * before anything was measured.** P7.07 measured the TypeScript stepper and the
 * scalar WASM kernel bit-identical over this model; P7.09 measured the scalar
 * and SIMD kernels bit-identical over the batch path. The composition is
 * bit-identity, so these assertions are `Object.is` on raw doubles rather than
 * `toBeCloseTo`. P7.07's own finding was that a 1e-15 tolerance would have
 * passed a kernel whose final increment had been reassociated; a tolerance
 * adopted here for comfort would be the same mistake with more hindsight
 * available.
 *
 * **An executor is not exercised by running each backend separately.** The
 * central test below runs ONE job split across BOTH backends in a single run
 * and requires the mixed result to be bit-identical to the all-TS and the
 * all-WASM result. Running them apart and comparing would test two backends;
 * it would not test a scheduler.
 *
 * **Five negative controls run before the green is believed**, in the pattern
 * the 89th-93rd runs established: three broken backends (RK4's final increment
 * accumulated rather than summed-then-scaled, an accumulated `t_final`, a
 * running max that skips the initial state) and two broken schedulers
 * (reassembly in settle order, a dropped chunk). Each must make the suite red,
 * and the counts are recorded in `ROADMAP.json`.
 *
 * A sixth was drafted and **could not fail**, which is recorded here rather
 * than deleted: swapping gravity and drag reorders the only two summands in
 * `forceAccum`, and two-operand IEEE-754 addition is commutative, so it is
 * bit-identical. It is kept below as a positive assertion of that fact.
 */

/**
 * Odd on purpose. `batchRunSimd` processes replicates in pairs and sends the
 * last one of an odd `n` through the scalar path's own per-replicate body, so
 * an even count would leave that tail untested -- and the uneven chunking below
 * makes several chunks odd too.
 */
const REPLICATES = 257;

/**
 * A deterministic, genuinely heterogeneous ensemble. Not seeded-random: a
 * failing run has to be reproducible from this file alone.
 *
 * Mass, radius and `Cd` all vary, which is what makes a backend that runs the
 * whole ensemble with replicate 0's projectile visible. `vy0` spans -14 to +38
 * so the ensemble contains replicates that only ever fall (their
 * `maxSampledHeight` is their launch height), replicates that turn over inside
 * the window, and replicates still climbing at the end. Without that spread the
 * running-max slot degrades to "final y equals final y" and would pass a kernel
 * that never tracked a maximum -- which is exactly how P7.08's version of this
 * test survived its first control run.
 */
function replicate(r: number): EnsembleReplicate {
  return {
    mass: 0.145 * (1 + (r % 97) / 500),
    radius: 0.0366 * (1 + (r % 17) / 400),
    dragCoefficient: 0.47 * (1 + (r % 31) / 200),
    x0: 0,
    y0: 1.5 + (r % 13) * 0.25,
    vx0: 40 + (r % 71) * 0.5,
    vy0: -14 + (r % 53) * 1,
  };
}

/**
 * `h` is deliberately not a power of two and `t0` is non-zero.
 *
 * A dyadic step would make `t0 + i*h` and an accumulated `t` the same double
 * for every `i`, so the "multiply, don't accumulate" contract both sides
 * implement would be untestable -- control C below would pass a broken
 * backend. A non-zero `t0` is the second half of that: the model here is
 * time-independent, so `t0` must move `t_final` and must move nothing else.
 */
const JOB: EnsembleJobSpec = {
  t0: 0.25,
  h: 0.0071,
  steps: 128,
  gravity: 9.79,
  windX: 3.5,
  windY: -1.25,
  replicates: Array.from({ length: REPLICATES }, (_, r) => replicate(r)),
};

interface Divergence {
  readonly replicate: number;
  readonly slot: number;
  readonly left: number;
  readonly right: number;
}

/**
 * The first slot at which two observable blocks differ, or `undefined`.
 *
 * `Object.is` rather than `===` so a `-0`/`+0` divergence is caught rather than
 * compared equal, and so two NaNs compare equal instead of silently passing.
 * Reporting the first divergence rather than asserting per slot keeps a
 * 257x6 comparison to one `expect` -- and names where it went wrong, which a
 * bare `toEqual` on 1542 doubles does not.
 */
function firstDivergence(left: Float64Array, right: Float64Array): Divergence | undefined {
  if (left.length !== right.length) {
    throw new Error(`length mismatch: ${left.length} vs ${right.length}`);
  }
  for (let i = 0; i < left.length; i++) {
    if (!Object.is(left[i], right[i])) {
      return {
        replicate: Math.floor(i / ENSEMBLE_OBS_COUNT),
        slot: i % ENSEMBLE_OBS_COUNT,
        left: left[i]!,
        right: right[i]!,
      };
    }
  }
  return undefined;
}

/** Runs `job` end-to-end on a single backend, as the one-chunk reference. */
async function runWhole(backend: EnsembleBackend, job: EnsembleJobSpec): Promise<Float64Array> {
  const { observables } = await createHeterogeneousExecutor({
    backends: [backend],
    chunks: 1,
  }).run(job);
  return observables;
}

/**
 * Delays a backend's resolution by `ticks` microtasks, *after* its work is
 * done.
 *
 * Two properties matter. The inner `runRange` runs to completion before the
 * delay, so a WASM backend wrapped in this still reaches its `return` without a
 * suspension point inside the arena (see `createWasmEnsembleBackend`). And the
 * delay is what makes chunks settle in an order unrelated to their position --
 * the only condition under which placing a chunk by its own `startIndex` and
 * placing it at a running cursor are distinguishable operations.
 */
function withSettleDelay(backend: EnsembleBackend, ticks: number): EnsembleBackend {
  return {
    id: `${backend.id}+${ticks}`,
    async runRange(job, startIndex, endIndex) {
      const chunk = await backend.runRange(job, startIndex, endIndex);
      for (let i = 0; i < ticks; i++) await Promise.resolve();
      return chunk;
    },
  };
}

let scalarKernel: WasmRk4Kernel;
let bestKernel: WasmRk4Kernel;
let tsBackend: EnsembleBackend;
let wasmScalarBackend: EnsembleBackend;
let wasmBestBackend: EnsembleBackend;
let tsReference: Float64Array;

beforeAll(async () => {
  scalarKernel = await WasmRk4Kernel.instantiate();
  bestKernel = await WasmRk4Kernel.instantiateBest();
  tsBackend = createTsEnsembleBackend();
  wasmScalarBackend = createWasmEnsembleBackend(scalarKernel, {
    id: "wasm-scalar",
    useSimd: false,
  });
  wasmBestBackend = createWasmEnsembleBackend(bestKernel, { id: "wasm-best" });
  tsReference = await runWhole(tsBackend, JOB);
});

describe("the fixture is not vacuous", () => {
  it("gives every adjacent replicate pair a different answer", () => {
    // Correct numbers in the wrong rows are invisible against a homogeneous
    // ensemble, and a chunk placed at the wrong start index is exactly that
    // defect. Nothing below means anything unless this holds.
    let identicalPairs = 0;
    for (let r = 0; r + 1 < REPLICATES; r++) {
      const a = tsReference.subarray(r * ENSEMBLE_OBS_COUNT, (r + 1) * ENSEMBLE_OBS_COUNT);
      const b = tsReference.subarray((r + 1) * ENSEMBLE_OBS_COUNT, (r + 2) * ENSEMBLE_OBS_COUNT);
      if (firstDivergence(Float64Array.from(a), Float64Array.from(b)) === undefined) {
        identicalPairs++;
      }
    }
    expect(identicalPairs).toBe(0);
  });

  it("contains replicates that peak inside the window and replicates that never rise", () => {
    let peaked = 0;
    let neverRose = 0;
    for (let r = 0; r < REPLICATES; r++) {
      const o = r * ENSEMBLE_OBS_COUNT;
      const max = tsReference[o + ENSEMBLE_OBS.maxSampledHeight]!;
      if (max > tsReference[o + ENSEMBLE_OBS.y]!) peaked++;
      if (max === JOB.replicates[r]!.y0) neverRose++;
    }
    expect(peaked).toBeGreaterThan(REPLICATES / 10);
    expect(neverRose).toBeGreaterThan(0);
  });

  it("produces no all-zero row, so an unwritten range cannot pass as a result", () => {
    // P7.09's control D lesson one level out: a comparison that only looks
    // where output is expected cannot see where none was written. An executor
    // that dropped a chunk leaves its rows at the Float64Array's zero fill,
    // and a spot check of the written rows would never notice.
    let blankRows = 0;
    for (let r = 0; r < REPLICATES; r++) {
      const row = tsReference.subarray(r * ENSEMBLE_OBS_COUNT, (r + 1) * ENSEMBLE_OBS_COUNT);
      if (row.every((v) => v === 0)) blankRows++;
    }
    expect(blankRows).toBe(0);
  });
});

describe("the mirrored kernel constants still agree with the kernel", () => {
  // ensemble-job.ts restates PARAM/OBS rather than value-importing them, to
  // keep node:fs/promises out of every browser bundle that touches this
  // package. That is only safe while the restatement is pinned.
  it("ENSEMBLE_PARAM is the kernel's own PARAM", () => {
    expect({ ...ENSEMBLE_PARAM }).toEqual({ ...PARAM });
  });

  it("ENSEMBLE_OBS is the kernel's own OBS", () => {
    expect({ ...ENSEMBLE_OBS }).toEqual({ ...OBS });
  });

  it("the slot counts match the instantiated module's own exports", () => {
    expect(scalarKernel.obsCount).toBe(ENSEMBLE_OBS_COUNT);
    expect(scalarKernel.params.length).toBe(ENSEMBLE_PARAM_COUNT);
    expect(Object.keys(ENSEMBLE_PARAM).length).toBe(ENSEMBLE_PARAM_COUNT);
    expect(Object.keys(ENSEMBLE_OBS).length).toBe(ENSEMBLE_OBS_COUNT);
  });
});

describe("the same job spec runs on both backends (P7.10 validation criterion)", () => {
  it("states its tolerance as zero ULP", () => {
    expect(ENSEMBLE_BACKEND_TOLERANCE_ULP).toBe(0);
  });

  it("TS and scalar WASM agree on every slot of every replicate, bit for bit", async () => {
    const wasm = await runWhole(wasmScalarBackend, JOB);
    expect(firstDivergence(tsReference, wasm)).toBeUndefined();
    expect(wasm.length).toBe(REPLICATES * ENSEMBLE_OBS_COUNT);
  });

  it("TS and the best available WASM artifact agree on every slot of every replicate", async () => {
    // Separate from the scalar comparison on purpose. Where simd128 is
    // available this is TS vs the f64x2 path and is a second measurement; where
    // it is not, `instantiateBest` hands back the scalar module and this
    // repeats the first. The reported `hasSimd` says which happened, so a run
    // that quietly lost its SIMD artifact is visible rather than green.
    expect(bestKernel.hasSimd).toBe(wasmSimdSupported());
    const wasm = await runWhole(wasmBestBackend, JOB);
    expect(firstDivergence(tsReference, wasm)).toBeUndefined();
  });

  it("agrees on a zero-step window, where the observables are the initial state", async () => {
    const spec = { ...JOB, steps: 0 };
    const ts = await runWhole(tsBackend, spec);
    const wasm = await runWhole(wasmScalarBackend, spec);
    expect(firstDivergence(ts, wasm)).toBeUndefined();
    expect(ts[ENSEMBLE_OBS.tFinal]).toBe(spec.t0);
  });

  it("agrees on a single-replicate job, where no chunking happens at all", async () => {
    const spec = { ...JOB, replicates: [replicate(3)] };
    expect(
      firstDivergence(await runWhole(tsBackend, spec), await runWhole(wasmScalarBackend, spec)),
    ).toBeUndefined();
  });
});

describe("one job, split across both backends in a single run", () => {
  it("is bit-identical to running it entirely on either one", async () => {
    const executor = createHeterogeneousExecutor({
      backends: [tsBackend, wasmScalarBackend],
      chunks: 7,
    });
    const { observables, assignments } = await executor.run(JOB);

    // The run really was heterogeneous, rather than merely configured to be.
    const ids = new Set(assignments.map((a) => a.backendId));
    expect(ids).toEqual(new Set(["ts", "wasm-scalar"]));
    expect(assignments.length).toBe(7);

    expect(firstDivergence(tsReference, observables)).toBeUndefined();
    expect(firstDivergence(await runWhole(wasmScalarBackend, JOB), observables)).toBeUndefined();
  });

  it("covers every replicate exactly once, contiguously and without gaps", async () => {
    const { assignments } = await createHeterogeneousExecutor({
      backends: [tsBackend, wasmScalarBackend],
      chunks: 7,
    }).run(JOB);
    const ordered = [...assignments].sort((a, b) => a.startIndex - b.startIndex);
    expect(ordered[0]!.startIndex).toBe(0);
    expect(ordered[ordered.length - 1]!.endIndex).toBe(REPLICATES);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!.startIndex).toBe(ordered[i - 1]!.endIndex);
    }
  });

  it("gives the same answer under every partition, from one chunk to more chunks than backends", async () => {
    for (const chunks of [1, 2, 3, 8, 16, 64]) {
      const { observables } = await createHeterogeneousExecutor({
        backends: [tsBackend, wasmScalarBackend],
        chunks,
      }).run(JOB);
      expect(firstDivergence(tsReference, observables)).toBeUndefined();
    }
  });

  it("gives the same answer whichever backend a chunk lands on", async () => {
    // Same partition, three different assignments: all-TS, all-WASM, and the
    // reverse of the round-robin. If any chunk's answer depended on who ran it,
    // these would not all be the same bytes.
    const backends = [tsBackend, wasmScalarBackend];
    const results = await Promise.all(
      [() => 0, () => 1, (chunkIndex: number) => (chunkIndex + 1) % 2].map((assign) =>
        createHeterogeneousExecutor({ backends, chunks: 5, assign }).run(JOB),
      ),
    );
    for (const { observables } of results) {
      expect(firstDivergence(tsReference, observables)).toBeUndefined();
    }
  });

  it("places each chunk at its own index even when later chunks settle first", async () => {
    // The three delays make the settle order a genuine permutation of the
    // dispatch order (chunks 2 and 5 land first, then 1 and 4, then 0 and 3),
    // which is the only condition under which "write at the chunk's own
    // startIndex" and "write at a running cursor" are different operations at
    // all. Substitution S3 in `ROADMAP.json`'s P7.10 notes records what
    // happens to this suite without it.
    const { observables, assignments } = await createHeterogeneousExecutor({
      backends: [
        withSettleDelay(tsBackend, 12),
        withSettleDelay(wasmScalarBackend, 6),
        withSettleDelay(tsBackend, 0),
      ],
      chunks: 6,
    }).run(JOB);
    expect(firstDivergence(tsReference, observables)).toBeUndefined();
    expect(assignments.length).toBe(6);
  });

  it("skips empty chunks rather than dispatching them", async () => {
    const spec = { ...JOB, replicates: JOB.replicates.slice(0, 3) };
    const counted: EnsembleBackend = {
      id: "counted",
      runRange: vi.fn(tsBackend.runRange),
    };
    const { assignments } = await createHeterogeneousExecutor({
      backends: [counted],
      chunks: 10,
    }).run(spec);
    expect(assignments.length).toBe(3);
    expect(counted.runRange).toHaveBeenCalledTimes(3);
  });

  it("resolves an empty ensemble without dispatching anything", async () => {
    const never: EnsembleBackend = {
      id: "never",
      runRange: vi.fn(() => Promise.reject(new Error("dispatched an empty job"))),
    };
    const { observables, assignments } = await createHeterogeneousExecutor({
      backends: [never],
    }).run({ ...JOB, replicates: [] });
    expect(observables.length).toBe(0);
    expect(assignments).toEqual([]);
    expect(never.runRange).not.toHaveBeenCalled();
  });

  it("validates the spec once, before any chunk is dispatched", async () => {
    const never: EnsembleBackend = {
      id: "never",
      runRange: vi.fn(() => Promise.reject(new Error("dispatched an invalid job"))),
    };
    await expect(
      createHeterogeneousExecutor({ backends: [never] }).run({ ...JOB, h: -1 }),
    ).rejects.toThrow(/h must be finite and positive/);
    expect(never.runRange).not.toHaveBeenCalled();
  });

  it("rejects a configuration it cannot schedule", async () => {
    expect(() => createHeterogeneousExecutor({ backends: [] })).toThrow(/at least one backend/);
    expect(() => createHeterogeneousExecutor({ backends: [tsBackend], chunks: 0 })).toThrow(
      /positive integer/,
    );
    await expect(
      createHeterogeneousExecutor({ backends: [tsBackend], chunks: 2, assign: () => 5 }).run(JOB),
    ).rejects.toThrow(/outside \[0, 1\)/);
  });
});

describe("the WASM backend's use of one arena across many chunks", () => {
  it("grows linear memory at most once for a run, and not per chunk", async () => {
    const kernel = await WasmRk4Kernel.instantiate();
    const backend = createWasmEnsembleBackend(kernel, { id: "arena", useSimd: false });
    const executor = createHeterogeneousExecutor({ backends: [backend], chunks: 9 });

    await executor.run(JOB);
    const bytesAfterFirst = kernel.memoryBytes;
    // A second run over the same partition needs no more capacity than the
    // first, so a growing memory here would mean the backend re-inits per
    // chunk -- which would also mean it discards the arena mid-run.
    await executor.run(JOB);
    expect(kernel.memoryBytes).toBe(bytesAfterFirst);
  });

  it("returns rows copied out of the arena, not a live view the next chunk overwrites", async () => {
    const kernel = await WasmRk4Kernel.instantiate();
    const backend = createWasmEnsembleBackend(kernel, { id: "copy", useSimd: false });
    const first = await backend.runRange(JOB, 0, 4);
    const snapshot = Float64Array.from(first.rows);
    await backend.runRange(JOB, 100, 104);
    expect(firstDivergence(Float64Array.from(first.rows), snapshot)).toBeUndefined();
  });

  it("refuses to promise SIMD it does not have", async () => {
    const kernel = await WasmRk4Kernel.instantiate();
    expect(() => createWasmEnsembleBackend(kernel, { useSimd: true })).toThrow(/scalar artifact/);
  });
});

describe("a worker-backed backend is just another backend", () => {
  /**
   * A `WorkerLike` over a real `MessageChannel`: the request crosses a genuine
   * port and the reply's `Float64Array` comes back through structured clone, so
   * this exercises the serialization boundary rather than a same-object
   * handover.
   */
  function createPortWorker(backend: EnsembleBackend): { worker: WorkerLike; close: () => void } {
    const { port1, port2 } = new MessageChannel();
    port2.on("message", (data: EnsembleChunkRequest) => {
      void postEnsembleChunkResult(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- node:worker_threads types its transfer list against the DOM `Transferable` type, which this DOM-lib-free package does not have.
        (message, transfer) => port2.postMessage(message, transfer as any),
        data,
        backend,
      );
    });
    const worker: WorkerLike = {
      postMessage(message) {
        port1.postMessage(message);
      },
      terminate() {
        port1.close();
        port2.close();
      },
      onmessage: null,
      onerror: null,
    };
    port1.on("message", (data: EnsembleChunkResponse) => {
      worker.onmessage?.({ data });
    });
    return {
      worker,
      close: () => {
        port1.close();
        port2.close();
      },
    };
  }

  it("round-trips a chunk through a real message port and lands it at the right index", async () => {
    const { worker, close } = createPortWorker(createTsEnsembleBackend("in-worker"));
    try {
      const backend = createWorkerEnsembleBackend(worker, "worker-ts");
      const chunk = await backend.runRange(JOB, 100, 140);
      expect(chunk.startIndex).toBe(100);
      const expected = runTsEnsembleRange(JOB, 100, 140);
      expect(firstDivergence(Float64Array.from(chunk.rows), expected)).toBeUndefined();
    } finally {
      close();
    }
  });

  it("schedules alongside an in-process backend, bit-identically", async () => {
    const { worker, close } = createPortWorker(createTsEnsembleBackend("in-worker"));
    try {
      const { observables, assignments } = await createHeterogeneousExecutor({
        backends: [wasmScalarBackend, createWorkerEnsembleBackend(worker, "worker-ts")],
        chunks: 2,
      }).run(JOB);
      expect(new Set(assignments.map((a) => a.backendId))).toEqual(
        new Set(["wasm-scalar", "worker-ts"]),
      );
      expect(firstDivergence(tsReference, observables)).toBeUndefined();
    } finally {
      close();
    }
  });

  it("posts the result by transfer rather than by copy", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      const request: EnsembleChunkRequest = {
        kind: "ensemble-chunk",
        job: JOB,
        startIndex: 0,
        endIndex: 4,
      };
      const response = await postEnsembleChunkResult(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see createPortWorker.
        (message, transfer) => port1.postMessage(message, transfer as any),
        request,
        createTsEnsembleBackend(),
      );
      // A structured-clone copy would leave the sender's buffer intact; a real
      // transfer detaches it.
      expect(response.rows.buffer.byteLength).toBe(0);
      void port2;
    } finally {
      port1.close();
      port2.close();
    }
  });

  it("rejects a second concurrent chunk rather than stranding the first", async () => {
    const { worker, close } = createPortWorker(createTsEnsembleBackend("in-worker"));
    try {
      const backend = createWorkerEnsembleBackend(worker, "worker-ts");
      const first = backend.runRange(JOB, 0, 8);
      await expect(backend.runRange(JOB, 8, 16)).rejects.toThrow(/already in flight/);
      await expect(first).resolves.toBeDefined();
      // ...and the backend is usable again afterwards, rather than stuck busy.
      await expect(backend.runRange(JOB, 8, 16)).resolves.toBeDefined();
    } finally {
      close();
    }
  });
});

/**
 * The negative controls. Each is a deliberately-broken backend or scheduler
 * that the assertions above must reject; a control that stays green means the
 * suite is not measuring what it claims to.
 */
describe("negative controls: the suite goes red on a broken backend", () => {
  /**
   * Control A -- RK4 with the final increment accumulated as it goes.
   *
   * `stepExplicitRK` forms `y[i] + h * (b0*k0 + b1*k1 + b2*k2 + b3*k3)`: one
   * weighted sum, then one multiply by `h`. This control forms
   * `((y[i] + h*b0*k0) + h*b1*k1) + ...` instead. That is the exact
   * reassociation `explicit-rk-kernel.ts` warns about in its own doc comment
   * and the exact defect P7.07 measured at 1 ULP -- a difference any tolerance
   * above ~1e-16 relative would pass, and the reason the stated tolerance here
   * is zero.
   *
   * The stage loop is otherwise transcribed from `stepExplicitRK` term for
   * term, which is what makes this a control rather than a second
   * implementation: with `reassociate` false it must reproduce the reference
   * bit-for-bit (asserted below), so the *only* thing the `reassociate` case
   * changes is the grouping.
   */
  function runHandRolledRk4(
    job: EnsembleJobSpec,
    startIndex: number,
    endIndex: number,
    reassociate: boolean,
  ): Float64Array {
    const rows = new Float64Array((endIndex - startIndex) * ENSEMBLE_OBS_COUNT);
    const environment = ensembleEnvironment(job);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const { c, a, b } = RK4_TABLEAU;
    const dim = model.dim;
    const k = Array.from({ length: c.length }, () => new Float64Array(dim));
    const yStage = new Float64Array(dim);
    const y = new Float64Array(dim);
    const yNext = new Float64Array(dim);

    for (let r = startIndex; r < endIndex; r++) {
      const rep = job.replicates[r]!;
      const ctx = createEvalContext(environment, ensembleReplicateParams(rep));
      y.set([rep.x0, rep.y0, rep.vx0, rep.vy0]);
      let max = y[1]!;

      for (let step = 0; step < job.steps; step++) {
        const t = job.t0 + step * job.h;
        for (let s = 0; s < c.length; s++) {
          const aRow = a[s]!;
          for (let i = 0; i < dim; i++) {
            let yi = y[i]!;
            for (let j = 0; j < aRow.length; j++) yi += job.h * aRow[j]! * k[j]![i]!;
            yStage[i] = yi;
          }
          model.rhs(t + c[s]! * job.h, yStage, k[s]!, ctx);
        }
        for (let i = 0; i < dim; i++) {
          if (reassociate) {
            let acc = y[i]!;
            for (let s = 0; s < c.length; s++) acc += job.h * b[s]! * k[s]![i]!;
            yNext[i] = acc;
          } else {
            let increment = 0;
            for (let s = 0; s < c.length; s++) increment += b[s]! * k[s]![i]!;
            yNext[i] = y[i]! + job.h * increment;
          }
        }
        y.set(yNext);
        if (y[1]! > max) max = y[1]!;
      }

      const o = (r - startIndex) * ENSEMBLE_OBS_COUNT;
      rows.set([y[0]!, y[1]!, y[2]!, y[3]!, job.t0 + job.steps * job.h, max], o);
    }
    return rows;
  }

  /** Control B -- `t_final` accumulated instead of `t0 + steps*h`. */
  function runAccumulatedTFinal(
    job: EnsembleJobSpec,
    startIndex: number,
    endIndex: number,
  ): Float64Array {
    const rows = runTsEnsembleRange(job, startIndex, endIndex);
    let accumulated = job.t0;
    for (let i = 0; i < job.steps; i++) accumulated += job.h;
    for (let r = 0; r < endIndex - startIndex; r++) {
      rows[r * ENSEMBLE_OBS_COUNT + ENSEMBLE_OBS.tFinal] = accumulated;
    }
    return rows;
  }

  /** Control C -- the running max started after the first step, not at the initial state. */
  function runMaxExcludingInitialState(
    job: EnsembleJobSpec,
    startIndex: number,
    endIndex: number,
  ): Float64Array {
    const rows = new Float64Array((endIndex - startIndex) * ENSEMBLE_OBS_COUNT);
    const environment = ensembleEnvironment(job);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const stepper = new ClassicalRK4Stepper();
    const out = createStepResult(model.dim);
    const y = new Float64Array(4);
    for (let r = startIndex; r < endIndex; r++) {
      const rep = job.replicates[r]!;
      stepper.init(model, createEvalContext(environment, ensembleReplicateParams(rep)));
      y.set([rep.x0, rep.y0, rep.vx0, rep.vy0]);
      let max = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < job.steps; i++) {
        stepper.step(job.t0 + i * job.h, y, job.h, out);
        y.set(out.yNext);
        if (y[1]! > max) max = y[1]!;
      }
      const o = (r - startIndex) * ENSEMBLE_OBS_COUNT;
      rows.set([y[0]!, y[1]!, y[2]!, y[3]!, job.t0 + job.steps * job.h, max], o);
    }
    return rows;
  }

  function backendFrom(
    id: string,
    run: (job: EnsembleJobSpec, s: number, e: number) => Float64Array,
  ): EnsembleBackend {
    return {
      id,
      runRange: (job, startIndex, endIndex) =>
        Promise.resolve({ startIndex, rows: run(job, startIndex, endIndex) }),
    };
  }

  it("A0: the control's faithful form is bit-identical, so A isolates the reassociation", async () => {
    // Without this, control A proves only that two different implementations
    // differ. With it, the grouping is the single thing that changed.
    const faithful = await runWhole(
      backendFrom("control-a0", (job, s, e) => runHandRolledRk4(job, s, e, false)),
      JOB,
    );
    expect(firstDivergence(tsReference, faithful)).toBeUndefined();
  });

  it("A: an accumulated final increment diverges, at a size a 1e-12 tolerance would pass", async () => {
    const control = await runWhole(
      backendFrom("control-a", (job, s, e) => runHandRolledRk4(job, s, e, true)),
      JOB,
    );
    const divergence = firstDivergence(tsReference, control);
    expect(divergence).toBeDefined();
    // The substance of the zero-ULP choice: this defect is real and this
    // suite catches it, while P7.11's own headline bound would not have.
    const relative = Math.abs(divergence!.left - divergence!.right) / Math.abs(divergence!.left);
    expect(relative).toBeGreaterThan(0);
    expect(relative).toBeLessThan(1e-12);
  });

  it("swapping gravity and drag changes nothing, and that is commutativity rather than luck", async () => {
    // Recorded as a finding because it was drafted as a control and could not
    // fail. `specializeForces` applies forces in array order, so the swap does
    // change the order the two contributions are summed -- but with exactly
    // TWO summands that is a + b against b + a, which IEEE-754 addition makes
    // bit-identical. Reassociation needs three. So P7.07's "gravity BEFORE
    // drag" note is a statement about convention, not about bit-identity, and
    // this stops the next reader inferring more from it than it says. A third
    // force in this model would end it, which is one more reason the kernel's
    // scope is pinned at two.
    const swapped = await runWhole(
      backendFrom("force-order", (job, s, e) => {
        const rows = new Float64Array((e - s) * ENSEMBLE_OBS_COUNT);
        const environment = ensembleEnvironment(job);
        const model = createPlanarProjectileModel([new QuadraticDragForce(), new GravityForce()]);
        const stepper = new ClassicalRK4Stepper();
        const out = createStepResult(model.dim);
        const y = new Float64Array(4);
        for (let r = s; r < e; r++) {
          const rep = job.replicates[r]!;
          stepper.init(model, createEvalContext(environment, ensembleReplicateParams(rep)));
          y.set([rep.x0, rep.y0, rep.vx0, rep.vy0]);
          let max = y[1]!;
          for (let i = 0; i < job.steps; i++) {
            stepper.step(job.t0 + i * job.h, y, job.h, out);
            y.set(out.yNext);
            if (y[1]! > max) max = y[1]!;
          }
          rows.set(
            [y[0]!, y[1]!, y[2]!, y[3]!, job.t0 + job.steps * job.h, max],
            (r - s) * ENSEMBLE_OBS_COUNT,
          );
        }
        return rows;
      }),
      JOB,
    );
    expect(firstDivergence(tsReference, swapped)).toBeUndefined();
  });

  it("B: an accumulated t_final diverges, which is why h is not a power of two here", async () => {
    const control = await runWhole(backendFrom("control-b", runAccumulatedTFinal), JOB);
    const divergence = firstDivergence(tsReference, control);
    expect(divergence).toBeDefined();
    expect(divergence!.slot).toBe(ENSEMBLE_OBS.tFinal);
  });

  it("C: a running max that skips the initial state diverges on the replicates that never rise", async () => {
    const control = await runWhole(backendFrom("control-c", runMaxExcludingInitialState), JOB);
    const divergence = firstDivergence(tsReference, control);
    expect(divergence).toBeDefined();
    expect(divergence!.slot).toBe(ENSEMBLE_OBS.maxSampledHeight);
  });
});

describe("negative controls: the suite goes red on a broken scheduler", () => {
  /**
   * Control D -- chunks written where the cursor happens to be when they
   * settle, instead of at their own `startIndex`.
   *
   * This is the defect §5.6's determinism-under-parallelism rule exists to
   * forbid, and it is invisible unless chunks actually settle out of order --
   * which is why the backends here are given deliberately opposed delays. It is
   * also the honest answer to a question worth recording: `Promise.all`
   * preserves input order, so the executor's `startIndex` tagging is not what
   * saves it in the common case. What the tagging buys is that a backend which
   * answers for a different range than it was asked about (a worker replying to
   * a stale request, say) lands its rows in the wrong place *loudly*, and that
   * a future scheduler collecting results as they arrive cannot regress into
   * this.
   */
  async function runReassembledInSettleOrder(
    job: EnsembleJobSpec,
    backends: readonly EnsembleBackend[],
    chunks: number,
  ): Promise<Float64Array> {
    const observables = new Float64Array(job.replicates.length * ENSEMBLE_OBS_COUNT);
    let cursor = 0;
    await Promise.all(
      partitionReplicates(job.replicates.length, chunks).map((chunk, i) =>
        backends[i % backends.length]!.runRange(job, chunk.startIndex, chunk.endIndex).then(
          (result) => {
            observables.set(result.rows, cursor);
            cursor += result.rows.length;
          },
        ),
      ),
    );
    return observables;
  }

  /** Control E -- the last chunk never dispatched, leaving its rows at the zero fill. */
  async function runDroppingLastChunk(
    job: EnsembleJobSpec,
    backend: EnsembleBackend,
    chunks: number,
  ): Promise<Float64Array> {
    const observables = new Float64Array(job.replicates.length * ENSEMBLE_OBS_COUNT);
    const bounds = partitionReplicates(job.replicates.length, chunks).slice(0, -1);
    const results = await Promise.all(
      bounds.map((chunk) => backend.runRange(job, chunk.startIndex, chunk.endIndex)),
    );
    for (const result of results) {
      observables.set(result.rows, result.startIndex * ENSEMBLE_OBS_COUNT);
    }
    return observables;
  }

  it("D: reassembling in settle order scrambles the result, and the executor does not", async () => {
    const slow = withSettleDelay(tsBackend, 8);
    const fast = withSettleDelay(wasmScalarBackend, 0);
    const control = await runReassembledInSettleOrder(JOB, [slow, fast], 4);
    expect(firstDivergence(tsReference, control)).toBeDefined();

    // The same backends, the same partition, through the real executor.
    const { observables } = await createHeterogeneousExecutor({
      backends: [slow, fast],
      chunks: 4,
    }).run(JOB);
    expect(firstDivergence(tsReference, observables)).toBeUndefined();
  });

  it("E: a dropped chunk leaves rows the fixture's own no-blank-row check catches", async () => {
    const control = await runDroppingLastChunk(JOB, tsBackend, 4);
    expect(firstDivergence(tsReference, control)).toBeDefined();
    let blankRows = 0;
    for (let r = 0; r < REPLICATES; r++) {
      const row = control.subarray(r * ENSEMBLE_OBS_COUNT, (r + 1) * ENSEMBLE_OBS_COUNT);
      if (row.every((v) => v === 0)) blankRows++;
    }
    expect(blankRows).toBeGreaterThan(0);
  });
});
