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

## 2026-08-06 — P4.37 (golden store v2 + tolerance review)

- **Done: P4.37** — `packages/validation/src/golden-trajectory-store.ts` gains a v2 scenario
  runner over the P4.36 curated library plus a tolerance-review harness;
  `golden-trajectories.json` goes to `schemaVersion: 2` with 11 new entries; 24 new tests. Full
  notes in `ROADMAP.json` under P4.37.
- **The "diffs from v1" the validation criterion asks about: there are none.** All 12 v1 entries
  (6 `PRESET_SCENARIOS` × {RK4 fixed, DOPRI5}, P2.52) were re-recorded and every one is
  bit-identical — same hash, `nSteps`, `finalState`, and full `t`/`channels` arrays for the
  smooth-sphere/RK4 entry. The entire body of Phase 4 work — ISA atmosphere, altitude-dependent
  gravity, the η(T)/c(T) wiring, Mach-dependent C_d, the dim-5 and dim-6 models, six new wind
  kinds — moved no pre-existing golden. The fixture diff is **128 added lines and 2 changed**
  (`schemaVersion`, `provenance`), which is the claim in a form that can be read off the diff
  rather than taken on trust.
- **v2 adds 11 entries, one per capability v1 could not reach**, sourced from the P4.36 library
  rather than newly invented: ISA + transonic C_d(M) (`cannonball-muzzle`), the steep C_d(Re)
  drag-crisis feature, the dim-5 spin model, the dim-6 spatial model, log-profile wind shear,
  the 1-cosine gust, the seeded frozen-OU realisation, a position-dependent vortex field,
  exponential atmosphere + altitude-dependent gravity, buoyancy, and a fixed-step RK4 entry.
- **The main finding is about which solver a golden is recorded with.** Nearly every library spec
  carries `REFERENCE_SOLVER` at rtol=1e-6 — correct for an interactive app, wrong for a
  regression store. Measured: at rtol=1e-6, a **7.11e-15** change in `frozen-ou-gust`'s `vx0`
  moves its final state by **8.07e-5** relative — an amplification of **3.6e11**, because the
  adaptive step sequence itself reorders. A golden recorded that way cannot detect a physics
  regression smaller than its own solver noise. v2 therefore takes the library's _physics_ and
  pairs it with v1's regression-grade DOPRI5 (rtol=1e-10/atol=1e-12), which drops that
  amplification by three decades to 2.59e8. `energy-drift-gravity-only` is the one documented
  exception and keeps its fixed-step library solver — being fixed-step is that entry's subject.
- **Tolerance review, measured rather than guessed.** v1 applied one global 1e-13 to every entry.
  v2 keeps 1e-13 as a floor and derives each entry's tolerance by perturbing each non-zero `y0`
  component by one relative EPS, re-integrating, and rounding the implied bound up to a decade.
  Result: **8 of 11 entries are well-conditioned** (amplification 2.7 → 4.5e2) and keep the
  floor; three need more — `table-tennis-topspin-decay` 1.62e4 → **1e-11**, `one-cosine-gust`
  4.52e2 → **1e-12**, `frozen-ou-gust` 2.59e8 → **1e-7**. So v1's single global tolerance was
  defensible for the entries it covered, and would have been misleading for three of the new ones.
- **Why frozen-OU is the outlier, and why it was not "fixed".** Its wind is a PCHIP interpolant
  over 501 sampled points, so the right-hand side is only C¹ in `t` — the second derivative jumps
  at every knot — and a 5(4) embedded pair's error control degrades there; the measurement
  confirms the step sequence genuinely reorders under the perturbation. This is the same
  order-degradation mechanism P4.34's C⁰-vs-C¹ exhibit demonstrates in the state variable, showing
  up in time instead. It is a property of P4.17's wind model, not a defect in this store, so it is
  recorded and left alone rather than fixed under a golden-store task.
- **Two anti-fabrication tests**, added because a tolerance is exactly the kind of number a future
  session could quietly widen to make a red suite green: one pins each recorded tolerance to be
  exactly its recorded amplification's decade, and one **re-measures** conditioning at test time
  and fails if the implied tolerance has grown (one decade of slack, since the measurement is
  platform-dependent and `frozen-ou-gust` sits just under a decade boundary).
- **Negative-controlled**, not just observed green: relaxing the v2 solver's rtol 1e-10 → 1e-9
  failed **11 of the new tests** (10 hash mismatches plus one conditioning check) while all 12 v1
  tests stayed green, then it was restored. Without that check the new assertions could have been
  passing vacuously.
