import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { WasmRk4Kernel, type WasmArtifactSource } from "./wasm-rk4-backend.js";

/**
 * The Node half of P0.133: reading the committed `.wasm` artifacts off disk.
 *
 * This file exists so that `wasm-rk4-backend.ts` does not. Everything here
 * imports a `node:` builtin, which is exactly why it is quarantined in a module
 * no browser-reachable code path imports -- a chunk containing a `node:`
 * specifier does not degrade in a browser, it fails to resolve, so the boundary
 * has to be a file boundary and not a conditional.
 *
 * Reached as `@ballista/wasm-core/node`. The bare `@ballista/wasm-core`
 * specifier stays browser-safe, and that split is what
 * `wasm-rk4-backend.browser.test.ts` pins.
 */

/** Path to the committed scalar `.wasm`, which is what CI runs against (it has no Rust). */
export const WASM_ARTIFACT_PATH = fileURLToPath(
  new URL("./generated/ballista-core.wasm", import.meta.url),
);

/**
 * Path to the committed simd128 `.wasm` (P7.09).
 *
 * A separate binary rather than a runtime branch inside one: a module carrying
 * simd128 instructions fails *validation* on an engine without the proposal, so
 * the choice has to be made before the bytes are compiled, not inside them.
 */
export const WASM_SIMD_ARTIFACT_PATH = fileURLToPath(
  new URL("./generated/ballista-core.simd.wasm", import.meta.url),
);

/** Reads the committed scalar artifact's bytes. */
export async function readWasmArtifact(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(WASM_ARTIFACT_PATH));
}

/** Reads the committed simd128 artifact's bytes. */
export async function readWasmSimdArtifact(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(WASM_SIMD_ARTIFACT_PATH));
}

/**
 * The two artifacts as a {@link WasmArtifactSource}, read from the filesystem.
 *
 * A module-level constant rather than a factory because there is nothing to
 * configure: the paths are derived from this file's own location and a Node
 * caller that wanted different bytes would pass them to
 * {@link WasmRk4Kernel.instantiate} directly.
 */
export const nodeWasmArtifactSource: WasmArtifactSource = {
  readScalar: readWasmArtifact,
  readSimd: readWasmSimdArtifact,
};

/** The scalar kernel, instantiated from the committed artifact on disk. */
export async function instantiateNodeKernel(): Promise<WasmRk4Kernel> {
  return WasmRk4Kernel.instantiateFrom(nodeWasmArtifactSource);
}

/**
 * The simd128 kernel where this engine supports it and the scalar one where it
 * does not, both from disk.
 *
 * The Node-side replacement for the old no-argument `instantiateBest()`.
 */
export async function instantiateBestNodeKernel(): Promise<WasmRk4Kernel> {
  return WasmRk4Kernel.instantiateBestFrom(nodeWasmArtifactSource);
}
