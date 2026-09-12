/**
 * WebGPU detection and the compute-capability report (P7.13).
 *
 * **The deliverable is the fallback story, not the detection.** Detecting
 * `navigator.gpu` is four lines; the task's validation line is "unsupported
 * browsers get graceful CPU path", and that is a claim about what happens when
 * detection says *no*. So this module's output is not a boolean. It is a
 * {@link ComputeCapabilityReport} whose centre is {@link ExecutionPlan} -- the
 * backend that **will** run, named, on every machine including the ones with no
 * GPU at all. A report that says "WebGPU: unsupported" and stops has told the
 * reader that something is missing without telling them what they get instead,
 * which is the opposite of an explicit fallback.
 *
 * **Nothing here throws, and that is the criterion rather than a nicety.** A
 * capability probe exists to answer a question about a hostile environment: no
 * `navigator.gpu` (every non-Chromium browser at time of writing, and every
 * Node process -- including the one running this file's tests), an adapter
 * request that resolves `null` because the driver is blocklisted, an adapter
 * request that throws outright, and an adapter whose `requestDevice` rejects
 * because the device was lost between the two calls. A probe that propagates
 * any of those **is** the ungraceful path the criterion forbids: the caller
 * asked "can I use the GPU?" and got an exception rather than "no". All four
 * are exercised by `webgpu-capability.test.ts` and all four produce a report.
 *
 * **The GPU is injected, never read from a global.** `probeWebGpu` takes a
 * {@link GpuLike} rather than reaching for `navigator.gpu`, for the reason
 * every other testable seam in this package is injected: the four failure modes
 * above are otherwise unreachable from a test, and the one this container can
 * reproduce naturally -- no GPU at all -- is the *least* interesting of them.
 * {@link detectComputeCapability} is the thin wrapper that does read the
 * globals, and it is deliberately the only part of this module that cannot be
 * unit-tested on its own.
 *
 * **The available CPU backends are an input, not a constant, because the
 * browser's honest answer is not the repository's.** This is the finding P7.13
 * turned up and the reason {@link BROWSER_CPU_BACKENDS} exists. The repository
 * has three CPU ensemble backends -- `createWasmEnsembleBackend` over the
 * simd128 kernel, the same over the scalar kernel, and
 * `createTsEnsembleBackend` -- but **only the last of them is reachable from a
 * browser today**, because `@ballista/wasm-core` reads its committed artifact
 * with `node:fs/promises` at module scope. `heterogeneous-executor.ts` imports
 * it `import type` precisely to keep that out of the bundle, and
 * `runtime/src/index.ts` does not re-export `backend-equivalence-golden.ts` for
 * the same reason. A capability panel that told a browser user "your fallback
 * is WebAssembly SIMD" would therefore be **stating something that cannot
 * happen in the deployed app** -- an explicit fallback story that is false is
 * worse than none, since it is the kind that gets believed. Filed as P0.133;
 * this task reports the truth rather than fixing it.
 *
 * **The structural `GpuLike` types are hand-written, and no `@webgpu/types`
 * dependency is added.** This module touches three members of the WebGPU
 * surface (`requestAdapter`, `requestDevice`, and an adapter's `limits` /
 * `features` / `info` bags) and needs none of the ~200 the package declares. It
 * follows `worker-pool.ts`'s `WorkerLike` and `wasm-core`'s hand-written
 * `webassembly.d.ts`: a structural minimum that a real `GPU` satisfies, so the
 * browser's own object can be passed straight in without a cast.
 *
 * **No WGSL, no kernel, no buffers.** That is P7.14 onward. The device this
 * module requests is requested to prove that one *can* be, and is destroyed
 * immediately -- see {@link probeWebGpu}.
 */

/**
 * A WebGPU adapter's identifying strings.
 *
 * Every field is optional because every field genuinely is: the spec permits a
 * user agent to report empty strings for all of them as a fingerprinting
 * defence, and Firefox and Safari do exactly that. The report therefore treats
 * a blank adapter as normal rather than as a detection failure.
 */
export interface GpuAdapterInfoLike {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
}

/** The three parts of a `GPUAdapter` this module reads. */
export interface GpuAdapterLike {
  readonly features?: Iterable<string>;
  readonly limits?: Readonly<Record<string, number>>;
  readonly info?: GpuAdapterInfoLike;
  requestDevice(): Promise<GpuDeviceLike>;
}

