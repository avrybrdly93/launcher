# ADR-020: WASM Threads Are Deferred, Because This Workload Needs Cores and Not Shared Memory

**Status:** Accepted — wasm threads and `SharedArrayBuffer` are deferred
indefinitely, not blocked. The premises this rests on are asserted by
`packages/runtime/src/worker-scaling-decision.test.ts`, and the measurement is
`scripts/worker-scaling-results.json`
**Date:** 2026-09-12
**Task:** P7.12

## Context

P7.12's validation line is:

> 4-thread WASM scales ≥2.5× (or documented decision to defer)

This is the documented decision. It is a deferral, and the criterion explicitly
permits one — but a deferral is only worth writing down if it says **what was
measured** and **what would change the answer**, so this ADR does both.

### The ground the handover offered, and why it is not available

The 95th run's changelog entry handed P7.12 forward with this:

> wasm threads need `SharedArrayBuffer`, which needs COOP/COEP headers, and
> this app is served from GitHub Pages, which does not set them

**That is factually wrong about this repository, and it was checked rather than
inherited.** The deploy configuration in the repo root is `vercel.json` —
`"framework": "vite"`, `"outputDirectory": "packages/app/dist"` — and
`.github/workflows/` contains exactly one file, `ci.yml`, with no Pages job and
no deploy step of any kind. The app deploys to Vercel, and Vercel sets response
headers from a `headers` array in that same `vercel.json`. Setting

```json
"headers": [
  {
    "source": "/(.*)",
    "headers": [
      { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
      { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
    ]
  }
]
```

is a four-line diff to a file that already exists. **The host can set the
headers.** "We cannot" is not available as a reason, and had this ADR rested on
it, the first person to open `vercel.json` would have been entitled to reopen
the decision.

### The second ground that is also not available

The usual second cost of cross-origin isolation is that `require-corp` breaks
every cross-origin subresource that does not opt in with CORP. **This app has
none.** `packages/app/index.html` loads exactly one script, its own
`/src/main.tsx`, and a grep for `http://` or `https://` across
`packages/{app,ui,viz}/src` returns nothing — no CDN font, no analytics, no
external image. So cross-origin isolation would cost this app, today, nothing
in broken subresources.

Both of the easy arguments for deferring are therefore false here, and this ADR
says so before making the argument that is true. A deferral resting on a
convenient premise nobody checked is worse than no ADR.

## Decision

**Defer wasm threads. The workload is embarrassingly parallel over replicate
index, so it needs execution contexts, not shared memory — and message-passing
workers already supply them at the scaling the criterion asks for.**

### The structural half

