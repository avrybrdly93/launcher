/**
 * Lazy entry point for the GPU compute path (P7.30, "bundle strategy:
 * WASM+GPU code lazy-loaded on demand").
 *
 * **The split this module draws is between probing and dispatching, and it is
 * the whole design.** {@link ./webgpu-capability.js} stays eager on purpose:
 * you cannot decide whether to load a kernel until you have asked whether
 * there is an adapter to run it on, so the probe is on the critical path by
 * definition and moving it behind a dynamic import would only add a round trip
 * before the first honest answer. What is *not* on the critical path is
 * everything that is useless without that answer -- the WGSL sources and the
 * dispatch plumbing -- and that is what this module defers.
 *
 * **Why a dynamic `import()` and not tree-shaking.** The wgsl modules are
 * already absent from the app's emitted chunks today, but only because nothing
 * in `packages/app` references them; `packages/runtime/src/index.ts` re-exports
 * all seven, so the first route that reaches for the GPU path would pull them
 * into the eager chunk. Tree-shaking keeps them out while the feature is
 * unbuilt and stops keeping them out on the day it is built, which is the
 * opposite of the guarantee this task's criterion asks for. A dynamic import
 * boundary holds either way.
 *
 * Following {@link ../../viz/src/lazy-plotly-pane.js}'s precedent, the promise
 * is memoized at module scope: N callers cause one fetch and share one module
 * instance. The `import()` expression is what makes Rollup/Vite split the
 * chunk, and that is a property of the call site rather than of how this module
 * is itself imported -- so a static import of *this* file does not undo it.
 *
 * **There is still no WASM half here, but the reason changed under it and the
 * new reason is weaker.** It used to be impossibility: `@ballista/wasm-core`
 * imported `node:fs/promises` and `node:url` at module top level, so a dynamic
 * `import()` of it from a browser bundle emitted a chunk that could not
 * resolve, and total absence from the bundle was the only available property.
 * **P0.133 removed those imports**, so lazy-loading the kernel is now possible
 * and is simply not done yet. `lazy-gpu-backend.bundle.test.ts` still asserts
 * the absence, which still holds -- nothing in that fixture references
 * wasm-core -- but it now records a fact about the fixture rather than a
 * property of the package. Doing for the kernel what this module does for the
 * WGSL sources is P0.139.
 */

/**
 * The GPU dispatch surface, resolved on demand.
 *
 * Deliberately typed with `typeof import(...)` rather than a hand-written
 * interface: a hand-written one would drift silently as the underlying modules
 * gain exports, and the point of this module is to be a loading boundary, not a
 * second declaration of the API behind it.
 */
export interface GpuComputeModule {
  readonly dispatch: typeof import("./wgsl-rk4-dispatch.js");
  readonly kernel: typeof import("./wgsl-rk4-kernel.js");
  readonly observables: typeof import("./wgsl-observables-kernel.js");
  readonly philox: typeof import("./wgsl-philox.js");
  readonly planarPhysics: typeof import("./wgsl-planar-physics.js");
}

let gpuComputeModulePromise: Promise<GpuComputeModule> | undefined;

/**
 * Dynamically imports the GPU compute path, memoized.
 *
 * The five modules are loaded as one unit rather than five independently
 * resolvable promises because they are one unit in use: `runWgslRk4` needs a
 * kernel source to compile, the observables and Philox sources are spliced into
 * that source, and the planar physics is the rhs all of them share. Splitting
 * them into separate awaited boundaries would multiply round trips without ever
 * letting a caller usefully hold one and not the others.
 *
 * Rejection is not cached: a failed load leaves the memo cleared, so a caller
 * that retries after a transient network failure gets a fresh attempt rather
 * than the first failure replayed forever. That differs from
 * `loadPlotlyModule`'s simpler memo deliberately -- opening an exploratory pane
 * is user-initiated and retried by hand, whereas a scheduler that has already
 * routed a job to the GPU tier has no such operator in the loop.
 */
export function loadGpuComputeModule(): Promise<GpuComputeModule> {
  if (!gpuComputeModulePromise) {
    gpuComputeModulePromise = Promise.all([
      import("./wgsl-rk4-dispatch.js"),
      import("./wgsl-rk4-kernel.js"),
      import("./wgsl-observables-kernel.js"),
      import("./wgsl-philox.js"),
      import("./wgsl-planar-physics.js"),
    ])
      .then(([dispatch, kernel, observables, philox, planarPhysics]) => ({
        dispatch,
        kernel,
        observables,
        philox,
        planarPhysics,
      }))
      .catch((error: unknown) => {
        gpuComputeModulePromise = undefined;
        throw error;
      });
  }
  return gpuComputeModulePromise;
}

/**
 * Resets the memoized module promise -- test-only, so each test observes a
 * fresh dynamic-import call rather than the previous test's resolved value.
 */
export function resetLazyGpuModuleForTesting(): void {
  gpuComputeModulePromise = undefined;
}
