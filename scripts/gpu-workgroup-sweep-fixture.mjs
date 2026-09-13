// Browser-side fixture for P7.15's workgroup-size sweep.
//
// Same arrangement as `gpu-rk4-agreement-fixture.mjs` and for the same reasons:
// plain JS, only relative imports into already-built `dist/` outputs, no
// Node-only APIs, so esbuild can bundle it for the page. It reuses that file's
// `buildEnsemble` rather than defining a second one — the sweep must vary the
// workgroup size and nothing else, and two ensembles would be two things
// varying.
//
// ## WHAT THIS MEASURES, AND THE ONE THING IT CANNOT
//
// It measures the wall-clock time of `runWgslRk4` per dispatch, from the host's
// side of the queue, with the readback included. That is deliberately the whole
// round trip rather than a GPU timestamp query: `timestamp-query` is an
// optional feature, it is unavailable on the adapter reachable in this
// project's container, and the quantity a caller of `runWgslRk4` actually waits
// on is the round trip. So the number includes buffer creation, upload,
// dispatch, readback and teardown, and the workgroup size is the only thing
// varying across it.
//
// **It cannot tell a hardware occupancy curve from a CPU emulation of one.**
// Nothing here can. That is a property of the adapter, not of the harness, and
// it is why the results file keys every row by an adapter class rather than
// presenting one number.
//
// ## Correctness is re-checked at every size, not assumed
//
// A dispatch that under-dispatches leaves the tail of the ensemble holding its
// initial state, which is fast and wrong — precisely the failure mode a
// benchmark rewards. So every size's first run is compared against the first
// run of the smallest size, and any disagreement aborts the sweep rather than
// being timed. `runWgslRk4` already refuses a source whose `@workgroup_size`
// literal disagrees with the caller's argument; this catches the class where
// they agree and the dispatch geometry is still wrong.

import { GPU_BUFFER_USAGE, runWgslRk4 } from "../packages/runtime/dist/wgsl-rk4-dispatch.js";
import { buildWgslRk4KernelSource } from "../packages/runtime/dist/wgsl-rk4-kernel.js";
import { planWorkgroupSweep } from "../packages/runtime/dist/wgsl-workgroup-sweep.js";
import { buildEnsemble } from "./gpu-rk4-agreement-fixture.mjs";

/**
 * Runs the sweep on whatever device the page can obtain.
 *
 * Reports rather than throws on every "no GPU here" outcome, matching
 * `runGpuEnsemble`'s contract: the caller must be able to tell "the sweep found
 * nothing" from "there was nothing to sweep on", and an exception conflates
 * them.
 *
 * @param count trajectories per dispatch.
 * @param seed ensemble seed, so the sweep and the agreement run share inputs.
 * @param warmups dispatches per size whose timings are discarded.
 * @param repeats timed dispatches per size.
 */
export async function runWorkgroupSweep(count, seed, warmups, repeats) {
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

  const usageMismatches = [];
  for (const [name, value] of Object.entries(GPU_BUFFER_USAGE)) {
    if (GPUBufferUsage[name] !== value) {
      usageMismatches.push({ name, ours: value, browser: GPUBufferUsage[name] });
    }
  }
  if (usageMismatches.length > 0) {
    return { status: "failed", reason: "buffer-usage-mismatch", usageMismatches };
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
  // Read off the device rather than the adapter: `requestDevice` may grant less
  // than the adapter advertises, and the granted limits are what the pipeline
  // will be validated against.
  const limits = {
    maxComputeWorkgroupSizeX: device.limits.maxComputeWorkgroupSizeX,
    maxComputeInvocationsPerWorkgroup: device.limits.maxComputeInvocationsPerWorkgroup,
  };

  try {
    const captured = [];
    device.addEventListener?.("uncapturederror", (event) => {
      captured.push(String(event.error ?? event));
    });

    let sizes;
    try {
      sizes = planWorkgroupSweep(limits);
    } catch (error) {
      return { status: "failed", reason: "plan-failed", error: String(error), adapterInfo, limits };
    }

    const ensemble = buildEnsemble(count, seed);
    const samples = [];
    let baseline = null;

    for (const workgroupSize of sizes) {
      const request = {
        ...ensemble,
        kernelSource: buildWgslRk4KernelSource(workgroupSize),
        workgroupSize,
      };

      // Correctness first, and outside the timed loop. A wrong dispatch
      // geometry is fast, so a sweep that only timed would reward it.
      const check = await runWgslRk4(device, request);
      if (baseline === null) {
        baseline = check;
      } else {
        for (let i = 0; i < baseline.length; i++) {
          if (!Object.is(baseline[i], check[i])) {
            return {
              status: "failed",
              reason: "size-disagrees",
              workgroupSize,
              index: i,
              expected: baseline[i],
              actual: check[i],
              adapterInfo,
              limits,
            };
          }
        }
      }

      for (let w = 0; w < warmups; w++) {
        await runWgslRk4(device, request);
      }
      const timingsMs = [];
      for (let r = 0; r < repeats; r++) {
        const started = performance.now();
        await runWgslRk4(device, request);
        timingsMs.push(performance.now() - started);
      }
      samples.push({ workgroupSize, timingsMs });
    }

    return {
      status: "measured",
      adapterInfo,
      limits,
      deviceErrors: captured,
      samples,
    };
  } catch (error) {
    return { status: "failed", reason: "sweep-failed", error: String(error), adapterInfo, limits };
  } finally {
    device.destroy?.();
  }
}
