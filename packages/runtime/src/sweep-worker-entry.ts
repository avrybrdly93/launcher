/**
 * The actual code that runs inside a `sweep` worker (P3.39): wires
 * `handleSweepChunkRequest` (`worker-pool.ts`, the one place the
 * request/response shape is defined) to the worker global scope's message
 * event. Never imported by any main-thread module -- it's only ever
 * referenced by `new URL("./sweep-worker-entry.js", import.meta.url)` at
 * the app edge (`sweep-worker-factory.ts`), which is what makes Vite
 * bundle it as its own separate worker chunk pulling in nothing beyond
 * this file's own transitive imports: `@ballista/engine`,
 * `@ballista/solverkit`, and this package's own DOM-free
 * `sweep-job.ts`/`scenario-resolver.ts` -- the "pure L0/L1 bundle" this
 * task's title asks for, never `viz`/`ui`.
 */

import { postSweepChunkResult, type SweepChunkRequest } from "./worker-pool.js";

/**
 * The minimal worker-global-scope surface this file needs. Declared
 * locally (not `declare global`) so it doesn't require the "webworker"/
 * "dom" lib and can't leak into any other package's compilation -- exactly
 * how `simulation-session.ts` probes `requestAnimationFrame` structurally
 * rather than pulling in a DOM lib package-wide.
 */
declare const self: {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: readonly ArrayBufferLike[]): void;
};

self.onmessage = (event) => {
  postSweepChunkResult(
    (message, transfer) => self.postMessage(message, transfer),
    event.data as SweepChunkRequest,
  );
};