/** The one part of a `GPUDevice` this module uses, and only to give it back. */
export interface GpuDeviceLike {
  destroy?(): void;
}

/** The one method of `navigator.gpu` this module calls. */
export interface GpuLike {
  requestAdapter(options?: {
    powerPreference?: "low-power" | "high-performance";
  }): Promise<GpuAdapterLike | null>;
}

/**
 * Why WebGPU is unavailable, distinguished because the four cases call for
 * different responses from a reader and only the first is about the browser.
 *
 * - `no-navigator-gpu` -- the browser has no WebGPU at all. The user needs a
 *   different browser; nothing about this machine will change the answer.
 * - `no-adapter` -- WebGPU exists and `requestAdapter` resolved `null`. This is
 *   the spec's documented way of saying "not on this hardware": a blocklisted
 *   driver, a headless or software-rendered context, or a GPU the user agent
 *   declines to expose. A driver update may change it.
 * - `adapter-request-failed` -- `requestAdapter` threw. Not a documented
 *   outcome, so it is reported separately rather than folded into `no-adapter`:
 *   an implementation bug and a hardware answer are different findings.
 * - `device-request-failed` -- an adapter exists but `requestDevice` rejected.
 *   The GPU is present and still unusable, which is the case most likely to be
 *   mistaken for a bug in this repository if it is not named.
 */
export type WebGpuUnsupportedReason =
  "no-navigator-gpu" | "no-adapter" | "adapter-request-failed" | "device-request-failed";

/**
 * The adapter limits P7.14-P7.20 will actually need, lifted out of the ~30 a
 * `GPUSupportedLimits` carries.
 *
 * Chosen rather than copied wholesale because a capability report is read by a
 * human: the workgroup-sizing sweep (P7.15) needs the first three, the storage
 * buffers holding parameter and IC arrays (P7.15) need the last two, and
 * nothing in Phase 7 is bounded by the texture and vertex limits that make up
 * most of the rest. `null` for a limit the adapter did not report.
 */
export interface WebGpuLimitsSummary {
  readonly maxComputeWorkgroupSizeX: number | null;
  readonly maxComputeInvocationsPerWorkgroup: number | null;
  readonly maxComputeWorkgroupsPerDimension: number | null;
  readonly maxStorageBufferBindingSize: number | null;
  readonly maxBufferSize: number | null;
}

/** The limit keys {@link WebGpuLimitsSummary} reports, in the order the UI lists them. */
export const REPORTED_WEBGPU_LIMITS = [
  "maxComputeWorkgroupSizeX",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupsPerDimension",
  "maxStorageBufferBindingSize",
  "maxBufferSize",
] as const satisfies readonly (keyof WebGpuLimitsSummary)[];

/** A completed probe. Never a rejection -- see this module's header. */
export type WebGpuProbeResult =
  | {
      readonly supported: true;
      readonly reason: null;
      readonly adapter: GpuAdapterInfoLike;
      readonly features: readonly string[];
      readonly limits: WebGpuLimitsSummary;
    }
  | {
      readonly supported: false;
      readonly reason: WebGpuUnsupportedReason;
      /**
       * The thrown value's message, where there was one. Present only for the
       * two throwing reasons; `null` for the two where nothing went wrong and
       * the answer is simply "no".
       */
      readonly error: string | null;
    };

/** A backend this repository can dispatch an ensemble to. */
export type ExecutionBackendId = "webgpu" | "wasm-simd" | "wasm" | "ts";

/**
 * The CPU backends, best first.
 *
 * The order is measured rather than assumed: P7.09 measured the simd128 kernel
 * against the scalar one and P7.07 measured scalar WASM against the TypeScript
 * stepper. **`"ts"` is last and is the floor** -- it needs nothing but the
 * engine already running this code, which is what makes it a genuine fallback
 * rather than one more thing that can be absent.
 */
export const CPU_BACKEND_PREFERENCE = ["wasm-simd", "wasm", "ts"] as const;

