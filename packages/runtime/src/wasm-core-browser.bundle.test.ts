import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import type { OutputAsset, OutputChunk, RollupOutput } from "rollup";
import { afterAll, describe, expect, it } from "vitest";
import type { BrowserKernelProbe } from "./wasm-core-browser.bundle-fixture.js";

/**
 * P0.133's validation criterion, in the only form that can actually fail:
 * **a browser bundle instantiates the scalar and the simd128 kernels**.
 *
 * The three weaker things this file deliberately does not do, because each of
 * them would pass while the criterion was false:
 *
 * 1. *Import the browser loader from this test.* Vitest runs in Node, where
 *    `node:fs` resolves fine, so a module that had quietly regained a Node
 *    import would still pass. The bundler is the instrument precisely because
 *    it is the thing that cannot resolve one.
 * 2. *Assert on the chunk graph and stop.* A bundle can be free of `node:`
 *    specifiers and still fail at runtime -- wrong asset URL, artifact not
 *    emitted, bytes truncated. So the built chunk is written out and
 *    **executed**, with `fetch` served from the committed artifacts.
 * 3. *Trust `instantiateBestBrowserKernel` for the simd128 half.* It falls back
 *    to the scalar artifact by design, so on an engine without simd128 it
 *    proves nothing about the second binary. The fixture therefore also asks
 *    for the simd128 bytes by name.
 *
 * The companion assertion -- that `wasm-rk4-backend.ts` holds no `node:` import
 * at all -- lives in `lazy-gpu-backend.bundle.test.ts`, which is where the
 * opposite claim used to be pinned before this task removed it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const ARTIFACT_DIR = path.join(here, "..", "..", "wasm-core", "src", "generated");

/** Matches an ESM import/export of a `node:` builtin, not the string in a comment. */
const NODE_BUILTIN_SPECIFIER = /\bfrom\s*["']node:/;

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface BuiltBundle {
  readonly chunks: readonly OutputChunk[];
  readonly assets: readonly OutputAsset[];
}

async function buildFixture(): Promise<BuiltBundle> {
  const result = await build({
    root: here,
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      // Deterministic asset handling, and the reason this is an APP build
      // rather than a `lib` one. Vite's library mode inlines every referenced
      // asset as a base64 data URI no matter what `assetsInlineLimit` says,
      // because a library cannot assume where its files will sit. That would
      // turn the fetch path this test exists to exercise into a no-op while
      // every assertion still passed. An app build is also what
      // `packages/app` actually ships, so this measures the deployed shape.
      assetsInlineLimit: 0,
      rollupOptions: {
        input: path.join(here, "wasm-core-browser.bundle-fixture.ts"),
        output: { entryFileNames: "entry.js", format: "es" },
        // An app build assumes nothing imports its entry and drops the
        // entry's exports. This test does import it, so the signature has to
        // be kept -- without changing anything else about how the graph is
        // built or how assets are emitted.
        preserveEntrySignatures: "exports-only",
      },
    },
  });
  const single = Array.isArray(result) ? result[0]! : result;
  const output = (single as RollupOutput).output;
  return {
    chunks: output.filter((item): item is OutputChunk => item.type === "chunk"),
    assets: output.filter((item): item is OutputAsset => item.type === "asset"),
  };
}

/**
 * Writes the built bundle to a temp directory and imports it, with `fetch`
 * stubbed to serve the committed artifacts.
 *
 * The stub keys on the request's basename rather than its full path, because
 * the bundler rewrites `new URL("./generated/x.wasm", import.meta.url)` to
 * wherever the asset landed and the point of the exercise is that the loader
 * follows the bundler's answer rather than a path this repository guessed.
 */
async function runBuiltFixture(bundle: BuiltBundle): Promise<BrowserKernelProbe> {
  const dir = mkdtempSync(path.join(tmpdir(), "ballista-wasm-browser-"));
  tempDirs.push(dir);

  const byBasename = new Map<string, string>();
  const place = (fileName: string, contents: Buffer | string): void => {
    const file = path.join(dir, fileName);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
    byBasename.set(path.basename(fileName), file);
  };
  for (const chunk of bundle.chunks) {
    place(chunk.fileName, chunk.code);
  }
  for (const asset of bundle.assets) {
    place(asset.fileName, Buffer.from(asset.source as Uint8Array));
  }

  const served: string[] = [];
  const fetchStub = async (input: string | URL) => {
    const requested = String(input);
    // The bundler decides both the directory and the hashed filename, so the
    // stub resolves by basename rather than reconstructing a path. A `data:`
    // URL here would mean the asset was inlined and never fetched, which the
    // build options above exist to prevent -- fail loudly rather than decode it.
    expect(requested.startsWith("data:")).toBe(false);
    const name = path.basename(new URL(requested).pathname);
    const local = byBasename.get(name);
    expect(local, `bundle fetched ${name}, which it did not emit`).toBeDefined();
    served.push(name);
    const bytes = readFileSync(local!);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };

  const previousFetch = globalThis.fetch;
  (globalThis as { fetch?: unknown }).fetch = fetchStub;
  try {
    const entry = bundle.chunks.find((c) => c.isEntry)!;
    expect(entry, "the build produced no entry chunk").toBeDefined();
    const module = (await import(pathToFileURL(path.join(dir, entry.fileName)).href)) as {
      probeBrowserKernels: () => Promise<BrowserKernelProbe>;
    };
    const probe = await module.probeBrowserKernels();
    // Not vacuous: if the loader had stopped fetching -- inlined bytes, a
    // cached instance, a silent throw swallowed upstream -- this would be empty
    // while every numeric assertion below still passed.
    expect(served.length).toBeGreaterThan(0);
    expect(served.every((n) => n.endsWith(".wasm"))).toBe(true);
    return probe;
  } finally {
    (globalThis as { fetch?: unknown }).fetch = previousFetch;
  }
}

