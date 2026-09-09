import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Host side of the `ballista-core` WASM kernel (P7.07).
 *
 * The module exports a plain C ABI over its own linear memory -- no
 * wasm-bindgen, no generated glue. The contract is four numbers-in-memory and
 * two calls, and this file is the whole binding:
 *
 * - `state_ptr()` / `params_ptr()` return addresses of statics inside the
 *   instance. We build one {@link Float64Array} view over each at
 *   instantiation and keep them, so reading and writing state costs no copy.
 *   That is deliberate groundwork for P7.08's zero-copy batch API rather than
 *   a shortcut here.
 * - `step(t, h)` / `step_n(t0, h, n)` advance the state in place.
 *
 * P7.08 adds a batch path over the same memory: {@link WasmRk4Kernel.batchInit}
 * reserves an arena, three more views expose its parameter, initial-state and
 * observable blocks, and {@link WasmRk4Kernel.batchRun} integrates `n`
 * replicates without a boundary crossing per replicate or per step.
 *
 * **Growth detaches views, and with the batch API that is no longer
 * hypothetical.** P7.07 could build its two views once because the kernel had
 * no allocator and every buffer was a fixed-size static. An arena for 1e4
 * replicates is ~1.36 MB and forces `memory.grow`, which detaches the
 * instance's old `ArrayBuffer` and every view onto it -- including `state` and
 * `params`, which have nothing to do with the batch. So the views are no longer
 * fields: they are getters over privately-held arrays that
 * {@link WasmRk4Kernel.batchInit} rebuilds when, and only when, the buffer or
 * the capacity actually changed. A caller that caches `kernel.state` in a local
 * across a `batchInit` is holding a detached view; re-read the getter.
 */

/** Slot indices into the parameter block, mirroring the crate's `ParamSlot`. */
export const PARAM = {
  mass: 0,
  area: 1,
  cd: 2,
  rho: 3,
  g: 4,
  wx: 5,
  wy: 6,
} as const;

/**
 * Slot indices into one replicate's observables row (P7.08), mirroring the
 * crate's `OBS_COUNT` doc comment.
 *
 * {@link OBS.maxSampledHeight} is a running maximum over *step boundaries*,
 * including the initial state. It is deliberately **not** named `apexHeight`:
 * `Observables.apexHeight` in `@ballista/analysis` refines the peak between the
 * two rows that bracket it with a Hermite stationary point, and these two agree
 * only as `h` shrinks. Compare this against a TS-side running max over the same
 * rows, never against the refined observable.
 *
 * There is no slot for the time of that maximum, and its absence is deliberate:
 * a step-boundary argmax time is not `apexTime` for the same reason, and
 * shipping it beside a height invites precisely the comparison above.
 *
 * {@link OBS.x} through {@link OBS.vy} are the state after the final step, not
 * an event-localized impact state -- the batch runs a fixed step count and
 * stops.
 */
export const OBS = {
  x: 0,
  y: 1,
  vx: 2,
  vy: 3,
  tFinal: 4,
  maxSampledHeight: 5,
} as const;

/** Parameters the kernel reads. Names match the engine's, not the crate's slots. */
export interface WasmKernelParams {
  readonly mass: number;
  readonly area: number;
  /** Constant drag coefficient. The kernel targets `ConstantCd` only (P7.07). */
  readonly cd: number;
  readonly rho: number;
  readonly g: number;
  readonly wx: number;
  readonly wy: number;
}

interface KernelExports {
  readonly memory: WebAssembly.Memory;
  readonly state_ptr: () => number;
  readonly params_ptr: () => number;
  readonly dim: () => number;
  readonly param_count: () => number;
  readonly step: (t: number, h: number) => void;
  readonly step_n: (t0: number, h: number, n: number) => void;
  readonly obs_count: () => number;
  readonly batch_init: (capacity: number) => number;
  readonly batch_capacity: () => number;
  readonly batch_params_ptr: () => number;
  readonly batch_states_ptr: () => number;
  readonly batch_observables_ptr: () => number;
  readonly batch_run: (t0: number, h: number, steps: number, n: number) => number;
  readonly simd_enabled: () => number;
  readonly simd_lanes: () => number;
  /** Present only in the simd128 build. See {@link wasmSimdSupported}. */
  readonly batch_run_simd?: (t0: number, h: number, steps: number, n: number) => number;
}

