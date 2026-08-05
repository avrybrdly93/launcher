# Changelog

Dated, newest-first log of automated session runs against this repo.

**This file is a session log, not the task record.** `ROADMAP.json` remains the
authoritative per-task state: every task's `status`, `validation` criterion, and
its full implementation/verification notes live there, in the same commit as the
code change (see `policy.commitRules`). Entries here say what a _run_ did and
what the next one should pick up, and never restate what `ROADMAP.json` already
records in more detail.

Created 2026-08-05 because the scheduled routine that drives this repo orders its
work by each repo's most-recent changelog entry and this repo had no such file,
forcing a fallback to commit timestamps.

---

## 2026-08-05 — P4.32 (phase-portrait plot pane)

- **Done: P4.32** — phase-portrait pane, `packages/viz/src/phase-portrait.ts`
  (+ `phase-portrait.test.ts`, 17 tests), exported from `packages/viz/src/index.ts`.
  A solve drawn as a (q, p) curve instead of a value-vs-time trace, plus
  `cycleAreas`/`areaGrowthRatio`, which turn the orbit into a number so the
  integrator contrast can be asserted rather than eyeballed. Reuses `plot-pane.ts`'s
  screen mapping and `axes-layer.ts`'s ticks rather than duplicating them. Full
  design/verification notes in `ROADMAP.json` under P4.32.
- **Validation criterion met** ("Euler spiral vs Verlet closed orbit visible
  (automated area-growth assert)"), measured on the P4.31 pendulum — L=1, g=9.81,
  theta0=0.5 rad, h=0.01, t in [0,16], 7 laps, identical setup for both runs with
  only the integrator differing: explicit Euler's per-lap enclosed phase-space area
  grows monotonically **2.679524 → 8.420249** (ratio 3.142442); velocity Verlet holds
  **2.427316 → 2.427316** (ratio 1.000000 to 6 dp).
- **Integrator discipline**: the pendulum is conservative (no drag, no damping, no
  dissipative path), which is the precondition for the symplectic Verlet stepper used
  in the comparison. No dissipative system is integrated symplectically in this diff;
  no stepper or golden-trajectory code was touched.
- **Tests**: `pnpm test` **197 files / 1310 tests, all passing** (up from P4.31's
  196/1293: +1 file, +17 tests). `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`
  (1158 modules, 3119 dependencies, no violations) all clean. Engine and solverkit
  `docs` clean. `pnpm --filter @ballista/app build` succeeds; `check-bundle-size`
  60.1 kB gzipped against the 300 kB budget, unchanged — the new module is not
  imported by the app yet, the same status `plot-pane.ts` has had since P3.29.
- **Not re-run** (cannot be affected by this diff — no stepper, no cross-engine
  physics path; same reasoning P4.28/P4.30 recorded): `pnpm bench:solverkit`,
  `pnpm check:cross-engine-drift`.
- **Known pre-existing, not introduced here**: `pnpm --filter @ballista/viz test`
  fails with "No test files found" (vitest's root include glob does not resolve under
  a per-package cwd, documented in P4.30's notes). Root `pnpm test` — CI's own Test
  step — was used throughout.
- **Next session**: take **P4.33** (two-body/Kepler model registration, Stage-B seed,
  with energy + angular-momentum invariants) — it is the next `todo` in `seq` order and
  nothing in Phase 4 is `in-progress` or `review`. It is also the natural next consumer
  of this session's work: a Kepler orbit is the other classic closed-orbit phase
  portrait, and `phasePortraitSeries` will pick its pair straight off `partitions` with
  no new plumbing. Do not reorder phases or skip ahead to the P4.38 stretch item.
