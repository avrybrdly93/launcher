/**
 * The actual code that runs inside an `optimize` worker (P5.18), mirroring
 * `sweep-worker-entry.ts`: wires `postOptimizeResult` (`worker-pool.ts`, the
 * one place the request/response shape is defined) to the worker global
 * scope's message event.
 *
 * A separate entry from the sweep worker rather than one entry switching on
 * `request.kind`, because the entry file *is* the bundle boundary: Vite
 * splits a worker chunk per `new URL(...)` entry, so merging them would make
 * every sweep worker pull in `@ballista/analysis` and every optimize worker
 * pull in the sweep path. The pool takes a `WorkerFactory`, so pointing a
 * pool at one entry or the other is the app edge's choice.
 */

import { postOptimizeResult, type OptimizeRequest } from "./worker-pool.js";

/** See `sweep-worker-entry.ts` for why this is declared locally rather than pulled from a DOM lib. */
declare const self: {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: readonly ArrayBufferLike[]): void;
};

self.onmessage = (event) => {
  postOptimizeResult((message) => self.postMessage(message), event.data as OptimizeRequest);
};
