/**
 * P7.13's tests. The criterion is "unsupported browsers get graceful CPU
 * path", so the shape of this file follows it: the *absence* of WebGPU is the
 * subject, and the success path is the short section at the end.
 *
 * Two things are asserted here that a reader might expect to find only in a
 * comment, deliberately:
 *
 * 1. **`probeWebGpu` never rejects, for any of its four failure modes.** That
 *    is the criterion restated -- a probe that throws is the un-graceful path.
 * 2. **`BROWSER_CPU_BACKENDS` is exactly `["ts"]`.** The repository has three
 *    CPU backends and a browser can reach one of them, because
 *    `@ballista/wasm-core` reads its artifact via `node:fs/promises`. That is
 *    P0.133. Asserting it means the day it is fixed, this test fails and the
 *    panel's prose is revisited, rather than the app quietly continuing to tell
 *    users their fallback is a backend they cannot reach.
 */

import { describe, expect, it } from "vitest";
import {
  BACKEND_LABELS,
  BROWSER_CPU_BACKENDS,
  CPU_BACKEND_PREFERENCE,
  NODE_CPU_BACKENDS,
  REPORTED_WEBGPU_LIMITS,
  detectComputeCapability,
  probeWebGpu,
  selectExecutionPlan,
  type CpuCapabilities,
  type ExecutionBackendId,
  type GpuAdapterLike,
  type GpuLike,
  type WebGpuProbeResult,
} from "./webgpu-capability.js";

const browserCpu: CpuCapabilities = { available: BROWSER_CPU_BACKENDS, hardwareConcurrency: 4 };
const nodeCpu: CpuCapabilities = { available: NODE_CPU_BACKENDS, hardwareConcurrency: 4 };

const unsupported = (reason: WebGpuProbeResult["reason"]): WebGpuProbeResult =>
  ({ supported: false, reason, error: null }) as WebGpuProbeResult;

/** An adapter that works, reporting the five limits P7.14-P7.20 will read. */
function workingAdapter(overrides: Partial<GpuAdapterLike> = {}): GpuAdapterLike {
  return {
    info: { vendor: "test-vendor", architecture: "test-arch", device: "", description: "" },
    features: new Set(["timestamp-query", "shader-f16"]),
    limits: {
      maxComputeWorkgroupSizeX: 256,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupsPerDimension: 65535,
      maxStorageBufferBindingSize: 134217728,
      maxBufferSize: 268435456,
      maxTextureDimension2D: 8192,
    },
    requestDevice: () => Promise.resolve({ destroy: () => undefined }),
    ...overrides,
  };
}

const gpuReturning = (adapter: GpuAdapterLike | null): GpuLike => ({
  requestAdapter: () => Promise.resolve(adapter),
});

describe("probeWebGpu answers rather than throwing, for every way WebGPU can be missing", () => {
  it("reports no-navigator-gpu when there is no GPU object at all", async () => {
    const result = await probeWebGpu(undefined);
    expect(result.supported).toBe(false);
    expect(result).toMatchObject({ reason: "no-navigator-gpu", error: null });
  });

  it("reports no-navigator-gpu when the GPU object has no requestAdapter", async () => {
    // A partial or shimmed `navigator.gpu` is a real thing on old Chromium
    // builds behind a flag; it is 'no WebGPU' rather than a crash.
    const result = await probeWebGpu({} as GpuLike);
    expect(result).toMatchObject({ supported: false, reason: "no-navigator-gpu" });
  });

  it("reports no-adapter when requestAdapter resolves null", async () => {
    const result = await probeWebGpu(gpuReturning(null));
    expect(result).toMatchObject({ supported: false, reason: "no-adapter", error: null });
  });

  it("reports adapter-request-failed, with the message, when requestAdapter throws", async () => {
    const gpu: GpuLike = {
      requestAdapter: () => Promise.reject(new Error("adapter exploded")),
    };
    const result = await probeWebGpu(gpu);
    expect(result).toMatchObject({
      supported: false,
      reason: "adapter-request-failed",
      error: "adapter exploded",
    });
  });

  it("reports device-request-failed when an adapter exists but the device rejects", async () => {
    // The case that would otherwise surface as a crash inside P7.14's first
    // dispatch: a present adapter is not a usable GPU.
    const gpu = gpuReturning(
      workingAdapter({ requestDevice: () => Promise.reject(new Error("device lost")) }),
    );
    const result = await probeWebGpu(gpu);
    expect(result).toMatchObject({
      supported: false,
      reason: "device-request-failed",
      error: "device lost",
    });
  });

  it("survives a thrown non-Error, reporting a null message rather than inventing one", async () => {
    const gpu: GpuLike = { requestAdapter: () => Promise.reject("nope") };
    const result = await probeWebGpu(gpu);
    expect(result).toMatchObject({ supported: false, reason: "adapter-request-failed" });
    expect(result.supported ? null : result.error).toBe("nope");
  });

  it("survives a synchronously throwing requestAdapter, not only a rejected promise", async () => {
    const gpu: GpuLike = {
      requestAdapter: () => {
        throw new Error("sync throw");
      },
    };
    await expect(probeWebGpu(gpu)).resolves.toMatchObject({
      supported: false,
      reason: "adapter-request-failed",
    });
  });
});

