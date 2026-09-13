import type { PlanarDragParams } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";

import type { GpuBufferLike, GpuComputeDeviceLike } from "./wgsl-rk4-dispatch.js";
import {
  GPU_BUFFER_USAGE,
  WGSL_CONFIG_BYTES,
  assertWorkgroupSizeMatchesSource,
  packConfig,
  packInitialStates,
  packPlanarParams,
  planDispatch,
  runWgslRk4,
} from "./wgsl-rk4-dispatch.js";
import {
  WGSL_BINDINGS,
  WGSL_ENTRY_POINT,
  WGSL_PARAMS_STRIDE_BYTES,
  WGSL_PARAM_COUNT,
  WGSL_RK4_KERNEL_SOURCE,
  WGSL_STATE_DIM,
  WGSL_WORKGROUP_SIZE,
} from "./wgsl-rk4-kernel.js";

/**
 * **What this file can and cannot establish, stated before the assertions.**
 *
 * It runs under Node, where there is no `navigator.gpu`, against a recording
 * fake device. So it verifies the *host protocol*: the bindings the kernel
 * declares are the bindings that get bound, the buffers carry the usage flags
 * their role requires, the parameter array is packed at the stride the struct
 * layout dictates, the dispatch covers every trajectory, the result is copied
 * out before the mapping is torn down, and nothing leaks.
 *
 * It establishes **nothing** about whether a real driver agrees with the CPU
 * reference numerically. That is `scripts/measure-gpu-rk4-agreement.mjs`, which
 * needs a device, and its numbers are the ones P7.14's criterion is about. A
 * green run here with a red run there means the physics is wrong; the reverse
 * means the plumbing is wrong. Keeping them separate is what makes either
 * informative.
 */

const PARAMS_A: PlanarDragParams = {
  mass: 0.145,
  area: 0.00426,
  cd: 0.35,
  rho: 1.225,
  g: 9.80665,
  windX: 0,
  windY: 0,
};
const PARAMS_B: PlanarDragParams = { ...PARAMS_A, mass: 0.2, cd: 0.47, windX: -3.5, windY: 1.25 };

interface RecordedBuffer extends GpuBufferLike {
  readonly id: number;
  readonly size: number;
  readonly usage: number;
  destroyed: boolean;
  unmapped: boolean;
}

interface Recording {
  readonly buffers: RecordedBuffer[];
  readonly writes: { buffer: RecordedBuffer; offset: number; byteLength: number }[];
  readonly copies: { from: number; to: number; size: number }[];
  readonly dispatches: number[];
  readonly bindGroups: { binding: number; bufferId: number }[][];
  readonly shaderSources: string[];
  readonly entryPoints: string[];
  readonly bindGroupLayoutIndices: number[];
  readonly setBindGroupIndices: number[];
  submitCount: number;
  passesEnded: number;
  mapModes: number[];
  /** Order of the two operations that must not be swapped. */
  readonly readbackOrder: string[];
}

/**
 * A fake device that records the protocol and serves readback from whatever the
 * test says the "GPU" produced.
 *
 * Deliberately not a mock library: the assertions below are about a *sequence*
 * of calls with data flowing between them, and an expressive record of what
 * happened reads better than a pile of `toHaveBeenCalledWith`.
 */
