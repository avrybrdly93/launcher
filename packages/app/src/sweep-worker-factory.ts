/**
 * The one place a real browser `Worker` gets constructed for the sweep
 * worker pool (P3.39). `@ballista/runtime`'s `worker-pool.ts` (L2) stays
 * DOM-agnostic on purpose -- `new Worker(new URL(...))` needs both the DOM
 * `Worker` type (this package's tsconfig includes `"DOM"`; runtime's
 * doesn't) and a bundler that statically recognizes this exact call shape
 * (Vite's worker plugin) to split `sweep-worker-entry.ts` into its own
 * chunk, both of which are properties of the app edge, not a library
 * package. The referenced path is a real relative filesystem path across
 * the monorepo (`packages/app/src` -> `packages/runtime/src`), not a
 * package-specifier import, so Vite resolves and bundles it exactly like
 * any other same-repo source file.
 */

import type { WorkerLike } from "@ballista/runtime";

/**
 * Wraps a real DOM `Worker` to `WorkerLike`'s narrower shape (message
 * payload only, not a full `MessageEvent`). A direct `Worker` value can't
 * structurally satisfy `WorkerLike` -- `onmessage`'s DOM type takes a full
 * `MessageEvent`, ours takes just `{ data }`, and property (not method)
 * assignability is checked contravariantly on that parameter -- so this
 * subscribes to the real worker's events once, at construction, and
 * forwards through whichever handler `WorkerLike.onmessage`/`onerror` is
 * currently set to.
 */
export function createSweepWorker(): WorkerLike {
  const worker = new Worker(new URL("../../runtime/src/sweep-worker-entry.ts", import.meta.url), {
    type: "module",
  });

  let onmessageHandler: ((event: { readonly data: unknown }) => void) | null = null;
  let onerrorHandler: ((event: unknown) => void) | null = null;
  worker.onmessage = (event) => onmessageHandler?.({ data: event.data });
  worker.onerror = (event) => onerrorHandler?.(event);

  return {
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
    get onmessage() {
      return onmessageHandler;
    },
    set onmessage(handler) {
      onmessageHandler = handler;
    },
    get onerror() {
      return onerrorHandler;
    },
    set onerror(handler) {
      onerrorHandler = handler;
    },
  };
}
