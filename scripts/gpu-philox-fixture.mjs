// Shared fixture for P7.21's GPU/CPU Philox agreement measurement.
//
// Same two-way arrangement as `gpu-observables-fixture.mjs`: plain JS, only
// relative imports into already-built `dist/`, no Node-only APIs, so one file is
// imported under Node to compute the CPU reference and bundled into Playwright
// Chromium to dispatch the kernel on a real device.
//
// ## WHY THIS COMPARISON IS EXACT AND NOT A TOLERANCE
//
// Every other GPU check in this repo gates on ULP, because every other one
// compares floating-point results and a conformant implementation is permitted
// latitude there -- FMA contraction, mainly. This one does not, and the reason
// is not strictness: the generator is INTEGER arithmetic. u32 add, multiply,
// shift and xor are exactly specified modulo 2^32, so a conformant WGSL
// implementation has no latitude at all. One bit of disagreement is one bug.
//
// The uniform conversion is the one floating-point step, and it is exact too by
// construction: `f32(word >> 8u)` is exact for every input because the value
// fits in 24 bits, and multiplying by 2^-24 is exact because it is a power of
// two. So the f32 arm is bit-identical as well, and any tolerance here would be
// covering for a defect rather than for arithmetic latitude.
//
// ## WHAT A SOFTWARE ADAPTER DOES AND DOES NOT ESTABLISH
//
// The same distinction the compensated-impact and observables scripts draw. This
// is a question about ARITHMETIC, and the same WGSL with the same u32 semantics
// runs on either adapter, so a bit-identical result here is evidence about the
// SHADER. It is not evidence about throughput, this script measures no time, and
// P7.20's 1e6 trajectories/s target remains untouched by anything here.

import {
  philox4x32,
  philox4x32Uniforms,
  replicateCounter,
  u32ToUnitFloatF32,
} from "../packages/engine/dist/philox.js";
import {
  WGSL_PHILOX_FNS,
  WGSL_PHILOX_REPLICATE_COUNTER,
} from "../packages/runtime/dist/wgsl-philox.js";

/** Four words and four uniforms per replicate. */
export const PHILOX_LANES = 4;

/** The workgroup size the check dispatches at. */
export const WORKGROUP_SIZE = 64;

/**
 * The kernel: the shared generator text, a counter convention, and an entry
 * point that writes both arms' outputs.
 *
 * Both the raw words and the uniforms are written, rather than only the
 * uniforms, because they fail differently and a check that saw only the
 * uniforms could not tell them apart. A wrong *generator* and a wrong
 * *conversion* both show up as disagreeing floats; only the words separate
 * them, and the words are also the arm where "exact" is unarguable.
 *
 * The count guard is the same out-of-range guard every kernel here carries: a
 * dispatch is rounded up to whole workgroups, so the tail invocations must not
 * write.
 */
export function buildPhiloxKernelSource(workgroupSize = WORKGROUP_SIZE) {
  return `${WGSL_PHILOX_FNS}

${WGSL_PHILOX_REPLICATE_COUNTER}

struct PhiloxConfig {
  count: u32,
  key0: u32,
  key1: u32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> config: PhiloxConfig;
@group(0) @binding(1) var<storage, read_write> words: array<u32>;
@group(0) @binding(2) var<storage, read_write> uniforms: array<f32>;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= config.count) {
    return;
  }

  let key = vec2<u32>(config.key0, config.key1);
  let ctr = philoxReplicateCounter(i);
  let w = philox4x32(ctr, key);
  let u = philox4x32Uniforms(ctr, key);

  let base = i * 4u;
  words[base + 0u] = w.x;
  words[base + 1u] = w.y;
  words[base + 2u] = w.z;
  words[base + 3u] = w.w;
  uniforms[base + 0u] = u.x;
  uniforms[base + 1u] = u.y;
  uniforms[base + 2u] = u.z;
  uniforms[base + 3u] = u.w;
}`;
}

/**
 * The CPU reference: the same replicates, the same key, both arms.
 *
 * `u32ToUnitFloatF32` and not `u32ToUnitFloat` -- the f64 conversion is the CPU
 * path's and would differ from the shader in the low bits by design. Comparing
 * against it would manufacture a disagreement and then need a tolerance to hide
 * it, which is exactly the shape of mistake this pairing exists to avoid.
 */
export function computeCpuPhilox(count, key) {
  const words = new Uint32Array(count * PHILOX_LANES);
  const uniforms = new Float32Array(count * PHILOX_LANES);
  for (let i = 0; i < count; i++) {
    const out = philox4x32(replicateCounter(i), key);
    const base = i * PHILOX_LANES;
    for (let lane = 0; lane < PHILOX_LANES; lane++) {
      words[base + lane] = out[lane];
      uniforms[base + lane] = u32ToUnitFloatF32(out[lane]);
    }
  }
  return { words, uniforms };
}