/** Stand-in for the batch views before the first `batchInit`. Never grows. */
const EMPTY = new Float64Array(0);

/** Path to the committed scalar `.wasm`, which is what CI runs against (it has no Rust). */
export const WASM_ARTIFACT_PATH = fileURLToPath(
  new URL("./generated/ballista-core.wasm", import.meta.url),
);

/**
 * Path to the committed simd128 `.wasm` (P7.09).
 *
 * A separate binary rather than a runtime branch inside one: a module carrying
 * simd128 instructions fails *validation* on an engine without the proposal, so
 * the choice has to be made before the bytes are compiled, not inside them.
 */
export const WASM_SIMD_ARTIFACT_PATH = fileURLToPath(
  new URL("./generated/ballista-core.simd.wasm", import.meta.url),
);

/**
 * A 43-byte module whose only body is `v128.const 0; drop`.
 *
 * `WebAssembly.validate` returns false for it on an engine without the simd128
 * proposal, and that is the whole feature detect. Compiling it (rather than
 * instantiating) is enough, because validation is exactly the step that
 * rejects an unknown instruction.
 */
// prettier-ignore
const SIMD_PROBE_MODULE = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic "\0asm", version 1
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,             // type section: one type, () -> ()
  0x03, 0x02, 0x01, 0x00,                         // function section: one function, type 0
  0x0a, 0x17, 0x01, 0x15, 0x00,                   // code section: one body, no locals
  0xfd, 0x0c,                                     //   v128.const ...
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, //   ... sixteen zero bytes
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x1a,                                           //   drop
  0x0b,                                           //   end
]);

/**
 * Whether this engine supports the WebAssembly simd128 proposal (P7.09).
 *
 * Memoised: the answer cannot change within a process, and the probe is on the
 * path of every {@link WasmRk4Kernel.instantiate} call.
 */
let simdSupport: boolean | undefined;
export function wasmSimdSupported(): boolean {
  const cached = simdSupport;
  if (cached !== undefined) {
    return cached;
  }
  const supported = WebAssembly.validate(SIMD_PROBE_MODULE);
  simdSupport = supported;
  return supported;
}

/** Reads the committed scalar artifact's bytes. */
export async function readWasmArtifact(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(WASM_ARTIFACT_PATH));
}

/** Reads the committed simd128 artifact's bytes. */
export async function readWasmSimdArtifact(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(WASM_SIMD_ARTIFACT_PATH));
}

/**
 * An instantiated kernel: the two memory views plus the two step calls.
 *
 * `state` is live. Write the initial condition into it, call {@link step}, and
 * read the result back out of the same view -- there is no separate get/set.
 */
export class WasmRk4Kernel {
  private readonly exports: KernelExports;

  private stateView!: Float64Array;
  private paramsView!: Float64Array;
  private batchParamsView: Float64Array = EMPTY;
  private batchStatesView: Float64Array = EMPTY;
  private batchObservablesView: Float64Array = EMPTY;

  /** The buffer the current views are built on, so a detach can be detected. */
  private boundBuffer: ArrayBuffer | undefined;
  /** The capacity the current batch views were sized for. */
  private boundCapacity = -1;

  private constructor(exports: KernelExports) {
    this.exports = exports;
    this.rebuildViews();
  }

  /**
   * Rebuilds every view, but only if the instance's `ArrayBuffer` or the
   * reserved capacity actually changed.
   *
   * The early return is not a micro-optimisation, it is what makes the "no
   * per-call allocation" claim checkable by identity: a `batchInit` at or below
   * the existing capacity grows no memory and returns the *same* view objects,
   * so a test can assert `toBe` rather than trusting a byte count.
   */
  private rebuildViews(): void {
    const { buffer } = this.exports.memory;
    const capacity = this.exports.batch_capacity();
    if (buffer === this.boundBuffer && capacity === this.boundCapacity) {
      return;
    }
    this.boundBuffer = buffer;
    this.boundCapacity = capacity;

    const { exports } = this;
    this.stateView = new Float64Array(buffer, exports.state_ptr(), exports.dim());
    this.paramsView = new Float64Array(buffer, exports.params_ptr(), exports.param_count());

    if (capacity === 0) {
      this.batchParamsView = EMPTY;
      this.batchStatesView = EMPTY;
      this.batchObservablesView = EMPTY;
      return;
    }
    this.batchParamsView = new Float64Array(
      buffer,
      exports.batch_params_ptr(),
      capacity * exports.param_count(),
    );
    this.batchStatesView = new Float64Array(
      buffer,
      exports.batch_states_ptr(),
      capacity * exports.dim(),
    );
    this.batchObservablesView = new Float64Array(
      buffer,
      exports.batch_observables_ptr(),
      capacity * exports.obs_count(),
    );
  }

