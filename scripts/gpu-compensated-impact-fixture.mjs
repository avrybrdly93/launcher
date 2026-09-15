// Shared fixture for P0.136's device measurement: does the compensated WGSL
// march reproduce the CPU compensated arm, and does vacuum-45deg's batch
// maximum fall below P7.19's 1e-3 m bar on the device path?
//
// Same two-way arrangement as `gpu-observables-fixture.mjs`: plain JS, only
// relative imports into already-built `dist/`, no Node-only APIs, so one file
// is imported under Node to compute the CPU arms and bundled into Playwright
// Chromium to dispatch the compensated kernel on a real device.
//
// WHY THE BATCH IS REBUILT HERE RATHER THAN IMPORTED, AND WHAT GUARDS THAT.
// `planar-impact-agreement-study.js` cannot be imported under plain Node: it
// carries a bare `@ballista/solverkit` import whose workspace `main` is a `.ts`
// file, which is the same constraint `gpu-observables-fixture.mjs` documents
// for `reducePlanarObservables`. So the grid is re-derived here from the same
// `PRECISION_SCENARIOS` the study reads. A silent copy is exactly the failure
// mode `wgsl-planar-physics.ts` exists to prevent -- two spellings that agree
// on the day they are written -- so
// `packages/validation/src/gpu-compensated-impact-fixture.test.ts` asserts,
// member for member, that this file's batch is the study's `buildImpactBatch`
// output for the same family. If one drifts the other, that test fails.
//
// WHY ONLY vacuum-45deg. P7.19 measured all four families and only this one
// misses the bar -- it is the drag-free, non-stiff, longest flight, so it takes
// the most steps and accumulates the most rounding. The other three already
// pass on the plain accumulator, so putting them on the device here would add
// runtime and three guaranteed passes. The task names this family for the same
// reason.
//
// WHY THE REFERENCE IS THE f64 ARM. Unchanged from P7.19, and its study module
// gives the reasoning at length: grading the f32 device against the CPU f32
// reduction is the same arm compared with itself, which returns 0.0 on every
// row and is a criterion satisfied by construction. The absolute metre bar is
// only meaningful against f64.

import { PlanarObservableReducer } from "../packages/runtime/dist/planar-observables-reduction.js";
import { PRECISION_SCENARIOS } from "../packages/runtime/dist/planar-precision-scenarios.js";
import {
  identity,
  integratePlanarRk4,
  toF32,
} from "../packages/solverkit/dist/planar-rk4-precision-reference.js";
import { GPU_BUFFER_USAGE, runWgslRk4 } from "../packages/runtime/dist/wgsl-rk4-dispatch.js";
import {
  buildWgslObservablesKernelSource,
  WGSL_OBSERVABLE_DIM,
  WGSL_OBSERVABLE_OFFSETS,
} from "../packages/runtime/dist/wgsl-observables-kernel.js";
import { WGSL_WORKGROUP_SIZE } from "../packages/runtime/dist/wgsl-rk4-kernel.js";

/** The family P7.19's criterion turns on, and its measured step budget. */
export const FAMILY_ID = "vacuum-45deg";
export const FAMILY_H = 0.001;
export const FAMILY_STEPS = 7200;

/** P7.19's grid, verbatim: 50x50 over launch speed and elevation. */
export const GRID_SIDE = 50;
export const SPEED_SPAN = { lo: 0.8, hi: 1.2 };
export const DEGREE_SPAN = { lo: 25, hi: 65 };

/** The criterion, in metres. */
export const IMPACT_ABSOLUTE_BUDGET_M = 1e-3;

function scenario(id) {
  const s = PRECISION_SCENARIOS.find((x) => x.id === id);
  if (s === undefined) throw new Error(`unknown precision scenario: ${id}`);
  return s;
}

function gridValue(lo, hi, i, n) {
  if (n <= 1) return lo;
  return lo + ((hi - lo) * i) / (n - 1);
}

/**
 * The family's 2500-member batch, in the study's own order.
 *
 * Every member launches from `x0 = 0` with `vx > 0`, which is what makes
 * `range` and the impact abscissa the same number -- a constraint on the batch
 * rather than a convenience, as the study's docstring says.
 */
