/**
 * Cooperative cancellation for a chunked integration (P2.41, §5.1's
 * "worker-side cancellation are structural, not bolted on"). A caller
 * outside the solve (a "stop" button handler, a worker's message
 * listener) flips {@link CancellationSource.cancel}; the driver only ever
 * *reads* {@link CancellationToken.isCanceled}, checked once between each
 * accepted step inside {@link IntegrationContinuation.runSlice}'s
 * generator -- a stricter grain than "between chunks" (this task's own
 * title), so a caller who requests a single huge slice is still honored
 * promptly rather than only at the next slice boundary. `integrate`'s
 * plain, non-chunked entry point takes no token: a synchronous call
 * cannot observe an external mutation mid-call in single-threaded JS, so
 * cancellation is only meaningful paired with the chunking API that
 * actually returns control to the caller in between.
 */
export interface CancellationToken {
  readonly isCanceled: boolean;
}

/** Creates a fresh, uncanceled {@link CancellationToken} plus the one-way `cancel()` call that trips it. */
export function createCancellationSource(): { token: CancellationToken; cancel: () => void } {
  let canceled = false;
  const token: CancellationToken = {
    get isCanceled(): boolean {
      return canceled;
    },
  };
  return {
    token,
    cancel: (): void => {
      canceled = true;
    },
  };
}
