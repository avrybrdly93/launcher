import {
  probeBrowserKernels,
  type BrowserKernelProbe,
} from "./wasm-core-browser.bundle-fixture.js";

/**
 * The browser-side half of P0.139, and deliberately the thinnest thing that
 * can be.
 *
 * `wasm-core-browser.bundle.test.ts` already builds
 * {@link probeBrowserKernels} and runs the built chunk -- in Node, with a
 * stubbed `fetch`. P0.139's criterion asks for "a test that builds a real
 * consumer **and a browser test that runs it**", and this module is what
 * makes the second half possible: the *same* fixture, loaded by a real
 * engine from a real HTTP server, so `fetch`, the asset URL and
 * `WebAssembly` are the engine's own rather than this repository's.
 *
 * It adds no probing of its own. Anything asserted here and not there would
 * be a second definition of the same criterion, free to drift from the
 * first. All this does is run the fixture and park the outcome somewhere
 * `page.evaluate` can read it.
 *
 * No DOM types: `packages/runtime`'s tsconfig has `lib: ["ES2022"]` and this
 * module is not the reason to widen it. The one global it touches is reached
 * through `globalThis` with a named shape.
 */

/** Where the page parks its result. Read by `wasm-core-browser.e2e.test.ts`. */
export const PROBE_SLOT = "__ballistaWasmBrowserProbe";

/**
 * A settled probe, success or failure.
 *
 * The failure arm exists because a rejected promise inside a module script is
 * invisible to `page.evaluate` -- the slot would simply stay undefined and the
 * test would time out reporting nothing. Carrying the stack across makes a
 * browser-side failure legible in the Node-side assertion that reads it.
 */
export type ProbeOutcome =
  | { readonly ok: true; readonly probe: BrowserKernelProbe }
  | { readonly ok: false; readonly error: string };

const slot = globalThis as unknown as { [PROBE_SLOT]?: ProbeOutcome };

void (async (): Promise<void> => {
  try {
    slot[PROBE_SLOT] = { ok: true, probe: await probeBrowserKernels() };
  } catch (error) {
    slot[PROBE_SLOT] = {
      ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
  }
})();
