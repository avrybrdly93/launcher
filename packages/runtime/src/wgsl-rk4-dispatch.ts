/**
 * Host side of the WGSL RK4 kernel: buffer packing, dispatch, readback (P7.14).
 *
 * ## Why this exists now, when `wgsl-rk4-kernel.ts` said it could not
 *
 * That module's seam was justified by "this container has no `navigator.gpu` and
 * no adapter", so a dispatch layer written then would have been untestable
 * scaffolding. Half of that is still true and half was too strong. **Node has no
 * `navigator.gpu`; the Chromium in this image does** -- but only in a *secure
 * context*, which `about:blank` is not and `http://127.0.0.1` is. Given the
 * secure context and `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader
 * --enable-features=Vulkan`, it yields a real adapter and device backed by
 * SwiftShader, whose Vulkan ICD ships inside the Chromium build.
 *
 * **That adapter is software, which decides what this module may be used to
 * claim.** It runs the same WGSL through the same Tint compiler and produces
 * numbers a conformant implementation would produce, so it answers a
 * *correctness* question -- P7.14's criterion is exactly that. It answers no
 * performance question at all. Nothing here reports a timing, and
 * `scripts/measure-gpu-rk4-agreement.mjs` reports none either. Throughput and
 * the workgroup-size sweep belong to P7.15, P7.20 and P7.22, which need real
 * hardware.
 *
 * ## The seam that remains: the device is injected, never reached for
 *
 * Like {@link probeWebGpu}'s `GpuLike`, every WebGPU type here is a
 * **hand-written structural minimum** -- no `@webgpu/types` dependency, for the
 * reason `webgpu-capability.ts` gives: this module touches a dozen members of a
 * ~200-member surface, and a real `GPUDevice` satisfies these interfaces
 * structurally, so the browser's own object passes straight in with no cast.
 *
 * The payoff is that {@link runWgslRk4} is testable under Node against a
 * recording fake: the binding indices, the buffer usage flags, the byte sizes,
 * the dispatch count, the copy and the unmap are all assertions in
 * `wgsl-rk4-dispatch.test.ts`, on a machine with no GPU. What the fake cannot
 * check is whether a real driver agrees with the CPU reference numerically, and
 * that is precisely what the measurement script exists to do. Neither substitutes
 * for the other.
 *
 * ## Two mismatches that would otherwise be silently wrong physics
 *
 * 1. **Parameter stride.** `Params` is seven `f32` at alignment 4, so the host
 *    must pack at exactly {@link WGSL_PARAMS_STRIDE_BYTES}. A host that packed at
 *    32 bytes to "align nicely" would feed every trajectory after the first a
 *    blend of its neighbour's parameters and produce plausible, wrong
 *    trajectories rather than an error. {@link packPlanarParams} is the only
 *    writer of that layout and a test pins the stride.
 *
 * 2. **Workgroup size against shader text.** The `@workgroup_size` is baked into
 *    {@link WGSL_RK4_KERNEL_SOURCE} as a literal. The dispatch count is
 *    `ceil(count / workgroupSize)`, so a caller passing a `workgroupSize` that
 *    disagrees with the source's literal launches the wrong number of threads:
 *    too few and the tail of the ensemble silently keeps its initial state; too
 *    many and the guard discards the surplus, which is harmless but hides the
 *    first case. {@link assertWorkgroupSizeMatchesSource} makes that a thrown
 *    error instead, which is what lets P7.15 vary the size safely.
 */

import type { PlanarDragParams } from "@ballista/solverkit";

import {
  WGSL_BINDINGS,
  WGSL_ENTRY_POINT,
  WGSL_PARAM_COUNT,
  WGSL_PARAMS_STRIDE_BYTES,
  WGSL_RK4_KERNEL_SOURCE,
  WGSL_STATE_DIM,
  WGSL_WORKGROUP_SIZE,
} from "./wgsl-rk4-kernel.js";

/**
 * `GPUBufferUsage` flag values from the WebGPU specification.
 *
 * Hand-written for the same reason the interfaces below are: the real enum is a
 * browser global, and a module that read it at import time could not be loaded
 * under Node at all. These are the spec's fixed bit values, not an
 * implementation's choice -- but "not an implementation's choice" is a claim
 * worth checking rather than asserting, so the measurement script compares this
 * object against the browser's own `GPUBufferUsage` before it dispatches
 * anything. A transposed flag here would otherwise surface as a validation error
 * from the driver with no indication of which constant was wrong.
 */
export const GPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;

/** Bytes in the kernel's `Config` uniform: `f32 h`, `u32 steps`, `u32 count`, `u32 _pad`. */
export const WGSL_CONFIG_BYTES = 16;

/** The subset of `GPUBuffer` this module uses. */
export interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

/** The subset of `GPUBindGroupLayout` this module passes around (opaque). */
export type GpuBindGroupLayoutLike = object;

/** The subset of `GPUComputePipeline` this module uses. */
export interface GpuComputePipelineLike {
  getBindGroupLayout(index: number): GpuBindGroupLayoutLike;
}