describe("probeWebGpu on a working adapter", () => {
  it("reports supported, with the adapter info and sorted features", async () => {
    const result = await probeWebGpu(gpuReturning(workingAdapter()));
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(result.adapter.vendor).toBe("test-vendor");
    // Sorted so two runs on the same machine produce the same report text.
    expect(result.features).toEqual(["shader-f16", "timestamp-query"]);
  });

  it("summarises exactly the five limits Phase 7 needs and drops the rest", async () => {
    const result = await probeWebGpu(gpuReturning(workingAdapter()));
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(Object.keys(result.limits).sort()).toEqual([...REPORTED_WEBGPU_LIMITS].sort());
    expect(result.limits.maxComputeWorkgroupSizeX).toBe(256);
    expect(result.limits.maxBufferSize).toBe(268435456);
    expect(result.limits).not.toHaveProperty("maxTextureDimension2D");
  });

  it("reports null for a limit the adapter omits rather than guessing a default", async () => {
    const adapter = workingAdapter({ limits: { maxComputeWorkgroupSizeX: 128 } });
    const result = await probeWebGpu(gpuReturning(adapter));
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(result.limits.maxComputeWorkgroupSizeX).toBe(128);
    expect(result.limits.maxBufferSize).toBeNull();
  });

  it("treats an adapter that reports no info at all as normal, not as a failure", async () => {
    // Firefox and Safari blank these as a fingerprinting defence. The keys are
    // omitted rather than set to `undefined`: under `exactOptionalPropertyTypes`
    // those are different types, and an absent property is what a real adapter
    // presents.
    const bare: GpuAdapterLike = {
      requestDevice: () => Promise.resolve({ destroy: () => undefined }),
    };
    const result = await probeWebGpu(gpuReturning(bare));
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(result.adapter).toEqual({});
    expect(result.features).toEqual([]);
  });

  it("destroys the device it created rather than pinning one for the page's lifetime", async () => {
    let destroyed = 0;
    const adapter = workingAdapter({
      requestDevice: () => Promise.resolve({ destroy: () => void destroyed++ }),
    });
    await probeWebGpu(gpuReturning(adapter));
    expect(destroyed).toBe(1);
  });

  it("still reports supported when the device has no destroy, or destroy throws", async () => {
    const noDestroy = await probeWebGpu(
      gpuReturning(workingAdapter({ requestDevice: () => Promise.resolve({}) })),
    );
    expect(noDestroy.supported).toBe(true);

    const throwing = await probeWebGpu(
      gpuReturning(
        workingAdapter({
          requestDevice: () =>
            Promise.resolve({
              destroy: () => {
                throw new Error("destroy exploded");
              },
            }),
        }),
      ),
    );
    expect(throwing.supported).toBe(true);
  });
});

