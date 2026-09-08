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
 * The views are invalidated if the instance's memory ever grows (the old
 * `ArrayBuffer` detaches). This module never grows it -- the kernel has no
 * allocator and every buffer is a fixed-size static -- so the views are built
 * once. A future task that adds a heap must rebuild them after growth.
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
}

/** Path to the committed `.wasm`, which is what CI runs against (it has no Rust). */
export const WASM_ARTIFACT_PATH = fileURLToPath(
  new URL("./generated/ballista-core.wasm", import.meta.url),
);

/** Reads the committed artifact's bytes. */
export async function readWasmArtifact(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(WASM_ARTIFACT_PATH));
}

/**
 * An instantiated kernel: the two memory views plus the two step calls.
 *
 * `state` is live. Write the initial condition into it, call {@link step}, and
 * read the result back out of the same view -- there is no separate get/set.
 */
export class WasmRk4Kernel {
  /** Live view of `[x, y, vx, vy]` inside the instance's memory. */
  readonly state: Float64Array;
  /** Live view of the parameter block. Prefer {@link setParams}. */
  readonly params: Float64Array;

  private readonly exports: KernelExports;

  private constructor(exports: KernelExports) {
    this.exports = exports;
    const { buffer } = exports.memory;
    this.state = new Float64Array(buffer, exports.state_ptr(), exports.dim());
    this.params = new Float64Array(buffer, exports.params_ptr(), exports.param_count());
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
}