/** The subset of `GPUComputePassEncoder` this module uses. */
export interface GpuComputePassLike {
  setPipeline(pipeline: GpuComputePipelineLike): void;
  setBindGroup(index: number, bindGroup: object): void;
  dispatchWorkgroups(x: number): void;
  end(): void;
}

/** The subset of `GPUCommandEncoder` this module uses. */
export interface GpuCommandEncoderLike {
  beginComputePass(): GpuComputePassLike;
  copyBufferToBuffer(
    source: GpuBufferLike,
    sourceOffset: number,
    destination: GpuBufferLike,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): object;
}

/** The subset of `GPUQueue` this module uses. */
export interface GpuQueueLike {
  writeBuffer(
    buffer: GpuBufferLike,
    bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
  ): void;
  submit(commandBuffers: readonly object[]): void;
}

/**
 * The subset of `GPUDevice` this module uses.
 *
 * Named `GpuComputeDeviceLike` rather than `GpuDeviceLike` because
 * `webgpu-capability.ts` already exports the latter for a different purpose --
 * there it is `{ destroy?(): void }`, the one member a *probe* needs in order to
 * hand a device straight back. Both are re-exported from the package index, so
 * one name for two unrelated shapes would be an ambiguous re-export (and was: it
 * failed `tsc` before this comment existed). A real `GPUDevice` satisfies both.
 */
export interface GpuComputeDeviceLike {
  readonly queue: GpuQueueLike;
  createShaderModule(descriptor: { code: string }): object;
  createBuffer(descriptor: { size: number; usage: number }): GpuBufferLike;
  createComputePipeline(descriptor: {
    layout: "auto";
    compute: { module: object; entryPoint: string };
  }): GpuComputePipelineLike;
  createBindGroup(descriptor: {
    layout: GpuBindGroupLayoutLike;
    entries: readonly { binding: number; resource: { buffer: GpuBufferLike } }[];
  }): object;
  createCommandEncoder(): GpuCommandEncoderLike;
}

/**
 * Packs one `Params` struct per trajectory at the kernel's stride.
 *
 * Field order is the struct's declaration order, which is also `wasm-core`'s
 * `ParamSlot` order. Values are stored into a `Float32Array`, so each is rounded
 * to binary32 exactly once here -- the same single rounding
 * {@link roundParams} applies on the CPU side, which is what makes the two paths
 * start from identical inputs rather than merely similar ones.
 */
export function packPlanarParams(params: readonly PlanarDragParams[]): Float32Array {
  const packed = new Float32Array(params.length * WGSL_PARAM_COUNT);
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    const base = i * WGSL_PARAM_COUNT;
    packed[base + 0] = p.mass;
    packed[base + 1] = p.area;
    packed[base + 2] = p.cd;
    packed[base + 3] = p.rho;
    packed[base + 4] = p.g;
    packed[base + 5] = p.windX;
    packed[base + 6] = p.windY;
  }
  return packed;
}

/** Packs `[x, y, vx, vy]` per trajectory into one contiguous `f32` array. */
export function packInitialStates(states: readonly ArrayLike<number>[]): Float32Array {
  const packed = new Float32Array(states.length * WGSL_STATE_DIM);
  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    const base = i * WGSL_STATE_DIM;
    for (let c = 0; c < WGSL_STATE_DIM; c++) packed[base + c] = s[c]!;
  }
  return packed;
}

/**
 * Packs the `Config` uniform.
 *
 * `h` is an `f32` and `steps`/`count` are `u32`, so this writes through two
 * views onto one buffer rather than a single typed array: a `Float32Array`
 * carrying `steps` would store `3000` as a float bit pattern the shader would
 * read as a nonsense `u32`.
 */
export function packConfig(h: number, steps: number, count: number): ArrayBuffer {
  const buffer = new ArrayBuffer(WGSL_CONFIG_BYTES);
  new Float32Array(buffer, 0, 1)[0] = h;
  const words = new Uint32Array(buffer, 4, 3);
  words[0] = steps;
  words[1] = count;
  words[2] = 0;
  return buffer;
}

/**
 * Number of workgroups needed to cover `count` trajectories.
 *
 * Rounds up, which is why the kernel's entry guard exists: the last workgroup is
 * partially idle whenever `count` is not a multiple of the size.
 */
export function planDispatch(count: number, workgroupSize: number): { workgroupCount: number } {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`trajectory count must be a non-negative integer, got ${count}`);
  }
  if (!Number.isInteger(workgroupSize) || workgroupSize <= 0) {
    throw new RangeError(`workgroup size must be a positive integer, got ${workgroupSize}`);
  }
  return { workgroupCount: Math.ceil(count / workgroupSize) };
}

/**
 * Throws unless `source` declares `@workgroup_size(workgroupSize)`.
 *
 * See the header's second mismatch note: disagreement here under-dispatches and
 * leaves the tail of the ensemble holding its initial state, which looks like a
 * physics result rather than a bug. Matching on the shader text is crude but it
 * is checking the one thing that matters -- the literal the compiler will see.
 */