export function buildBatch() {
  const s = scenario(FAMILY_ID);
  const nominalSpeed = Math.hypot(s.y0[2], s.y0[3]);
  const members = [];
  for (let i = 0; i < GRID_SIDE; i++) {
    const speed = nominalSpeed * gridValue(SPEED_SPAN.lo, SPEED_SPAN.hi, i, GRID_SIDE);
    for (let j = 0; j < GRID_SIDE; j++) {
      const degrees = gridValue(DEGREE_SPAN.lo, DEGREE_SPAN.hi, j, GRID_SIDE);
      const theta = (degrees * Math.PI) / 180;
      members.push({
        index: i * GRID_SIDE + j,
        speed,
        degrees,
        y0: [0, 0, speed * Math.cos(theta), speed * Math.sin(theta)],
      });
    }
  }
  return { members, params: s.params, h: FAMILY_H, steps: FAMILY_STEPS };
}

/**
 * The ensemble in the shape `runWgslRk4` wants: one `params` entry per
 * trajectory (the projectile never varies within a family; only the launch
 * does) and a flat initial-state array.
 */
export function buildEnsemble() {
  const batch = buildBatch();
  return {
    params: batch.members.map(() => batch.params),
    initialStates: batch.members.map((m) => m.y0),
    h: batch.h,
    steps: batch.steps,
  };
}

/**
 * One CPU arm's `range` for every member.
 *
 * The reducer is driven here rather than through `reducePlanarObservables` for
 * the reason the module header gives. Same integrator, same rounding, same
 * reducer, same `compensated` flag -- only the driving is local.
 */
export function computeCpuRanges({ round, compensated }) {
  const batch = buildBatch();
  const out = new Float64Array(batch.members.length);
  const impacted = new Uint8Array(batch.members.length);
  for (let i = 0; i < batch.members.length; i++) {
    const y0 = batch.members[i].y0.map((v) => round(v));
    const reducer = new PlanarObservableReducer(y0, round(0), round);
    integratePlanarRk4({
      y0,
      h: batch.h,
      steps: batch.steps,
      params: batch.params,
      round,
      t0: 0,
      compensated,
      onStep: (_step, t, y) => reducer.step(t, y),
    });
    const observed = reducer.finish();
    out[i] = observed.range;
    impacted[i] = observed.impacted ? 1 : 0;
  }
  return { ranges: out, impacted };
}

/** The f64 reference arm. Compensation is off: see the module header. */
export function computeReferenceRanges() {
  return computeCpuRanges({ round: identity, compensated: false });
}

/** The CPU f32 compensated arm, which the device must reproduce. */
export function computeCpuCompensatedRanges() {
  return computeCpuRanges({ round: toF32, compensated: true });
}

/** The CPU f32 plain arm, carried so the device result has something to beat. */
export function computeCpuPlainRanges() {
  return computeCpuRanges({ round: toF32, compensated: false });
}

/**
 * Browser side: dispatch the COMPENSATED observables kernel and return each
 * trajectory's range and impacted flag.
 *
 * Reports rather than throws on every "no GPU here" outcome, matching
 * `probeWebGpu`'s contract: the caller must be able to tell "the march
 * disagrees" from "there was nothing to run it on".
 */
export async function runGpuCompensatedRanges() {
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
    const ensemble = buildEnsemble();
    const records = await runWgslRk4(device, {
      ...ensemble,
      // The whole point of this script: the compensated build, not the default.
      kernelSource: buildWgslObservablesKernelSource(WGSL_WORKGROUP_SIZE, { compensated: true }),
      outputDim: WGSL_OBSERVABLE_DIM,
    });
    const count = ensemble.params.length;
    const ranges = new Array(count);
    const impacted = new Array(count);
    for (let i = 0; i < count; i++) {
      const base = i * WGSL_OBSERVABLE_DIM;
      ranges[i] = records[base + WGSL_OBSERVABLE_OFFSETS.range];
      impacted[i] = records[base + WGSL_OBSERVABLE_OFFSETS.impacted];
    }
    return { status: "measured", adapterInfo, deviceErrors: captured, ranges, impacted };
  } catch (error) {
    return { status: "failed", reason: "dispatch-failed", error: String(error), adapterInfo };
  } finally {
    device.destroy?.();
  }
}
