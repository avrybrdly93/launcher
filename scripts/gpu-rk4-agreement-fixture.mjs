// Shared fixture for P7.14's GPU/CPU agreement measurement.
//
// Same two-way arrangement as `cross-engine-drift-fixture.mjs`, and for the same
// reason: plain JS, only relative imports into already-built `dist/` outputs, no
// Node-only APIs. So one file serves both sides of the comparison --
//   1. imported under Node to build the ensemble and compute the f32 CPU
//      reference, and
//   2. bundled by esbuild (platform: "browser") and run inside Playwright
//      Chromium, where it dispatches the WGSL kernel on a real device.
//
// THE ENSEMBLE IS GENERATED, NOT SHIPPED, AND THAT IS THE LOAD-BEARING CHOICE.
// Both sides call `buildEnsemble` rather than one side serialising arrays to the
// other. A serialisation round-trip is one more place for the two paths to start
// from inputs that differ in the last bit, which is exactly the size of the
// difference being measured. Generating from identical code with an explicit
// integer-seeded generator removes that possibility.
//
// Every generated value is passed through `Math.fround`, so the inputs are
// binary32 before either path touches them. The GPU has no choice about this --
// a storage buffer of `f32` rounds on upload -- so the CPU reference must see
// the same rounded inputs or the comparison charges an input difference to the
// kernel.

import {
  integratePlanarRk4,
  toF32,
} from "../packages/solverkit/dist/planar-rk4-precision-reference.js";
import { GPU_BUFFER_USAGE, runWgslRk4 } from "../packages/runtime/dist/wgsl-rk4-dispatch.js";
import { WGSL_STATE_DIM } from "../packages/runtime/dist/wgsl-rk4-kernel.js";

/** Fixed step size, and a step count that puts most of the ensemble past apex. */
export const FIXTURE_H = 0.001;
export const FIXTURE_STEPS = 2000;

/**
 * mulberry32: a small, exactly-specified integer generator.
 *
 * Chosen over `Math.random` because the comparison must be reproducible across
 * two engines and two runs, and over a library because a seeded generator that
 * both sides must agree on bit-for-bit is better read than imported.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a deterministic ensemble of `count` jittered trajectories.
 *
 * The scenario class is a small sphere in constant air with wind: the model
 * `planar-rk4-precision-reference.ts` and the WGSL kernel both implement, with
 * every parameter jittered so the measurement is not one trajectory repeated
 * `count` times. Launch angles reach past 50 degrees deliberately, so a good
 * fraction of the ensemble is near apex at the final step -- that is where a
 * relative-error metric misbehaves, and P0.134 is the reason this fixture wants
 * those trajectories in the sample rather than excluded from it.
 */
export function buildEnsemble(count, seed = 0x7a14c0de) {
  const random = mulberry32(seed);
  const params = [];
  const initialStates = [];
  for (let i = 0; i < count; i++) {
    params.push({
      mass: Math.fround(0.145 + 0.05 * random()),
      area: Math.fround(0.00426 + 0.001 * random()),
      cd: Math.fround(0.3 + 0.2 * random()),
      rho: Math.fround(1.1 + 0.2 * random()),
      g: Math.fround(9.80665),
      windX: Math.fround(-5 + 10 * random()),
      windY: Math.fround(-1 + 2 * random()),
    });
    const speed = 30 + 30 * random();
    const angle = ((15 + 40 * random()) * Math.PI) / 180;
    initialStates.push([
      Math.fround(0),
      Math.fround(1.5),
      Math.fround(speed * Math.cos(angle)),
      Math.fround(speed * Math.sin(angle)),
    ]);
  }
  return { params, initialStates, h: FIXTURE_H, steps: FIXTURE_STEPS };
}

/**
 * The f32 CPU reference: final states for the whole ensemble, one flat array.
 *
 * `round: toF32` is the true-f32 reference -- every intermediate rounded -- and
 * NOT `SolverConfig.precision = "float32"`, which rounds only the accepted state
 * between steps and leaves the RK4 stages in f64. The 98th run measured that the
 * two agree to 1.502e-6 relative on this model, so the choice does not change
 * the verdict at 1e-4; it is made deliberately anyway because the true-f32 path
 * is the one a GPU actually computes.
 *
 * Returned as a `Float32Array`, which is lossless here: with `round: toF32`
 * every value the integrator returns is already binary32-representable.
 */
export function computeCpuReference(ensemble) {
  const { params, initialStates, h, steps } = ensemble;
  const out = new Float32Array(params.length * WGSL_STATE_DIM);
  for (let i = 0; i < params.length; i++) {
    const final = integratePlanarRk4({
      y0: initialStates[i],
      h,
      steps,
      params: params[i],
      round: toF32,
    });
    for (let c = 0; c < WGSL_STATE_DIM; c++) out[i * WGSL_STATE_DIM + c] = final[c];
  }
  return out;
}

/**
 * Browser side: obtain a device, dispatch the kernel, return the final states.
 *
 * Reports rather than throws on every "no GPU here" outcome, matching
 * `probeWebGpu`'s contract -- the caller needs to distinguish "the kernel
 * disagrees" from "there was nothing to run it on", and an exception conflates
 * them. A device is requested fresh: P7.13's probe destroys the one it creates.
 */
export async function runGpuEnsemble(count, seed) {
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

  // The host's hand-written GPUBufferUsage values, checked against the browser's
  // own enum before anything is dispatched. A transposed flag would otherwise
  // surface as an opaque driver validation error.
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
    const finalStates = await runWgslRk4(device, ensemble);
    return {
      status: "measured",
      adapterInfo,
      deviceErrors: captured,
      finalStates: Array.from(finalStates),
    };
  } catch (error) {
    return { status: "failed", reason: "dispatch-failed", error: String(error), adapterInfo };
  } finally {
    device.destroy?.();
  }
}