/**
 * The CPU f64 uniforms, for the report only.
 *
 * Reported so the run states what the two conversions cost relative to each
 * other rather than leaving a reader to assume they are the same number. Never
 * gated on: it is a different computation, deliberately.
 */
export function computeCpuUniformsF64(count, key) {
  const out = new Float64Array(count * PHILOX_LANES);
  for (let i = 0; i < count; i++) {
    const u = philox4x32Uniforms(replicateCounter(i), key);
    for (let lane = 0; lane < PHILOX_LANES; lane++) out[i * PHILOX_LANES + lane] = u[lane];
  }
  return out;
}

/**
 * Browser side: obtain a device, dispatch the kernel, return both arms.
 *
 * Reports rather than throws on every "no GPU here" outcome, matching the other
 * fixtures' contract: the caller must be able to tell "the generator disagrees"
 * from "there was nothing to run it on", and an exception conflates them.
 */
export async function runGpuPhilox(count, key, workgroupSize) {
  if (!("gpu" in navigator)) {
    return { status: "unsupported", reason: "no-navigator-gpu", secureContext: isSecureContext };
  }
  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (error) {
    return { status: "unsupported", reason: "adapter-request-failed", error: String(error) };
  }
  if (!adapter) {
    return { status: "unsupported", reason: "no-adapter", secureContext: isSecureContext };
  }

  let device;
  try {
    device = await adapter.requestDevice();
  } catch (error) {
    return { status: "unsupported", reason: "device-request-failed", error: String(error) };
  }

  const info = adapter.info ?? {};
  const adapterInfo = {
    vendor: info.vendor ?? null,
    architecture: info.architecture ?? null,
    device: info.device ?? null,
    description: info.description ?? null,
    isFallbackAdapter: adapter.isFallbackAdapter ?? null,
  };

  const captured = [];
  device.addEventListener?.("uncapturederror", (event) => {
    captured.push(String(event.error ?? event));
  });

  const byteLength = count * PHILOX_LANES * 4;
  const created = [];
  const track = (buffer) => {
    created.push(buffer);
    return buffer;
  };

  try {
    const configData = new Uint32Array([count, key[0] >>> 0, key[1] >>> 0, 0]);
    const configBuffer = track(
      device.createBuffer({
        size: configData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    );
    device.queue.writeBuffer(configBuffer, 0, configData);

    const storage = (name) =>
      track(
        device.createBuffer({
          label: name,
          size: byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        }),
      );
    const wordsBuffer = storage("words");
    const uniformsBuffer = storage("uniforms");

    const readback = (name) =>
      track(
        device.createBuffer({
          label: name,
          size: byteLength,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
      );
    const wordsRead = readback("words-read");
    const uniformsRead = readback("uniforms-read");

    const kernelSource = buildPhiloxKernelSource(workgroupSize);
    const module = device.createShaderModule({ code: kernelSource });
    const compilation = await module.getCompilationInfo?.();
    const shaderMessages = (compilation?.messages ?? []).map((m) => ({
      type: m.type,
      lineNum: m.lineNum,
      message: m.message,
    }));
    if (shaderMessages.some((m) => m.type === "error")) {
      return { status: "failed", reason: "shader-compile-error", shaderMessages, adapterInfo };
    }

    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: configBuffer } },
        { binding: 1, resource: { buffer: wordsBuffer } },
        { binding: 2, resource: { buffer: uniformsBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / workgroupSize));
    pass.end();
    encoder.copyBufferToBuffer(wordsBuffer, 0, wordsRead, 0, byteLength);
    encoder.copyBufferToBuffer(uniformsBuffer, 0, uniformsRead, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    await wordsRead.mapAsync(GPUMapMode.READ);
    await uniformsRead.mapAsync(GPUMapMode.READ);
    const words = Array.from(new Uint32Array(wordsRead.getMappedRange().slice(0)));
    const uniforms = Array.from(new Float32Array(uniformsRead.getMappedRange().slice(0)));
    wordsRead.unmap();
    uniformsRead.unmap();

    return {
      status: "measured",
      adapterInfo,
      deviceErrors: captured,
      shaderMessages,
      kernelLength: kernelSource.length,
      words,
      uniforms,
    };
  } catch (error) {
    return { status: "failed", reason: "dispatch-failed", error: String(error), adapterInfo };
  } finally {
    for (const buffer of created) buffer.destroy?.();
    device.destroy?.();
  }
}