/**
 * What a browser can actually reach today: the TypeScript stepper, and nothing
 * else.
 *
 * Not a simplification and not a placeholder -- see this module's header.
 * `@ballista/wasm-core` reads its artifact through `node:fs/promises`, so the
 * two WASM backends are Node-side today and naming either of them to a browser
 * user would be a false fallback story. Filed as P0.133. When that is fixed,
 * this constant changes and `webgpu-capability.test.ts`'s assertion about it
 * fails, which is the point of it being a constant with a test rather than a
 * sentence in a comment.
 */
export const BROWSER_CPU_BACKENDS = ["ts"] as const satisfies readonly ExecutionBackendId[];

/** Every CPU backend the repository has, for Node callers that can reach them all. */
export const NODE_CPU_BACKENDS = CPU_BACKEND_PREFERENCE;

/**
 * What the CPU side of this machine offers.
 *
 * `available` is an input rather than something this module detects, because
 * reachability is a property of the *bundle* and not of the hardware -- see
 * this module's header.
 */
export interface CpuCapabilities {
  /**
   * The CPU backends reachable from the calling environment. Must contain
   * `"ts"`; {@link selectExecutionPlan} falls back to it regardless, since a
   * plan naming no backend at all would be the un-graceful outcome this task
   * exists to rule out.
   */
  readonly available: readonly ExecutionBackendId[];
  /** `navigator.hardwareConcurrency`, or a conservative 1 where it is unreported. */
  readonly hardwareConcurrency: number;
}

/** Human-readable names, kept beside the ids so the panel retypes nothing. */
export const BACKEND_LABELS: Readonly<Record<ExecutionBackendId, string>> = {
  webgpu: "WebGPU compute",
  "wasm-simd": "WebAssembly SIMD (f64x2)",
  wasm: "WebAssembly (scalar)",
  ts: "TypeScript reference stepper",
};

/**
 * The backend that will run, and why it and not another.
 *
 * `reason` is prose for the panel, so a user reading "TypeScript reference
 * stepper" learns whether that is because their browser has no WebGPU or
 * because the faster backends are not reachable from a browser at all -- two
 * different things to do about it.
 */
export interface ExecutionPlan {
  readonly backendId: ExecutionBackendId;
  readonly label: string;
  readonly kind: "gpu" | "cpu";
  readonly reason: string;
  /**
   * How many of these run at once: the worker count, which P7.12 measured at
   * 3.08x on four cores, or 1 for the GPU plan, which is one device.
   */
  readonly parallelism: number;
}

/** The whole answer: what the hardware offers, and what will consequently run. */
export interface ComputeCapabilityReport {
  readonly webgpu: WebGpuProbeResult;
  readonly cpu: CpuCapabilities;
  readonly plan: ExecutionPlan;
}

