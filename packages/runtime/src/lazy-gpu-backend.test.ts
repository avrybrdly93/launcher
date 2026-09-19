import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadGpuComputeModule, resetLazyGpuModuleForTesting } from "./lazy-gpu-backend.js";

/**
 * Behavioural coverage for the lazy GPU loader (P7.30).
 *
 * The chunk-graph half of the criterion lives in
 * `lazy-gpu-backend.bundle.test.ts`, which needs a real Rollup build. These
 * tests need no bundler and no browser, and they are separate for the same
 * reason P7.29 split its matrix: either half can fail while the other holds. A
 * loader can resolve the right modules while the bundler staples them into the
 * entry chunk, and a chunk graph can be perfectly split around a loader that
 * re-fetches on every call.
 */
describe("lazy GPU compute module (P7.30)", () => {
  beforeEach(() => {
    resetLazyGpuModuleForTesting();
  });

  it("resolves the five modules that make up the GPU dispatch path", async () => {
    const mod = await loadGpuComputeModule();

    // Named rather than counted: a count would still pass if a key resolved to
    // the wrong module, and the grouping is the thing under test.
    expect(Object.keys(mod).sort()).toEqual([
      "dispatch",
      "kernel",
      "observables",
      "philox",
      "planarPhysics",
    ]);
  });

  it("resolves each key to the module that actually owns its exports", async () => {
    const mod = await loadGpuComputeModule();

    // One identifying export per module, chosen so a mis-wired key cannot pass:
    // no two of these live in the same file.
    expect(typeof mod.dispatch.runWgslRk4).toBe("function");
    expect(typeof mod.kernel.buildWgslRk4KernelSource).toBe("function");
    expect(typeof mod.observables.buildWgslObservablesKernelSource).toBe("function");
    expect(typeof mod.philox.WGSL_PHILOX_FNS).toBe("string");
    expect(typeof mod.planarPhysics.WGSL_PLANAR_STEP_FNS).toBe("string");
  });

  it("carries the real WGSL source, which is the weight the bundle split is about", async () => {
    const mod = await loadGpuComputeModule();

    // The point of deferring these modules is that they are not small. If this
    // ever became a handful of bytes the split would still "pass" structurally
    // while having stopped being worth anything.
    expect(mod.kernel.WGSL_RK4_KERNEL_SOURCE).toContain("@compute");
    expect(mod.kernel.WGSL_RK4_KERNEL_SOURCE).toContain("workgroup_size");
    expect(mod.kernel.WGSL_RK4_KERNEL_SOURCE.length).toBeGreaterThan(1_000);
  });

  it("memoizes: two calls share one resolved module object", async () => {
    const [first, second] = await Promise.all([loadGpuComputeModule(), loadGpuComputeModule()]);

    // Object.is, not toEqual: the contract is one shared instance, and a
    // structural comparison would pass for two independent loads.
    expect(Object.is(first, second)).toBe(true);
  });

  it("returns the identical promise to synchronous repeat callers", () => {
    const a = loadGpuComputeModule();
    const b = loadGpuComputeModule();

    expect(Object.is(a, b)).toBe(true);
    return a;
  });

  it("drops the memo after a reset, so a fresh load is observable", async () => {
    const first = await loadGpuComputeModule();
    resetLazyGpuModuleForTesting();
    const second = await loadGpuComputeModule();

    // The underlying ES modules are cached by the runtime, so the namespace
    // objects are the same; what must differ is the wrapper this module builds,
    // which is what proves the memo was actually cleared rather than reused.
    expect(Object.is(first, second)).toBe(false);
    expect(Object.is(first.kernel, second.kernel)).toBe(true);
  });

  it("does not cache a rejection: a retry after a failed load gets a fresh attempt", async () => {
    // Forces the real catch arm rather than simulating it. One of the five
    // dynamic imports is mocked to throw on the first attempt and to resolve on
    // the second, and the loader is re-imported into a fresh module registry so
    // its module-scope memo starts empty.
    vi.resetModules();
    let failNext = true;
    vi.doMock("./wgsl-philox.js", async () => {
      if (failNext) throw new Error("transient module load failure");
      return await vi.importActual("./wgsl-philox.js");
    });

    try {
      const fresh = await import("./lazy-gpu-backend.js");

      // The marker arrives in `cause`: vitest wraps a mock-factory throw in its
      // own diagnostic Error. Asserting the cause rather than the message keeps
      // this pinned to OUR failure rather than to any rejection at all.
      const rejection = await fresh.loadGpuComputeModule().then(
        () => undefined,
        (error: unknown) => error as Error & { cause?: Error },
      );
      expect(rejection).toBeDefined();
      expect(rejection!.cause?.message).toBe("transient module load failure");

      // The contract under test: the failure is not what the next caller gets.
      // Without the catch arm clearing the memo this second call replays the
      // first rejection forever, and this is the assertion that catches it.
      failNext = false;
      const recovered = await fresh.loadGpuComputeModule();
      expect(typeof recovered.philox.WGSL_PHILOX_FNS).toBe("string");
    } finally {
      vi.doUnmock("./wgsl-philox.js");
      vi.resetModules();
    }
  });
});
