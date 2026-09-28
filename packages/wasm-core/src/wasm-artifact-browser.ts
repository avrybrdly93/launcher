import { WasmRk4Kernel, type WasmArtifactSource } from "./wasm-rk4-backend.js";

/**
 * The browser half of P0.133: fetching the committed `.wasm` artifacts.
 *
 * Nothing here touches a `node:` builtin, a DOM type, or a global beyond
 * `fetch` -- and `fetch` is injectable, so even that is a default rather than a
 * dependency. That matters for the same reason the rest of this package's seams
 * are injected: a test can then exercise the browser path *as the browser path*
 * instead of approximating it.
 *
 * # Why the URLs are `new URL(..., import.meta.url)` and why they are overridable
 *
 * `new URL("./generated/x.wasm", import.meta.url)` is the form every bundler
 * recognises as an asset reference, so Vite/Rollup emit the `.wasm` beside the
 * chunk and rewrite the specifier to wherever it landed. Hard-coding a path
 * would work in exactly one deployment layout; this works in all of them,
 * including the relative `base: "./"` the app builds with so it can be embedded
 * at an arbitrary subpath.
 *
 * They are still overridable because a caller serving the artifacts from
 * somewhere else -- a CDN, a versioned asset host, a test harness -- has no
 * other way in, and because {@link createFetchWasmArtifactSource} is how
 * `wasm-rk4-backend.browser.test.ts` runs a real bundle's own code against the
 * real committed bytes without a browser.
 */

/** The two artifact URLs, resolved relative to this module. */
export interface WasmArtifactUrls {
  readonly scalar: string | URL;
  readonly simd: string | URL;
}

/**
 * Where the artifacts sit next to this module's own chunk.
 *
 * A getter-free plain object built at module scope: the `new URL` calls must be
 * statically analysable for a bundler to see them as asset references at all,
 * so they cannot be deferred into a function.
 */
export const DEFAULT_WASM_ARTIFACT_URLS: WasmArtifactUrls = {
  scalar: new URL("./generated/ballista-core.wasm", import.meta.url),
  simd: new URL("./generated/ballista-core.simd.wasm", import.meta.url),
};

/** The `fetch` shape this module needs, which is far less than the real one. */
export type FetchLike = (input: string | URL) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

async function fetchArtifact(url: string | URL, fetchImpl: FetchLike): Promise<Uint8Array> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    // A 404 on a `.wasm` otherwise surfaces as a WebAssembly magic-number
    // error against an HTML error page, which sends the reader looking at the
    // kernel instead of at the deployment.
    throw new Error(`Could not fetch WASM artifact ${String(url)}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * A {@link WasmArtifactSource} backed by `fetch`.
 *
 * @param urls where the two artifacts are served from; defaults to beside this
 *   module's chunk.
 * @param fetchImpl the fetch to use; defaults to the ambient global, read at
 *   call time rather than at module scope so that importing this module does
 *   not require `fetch` to exist.
 */
export function createFetchWasmArtifactSource(
  urls: WasmArtifactUrls = DEFAULT_WASM_ARTIFACT_URLS,
  fetchImpl?: FetchLike,
): WasmArtifactSource {
  const resolve = (): FetchLike => {
    const impl = fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (impl === undefined) {
      throw new TypeError("createFetchWasmArtifactSource: no fetch available; pass one explicitly");
    }
    return impl;
  };
  return {
    readScalar: () => fetchArtifact(urls.scalar, resolve()),
    readSimd: () => fetchArtifact(urls.simd, resolve()),
  };
}

/** The scalar kernel, fetched from beside this module's chunk. */
export async function instantiateBrowserKernel(
  source: WasmArtifactSource = createFetchWasmArtifactSource(),
): Promise<WasmRk4Kernel> {
  return WasmRk4Kernel.instantiateFrom(source);
}

/**
 * The simd128 kernel where the engine supports it and the scalar one where it
 * does not, both fetched.
 *
 * The browser-side counterpart of `instantiateBestNodeKernel`. The simd128
 * feature detect is `wasmSimdSupported()` either way -- it compiles a 43-byte
 * probe module and asks `WebAssembly.validate` -- so an engine without the
 * proposal gets the scalar artifact here exactly as it does in Node, and
 * `BROWSER_CPU_BACKENDS` naming `wasm-simd` is a statement about what this
 * package can reach rather than a promise about a particular engine.
 */
export async function instantiateBestBrowserKernel(
  source: WasmArtifactSource = createFetchWasmArtifactSource(),
): Promise<WasmRk4Kernel> {
  return WasmRk4Kernel.instantiateBestFrom(source);
}
