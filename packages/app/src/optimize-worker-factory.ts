/**
 * The one place a real browser `Worker` gets constructed for optimize jobs
 * (P5.18). Same reasoning as `sweep-worker-factory.ts` — see its header for
 * why `new Worker(new URL(...))` lives at the app edge and not in
 * `@ballista/runtime` — pointed at the other worker entry.
 */

import type { WorkerLike } from "@ballista/runtime";

/** Wraps a real DOM `Worker` to `WorkerLike`'s narrower shape (see `createSweepWorker`). */
export function createOptimizeWorker(): WorkerLike {
  const worker = new Worker(
    new URL("../../runtime/src/optimize-worker-entry.ts", import.meta.url),
    {
      type: "module",
    },
  );

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