export function assertWorkgroupSizeMatchesSource(source: string, workgroupSize: number): void {
  const match = /@compute\s+@workgroup_size\(\s*(\d+)\s*\)/.exec(source);
  if (match === null) {
    throw new Error("kernel source declares no @compute @workgroup_size(...) entry point");
  }
  const declared = Number(match[1]);
  if (declared !== workgroupSize) {
    throw new Error(
      `workgroup size mismatch: caller passed ${workgroupSize} but the kernel source declares ${declared}`,
    );
  }
}

/** Request for {@link runWgslRk4}. */
export interface WgslRk4Request {
  /** One entry per trajectory. */
  readonly params: readonly PlanarDragParams[];
  /** One `[x, y, vx, vy]` per trajectory; must be the same length as `params`. */
  readonly initialStates: readonly ArrayLike<number>[];
  /** Fixed step size. */
  readonly h: number;
  /** Number of steps every trajectory takes (uniform trip count). */
  readonly steps: number;
  /**
   * Shader source. Defaults to {@link WGSL_RK4_KERNEL_SOURCE}; P7.15 passes its
   * own when sweeping the workgroup size.
   */
  readonly kernelSource?: string;
  /** Must match the source's `@workgroup_size`. Defaults to {@link WGSL_WORKGROUP_SIZE}. */
  readonly workgroupSize?: number;
}

/**
 * Runs the kernel over an ensemble and returns the final states, `f32` values in
 * `[x, y, vx, vy]` order per trajectory.
 *
 * Every buffer created here is destroyed before returning, including on the
 * error path -- a leaked `GPUBuffer` on a software adapter is host memory that
 * the sweep in P7.15 would accumulate across dozens of dispatches.
 */
export async function runWgslRk4(
  device: GpuComputeDeviceLike,
  request: WgslRk4Request,
): Promise<Float32Array> {
  const { params, initialStates, h, steps } = request;
  const kernelSource = request.kernelSource ?? WGSL_RK4_KERNEL_SOURCE;
  const workgroupSize = request.workgroupSize ?? WGSL_WORKGROUP_SIZE;

  if (params.length !== initialStates.length) {
    throw new Error(
      `params and initialStates must describe the same ensemble: ${params.length} vs ${initialStates.length}`,
    );
  }
  if (!Number.isInteger(steps) || steps < 0) {
    throw new RangeError(`steps must be a non-negative integer, got ${steps}`);
  }
  assertWorkgroupSizeMatchesSource(kernelSource, workgroupSize);
  const count = params.length;
  const { workgroupCount } = planDispatch(count, workgroupSize);

  const packedParams = packPlanarParams(params);
  const packedInitial = packInitialStates(initialStates);
  const packedConfig = packConfig(h, steps, count);
  const stateBytes = count * WGSL_STATE_DIM * 4;

  const paramsBuffer = device.createBuffer({
    size: Math.max(count * WGSL_PARAMS_STRIDE_BYTES, 4),
    usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  });
  const initialBuffer = device.createBuffer({
    size: Math.max(stateBytes, 4),
    usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  });
  const finalBuffer = device.createBuffer({
    size: Math.max(stateBytes, 4),
    usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
  });
  const readbackBuffer = device.createBuffer({
    size: Math.max(stateBytes, 4),
    usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
  });
  const configBuffer = device.createBuffer({
    size: WGSL_CONFIG_BYTES,
    usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  });

  try {
    device.queue.writeBuffer(paramsBuffer, 0, packedParams);
    device.queue.writeBuffer(initialBuffer, 0, packedInitial);
    device.queue.writeBuffer(configBuffer, 0, packedConfig);

    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: {
        module: device.createShaderModule({ code: kernelSource }),
        entryPoint: WGSL_ENTRY_POINT,
      },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: WGSL_BINDINGS.params, resource: { buffer: paramsBuffer } },
        { binding: WGSL_BINDINGS.initialStates, resource: { buffer: initialBuffer } },
        { binding: WGSL_BINDINGS.finalStates, resource: { buffer: finalBuffer } },
        { binding: WGSL_BINDINGS.config, resource: { buffer: configBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupCount);
    pass.end();
    encoder.copyBufferToBuffer(finalBuffer, 0, readbackBuffer, 0, Math.max(stateBytes, 4));
    device.queue.submit([encoder.finish()]);

    await readbackBuffer.mapAsync(GPU_BUFFER_USAGE.MAP_READ);
    // Copy before unmapping: the mapped range is detached by `unmap()`, so a
    // view onto it would read as an empty buffer by the time the caller looked.
    const out = new Float32Array(readbackBuffer.getMappedRange().slice(0, stateBytes));
    readbackBuffer.unmap();
    return out;
  } finally {
    paramsBuffer.destroy();
    initialBuffer.destroy();
    finalBuffer.destroy();
    readbackBuffer.destroy();
    configBuffer.destroy();
  }
}