- **Test results, all run locally at this session's HEAD**: `pnpm test` **1404/1404 across 204
  files** (was 1380/204 at session start — +24 tests, no new files, no regressions); `pnpm
typecheck` clean; `pnpm lint` clean; `pnpm lint:deps` clean (1191 modules, 3220 dependencies, no
  violations); `pnpm --filter @ballista/app build` green, bundle **64.94 kB gzipped** against the
  300 kB budget.
- **Pre-existing issue, still NOT fixed and still needing a human** (unchanged from P4.36, restated
  because it has now survived two sessions): the **root `pnpm build` script is broken under pnpm
  11** — `pnpm -r --workspace-concurrency 1 run build` fails with
  `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` because pnpm 11 reads `run` as the script name. Confirmed
  again this session. CI is unaffected (`ci.yml` builds via `pnpm --filter @ballista/app build`,
  which passes), but `CLAUDE.md` tells every session to run the build locally before pushing, so
  each session hits it. The fix is a one-word `package.json` change (`run build` → `build`), which
  is why it keeps being left alone: it is a repo-config decision, not part of any claimed task.
- **Next session**: P4.38 is the next `todo` in seq order — "(Stretch) SDIRK2/TR-BDF2 stepper",
  30m/H, validation "L-stability demo; slope 2". Note it is marked _stretch_; if it is skipped,
  P4.39 (rotational-dynamics ADR, 15m/E) and P4.40 (physics reference docs regenerated from §3
  sources, 25m/E) are both small and unblocked, and clearing them finishes Phase 4 and opens
  Phase 5 (P5.01, the observable framework). Do not extend symplectic integration to the
  dissipative paths P4.38 touches — the standing constraint still holds.

---

## 2026-08-06 — P4.36 (scenario library v2 curation)

- **Done: P4.36** — `packages/engine/src/scenario-library.ts` (20 curated scenarios: id, title,
  teaching note, exhibit link, `ScenarioSpec`) exported from the engine barrel, plus
  `packages/app/src/routes.ts`, the exhibit-id → hash-route mapping extracted from `main.tsx`.
  28 new tests across three packages. Full notes in `ROADMAP.json` under P4.36.
- **Both halves of the validation criterion met.** "CI validates all specs" is enforced twice, on
  purpose: the engine test proves every spec _parses_ and JSON-round-trips bit-equal, and the
  runtime test proves every spec _resolves and runs_ — correct state dimension for its model kind
  (4/5/6), force ids present in `KNOWN_FORCE_IDS`, stepper id resolvable, and a 0.05 s integration
  reaching status `ok` with finite final state. These are genuinely different properties: a spec
  naming an unregistered force id parses perfectly and throws only at `resolveForce`. "Each note
  links exhibit" is asserted against `main.tsx`'s own source in both directions — every exhibit id
  maps to a hash the router really dispatches on, and every hash it dispatches on is declared.
- **The exhibit-link test was negative-controlled**, not just observed green: dropping
  `#/model-registry` from the route table failed 2 of the 5 route tests, then it was restored.
  Without that check the assertion could have been passing vacuously.
- **Measured spread across the 20 entries** — Π from 8.70e-3 (shot put) to 5.27e+2 (dust grain),
  **4.78 decades**; Re from 1.03e+1 (Stokes regime) to 1.71e+6 (cannonball at muzzle speed),
  **5.2 decades**; Mach to **0.735**, inside P4.04's transonic C_d(M) rise; spin ratio 0 → 0.32.
  All four regime tags, all three registered model kinds, all five resolvable force ids, both
  atmosphere variants plus altitude-dependent gravity, six of the eight wind kinds, and both
  adaptive and fixed-step solvers are exercised. All nine exhibits are reached by ≥1 entry.
- **Curation, not new physics.** The seven P1.36 `PRESET_SCENARIOS` are carried by _reference_, and
  a test asserts object identity, so the preset list and the library cannot drift apart.
- **Three things the spec format genuinely cannot express**, each handled by narrowing the claim
  rather than by faking it: Coriolis has no `FORCE_FACTORIES` id (such a spec would parse, then
  throw on resolve), the pendulum/Kepler Stage-B seeds are unreachable through `modelSpecSchema`'s
  `kind` enum, and a `uniform` wind carries only wx/wy — so the 3D entry is a lateral _launch_
  (vz0), not a crosswind, and its note says exactly that.