function summariseLimits(
  limits: Readonly<Record<string, number>> | undefined,
): WebGpuLimitsSummary {
  const read = (key: keyof WebGpuLimitsSummary): number | null => {
    const value = limits?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  return {
    maxComputeWorkgroupSizeX: read("maxComputeWorkgroupSizeX"),
    maxComputeInvocationsPerWorkgroup: read("maxComputeInvocationsPerWorkgroup"),
    maxComputeWorkgroupsPerDimension: read("maxComputeWorkgroupsPerDimension"),
    maxStorageBufferBindingSize: read("maxStorageBufferBindingSize"),
    maxBufferSize: read("maxBufferSize"),
  };
}

function messageOf(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" && error !== "" ? error : null;
}

/**
 * Probe a WebGPU implementation, or the absence of one.
 *
 * **Resolves for every input, including `undefined`.** See this module's
 * header: the four failure modes are the subject matter, not edge cases.
 *
 * **A device is requested and then destroyed.** Requesting an adapter is not
 * enough to answer "can I use the GPU?" -- `requestDevice` is where a present
 * adapter turns out to be unusable, and reporting `supported: true` on the
 * strength of an adapter alone would defer that failure to P7.14's first
 * kernel dispatch, which is exactly the un-graceful shape this task exists to
 * remove. Having proved the point, the probe hands the device back: a
 * capability report that leaves a live `GPUDevice` pinned for the lifetime of
 * the page has bought its answer with a leak. P7.14 requests its own.
 */
export async function probeWebGpu(gpu: GpuLike | undefined): Promise<WebGpuProbeResult> {
  if (gpu === undefined || gpu === null || typeof gpu.requestAdapter !== "function") {
    return { supported: false, reason: "no-navigator-gpu", error: null };
  }

  let adapter: GpuAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch (error) {
    return { supported: false, reason: "adapter-request-failed", error: messageOf(error) };
  }

  if (adapter === null || adapter === undefined) {
    return { supported: false, reason: "no-adapter", error: null };
  }

  let device: GpuDeviceLike;
  try {
    device = await adapter.requestDevice();
  } catch (error) {
    return { supported: false, reason: "device-request-failed", error: messageOf(error) };
  }

  // Guarded: `destroy` is optional on `GpuDeviceLike` because a test double has
  // no reason to implement it, and a probe that threw while tidying up would
  // defeat its own no-throw contract on the success path -- the one path where
  // failing would be most surprising.
  try {
    device.destroy?.();
  } catch {
    // A device that cannot be destroyed is still a device that was created,
    // which is the question asked. Nothing to report and nothing to do.
  }

  return {
    supported: true,
    reason: null,
    adapter: { ...(adapter.info ?? {}) },
    features: adapter.features === undefined ? [] : [...adapter.features].sort(),
    limits: summariseLimits(adapter.limits),
  };
}

/**
 * Choose the backend that will run, given what this machine and this bundle
 * turned out to offer.
 *
 * Pure and synchronous, so the whole decision table is testable without a probe
 * -- and so the panel can re-render from a stored report without re-probing.
 *
 * **Always returns a plan.** An empty `available` list falls through to `"ts"`,
 * because a report that named no backend would be the un-graceful outcome the
 * criterion rules out, and because the TypeScript stepper genuinely does need
 * nothing beyond the engine already executing this function.
 */
export function selectExecutionPlan(
  webgpu: WebGpuProbeResult,
  cpu: CpuCapabilities,
): ExecutionPlan {
  const parallelism = Math.max(1, Math.trunc(cpu.hardwareConcurrency) || 1);

  if (webgpu.supported) {
    return {
      backendId: "webgpu",
      label: BACKEND_LABELS.webgpu,
      kind: "gpu",
      reason: "A WebGPU adapter and device were both obtained on this machine.",
      parallelism: 1,
    };
  }

  const chosen =
    CPU_BACKEND_PREFERENCE.find((id) => cpu.available.includes(id)) ??
    ("ts" satisfies ExecutionBackendId);

  const because = `WebGPU is unavailable (${webgpu.reason}), so the ensemble runs on the CPU.`;
  const detail =
    chosen === "ts"
      ? " The TypeScript stepper is the reference every other backend is validated against at 0 ULP (P7.11), so this path is slower, not less correct."
      : "";

  return {
    backendId: chosen,
    label: BACKEND_LABELS[chosen],
    kind: "cpu",
    reason: `${because}${detail}`,
    parallelism,
  };
}

/** The globals {@link detectComputeCapability} reads, named so a caller can supply them. */
export interface CapabilityEnvironment {
  readonly gpu?: GpuLike | undefined;
  readonly hardwareConcurrency?: number | undefined;
  /** Defaults to {@link BROWSER_CPU_BACKENDS}; a Node caller passes {@link NODE_CPU_BACKENDS}. */
  readonly cpuBackends?: readonly ExecutionBackendId[] | undefined;
}

/**
 * Probe this machine and produce the full report.
 *
 * The `env` argument defaults to the real globals, which is the only place in
 * this module that touches them; pass one explicitly to describe a machine that
 * is not the one running the code. `cpuBackends` defaults to
 * {@link BROWSER_CPU_BACKENDS} rather than to everything the repository has,
 * because the app is this function's caller and a browser is where it runs.
 */
export async function detectComputeCapability(
  env: CapabilityEnvironment = {},
): Promise<ComputeCapabilityReport> {
  const nav: { gpu?: GpuLike; hardwareConcurrency?: number } | undefined =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as { gpu?: GpuLike; hardwareConcurrency?: number });

  const cpu: CpuCapabilities = {
    available: env.cpuBackends ?? BROWSER_CPU_BACKENDS,
    hardwareConcurrency: env.hardwareConcurrency ?? nav?.hardwareConcurrency ?? 1,
  };

  const webgpu = await probeWebGpu(env.gpu ?? nav?.gpu);
  return { webgpu, cpu, plan: selectExecutionPlan(webgpu, cpu) };
}