The ensemble path partitions by replicate index into contiguous chunks
(`partitionReplicates`) and reassembles by each chunk's own `startIndex`, never
by arrival order (§5.6, and ADR-011's determinism rule). A replicate is a pure
function of the study seed and its index (P6.03). Consequently **no two chunks
ever read or write the same cell of anything.** There is no shared mutable
state for shared memory to be shared _for_.

What wasm threads would add over `postMessage` workers is therefore not a core.
It is the removal of one buffer hand-off per chunk — and the worker entries
already move those buffers by transfer rather than copying them. Threads would
convert an already-zero-copy move into no move at all.

### The measured half

The criterion's subject is a number, and wasm threads are one mechanism for
reaching it rather than the only one. So the number was measured on the
mechanism that already ships. `scripts/measure-worker-scaling.mjs` sweeps the
worker count over the same ensemble, at the step size
`measure-batch-throughput.mjs` already reads its verdict at, on real
`node:worker_threads` threads, serially so the points do not contend:

| workers | traj/s | elapsed | speedup over 1 | parallel efficiency |
| ------- | -----: | ------: | -------------: | ------------------: |
| 1       |   3438 | 11.64 s |         1.000× |              100.0% |
| 2       |   6690 |  5.98 s |         1.946× |               97.3% |
| 4       |  10595 |  3.78 s |     **3.082×** |               77.1% |

Measured 2026-09-12 on this container: Node v22.22.2, linux/x64, **4 CPUs
reported**, 40 000 replicates at `h = 0.05`.

**3.08× ≥ 2.5×.** The criterion's number is met, today, with no
`SharedArrayBuffer`, no COOP/COEP header, and no change to the deployed app.
The drop from 97.3% efficiency at two workers to 77.1% at four is what a
4-CPU machine running four compute threads plus a main thread looks like, and
it is the reason the two-worker point is in the sweep: without it, 77% could be
read as a parallelization defect rather than as core exhaustion.

### What is therefore being traded away, honestly

Deferring threads gives up the one thing they would buy — the per-chunk buffer
hand-off — and that hand-off is not visible in the table above. At the sizes
this app runs, the chunk payload is `replicates × 8` doubles of parameters in
and a handful of observables out, against an RK4 integration of hundreds of
steps per replicate. The compute dominates by orders of magnitude, which is
exactly why 4 workers reach 3.08× rather than stalling on the boundary.

## Consequences

### What this costs if it is wrong

If a future workload appears where chunks _must_ share mutable state — a
tree-structured reduction across replicates, an adaptive scheduler rebalancing
mid-flight, a shared acceleration structure — this decision is wrong and should
be reopened. Nothing in phase 7's remaining tasks is such a workload: P7.13 to
P7.22 are GPU, where the parallelism question is answered by WebGPU rather than
by wasm threads, and P7.28's scheduler routes whole jobs rather than sharing
state inside one.

### The specific toolchain cost, which is repo-shaped and worth recording

`scripts/build-wasm-core.mjs` builds the crate with stock stable
`cargo build --target wasm32-unknown-unknown --release`, and `crate/Cargo.toml`
says out loud that being dependency-free "is what lets the `.wasm` be
reproduced from a stock toolchain with no registry access". Threads would
require `-C target-feature=+atomics,+bulk-memory,+mutable-globals` and a
shared-memory link, which in turn requires a standard library built with those
features — i.e. `-Z build-std` on nightly. That is a **third** artifact
variant beside `ballista-core.wasm` and `ballista-core.simd.wasm`, a third
target directory, a third freshness check, and a third lineage in P7.11's
backend-equivalence golden, in exchange for removing a buffer hand-off that is
already a transfer.

That cost is stated here as reasoning, not as a measurement: `cargo` and the
`wasm32-unknown-unknown` target are both reachable in this container, but no
atomics build was attempted, so this ADR does not claim to have observed the
failure mode. A later task that wants threads should try it and record what
actually happens rather than citing this paragraph.

### What would reopen this decision

Three things, in the order a reader should check them:

1. **The scaling number stops holding.** `pnpm bench:worker-scaling` reports
   under 2.5× at four workers **on an idle machine with at least four cores**.
   The script soft-warns rather than failing, for the reason every perf check
   in this repository soft-warns: a ratio measured next to a noisy neighbour is
   not a defect. A single warning is not evidence; a reproducible one is.
2. **A chunk-shared-state workload appears**, per the paragraph above.
3. **The app acquires a reason to be cross-origin isolated anyway** — for
   instance `performance.measureUserAgentSpecificMemory()`, or a future
   high-resolution timer requirement. If the headers are being set for another
   reason, threads' incremental cost drops to the toolchain paragraph alone and
   the trade changes.

### How the premises stay honest

Two of this ADR's load-bearing claims are facts about the repository that a
later commit could silently falsify: that `vercel.json` does **not** currently
set COOP/COEP, and that the app has **no** cross-origin subresources.
`packages/runtime/src/worker-scaling-decision.test.ts` asserts both, and fails
with a message pointing here. It is deliberately **not** a test that the
headers must never be set — setting them is reopening reason 3, which is a
legitimate thing to do. It is a test that they cannot be set _without someone
reading this file_.

The third claim — the 3.08× — is not asserted by a test, because a timing
assertion in `pnpm test` is a flake. It lives in
`scripts/worker-scaling-results.json` with the environment it was taken in, and
`pnpm bench:worker-scaling` re-derives it on demand.