describe("selectExecutionPlan always names a backend that will actually run", () => {
  it("takes the GPU when the probe supported it", async () => {
    const webgpu = await probeWebGpu(gpuReturning(workingAdapter()));
    const plan = selectExecutionPlan(webgpu, browserCpu);
    expect(plan).toMatchObject({ backendId: "webgpu", kind: "gpu", parallelism: 1 });
  });

  it.each([
    "no-navigator-gpu",
    "no-adapter",
    "adapter-request-failed",
    "device-request-failed",
  ] as const)("falls back to a CPU backend when WebGPU is %s", (reason) => {
    const plan = selectExecutionPlan(unsupported(reason), browserCpu);
    expect(plan.kind).toBe("cpu");
    expect(plan.backendId).toBe("ts");
    // The fallback story is explicit only if it says why -- the criterion.
    expect(plan.reason).toContain(reason);
  });

  it("prefers the fastest reachable CPU backend, in the measured order", () => {
    const plan = selectExecutionPlan(unsupported("no-adapter"), nodeCpu);
    expect(plan.backendId).toBe("wasm-simd");
    expect(plan.label).toBe(BACKEND_LABELS["wasm-simd"]);
  });

  it("drops to the next backend down when the better one is unreachable", () => {
    const plan = selectExecutionPlan(unsupported("no-adapter"), {
      available: ["wasm", "ts"],
      hardwareConcurrency: 4,
    });
    expect(plan.backendId).toBe("wasm");
  });

  it("still names the TypeScript stepper when the available list is empty", () => {
    // The un-graceful outcome would be a report naming no backend at all. The
    // TS stepper needs nothing but the engine already running this test.
    const plan = selectExecutionPlan(unsupported("no-navigator-gpu"), {
      available: [],
      hardwareConcurrency: 2,
    });
    expect(plan.backendId).toBe("ts");
    expect(plan.reason).toContain("0 ULP");
  });

  it("carries hardwareConcurrency through as parallelism, floored at 1", () => {
    const at = (hardwareConcurrency: number) =>
      selectExecutionPlan(unsupported("no-adapter"), { available: ["ts"], hardwareConcurrency })
        .parallelism;
    expect(at(4)).toBe(4);
    expect(at(0)).toBe(1);
    expect(at(-3)).toBe(1);
    expect(at(2.9)).toBe(2);
  });

  it("labels every backend id it can return", () => {
    for (const id of ["webgpu", ...CPU_BACKEND_PREFERENCE] satisfies ExecutionBackendId[]) {
      expect(BACKEND_LABELS[id]).toBeTruthy();
    }
  });
});

describe("what a browser can actually reach", () => {
  it("is the TypeScript stepper and nothing else, until P0.133 is fixed", () => {
    // Not a simplification. `@ballista/wasm-core` reads its artifact with
    // `node:fs/promises`, so the two WASM backends cannot be bundled for a
    // browser. When that changes, this assertion fails on purpose and the
    // panel's prose gets revisited with it.
    expect([...BROWSER_CPU_BACKENDS]).toEqual(["ts"]);
    expect([...NODE_CPU_BACKENDS]).toEqual(["wasm-simd", "wasm", "ts"]);
  });
});

describe("detectComputeCapability", () => {
  it("produces a full report on this container, which has no WebGPU", async () => {
    // The container is the unsupported browser the criterion is about, so this
    // is the criterion measured rather than simulated.
    const report = await detectComputeCapability();
    expect(report.webgpu.supported).toBe(false);
    expect(report.plan.kind).toBe("cpu");
    expect(report.plan.backendId).toBe("ts");
    expect(report.cpu.hardwareConcurrency).toBeGreaterThanOrEqual(1);
  });

  it("defaults to the browser backend set rather than everything the repo has", async () => {
    const report = await detectComputeCapability();
    expect([...report.cpu.available]).toEqual([...BROWSER_CPU_BACKENDS]);
  });

  it("uses an injected GPU and hardware count in preference to the globals", async () => {
    const report = await detectComputeCapability({
      gpu: gpuReturning(workingAdapter()),
      hardwareConcurrency: 8,
      cpuBackends: NODE_CPU_BACKENDS,
    });
    expect(report.webgpu.supported).toBe(true);
    expect(report.plan.backendId).toBe("webgpu");
    expect(report.cpu.hardwareConcurrency).toBe(8);
  });

  it("reports the CPU plan, without throwing, when the injected GPU fails", async () => {
    const report = await detectComputeCapability({
      gpu: { requestAdapter: () => Promise.reject(new Error("no")) },
      cpuBackends: NODE_CPU_BACKENDS,
    });
    expect(report.webgpu).toMatchObject({ supported: false, reason: "adapter-request-failed" });
    expect(report.plan.backendId).toBe("wasm-simd");
  });
});
