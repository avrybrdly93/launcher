# ADR-004: Zero-Allocation Hot Path for RHS Evaluation and Stepping

**Status:** Accepted
**Date:** 2026-07-03

## Context

The interactive path re-integrates a full trajectory on every slider change
within a 16 ms frame budget (§2.6), and batch runs must reach ≥10⁴
trajectories/s on CPU (Phase 6) and ≥10⁶/s on GPU (Phase 7). `Model.rhs` is
called on the order of 10²–10⁵ times per interactive run and far more per
batch. Any per-call heap allocation there both costs time directly and adds
GC pause risk that shows up as dropped frames.

## Decision

- `Model.rhs(t, y, out, ctx)` writes into a caller-supplied `out` buffer; it
  never allocates or returns a new object (§3.7).
- `Vec2` operations (`packages/engine/src/vec2.ts`) take an explicit `out`
  parameter and return it, rather than constructing a new tuple, so force
  composition (`composeForces`) can run entirely on preallocated
  accumulators.
- `EnvSample` (P1.02) is a reusable buffer object, sampled and overwritten in
  place rather than freshly constructed per query.
- This is verified, not just aspired to: a dedicated allocation-count test
  harness (P1.21, P2.42) asserts zero new objects across 10⁴–10⁵ evaluations
  after warmup.

## Consequences

- Force model and stepper code is slightly more verbose (explicit `out`
  params everywhere) than a naive functional style would be.
- The discipline established here at Phase 0/1 is what later makes SoA
  typed-array storage (§2.3) and a GPU backend (§10.1) a natural extension
  rather than a retrofit: the hot path was never depending on GC-managed
  object graphs to begin with.