- **Test results, all run locally at this session's HEAD**: `pnpm test` **1380/1380 across 204
  files** (was 1352/201 at the start of the session — +28 tests, +3 files, no regressions);
  `pnpm typecheck` clean; `pnpm lint` clean; `pnpm lint:deps` clean (1191 modules, 3220
  dependencies, no violations); `pnpm --filter @ballista/app build` green; bundle size **63.4 kB
  gzipped** against the 300 kB budget; engine typedoc generated. The chunked-integration timing
  flake noted in the P4.35 entry did not reproduce in either full run this session.
- **Issue found, NOT fixed here** (scope discipline — it needs a human decision, and it is not a
  P4.36 change): the **root `pnpm build` script is broken under pnpm 11**.
  `pnpm -r --workspace-concurrency 1 run build` fails with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`
  ("None of the selected packages has a \"run\" script") — pnpm 11 reads `run` as the script name.
  Every workspace package _does_ have a `build` script. This is **pre-existing and unrelated to this
  task**: `package.json` has not been touched since P4.25. CI is unaffected because `ci.yml` builds
  via `pnpm --filter @ballista/app build`, which passes — but `CLAUDE.md` instructs each session to
  run the root build before pushing, so a session following that instruction sees a spurious red.
  Likely fix is dropping the redundant `run` (`pnpm -r --workspace-concurrency 1 build`), unverified.
- **Next session**: P4.37 (Golden store v2 + tolerance review) is next in `seq` order and is the
  natural follow-on — the 13 new specs added here are exactly the candidates a golden store v2 would
  pin, and several (the frozen-OU entry especially) will need a tolerance decision. Before starting
  it, decide the root-`pnpm build` question above, since P4.37 will want a working build gate.

---

## 2026-08-05 — P4.35 (force-magnitude stacked-area plot over flight)

- **Done: P4.35** — `packages/viz/src/force-share-series.ts` +
  `force-share-series.test.ts` (16 tests), exported from the viz barrel. Full notes in
  `ROADMAP.json` under P4.35. `computeForceShareSeries` derives every wired force's share of
  the resultant at every recorded row and stacks them into plot bands;
  `drawForceShareStack` fills them through `plot-pane.ts`'s existing screen mapping, so the
  pane shares its axes and its one-screen-point-per-recorded-row guarantee with every other
  plot in the panel.
- **Validation criterion met** ("shares sum to |ΣF| within 1e-12"): worst-case residual
  **~2e-25 absolute** across shot put, golf drive and dust grain, asserted **row by row**
  rather than only through the aggregate helper, so a single bad row cannot hide behind a
  maximum. A relative check lands at **~1e-17**.
- **The criterion is what forced the design.** A share is the signed scalar projection
  `F_i·n̂` onto the resultant's own direction, not `|F_i|`. Then
  `Σ_i share_i = (Σ_i F_i)·n̂ = |ΣF|` is an _exact_ identity, so 1e-12 measures floating-point
  roundoff rather than a modelling tolerance. Naive magnitudes cannot satisfy it at all — the
  triangle inequality gives `Σ|F_i| >= |ΣF|`, and a test pins that gap at **>1e-6 N** on the
  shot put so the choice does not read as arbitrary later.
- **Three findings that contradicted the first guess**, each now pinned by a test:
  1. **Drag's share flips sign one step _after_ apex, not at it.** Climbing, drag and gravity
     both project _positively_ onto the resultant they jointly make — the initial assumption
     that drag opposes it on the way up was simply wrong. Just past apex the vertical drag
     component is still ~0 while the horizontal one still dominates, and that one always
     projects positively because the resultant's x-component _is_ drag's x-component (gravity
     has none). Measured: apex row 83, flip row 84, exactly one sign change.
  2. **The dust grain diverges under explicit RK4 at h = 0.01** — `|ΣF|` overflows to
     `Infinity`. It is solved here with backward Euler instead (implicit but **not** symplectic,
     so the standing dissipative-path constraint holds). The diverged RK4 run is _kept_ as a
     test: shares go `NaN` rather than zeroing, since zeroing would report a tidy `Σ share = 0`
     against an infinite resultant and make a diverged solve look converged.
  3. **The relative-closure check can normalize by neither `|ΣF|` nor `Σ|share_i|`.** At
     terminal velocity drag cancels gravity to ~1e-64, far under the ~1e-27 rounding floor of
     the ~1e-11 forces involved, and the resultant turns purely horizontal so gravity's
     projection is exactly 0 while `|F_g|` is still `mg`. Both denominators are
     cancellation-damaged (`|ΣF|` yields a meaningless ~0.28). `max_i |F_i|` is not, and
     `ForceShareBand.magnitude` was added to carry it.
- **Test results** (all run locally at this commit, none estimated): `pnpm typecheck` clean,
  `pnpm lint` clean, `pnpm lint:deps` **no violations**, `pnpm test` **1352 passed across 201
  files**, `pnpm --filter @ballista/app build` succeeded, `check-bundle-size` **60.1 kB gzipped
  within the 300 kB budget**. The new module's own 16 tests passed on every run.
- **One pre-existing flaky test was found while gating this work, and is reported rather than
  touched.** `packages/solverkit/src/chunked-integration.test.ts` → "a 1e6-step run stays
  within a small, bounded wall-clock budget per slice (cooperative-yield target: 10 ms)"
  (line 318, `expect(maxSliceMs).toBeLessThan(10)`) **failed 3 of 5 full-suite runs** and
  passed **6 of 6** when that file was run in isolation. It is a wall-clock assertion competing
  with ~200 other test files across parallel workers, so it measures machine contention as much
  as the chunking behaviour it targets.
  - **It is not caused by P4.35.** Verified by checking out the pre-change base commit
    `ccfda28` and re-running the full suite there: the same test failed **1 of 2 runs** at
    **1336 tests** (this session's work adds 16). `solverkit` also cannot import `viz` — the
    dependency direction is the other way and `lint:deps` enforces it — so a new viz module has
    no path to affect it beyond total suite load.
  - **Deliberately not weakened, skipped, or deleted.** Raising the threshold or marking it
    flaky would erase the only signal for a real chunking regression. A human should decide
    whether to re-express it against a work-per-slice count rather than wall-clock, which would
    make it contention-proof without losing the guarantee.
- **Discovered, not fixed** (scope discipline — filed here rather than actioned, and
  deliberately _not_ added to `ROADMAP.json`, whose tasks come from the blueprint):
  1. The **root `pnpm build` script is broken** — `pnpm -r --workspace-concurrency 1 run build`
     exits `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` because no workspace package defines a `build`
     script under that name. This is pre-existing and does **not** affect CI, which builds via
     `pnpm --filter @ballista/app build` (the command used for this session's gate). A human
     should decide whether to repair or remove the root script.
  2. `plotly.min` is still statically bundled at **4.84 MB** (1.47 MB gzipped), as the build
     output shows. That is the known lazy-loading backlog item and remains unclaimed.
- **Next session**: take **P4.36** (seq 189, 30m, E) — "Scenario library v2 curation: 20
  scenarios spanning regimes with teaching notes", validation "each note links exhibit; CI
  validates all specs". With P4.35 done, Phase 4 has **5 tasks left** — P4.36, P4.37 (golden
  store v2 + tolerance review), P4.38 (stretch SDIRK2/TR-BDF2 — note it is marked stretch and
  difficulty H), P4.39 (rotational-dynamics ADR), P4.40 (docs pass) — i.e. 35 of 40 complete.
  Note P4.35 added a new viz export,
  so P4.37's golden review should confirm nothing in the golden store moved (nothing should —
  this task added a read-only derivation and touched no solver path).

---

## 2026-08-05 — P4.34 (C⁰-vs-C¹ Cd(Re) convergence degradation exhibit)

- **Done: P4.34** — `packages/solverkit/src/cd-table-smoothness-convergence.test.ts`
  (8 tests). Exhibit as a documented solverkit test module, the P4.09/P4.22 pattern; no new
  UI route was needed. One scenario run twice with **only the `C_d` interpolant differing** —
  the shipped C¹ PCHIP `TabulatedReynoldsCd` against a test-local piecewise-linear interpolant
  over the same `SMOOTH_SPHERE_CD_TABLE` data — same launch state, same `ClassicalRK4Stepper`,
  same step sizes, each measured against its own 2^20-step reference. Full notes in
  `ROADMAP.json` under P4.34.
- **Validation criterion met** ("measured order drop with non-smooth table documented"), on a
  size-5 football (0.43 kg, 0.11 m) launched at 90 m/s / 0.35 rad over 2 s, its Reynolds number
  sweeping **1.356e6 → 4.533e5** and crossing the table's `Re = 1e6` node (asserted, so the
  comparison cannot quietly go vacuous). Fitted log-log order over h ∈ [0.0025, 0.02]:
  **3.68 (C¹) vs 2.15 (C⁰), a drop of 1.53** — RK4 reduced to roughly second-order behaviour
  while still paying four stages per step. Per-h error ratios C⁰/C¹: 47, 958, 683, 537, 12075,
  1182, 2215.
- **Refinement stops being reliable under the C⁰ table**: 2 of the 6 refinements make the error
  _worse_ (1.59e-5 → 1.73e-5, 3.29e-6 → 4.41e-6), and the fit's R² falls 0.92 → 0.85. Where a
  node crossing lands relative to the step grid matters as much as h does, so the error curve is
  no longer a clean power law.
- **Two things are stated rather than rounded off.** The C¹ order is 3.68, _not_ 4: PCHIP is C¹
  but not C², so the fourth-order Taylor argument is not fully available even on the shipped
  path. And the C¹ error curve is not perfectly monotone either (1 non-monotone refinement
  against the C⁰ table's 2), which makes that particular test descriptive rather than
  discriminating — the asserted claim is comparative.
- **A configuration was measured and rejected**: aiming the trajectory through the drag-crisis
  node cluster (40 m/s, 4 s, crossing `Re = 4e5`) also shows the drop (3.06 vs 1.69) but degrades
  the C¹ baseline too, muddying the headline comparison. The single mild `Re = 1e6` crossing is
  the cleaner exhibit.
- **The C⁰ interpolant is deliberately test-local.** §3.3 prescribes PCHIP for the production
  path; exporting a knowingly-inferior interpolant from `@ballista/engine` would invite exactly
  the mistake this exhibit exists to warn about.
- **Verified non-vacuous by mutation**: substituting `TabulatedReynoldsCd` for the piecewise-linear
  model fails exactly the three discriminating tests (order drop, per-h error ratio, work
  comparison) and leaves the five describing interpolant properties or the C¹ path alone passing.
- **Integrator discipline**: dissipative scenario (quadratic drag is the point of it), so classical
  RK4 throughout — no symplectic method appears in the diff, and no stepper, force, or
  golden-trajectory code was touched. The diff is one new test file.
- **Tests**: `pnpm test` **200 files / 1336 tests, all passing** (up from P4.33's 199/1328: +1 file,
  +8 tests). `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps` (1170 modules, 3154 dependencies, no
  violations) all clean. Engine and solverkit `docs` clean. `pnpm --filter @ballista/app build`
  succeeds; `check-bundle-size` 60.1 kB gzipped against the 300 kB budget, unchanged — a test-only
  diff cannot move it.
- **Not re-run** (cannot be affected by a test-only diff that touches no stepper, force, or
  cross-engine path; same reasoning P4.28/P4.30/P4.32/P4.33 recorded): `pnpm bench:solverkit`,
  `pnpm check:cross-engine-drift`.
- **Known pre-existing, not introduced here**: `pnpm format:check` flags `CLAUDE.md` (it is not a
  CI step; CI runs typecheck/lint/lint:deps/test/docs/build/bundle-size). The per-package
  `--filter @ballista/viz test` "No test files found" failure documented in P4.30 is also still
  present; root `pnpm test` — CI's own Test step — was used throughout.
- **Next session**: take **P4.35** (force-magnitude stacked-area plot over flight: F_g, F_d, F_M
  shares) — it is the next `todo` in `seq` order and nothing in Phase 4 is `in-progress` or
  `review`. It is self-contained viz work. P4.36 (scenario library v2 curation) and P4.37 (golden
  store v2 + tolerance review) follow; P4.37 touches goldens, so it needs the explanatory
  commit-message note the blueprint's §8.4 requires. Do not reorder phases or skip ahead to the
  P4.38 stretch item.

---

## 2026-08-05 — P4.33 (two-body/Kepler model registration)

- **Done: P4.33** — `createKeplerModel(mu)` in `packages/engine/src/kepler-model.ts`
  (+ `kepler-model.test.ts`, 13 tests), exported from `packages/engine/src/index.ts`, plus
  `packages/solverkit/src/kepler-invariant-drift.test.ts` (5 tests) carrying the validation
  criterion. Planar two-body problem in fixed-primary form, `r'' = -mu*r/|r|^3`, dim 4
  (`rx, ry, vx, vy`), `partitions {q:[rx,ry], p:[vx,vy]}`. The second non-projectile `Model`
  after P4.31's pendulum and the first with **two** invariants — specific orbital energy and
  specific angular momentum — which is the substance of the task rather than a detail: they
  fail differently under a given integrator, so the pair discriminates where either alone
  would not. Full design/verification notes in `ROADMAP.json` under P4.33.
- **Validation criterion met** ("eccentric orbit: RK4 drifts, Verlet bounded (invariant
  asserts)"), measured on an `a = 1e7 m`, `e = 0.6`, `mu = 3.986e14 m^3/s^2` ellipse released
  at periapsis, 60 orbits at 2000 steps/orbit, identical setup for both runs with only the
  stepper differing. Relative energy error: classical RK4's six block means march
  **-9.30e-10 → -4.26e-9**, monotone, one-signed, with a near-constant per-block increment
  (~6.66e-10, equal to within 5%) — linear in time, the defining shape of a secular term.
  The entire last orbit's band lies strictly outside the entire first orbit's with **no
  overlap** ([-4.59e-9, -3.93e-9] vs [-6.59e-10, -1.0e-12]). Velocity Verlet is **bounded**:
  first- and last-orbit bands agree to 5 significant figures (**7.3134e-5** both) and all six
  block means agree to within 1%, while still oscillating across essentially the full band
  within each orbit. Angular momentum is the control and both steppers hold it (RK4 4.4e-10,
  Verlet 1.6e-14) — it follows from the force being _central_, not from Hamiltonian structure.
- **The comparison is stated honestly**: a dedicated test asserts RK4's error magnitude is
  ~4 orders _smaller_ than Verlet's throughout (order 4 vs order 2). The claim is about the
  **shape** of the error over time, not about Verlet being the more accurate method, and the
  test pins that ordering so a later reader cannot mistake the story.
- **Assertions were measured, not guessed.** Two first-draft thresholds failed against the
  real integrators and were replaced by what the runs actually show: a block-mean ratio guess
  (>5, actual 4.58) became the much stronger constant-increment + band-separation pair, and an
  "error takes both signs" assumption was simply wrong — Verlet's band here is one-signed and
  offset from zero, which is still bounded, which is all the property claims. An argmax-location
  assertion was also tried and discarded: Verlet's band is flat to ~5 significant figures across
  all 60 orbits, so the argmax is decided by last-bit noise (it landed in orbit 44).
- **Verified non-vacuous by mutation**: substituting `ClassicalRK4Stepper` for `VerletStepper`
  throughout the validation file fails exactly the two bounded-error tests and leaves the two
  integrator-agnostic ones (eccentricity fixture, angular momentum) passing — the expected
  pattern, since only those two discriminate integrators.
- **Integrator discipline**: the two-body problem is conservative (no drag, no damping, no
  dissipative path), which is the precondition for the symplectic Verlet stepper used in the
  comparison. No dissipative system is integrated symplectically in this diff; no stepper,
  force, or golden-trajectory code was touched — the diff is two new files plus one export line.
- **Tests**: `pnpm test` **199 files / 1328 tests, all passing** (up from P4.32's 197/1310:
  +2 files, +18 tests). `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps` (1167 modules, 3143
  dependencies, no violations) all clean. Engine and solverkit `docs` clean.
  `pnpm --filter @ballista/app build` succeeds; `check-bundle-size` 60.1 kB gzipped against the
  300 kB budget, unchanged — the new model is not imported by the app yet, the same status
  `pendulum-model.ts` has had since P4.31.
- **Not re-run** (cannot be affected by this diff — no stepper touched, no cross-engine physics
  path; same reasoning P4.28/P4.30/P4.32 recorded): `pnpm bench:solverkit`,
  `pnpm check:cross-engine-drift`.
- **Known pre-existing, not introduced here**: `pnpm --filter @ballista/viz test` fails with
  "No test files found" (vitest's root include glob does not resolve under a per-package cwd,
  documented in P4.30's notes); the same affects `--filter @ballista/engine`. Root `pnpm test` —
  CI's own Test step — was used throughout.
- **Next session**: take **P4.34** (Solver Lab exhibit: C⁰-vs-C¹ `C_d(Re)` convergence
  degradation demo, §3.3) — it is the next `todo` in `seq` order and nothing in Phase 4 is
  `in-progress` or `review`. Note it is a _dissipative_ (drag) exhibit, so the standing
  constraint applies directly: use standard RK schemes there, not the symplectic path this
  session exercised. Two ready follow-ons if it proves too large for one session: P4.35
  (force-magnitude stacked-area plot) is self-contained viz work, and the Kepler model landed
  here is now available to `phasePortraitSeries` (P4.32) with no new plumbing — its `partitions`
  give pair 0 = (rx, vx) and pair 1 = (ry, vy). Do not reorder phases or skip ahead to the
  P4.38 stretch item.

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
