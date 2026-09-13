// Shared fixture for P7.16's GPU/CPU observables agreement measurement.
//
// Same two-way arrangement as `gpu-rk4-agreement-fixture.mjs`: plain JS, only
// relative imports into already-built `dist/`, no Node-only APIs, so one file is
// imported under Node to compute the CPU reduction and bundled into Playwright
// Chromium to dispatch the observables kernel on a real device.
//
// THE ENSEMBLE IS P7.14'S, IMPORTED RATHER THAN RE-DERIVED. `buildEnsemble` is
// the same generator, at the same seed, producing the same jittered trajectories
// the 99th run compared bit-identically. That is deliberate: it means any
// disagreement this script finds is in the REDUCTION, because the integration
// underneath it is already known to agree exactly on this exact input. Writing a
// second ensemble builder would have thrown that away and made every
// disagreement ambiguous between the two layers.
//
// THE STEP COUNT IS NOT P7.14'S, AND THAT DIFFERENCE IS THE POINT. Its fixture
// marches 2000 steps at h=0.001 -- two seconds, which for this scenario class
// leaves most of the ensemble still airborne. Range is only defined once a
// flight has crossed the ground, so a 2000-step run would compare `impacted:
// false` against `impacted: false` ten thousand times and report agreement
// having tested nothing about range at all. 12000 steps lands essentially the
// whole ensemble and leaves every landed flight integrating on past its impact,
// which is also the case that exercises "first crossing only".

import { PlanarObservableReducer } from "../packages/runtime/dist/planar-observables-reduction.js";
import {
  integratePlanarRk4,
  toF32,
} from "../packages/solverkit/dist/planar-rk4-precision-reference.js";
import { GPU_BUFFER_USAGE, runWgslRk4 } from "../packages/runtime/dist/wgsl-rk4-dispatch.js";
import {
  WGSL_OBSERVABLE_DIM,
  WGSL_OBSERVABLES_KERNEL_SOURCE,
} from "../packages/runtime/dist/wgsl-observables-kernel.js";
import { buildEnsemble as buildRk4Ensemble } from "./gpu-rk4-agreement-fixture.mjs";

/** Long enough that essentially every flight in the ensemble lands. */
export const FIXTURE_H = 0.001;
export const FIXTURE_STEPS = 12_000;

/** The observable names, in the order the kernel writes them. */
export const OBSERVABLES = ["apexHeight", "apexT", "range", "impactT", "impacted"];

/**
 * The ensemble: P7.14's parameters and initial states, marched for longer.
 *
 * Only `steps` differs from what `gpu-rk4-agreement-fixture.mjs` returns, and it
 * is overridden here rather than in that module so P7.14's recorded measurement
 * keeps describing the run it actually made.
 */
export function buildEnsemble(count, seed = 0x7a14c0de) {
  const base = buildRk4Ensemble(count, seed);
  return { ...base, h: FIXTURE_H, steps: FIXTURE_STEPS };
}

/**
 * The f32 CPU reduction for the whole ensemble, one flat array.
 *
 * `round: toF32` for the reason P7.14's fixture gives -- it is the true-f32 path
 * a GPU actually computes, rather than `precision: "float32"`, which leaves the
 * RK4 stages in f64.
 *
 * `impacted` is written as 1 or 0 so the record is a single `Float32Array` and
 * the comparison can treat all five outputs uniformly. A boolean that disagrees
 * is then a difference of exactly 1.0, which is unmissable next to the rounding
 * differences everything else shows.
 */
export function computeCpuObservables(ensemble) {
  const { params, initialStates, h, steps } = ensemble;
  const out = new Float32Array(params.length * WGSL_OBSERVABLE_DIM);
  for (let i = 0; i < params.length; i++) {
    // The reducer is driven here rather than through `reducePlanarObservables`
    // because this file must load under plain Node from `dist/`, and that
    // wrapper's module carries a runtime `@ballista/solverkit` import Node
    // cannot resolve (the workspace `main` is a `.ts` file). Same integrator,
    // same rounding, same reducer -- only the driving is local.
    const y0 = [
      toF32(initialStates[i][0]),
      toF32(initialStates[i][1]),
      toF32(initialStates[i][2]),
      toF32(initialStates[i][3]),
    ];
    const reducer = new PlanarObservableReducer(y0, toF32(0), toF32);
    integratePlanarRk4({
      y0,
      h,
      steps,
      params: params[i],
      round: toF32,
      t0: 0,
      onStep: (_step, t, y) => reducer.step(t, y),
    });
    const observed = reducer.finish();
    const base = i * WGSL_OBSERVABLE_DIM;
    out[base + 0] = observed.apexHeight;
    out[base + 1] = observed.apexT;
    out[base + 2] = observed.range;
    out[base + 3] = observed.impactT;
    out[base + 4] = observed.impacted ? 1 : 0;
  }
  return out;
}

/**
 * Browser side: obtain a device, dispatch the observables kernel, return the
 * reduced records.
 *
 * Reports rather than throws on every "no GPU here" outcome, matching
 * `probeWebGpu`'s contract: the caller must be able to tell "the reduction
 * disagrees" from "there was nothing to run it on", and an exception conflates
 * them.
 */
export async function runGpuObservables(count, seed) {
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

  try {
    const captured = [];
    device.addEventListener?.("uncapturederror", (event) => {
      captured.push(String(event.error ?? event));
    });
    const ensemble = buildEnsemble(count, seed);
    const records = await runWgslRk4(device, {
      ...ensemble,
      kernelSource: WGSL_OBSERVABLES_KERNEL_SOURCE,
      outputDim: WGSL_OBSERVABLE_DIM,
    });
    return {
      status: "measured",
      adapterInfo,
      deviceErrors: captured,
      observables: Array.from(records),
    };
  } catch (error) {
    return { status: "failed", reason: "dispatch-failed", error: String(error), adapterInfo };
  } finally {
    device.destroy?.();
  }
}
