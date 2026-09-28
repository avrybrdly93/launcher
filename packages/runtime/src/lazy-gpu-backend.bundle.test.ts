import { describe, expect, it } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import type { OutputChunk, RollupOutput } from "rollup";

/**
 * Chunk-graph proof for P7.30 ("bundle strategy: WASM+GPU code lazy-loaded on
 * demand"; criterion "initial bundle unchanged (size CI)").
 *
 * Builds `lazy-gpu-backend.bundle-fixture.ts` -- a real consumer that probes
 * eagerly and loads the kernel on demand -- through Vite/Rollup with
 * `write: false` and inspects the in-memory chunk graph directly. This follows
 * `packages/viz/src/lazy-plotly-pane.bundle.test.ts`, which is this repo's
 * worked precedent for asserting on a real Rollup chunk graph.
 *
 * **Why the criterion is asserted structurally and not as a byte count of the
 * app.** "Initial bundle unchanged" is trivially true today for a reason that
 * has nothing to do with bundle strategy: nothing in `packages/app` references
 * the wgsl modules, so tree-shaking drops them and `check-bundle-size` would
 * report the same number whether or not this task had been done at all. A run
 * could therefore "pass" this criterion by measuring twice and changing
 * nothing. What actually has to hold is that the initial bundle stays unchanged
 * ON THE DAY A CALLER REACHES FOR THE GPU PATH, and that is a property of the
 * chunk graph around a real consumer, which is what this file builds.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The modules the criterion defers. Matched against Rollup's absolute
 * `moduleIds`, so the basenames are anchored with a separator and an extension
 * to keep `wgsl-rk4-kernel` from also matching a hypothetical
 * `wgsl-rk4-kernel-helpers`.
 */
const DEFERRED_GPU_MODULES = [
  "wgsl-rk4-dispatch",
  "wgsl-rk4-kernel",
  "wgsl-observables-kernel",
  "wgsl-philox",
  "wgsl-planar-physics",
] as const;

function isDeferredGpuModule(moduleId: string): boolean {
  const base = path.basename(moduleId).replace(/\.[cm]?[jt]s$/, "");
  return (DEFERRED_GPU_MODULES as readonly string[]).includes(base);
}

async function buildFixture(entry: string): Promise<readonly OutputChunk[]> {
  const result = await build({
    root: here,
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(here, entry), formats: ["es"], fileName: () => "entry.js" },
    },
  });
  const single = Array.isArray(result) ? result[0]! : result;
  return (single as RollupOutput).output.filter(
    (item): item is OutputChunk => item.type === "chunk",
  );
}