describe("browser reachability of the WASM kernels (P0.133)", () => {
  it("bundles @ballista/wasm-core with no node: builtin anywhere in the graph", async () => {
    const { chunks, assets } = await buildFixture();

    // The control. Every assertion below is about wasm-core's presence, and an
    // empty or tree-shaken graph would satisfy all of them.
    const wasmCoreChunks = chunks.filter((c) =>
      c.moduleIds.some((id) => id.includes(`${path.sep}wasm-core${path.sep}`)),
    );
    expect(wasmCoreChunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.code).not.toMatch(NODE_BUILTIN_SPECIFIER);
    }

    // Both artifacts emitted beside the chunk, which is what makes the
    // `new URL(..., import.meta.url)` form the right one: the bundler, not this
    // repository, decides where they land.
    const emitted = assets.map((a) => path.basename(a.fileName));
    expect(emitted.some((n) => n.startsWith("ballista-core") && n.endsWith(".wasm"))).toBe(true);
    expect(emitted.filter((n) => n.endsWith(".wasm"))).toHaveLength(2);
  }, 90_000);

  it("instantiates the scalar kernel from the built bundle and integrates with it", async () => {
    const probe = await runBuiltFixture(await buildFixture());

    expect(probe.scalarFinal).toHaveLength(4);
    for (const value of probe.scalarFinal) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // A kernel that instantiated but never ran would return the initial state.
    // Checked against the fixture's own initial condition rather than a golden
    // number, because this file is about reachability and the numbers are
    // pinned to 0 ULP by backend-equivalence.test.ts already.
    expect(probe.scalarFinal[0]).toBeGreaterThan(0);
    expect(probe.scalarFinal.slice(0, 2)).not.toEqual([0, 0]);
  }, 90_000);

  it("instantiates the simd128 kernel from the built bundle, by name rather than by fallback", async () => {
    const probe = await runBuiltFixture(await buildFixture());

    if (!probe.simdSupported) {
      // Recorded rather than silently passed: on an engine without the
      // proposal the criterion's simd128 half is untestable here, and the
      // scalar half above is what stands.
      expect(probe.explicitSimdHasSimd).toBeUndefined();
      expect(probe.bestHasSimd).toBe(false);
      return;
    }

    expect(probe.explicitSimdHasSimd).toBe(true);
    expect(probe.bestHasSimd).toBe(true);

    // Bit-identical, not merely close: each SIMD lane is an independent
    // replicate and simd128 has no FMA, so there is no reassociation. Any
    // difference here would mean the bundle handed one of the two paths the
    // wrong bytes.
    expect(probe.explicitSimdFinal).toBeDefined();
    for (const [i, value] of probe.scalarFinal.entries()) {
      expect(Object.is(probe.explicitSimdFinal![i], value)).toBe(true);
      expect(Object.is(probe.bestFinal[i], value)).toBe(true);
    }
  }, 90_000);

  it("serves the artifacts the bundler emitted, and the committed bytes are what run", async () => {
    const { assets } = await buildFixture();
    const emitted = assets.filter((a) => a.fileName.endsWith(".wasm"));
    const committed = [
      readFileSync(path.join(ARTIFACT_DIR, "ballista-core.wasm")),
      readFileSync(path.join(ARTIFACT_DIR, "ballista-core.simd.wasm")),
    ];

    // The bundler copies rather than transforms, so the emitted bytes must be
    // the committed ones. If this ever diverged, every equivalence result
    // measured in Node would be about a different binary from the one browsers
    // run -- which is the failure mode this whole task exists to remove.
    const emittedBytes = emitted.map((a) => Buffer.from(a.source as Uint8Array));
    for (const bytes of committed) {
      expect(emittedBytes.some((e) => e.equals(bytes))).toBe(true);
    }
  }, 90_000);
});