  /**
   * Live view of `[x, y, vx, vy]` inside the instance's memory.
   *
   * Re-read this after any {@link batchInit} that raised capacity: the growth
   * detaches the previous buffer, and a cached reference is dead.
   */
  get state(): Float64Array {
    return this.stateView;
  }

  /** Live view of the parameter block. Prefer {@link setParams}. Same detach caveat as {@link state}. */
  get params(): Float64Array {
    return this.paramsView;
  }

  /** Replicates the arena is currently reserved for. */
  get batchCapacity(): number {
    return this.boundCapacity;
  }

  /**
   * Total bytes of the instance's linear memory.
   *
   * This is the one number that moves when the kernel allocates -- a WASM
   * module with no allocator can only obtain memory through `memory.grow` --
   * so it is how P7.08's "no per-call allocation" half is checked rather than
   * asserted. It may change across {@link batchInit} and must not change across
   * anything else.
   */
  get memoryBytes(): number {
    return this.exports.memory.buffer.byteLength;
  }

  /** `f64` slots per replicate in {@link batchObservables}. See {@link OBS}. */
  get obsCount(): number {
    return this.exports.obs_count();
  }

  /**
   * Live view of the batch parameter block: `capacity * PARAM_COUNT`, row-major
   * by replicate, so replicate `r`'s block starts at `r * PARAM_COUNT`. Empty
   * before the first {@link batchInit}.
   */
  get batchParams(): Float64Array {
    return this.batchParamsView;
  }

  /** Live view of the batch initial-state block: `capacity * dim`, row-major. */
  get batchStates(): Float64Array {
    return this.batchStatesView;
  }

  /** Live view of the batch observables block: `capacity * obsCount`, row-major. */
  get batchObservables(): Float64Array {
    return this.batchObservablesView;
  }

  /**
   * Compiles and instantiates the kernel from `bytes`, or from the committed
   * artifact when no bytes are given.
   *
   * The kernel imports nothing, so the import object is empty -- there is no
   * host function it could call and therefore no way for its results to depend
   * on the host beyond the numbers written into `params` and `state`.
   */
  static async instantiate(bytes?: Uint8Array): Promise<WasmRk4Kernel> {
    const source = bytes ?? (await readWasmArtifact());
    // `BufferSource` wants a plain ArrayBuffer; Node may hand back a view onto
    // a pooled one, so slice to the exact bytes.
    const { instance } = await WebAssembly.instantiate(
      source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
      {},
    );
    return new WasmRk4Kernel(instance.exports as unknown as KernelExports);
  }

  /**
   * Instantiates the simd128 artifact where the engine supports it and the
   * scalar one where it does not (P7.09).
   *
   * The two produce **bit-identical** results -- the SIMD path's lanes are
   * independent replicates and simd128 has no FMA, so there is no reassociation
   * anywhere -- which is what makes selecting between them at runtime safe to
   * do silently. If that ever stopped being true this would have to become an
   * explicit choice by the caller instead.
   */
  static async instantiateBest(): Promise<WasmRk4Kernel> {
    return WasmRk4Kernel.instantiate(
      wasmSimdSupported() ? await readWasmSimdArtifact() : await readWasmArtifact(),
    );
  }

  /**
   * Whether *this instance* has the SIMD batch path.
   *
   * Read from the module's own `simd_enabled` export rather than from
   * {@link wasmSimdSupported}, so it says which artifact actually got loaded
   * rather than what the engine could have run. Those differ whenever a caller
   * passes bytes to {@link instantiate} directly, and a feature detect that is
   * never checked against its own outcome is a branch, not a detect.
   */
  get hasSimd(): boolean {
    return this.exports.simd_enabled() === 1;
  }

