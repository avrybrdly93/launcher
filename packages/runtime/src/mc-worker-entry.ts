/**
 * The actual code that runs inside an `mc` worker (P0.119), mirroring
 * `optimize-worker-entry.ts`: wires `postMcResult` (`worker-pool.ts`, the one
 * place the request/response shape is defined) to the worker global scope's
 * message event.
 *
 * Its own entry rather than a `request.kind` switch inside an existing one,
 * for the reason `optimize-worker-entry.ts` states: the entry file *is* the
 * bundle boundary, so Vite splits a worker chunk per `new URL(...)` entry and
 * merging them would make every sweep worker pull in this file's transitive
 * `@ballista/analysis` reductions. The pool takes a `WorkerFactory`, so
 * pointing a pool at one entry or another is the app edge's choice.
 */

import { postMcResult, type McRequest } from "./worker-pool.js";

/** See `sweep-worker-entry.ts` for why this is declared locally rather than pulled from a DOM lib. */
declare const self: {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: readonly ArrayBufferLike[]): void;
};

self.onmessage = (event) => {
  postMcResult((message) => self.postMessage(message), event.data as McRequest);
};