function createRecordingDevice(finalStates: Float32Array): {
  device: GpuComputeDeviceLike;
  recording: Recording;
} {
  let nextId = 0;
  const recording: Recording = {
    buffers: [],
    writes: [],
    copies: [],
    dispatches: [],
    bindGroups: [],
    shaderSources: [],
    entryPoints: [],
    bindGroupLayoutIndices: [],
    setBindGroupIndices: [],
    submitCount: 0,
    passesEnded: 0,
    mapModes: [],
    readbackOrder: [],
  };

  const makeBuffer = (size: number, usage: number): RecordedBuffer => {
    const buffer: RecordedBuffer = {
      id: nextId++,
      size,
      usage,
      destroyed: false,
      unmapped: false,
      mapAsync: (mode: number) => {
        recording.mapModes.push(mode);
        return Promise.resolve();
      },
      getMappedRange: () => {
        recording.readbackOrder.push("getMappedRange");
        // A fresh copy, sized like the real mapped range, so a test that read
        // after `unmap()` could not accidentally succeed on a shared view.
        const bytes = new Uint8Array(size);
        bytes.set(new Uint8Array(finalStates.buffer, 0, Math.min(finalStates.byteLength, size)));
        return bytes.buffer;
      },
      unmap: () => {
        recording.readbackOrder.push("unmap");
        buffer.unmapped = true;
      },
      destroy: () => {
        buffer.destroyed = true;
      },
    };
    recording.buffers.push(buffer);
    return buffer;
  };

  const device: GpuComputeDeviceLike = {
    queue: {
      writeBuffer: (buffer, offset, data) => {
        recording.writes.push({
          buffer: buffer as RecordedBuffer,
          offset,
          byteLength: data.byteLength,
        });
      },
      submit: (commandBuffers) => {
        recording.submitCount += commandBuffers.length;
      },
    },
    createShaderModule: ({ code }) => {
      recording.shaderSources.push(code);
      return { code };
    },
    createBuffer: ({ size, usage }) => makeBuffer(size, usage),
    createComputePipeline: ({ compute }) => {
      recording.entryPoints.push(compute.entryPoint);
      return {
        getBindGroupLayout: (index: number) => {
          recording.bindGroupLayoutIndices.push(index);
          return { index };
        },
      };
    },
    createBindGroup: ({ entries }) => {
      recording.bindGroups.push(
        entries.map((e) => ({
          binding: e.binding,
          bufferId: (e.resource.buffer as RecordedBuffer).id,
        })),
      );
      return {};
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => {},
        setBindGroup: (index: number) => {
          recording.setBindGroupIndices.push(index);
        },
        dispatchWorkgroups: (x: number) => {
          recording.dispatches.push(x);
        },
        end: () => {
          recording.passesEnded += 1;
        },
      }),
      copyBufferToBuffer: (source, _so, destination, _do, size) => {
        recording.copies.push({
          from: (source as RecordedBuffer).id,
          to: (destination as RecordedBuffer).id,
          size,
        });
      },
      finish: () => ({}),
    }),
  };

  return { device, recording };
}

describe("parameter packing matches the struct layout the shader declares", () => {
  it("packs seven f32 per trajectory in declaration order", () => {
    const packed = packPlanarParams([PARAMS_A, PARAMS_B]);
    expect(packed.length).toBe(2 * WGSL_PARAM_COUNT);
    expect(packed[0]).toBe(Math.fround(PARAMS_A.mass));
    expect(packed[1]).toBe(Math.fround(PARAMS_A.area));
    expect(packed[2]).toBe(Math.fround(PARAMS_A.cd));
    expect(packed[3]).toBe(Math.fround(PARAMS_A.rho));
    expect(packed[4]).toBe(Math.fround(PARAMS_A.g));
    expect(packed[5]).toBe(Math.fround(PARAMS_A.windX));
    expect(packed[6]).toBe(Math.fround(PARAMS_A.windY));
  });

  it("uses exactly the exported stride, so trajectory i starts where the shader looks for it", () => {
    const packed = packPlanarParams([PARAMS_A, PARAMS_B]);
    expect(packed.byteLength / 2).toBe(WGSL_PARAMS_STRIDE_BYTES);
    // The second struct's first field, at the stride the shader assumes.
    expect(packed[WGSL_PARAMS_STRIDE_BYTES / 4]).toBe(Math.fround(PARAMS_B.mass));
  });

  it("rounds every parameter to binary32 exactly once, as roundParams does on the CPU side", () => {
    // 0.1 is not representable in binary32; the packed value must be the f32
    // neighbour, not the f64 value, or the two paths start from different inputs.
    const packed = packPlanarParams([{ ...PARAMS_A, cd: 0.1 }]);
    expect(packed[2]).toBe(Math.fround(0.1));
    expect(packed[2]).not.toBe(0.1);
  });
});