  /** Replicates the SIMD batch path processes per iteration: 2 with f64x2, else 1. */
  get simdLanes(): number {
    return this.exports.simd_lanes();
  }

  /** Writes `p` into the live parameter view. */
  setParams(p: WasmKernelParams): void {
    this.params[PARAM.mass] = p.mass;
    this.params[PARAM.area] = p.area;
    this.params[PARAM.cd] = p.cd;
    this.params[PARAM.rho] = p.rho;
    this.params[PARAM.g] = p.g;
    this.params[PARAM.wx] = p.wx;
    this.params[PARAM.wy] = p.wy;
  }

  /** Writes `y` into the live state view. */
  setState(y: ArrayLike<number>): void {
    this.state.set(y);
  }

  /** Advances the state one RK4 step of size `h` from time `t`. */
  step(t: number, h: number): void {
    this.exports.step(t, h);
  }

  /** Advances the state `n` RK4 steps of size `h` from `t0`. */
  stepN(t0: number, h: number, n: number): void {
    this.exports.step_n(t0, h, n);
  }

  /**
   * Reserves arena space for `capacity` replicates and rebuilds the views.
   *
   * Call it **once**, with the largest capacity you will use. This is the only
   * call that can grow the instance's memory, and growth both detaches every
   * existing view and moves the state and observable blocks (their offsets are
   * capacity-derived). It preserves no buffer contents, so write parameters and
   * initial states *after* it, not before.
   *
   * @throws RangeError if `capacity` is not a non-negative integer.
   * @throws Error if `WebAssembly.Memory` refused to grow.
   */
  batchInit(capacity: number): void {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new RangeError(`batchInit: capacity must be a non-negative integer, got ${capacity}`);
    }
    if (this.exports.batch_init(capacity) !== 1) {
      throw new Error(
        `batchInit: WebAssembly memory could not grow to hold ${capacity} replicates`,
      );
    }
    this.rebuildViews();
  }

  /**
   * Integrates the first `n` replicates for `steps` RK4 steps of size `h` from
   * `t0`, writing one {@link OBS} row per replicate into
   * {@link batchObservables}.
   *
   * Allocates nothing, on either side of the boundary: the kernel's scratch is
   * static and this call passes only numbers. Each replicate is bit-identical
   * to driving the single-state path with the same parameters and initial
   * state, because it is the same stepper called in the same order.
   *
   * @throws RangeError if `n` exceeds the reserved capacity.
   */
  batchRun(t0: number, h: number, steps: number, n: number): void {
    if (this.exports.batch_run(t0, h, steps, n) !== 1) {
      throw new RangeError(`batchRun: n=${n} exceeds reserved capacity ${this.boundCapacity}`);
    }
  }

  /**
   * The f64x2 batch path (P7.09): same arguments, same observables rows, two
   * replicates per iteration.
   *
   * **Bit-identical to {@link batchRun}, not merely close.** Each lane is an
   * independent trajectory, so every scalar operation maps to one lane-wise
   * instruction in the same order; simd128 has no FMA and its `f64x2.sqrt` is
   * correctly rounded per lane. An odd `n` sends the last replicate through the
   * scalar path's own per-replicate body rather than a one-lane copy of the
   * vector one.
   *
   * @throws TypeError if this instance is the scalar artifact -- loudly, rather
   * than silently falling back, because a caller reaching for this wants to
   * know it did not get it. Use {@link hasSimd} to choose, or
   * {@link instantiateBest} and {@link batchRun} to not have to.
   * @throws RangeError if `n` exceeds the reserved capacity.
   */
  batchRunSimd(t0: number, h: number, steps: number, n: number): void {
    const run = this.exports.batch_run_simd;
    if (run === undefined) {
      throw new TypeError(
        "batchRunSimd: this instance is the scalar artifact and has no SIMD path",
      );
    }
    if (run(t0, h, steps, n) !== 1) {
      throw new RangeError(`batchRunSimd: n=${n} exceeds reserved capacity ${this.boundCapacity}`);
    }
  }
}