describe("lazy GPU backend bundle splitting (P7.30)", () => {
  it("keeps every WGSL module out of the entry chunk and reachable only by dynamic import", async () => {
    const chunks = await buildFixture("lazy-gpu-backend.bundle-fixture.ts");
    const entryChunk = chunks.find((c) => c.isEntry);
    expect(entryChunk).toBeDefined();

    const gpuChunks = chunks.filter((c) => c.moduleIds.some(isDeferredGpuModule));

    // Not vacuous: if the fixture stopped reaching the GPU path at all, every
    // assertion below would pass over an empty set. This is the control.
    expect(gpuChunks.length).toBeGreaterThan(0);

    // The criterion itself: none of the deferred modules is in the initial load.
    expect(entryChunk!.moduleIds.filter(isDeferredGpuModule)).toEqual([]);

    // And they are not merely absent from the entry -- every one is its own
    // dynamic entry, reached from the entry by a dynamic edge.
    const gpuFileNames = new Set(gpuChunks.map((c) => c.fileName));
    for (const gpuChunk of gpuChunks) {
      expect(gpuChunk.isDynamicEntry).toBe(true);
      expect(entryChunk!.dynamicImports).toContain(gpuChunk.fileName);
    }

    // No chunk OUTSIDE the deferred set may reach a GPU chunk by a static
    // import edge. The five are allowed to import each other -- they do, and
    // that is correct: `wgsl-rk4-dispatch` needs the kernel source and both
    // need the planar rhs, so forbidding it outright (as the Plotly precedent
    // could, being one self-contained package) would forbid the real shape of
    // this dependency. What must not exist is an edge from anything eager INTO
    // the set, which is the failure this actually guards.
    for (const other of chunks) {
      if (gpuFileNames.has(other.fileName)) continue;
      for (const imported of other.imports) {
        expect(gpuFileNames.has(imported)).toBe(false);
      }
    }

    // Strongest available form of the same statement on this graph: the entry
    // chunk has no static imports at all, so there is no edge to trace.
    expect(entryChunk!.imports).toEqual([]);

    // All five, not just the one the fixture names: the loader pulls them as a
    // unit, and a split that deferred only `wgsl-rk4-kernel` would satisfy every
    // assertion above while leaving the other four eager.
    const deferredBasenames = new Set(
      gpuChunks
        .flatMap((c) => c.moduleIds.filter(isDeferredGpuModule))
        .map((id) => path.basename(id).replace(/\.[cm]?[jt]s$/, "")),
    );
    expect([...deferredBasenames].sort()).toEqual([...DEFERRED_GPU_MODULES].sort());
  }, 90_000);

  it("keeps the eager capability probe eager, which is what makes the split meaningful", async () => {
    const chunks = await buildFixture("lazy-gpu-backend.bundle-fixture.ts");
    const entryChunk = chunks.find((c) => c.isEntry)!;

    // probeWebGpu must be in the INITIAL load. If it drifted behind the dynamic
    // boundary too, the first test would still pass while the app had lost the
    // ability to answer "is there an adapter?" without a round trip -- and the
    // whole probe/dispatch split this task rests on would be gone.
    expect(
      entryChunk.moduleIds.some((id) => path.basename(id).startsWith("webgpu-capability")),
    ).toBe(true);
    expect(entryChunk.code).toContain("requestAdapter");

    // The WGSL source text is the weight being deferred; it must not have
    // leaked into the entry chunk by any route, including inlining.
    expect(entryChunk.code).not.toContain("@compute");
    expect(entryChunk.code).not.toContain("workgroup_size");
  }, 90_000);

  it("carries real WGSL weight in the dynamic chunks, so the split is worth making", async () => {
    const chunks = await buildFixture("lazy-gpu-backend.bundle-fixture.ts");
    const gpuChunks = chunks.filter((c) => c.moduleIds.some(isDeferredGpuModule));

    // A structural split around a few bytes would pass every assertion above
    // and be pointless. The deferred code is tens of kB of WGSL source and
    // dispatch plumbing; this pins that it stays worth deferring.
    const deferredBytes = gpuChunks.reduce((sum, c) => sum + c.code.length, 0);
    expect(deferredBytes).toBeGreaterThan(20_000);

    const gpuCode = gpuChunks.map((c) => c.code).join("");
    expect(gpuCode).toContain("@compute");
    expect(gpuCode).toContain("workgroup_size");
  }, 90_000);

  it("keeps @ballista/wasm-core out of the bundle entirely, which is stronger than lazy", async () => {
    const chunks = await buildFixture("lazy-gpu-backend.bundle-fixture.ts");

    // The absence still holds and is still worth asserting, but READ THE
    // REASON, because P0.133 changed it. This used to be impossibility:
    // wasm-rk4-backend.ts imported node:fs/promises at module top level, so a
    // dynamic chunk containing it could not resolve in a browser and total
    // absence was the only available property. That import is gone. What this
    // now pins is that THIS fixture does not reach wasm-core -- a property of
    // the fixture, not of the package -- so it still catches a stray eager
    // import into the GPU path while no longer standing in for "the kernel is
    // unbundleable". Lazy-loading the kernel for real is P0.139.
    for (const chunk of chunks) {
      expect(chunk.moduleIds.some((id) => id.includes("wasm-core"))).toBe(false);
      expect(chunk.code).not.toContain("node:fs/promises");
    }
  }, 90_000);

  it("pins that wasm-core has no top-level node: import, which is what P0.133 changed", () => {
    // This case used to assert the opposite -- `toContain('from "node:fs/promises"')`
    // -- so that the day wasm-core lost its node-only imports, the absence
    // argument above would have to be re-derived rather than inherited from a
    // comment. That day was P0.133 and this is the re-derivation.
    //
    // The file is read rather than imported because importing it from vitest
    // proves nothing: Node resolves `node:fs` perfectly well, so a module that
    // had quietly regained the import would still load here. The regex matches
    // an import/export specifier, not the string `node:` in the prose above it,
    // which that file's own header contains several times.
    const backend = readFileSync(
      path.join(here, "..", "..", "wasm-core", "src", "wasm-rk4-backend.ts"),
      "utf8",
    );
    expect(backend).not.toMatch(/\bfrom\s*["']node:/);

    // And the node-only reader still exists, in the file that is allowed to
    // have it. Without this the assertion above would also pass if someone
    // deleted the Node path outright.
    const nodeLoader = readFileSync(
      path.join(here, "..", "..", "wasm-core", "src", "wasm-artifact-node.ts"),
      "utf8",
    );
    expect(nodeLoader).toMatch(/\bfrom\s*["']node:fs\/promises["']/);
  });
});