describe("initial-state packing", () => {
  it("packs DIM channels per trajectory contiguously", () => {
    const packed = packInitialStates([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    expect([...packed]).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(packed.length).toBe(2 * WGSL_STATE_DIM);
  });
});

describe("the config uniform", () => {
  it("writes h as f32 and the counts as u32", () => {
    const buffer = packConfig(0.001, 3000, 10_000);
    expect(buffer.byteLength).toBe(WGSL_CONFIG_BYTES);
    expect(new Float32Array(buffer, 0, 1)[0]).toBe(Math.fround(0.001));
    const words = new Uint32Array(buffer, 4, 3);
    expect(words[0]).toBe(3000);
    expect(words[1]).toBe(10_000);
    expect(words[2]).toBe(0);
  });

  it("does not store the step count as a float, which the shader would read as nonsense", () => {
    const buffer = packConfig(0.001, 3000, 1);
    // If `steps` had been written through a Float32Array, the u32 at offset 4
    // would be 3000's float bit pattern (0x453B8000 = 1160773632).
    expect(new Uint32Array(buffer, 4, 1)[0]).not.toBe(1_160_773_632);
  });
});

describe("dispatch planning covers every trajectory", () => {
  it("rounds up so a partial final workgroup still runs", () => {
    expect(planDispatch(10_000, 64).workgroupCount).toBe(157);
    expect(157 * 64).toBeGreaterThanOrEqual(10_000);
    expect(156 * 64).toBeLessThan(10_000);
  });

  it("is exact when the count divides evenly", () => {
    expect(planDispatch(128, 64).workgroupCount).toBe(2);
  });

  it("dispatches nothing for an empty ensemble", () => {
    expect(planDispatch(0, 64).workgroupCount).toBe(0);
  });

  it("rejects a non-integer or negative count rather than dispatching a fraction", () => {
    expect(() => planDispatch(1.5, 64)).toThrow(RangeError);
    expect(() => planDispatch(-1, 64)).toThrow(RangeError);
    expect(() => planDispatch(10, 0)).toThrow(RangeError);
  });
});

describe("the workgroup-size guard", () => {
  it("accepts the shipped source at the shipped constant", () => {
    expect(() =>
      assertWorkgroupSizeMatchesSource(WGSL_RK4_KERNEL_SOURCE, WGSL_WORKGROUP_SIZE),
    ).not.toThrow();
  });

  it("rejects a size the shader text does not declare", () => {
    expect(() => assertWorkgroupSizeMatchesSource(WGSL_RK4_KERNEL_SOURCE, 256)).toThrow(
      /declares 64/,
    );
  });

  it("rejects a source with no compute entry point at all", () => {
    expect(() => assertWorkgroupSizeMatchesSource("fn main() {}", 64)).toThrow(/no @compute/);
  });

  it("reads the literal rather than the exported constant, so P7.15 can vary both together", () => {
    const swept = WGSL_RK4_KERNEL_SOURCE.replace("@workgroup_size(64)", "@workgroup_size(256)");
    expect(() => assertWorkgroupSizeMatchesSource(swept, 256)).not.toThrow();
    expect(() => assertWorkgroupSizeMatchesSource(swept, 64)).toThrow(/declares 256/);
  });
});

describe("runWgslRk4 speaks the protocol the kernel declares", () => {
  const expected = new Float32Array([11, 12, 13, 14, 21, 22, 23, 24]);

  async function run(): Promise<{ out: Float32Array; recording: Recording }> {
    const { device, recording } = createRecordingDevice(expected);
    const out = await runWgslRk4(device, {
      params: [PARAMS_A, PARAMS_B],
      initialStates: [
        [0, 0, 30, 40],
        [0, 1, 25, 35],
      ],
      h: 0.001,
      steps: 2000,
    });
    return { out, recording };
  }

  it("returns the final states read back from the device", async () => {
    const { out } = await run();
    expect([...out]).toStrictEqual([...expected]);
  });

  it("binds each buffer at the binding index the shader declares", async () => {
    const { recording } = await run();
    expect(recording.bindGroups).toHaveLength(1);
    const bound = recording.bindGroups[0]!;
    expect(bound.map((b) => b.binding)).toStrictEqual([
      WGSL_BINDINGS.params,
      WGSL_BINDINGS.initialStates,
      WGSL_BINDINGS.finalStates,
      WGSL_BINDINGS.config,
    ]);
    // Four distinct buffers, not the same one bound twice.
    expect(new Set(bound.map((b) => b.bufferId)).size).toBe(4);
  });

  it("gives every buffer the usage flags its role requires", async () => {
    const { recording } = await run();
    const [paramsBuf, initialBuf, finalBuf, readbackBuf, configBuf] = recording.buffers;
    expect(paramsBuf!.usage & GPU_BUFFER_USAGE.STORAGE).toBeTruthy();
    expect(paramsBuf!.usage & GPU_BUFFER_USAGE.COPY_DST).toBeTruthy();
    expect(initialBuf!.usage & GPU_BUFFER_USAGE.STORAGE).toBeTruthy();
    expect(finalBuf!.usage & GPU_BUFFER_USAGE.COPY_SRC).toBeTruthy();
    // The readback buffer must NOT be a storage buffer: MAP_READ may only be
    // combined with COPY_DST, and a driver rejects the combination outright.
    expect(readbackBuf!.usage).toBe(GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ);
    expect(configBuf!.usage & GPU_BUFFER_USAGE.UNIFORM).toBeTruthy();
  });

  it("sizes the state buffers to DIM f32 per trajectory and the uniform to the struct", async () => {
    const { recording } = await run();
    const [paramsBuf, initialBuf, finalBuf, readbackBuf, configBuf] = recording.buffers;
    expect(paramsBuf!.size).toBe(2 * WGSL_PARAMS_STRIDE_BYTES);
    expect(initialBuf!.size).toBe(2 * WGSL_STATE_DIM * 4);
    expect(finalBuf!.size).toBe(2 * WGSL_STATE_DIM * 4);
    expect(readbackBuf!.size).toBe(2 * WGSL_STATE_DIM * 4);
    expect(configBuf!.size).toBe(WGSL_CONFIG_BYTES);
  });

  it("uploads params, initial states and config, and nothing else", async () => {
    const { recording } = await run();
    expect(recording.writes).toHaveLength(3);
    expect(recording.writes[0]!.byteLength).toBe(2 * WGSL_PARAMS_STRIDE_BYTES);
    expect(recording.writes[1]!.byteLength).toBe(2 * WGSL_STATE_DIM * 4);
    expect(recording.writes[2]!.byteLength).toBe(WGSL_CONFIG_BYTES);
    expect(recording.writes.every((w) => w.offset === 0)).toBe(true);
  });

  it("compiles the shipped source at the shipped entry point", async () => {
    const { recording } = await run();
    expect(recording.shaderSources).toStrictEqual([WGSL_RK4_KERNEL_SOURCE]);
    expect(recording.entryPoints).toStrictEqual([WGSL_ENTRY_POINT]);
    expect(recording.bindGroupLayoutIndices).toStrictEqual([0]);
    expect(recording.setBindGroupIndices).toStrictEqual([0]);
  });

  it("dispatches enough workgroups for the ensemble, ends the pass and submits once", async () => {
    const { recording } = await run();
    expect(recording.dispatches).toStrictEqual([
      planDispatch(2, WGSL_WORKGROUP_SIZE).workgroupCount,
    ]);
    expect(recording.passesEnded).toBe(1);
    expect(recording.submitCount).toBe(1);
  });

  it("copies the final buffer into the readback buffer and maps it for reading", async () => {
    const { recording } = await run();
    const [, , finalBuf, readbackBuf] = recording.buffers;
    expect(recording.copies).toStrictEqual([
      { from: finalBuf!.id, to: readbackBuf!.id, size: 2 * WGSL_STATE_DIM * 4 },
    ]);
    expect(recording.mapModes).toStrictEqual([GPU_BUFFER_USAGE.MAP_READ]);
  });

  it("reads the mapping before unmapping it, not after", async () => {
    const { recording } = await run();
    expect(recording.readbackOrder).toStrictEqual(["getMappedRange", "unmap"]);
  });

  it("destroys every buffer it created", async () => {
    const { recording } = await run();
    expect(recording.buffers).toHaveLength(5);
    expect(recording.buffers.every((b) => b.destroyed)).toBe(true);
  });

  it("destroys them on the error path too", async () => {
    const { device, recording } = createRecordingDevice(expected);
    const failing: GpuComputeDeviceLike = {
      ...device,
      createComputePipeline: () => {
        throw new Error("shader compilation failed");
      },
    };
    await expect(
      runWgslRk4(failing, {
        params: [PARAMS_A],
        initialStates: [[0, 0, 1, 1]],
        h: 0.001,
        steps: 10,
      }),
    ).rejects.toThrow(/shader compilation failed/);
    expect(recording.buffers).toHaveLength(5);
    expect(recording.buffers.every((b) => b.destroyed)).toBe(true);
  });

  it("rejects an ensemble whose params and initial states disagree in length", async () => {
    const { device } = createRecordingDevice(expected);
    await expect(
      runWgslRk4(device, {
        params: [PARAMS_A, PARAMS_B],
        initialStates: [[0, 0, 1, 1]],
        h: 0.001,
        steps: 10,
      }),
    ).rejects.toThrow(/same ensemble/);
  });

  it("rejects a caller-supplied workgroup size the shader text contradicts", async () => {
    const { device } = createRecordingDevice(expected);
    await expect(
      runWgslRk4(device, {
        params: [PARAMS_A],
        initialStates: [[0, 0, 1, 1]],
        h: 0.001,
        steps: 10,
        workgroupSize: 128,
      }),
    ).rejects.toThrow(/workgroup size mismatch/);
  });

  it("rejects a fractional step count rather than truncating it silently", async () => {
    const { device } = createRecordingDevice(expected);
    await expect(
      runWgslRk4(device, {
        params: [PARAMS_A],
        initialStates: [[0, 0, 1, 1]],
        h: 0.001,
        steps: 10.5,
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe("the hand-written GPUBufferUsage values", () => {
  it("are the specification's bit values, which the measurement script re-checks against the browser", () => {
    expect(GPU_BUFFER_USAGE.MAP_READ).toBe(0x0001);
    expect(GPU_BUFFER_USAGE.COPY_SRC).toBe(0x0004);
    expect(GPU_BUFFER_USAGE.COPY_DST).toBe(0x0008);
    expect(GPU_BUFFER_USAGE.UNIFORM).toBe(0x0040);
    expect(GPU_BUFFER_USAGE.STORAGE).toBe(0x0080);
  });

  it("are distinct single bits, so an OR of any two is unambiguous", () => {
    const values = Object.values(GPU_BUFFER_USAGE);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v & (v - 1)).toBe(0);
  });
});
