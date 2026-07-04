# ADR-001: Strict Layered Architecture with Unidirectional Dependencies

**Status:** Accepted
**Date:** 2026-07-03

## Context

Ballista's physics/numerics core (Engine, SolverKit) must run identically in
the main thread, a Web Worker, Node (CI), and eventually a WASM/GPU harness
(§2.1). That portability is only possible if the numerics layers never
acquire a DOM, rendering, or UI dependency, and if higher layers cannot reach
back down into lower layers' internals in ways that create cycles.

## Decision

The codebase is split into eight packages assigned to six strict layers:

```
L0 engine       — Model interface, ForceModel algebra, state types, units
L1 solverkit    — steppers, adaptivity, dense output, events, root finding
L1 analysis     — inverse problems, Monte Carlo, sensitivity (depends on solverkit)
L2 runtime      — session lifecycle, worker orchestration, recording
L3 viz          — scene graph, rendering, plots
L4 ui           — control panels, presets, scenario editor
L5 app          — shell, routing, storage, theming
dev validation  — analytical references, convergence harness, golden trajectories
```

A package may depend only on packages at a strictly lower layer (or, for the
`analysis` → `solverkit` edge, the other L1 package it legitimately needs).
`validation` may depend on `engine`/`solverkit`/`analysis` but nothing may
depend on `validation` — it exists for tests and CI only.

## Enforcement

- TypeScript project references (`tsconfig.json` per package) make illegal
  imports fail to typecheck against out-of-scope source.
- `dependency-cruiser` (`.dependency-cruiser.cjs`) encodes the exact allowed
  edge list and runs in CI (`pnpm lint:deps`) as a hard gate, independent of
  what any individual `package.json` happens to declare.

## Consequences

- L0/L1 stay dependency-free of the DOM by construction, which is what makes
  headless regression testing and later WASM/GPU backend swaps additive
  rather than a rewrite (§2.4c).
- Adding a legitimate new cross-package edge requires an explicit edit to
  `.dependency-cruiser.cjs`, not just a `package.json` change — the layering
  is reviewed, not implicit.
