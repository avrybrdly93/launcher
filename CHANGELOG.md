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

## 2026-08-08 (5th run) — P5.04 (shooting residual)

- **Done: P5.04.** `packages/analysis/src/shooting-residual.ts` exports `Aim`,
  `ShootingProblem`, `ShootingResidual`, `ResidualFunction`,
  `createShootingResidual` and `residualNorm`. **Next task is P5.05** (finite-difference
  Jacobian of this residual, with the adaptive-step noise control its title names —
  and note that this residual is deliberately exercised at _fixed_ step in its own
  tests, for the reason in the next bullet, so P5.05 is the first task that has to
  confront adaptive-step noise head-on).
- **The validation criterion needed a fixed-step solve to be measurable at all, and
  that is the one design decision here worth arguing.** "Residual continuous across
  step boundaries" presupposes a step boundary that stays put while the aim moves. An
  _adaptive_ solve picks its step sizes per aim, so its grid moves _with_ the aim and
  there is no fixed boundary left for the event to cross — the criterion would be
  untestable, not satisfied. Pinning `h = 0.05` fixes the grid at `0, h, 2h, …` for
  every aim while the ground-event time `2v₀sin θ/g` slides continuously, which is
  what lets a θ sweep walk the event across boundary after boundary.
- **The sweep asserts that it actually crossed boundaries.** 401 samples over
  [0.60, 0.70] rad at v₀ = 60 produce **20 distinct step counts spanning 139–158**, and
  that spread is a test, not a comment. Without it every continuity assertion in the
  file would pass vacuously on a sweep that never left one step interval — which is
  the failure mode a continuity test is most likely to have and least likely to show.
- **Measured: max |second difference| 9.04e-5 m**, against 8.8e-5 m predicted from the
  range curve's own curvature (`|R''| ≤ 4v₀²/g`). So the residual's discrete curvature
  is the physics and nothing else.
- **The negative control is the load-bearing part.** `gridPointResidualX` reads row
  `nSteps − 2` — the last step grid point before the crossing, exactly what a residual
  that ignored dense output would see — and on the **identical sweep** measures max
  |second difference| **2.47 m** and a largest single-sample jump of **2.41 m**, against
  a predicted `h·vₓ` = 2.39 m. **A factor of 2.7e4 between the two.** The asserted 1e-3 m
  bound sits an order above the curvature scale and three below the jump, so it fails on
  a staircase and does not fail on ordinary sampling.
- **A real defect was found and fixed mid-task, and it is the kind that ships quietly.**
  `report.status === "ok"` does **not** mean the shot hit the ground. Exhausting `tspan`
  without reaching the terminal event is a _successful_ solve — the driver reached `t_f` —
  and its final recorded row is an ordinary mid-air point that `impactPoint` reports as an
  impact without complaint. The first implementation keyed `ok` off `report.status`, and a
  shot with `tspan [0, 1]` came back with a residual that was finite, plausible and
  meaningless. `ok` is now `status === "ok" && tFinal < tspan[1]`, which is exact rather
  than a tolerance: a terminal event stops the solve strictly inside the span, while the
  driver clamps its last step to land _exactly_ on `tspan[1]` when the span is what ran
  out. A test pins the trap by asserting `status === "ok"` and `ok === false` together.
- **Full local gate green at this HEAD** (Node 22.22.2, pnpm **11.9.0**): `typecheck`
  clean · `lint` clean · `lint:deps` **no violations** (1227 modules, 3338 dependencies) ·
  `pnpm test` **1608/1608 across 211 files** in 110s (was 1586/210 — this task adds 22
  tests in 1 file, and nothing else moved) · `pnpm --filter @ballista/app build` ✓ in 31.7s ·
  app bundle **67.19 kB gzipped** against the 300 kB §2.6 budget. Nothing was skipped,
  weakened or retried. The `chunked-integration.test.ts` slice-budget assertion passed
  locally again this run — still not evidence the CI problem is gone, see below.
- **The root `pnpm build` failure is NOT a pnpm-version mismatch, and the 4th run's
  explanation of it is disproven.** That entry attributed
  `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` to the sandbox running pnpm 10.33.0 against a
  `packageManager` pin of `pnpm@11.9.0`. **This sandbox runs 11.9.0 — the pinned version
  exactly — and the root script still fails.** The actual cause is flag parsing in the
  script itself: `pnpm -r --workspace-concurrency 1 run build` fails, while
  `pnpm -r --workspace-concurrency=1 run build` **builds all 8 packages successfully**
  (verified this run). The space-separated form makes pnpm 11 take `1` as the recursive
  command. **The fix is one character**, `--workspace-concurrency=1` in `package.json`'s
  `build` script. It was **not** applied: it is outside P5.04 and the routine driving this
  repo prohibits drive-by changes, and `ROADMAP.json` has no convention for
  non-blueprint task ids to file it under. CI is unaffected either way — it runs
  `pnpm --filter @ballista/app build`, which passes.

### ⚠️ CI on `main` is still red, still the same flake, still the same open decision

**Unchanged, and this session did not attempt it** — it is a change to a performance
contract, which `ROADMAP.json`'s quality policy puts outside what a session that trips
over it may decide. Read first-hand this run rather than carried over: run
**`31224097976`** at **`3ed8d38`** (the 4th run's last commit) failed with the single
assertion `expected 10.490253000000052 to be less than 10` at
`chunked-integration.test.ts:318` — **1585 of 1586 tests passed**. Neighbouring runs at
`34036f9` and `1c3a8e1` are green while `37dbdb6` is red, which is the load-sensitivity
pattern the 3rd and 4th runs documented, not a change in it.

The consequence for this session is the same one the 4th run stated: **P5.04's own CI
result cannot be interpreted**, because a red run cannot be told apart from the known
flake from the outside. The local gate above is therefore the strongest honest statement
available about this change, and it is a full one.

The recommendation is unchanged — assert on work per slice (steps, `nRHS`) rather than
wall-clock, so the assertion means the same thing on every machine. **A human needs to
pick one. This is the third consecutive run to ask.**

---

## 2026-08-07 (4th run) — P5.03 (scalar range root)

- **Done: P5.03.** `packages/analysis/src/range-root.ts` exports `RangeFunction`,
  `DRAG_FREE_PEAK_ANGLE`, `dragFreeRange`, `solveRangeRoot` (explicit bracket)
  and `solveRangeRoots` (both arcs plus reachability). **Next task is P5.04**
  (shooting residual `F(θ,v₀) = r_impact − r*` from the event state, which
  consumes P5.02's `missVector` directly).
- **No new root finder was written.** The residual `range(θ) − R*` is handed to
  solverkit's existing `brentRoot`, whose own doc comment already names P5.03 as
  the caller it was made generic for. What this task adds is the _problem_:
  choosing the residual, bracketing each arc, and saying when there is no answer.
- **Range is not monotone in θ, and that is the entire difficulty.** It rises
  from zero, peaks, and falls back to zero, so a reachable `R*` below the maximum
  has two solutions — the flat arc and the lofted one — and a bracketing method
  has to be told which side of the peak to look on.
- **The two arcs are bracketed separately rather than solved once and
  reflected**, and this is the one decision in the task worth arguing. Reflection
  about the peak is exact for the drag-free `sin(2θ)` the criterion is written
  against, and it is shorter. It is also a property of that particular function
  rather than of the problem: with drag the range curve is not symmetric about
  its peak, so a reflected "root" comes back with a residual that is merely small.
  **A negative control that implements reflection passes all twelve drag-free
  root assertions and fails only 3 of 39** — so the drag-free criterion alone
  cannot distinguish the two designs, which is precisely why the file carries an
  asymmetric range curve (peak at `atan(1/√2)` ≈ 35.3°, where drag puts it) whose
  reflected low root misses by more than 1e-3.
- **Validation met, and checked against two independent references.** Both roots
  land within **1e-10 rad** of `½asin(gR*/v₀²)` and its complement to π/2, across
  4 closed-form cases **and** 2 cases where the range function is a real
  Dormand–Prince 5(4) integration to ground impact (`rtol` 1e-13, `atol` 1e-14)
  read through P5.01's `range` observable. The second path evaluates no inverse
  trig at all, so the closed form is an outside reference there rather than the
  same three lines of algebra checking themselves — which the closed-form-only
  version of this test would have been.
- **Negative-controlled three ways.** Perturbing the residual by 1e-8 relative
  fails **17** assertions, including every integrated one (so those tests are not
  vacuously passing); the reflection control fails **3**; **loosening the Brent
  stopping tolerance from 1e-12 to 1e-6 fails nothing at all.** That third result
  is the informative one and is recorded in `ROADMAP.json` for later tasks:
  Brent's final interpolation lands far inside its own bracket width, so
  `angleTol` is not the knob that controls achieved accuracy, and a future task
  must not reach for it as if it were.
- **`peakAngle` is data, not a constant.** It defaults to π/4, which is correct
  only for a drag-free ground launch; a raised launch peaks below it and a drag
  launch lower still. Computing it in general is P5.09's envelope sweep and
  P5.13's 1D minimizer, so it is deliberately **not** done here — callers with
  drag pass their own until those tasks land. `low`/`high` are independently
  nullable for the same reason a bound is real: a launcher that cannot depress
  below 30° loses the flat arc to a near target but keeps the lofted one.
- **A floating-point case is pinned rather than left to be discovered.** A target
  of exactly `0` has a low-arc root at exactly `0` and **no** high-arc root,
  because `dragFreeRange` at π/2 evaluates `sin(Math.PI)` = 1.22e-16, not zero.
  That asymmetry is arithmetic, not physics, and a test states it.
- **Full local gate green at this HEAD** (Node 22.22.2, pnpm **10.33.0**):
  `typecheck` clean · `lint` clean · `lint:deps` **no violations** (1219 modules,
  3308 dependencies) · `pnpm test` **1586/1586 across 210 files** in 114s ·
  `pnpm --filter @ballista/app build` ✓ in 45.6s · bundle size **65.6 kB gzipped**
  against the 300 kB §2.6 budget · both typedoc jobs ✓. Nothing was skipped,
  weakened or retried. **The `chunked-integration.test.ts` slice-budget assertion
  passed locally this run**, but see below — that is not evidence the CI problem
  is gone.
- **Root `pnpm build` fails in this sandbox, and it is not this change.**
  `pnpm -r --workspace-concurrency 1 run build` exits
  `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. Verified pre-existing by running it in a
  clean worktree at `34036f9`, the commit before this session's first: identical
  failure. The repo pins `pnpm@11.9.0` via `packageManager` and this sandbox has
  **10.33.0**, and CI never invokes the root script — it runs
  `pnpm --filter @ballista/app build`, which passes. Recorded as an environment
  mismatch, not filed as a repo bug, and not worked around.

### ⚠️ CI on `main` is still red, and the decision from the 3rd run is still open

**Nothing about the previous entry's finding has changed, and this session did
not attempt to resolve it** — it is a change to a performance contract, which
`ROADMAP.json`'s quality policy puts outside what a session that trips over it
may decide. The timing assertion passing locally this run is exactly the
load-sensitivity that entry documented (three of four _hosted_ attempts red on
two commits, one of them docs-only), so it is not evidence of a fix and is not
recorded as one.

The consequence for this session is worth stating plainly: **P5.03's own CI
result cannot be interpreted.** A red run here may be the known flake or a real
failure, and there is no way to tell them apart from the outside while the flake
stands. The local gate above is therefore the strongest honest statement
available about this change, and it is a full one.

The options and the recommendation are unchanged from the 3rd run's entry —
assert on work per slice (steps, `nRHS`) rather than wall-clock is still the one
that makes the assertion mean the same thing on every machine. **A human needs
to pick one.**

---

## 2026-08-07 (3rd run) — P5.02 (target model)

- **Done: P5.02.** `packages/analysis/src/targets.ts` exports `Target =
PointTarget | RingTarget | PlatformTarget` with `validateTarget`,
  `nearestPointOn`, `missVector`, `missMagnitude`, `isHit`, and the
  trajectory-level `impactMissVector` / `impactIsHit`. **Next task is P5.03**
  (scalar root problem: `range(θ) = R*` at fixed `v₀` via Brent).
- **The three shapes are point _sets_, not three cases.** Every operation
  derives from one nearest-point routine — the miss vector is
  `impact − nearestPointOn(target)` — so "zero exactly when the shot hits" is a
  consequence rather than three separately-maintained special cases, and the
  residual P5.04 drives to zero stays continuous across the target boundary,
  which is precisely where a kind-specific formula would introduce a kink.
- **Sign convention is impact minus target**, so for a point target the miss
  vector _is_ P5.04's `F = r_impact − r*` and a Newton step consumes it with no
  sign to remember at the call site. A dedicated test pins the sign; no
  magnitude assertion can.
- **The platform has zero vertical extent on purpose.** It models landing _on
  top of_ a pad, so a shot at the right downrange distance but the wrong height
  hit the side and gets a purely vertical miss vector — the exact case
  `observables.missDistance`'s doc comment singles out.
- **A floating-point detail is load-bearing.** Interior components are copied
  into the nearest point rather than reconstructed as
  `centre + (point − centre) * scale` with `scale === 1`: that identity does not
  hold in binary floating point (`10.1 + (30.3 − 10.1)` is `30.300000000000004`)
  and would leave a ~1e-15 miss where the criterion demands an exact zero. The
  test that catches it uses coordinates chosen to break the round-trip.
- **Validation is bit-exact, not approximate.** P5.02's criterion is "miss
  vector zero at exact hit (constructed)", so all 33 cases assert `toBe(0)` plus
  an `Object.is(−0)` sign check rather than a tolerance — a routine that
  reconstructs an interior point arithmetically lands within an ulp of it, and
  `toBeCloseTo` cannot tell that apart from correct. Miss cases are checked
  against closed-form geometry (radial overshoot `r − radius`, per-axis box
  clamp), never against a prior run of this code.
- **Negative-controlled.** Flipping the miss sign failed **12** assertions;
  forcing the scaling path in the ring interior failed **exactly** the
  non-round-tripping-coordinates case; letting the platform ignore the vertical
  axis failed **3**. The middle one is the informative control: it passed on the
  first version of that test, which is how the round-trip case got its
  adversarial coordinates.
- **A finding the next task needs.** A flat target with tolerance `0` is never
  hit by a _solved_ trajectory, only by a constructed point: all three shapes
  have zero vertical extent, and event localization puts a ground impact's
  vertical coordinate at ~6e-15 m rather than 0. This is asserted directly
  rather than worked around, and the tolerance doc comment now says so. P5.04–06
  should drive `missVector`, which is unaffected, rather than consult `isHit`.
- **Measured at this session's HEAD**: `pnpm typecheck` clean; `pnpm lint`
  clean; `pnpm lint:deps` no violations; `pnpm --filter @ballista/app build`
  green; `check-bundle-size` **65.6 kB gzipped** against the 300 kB §2.6 budget,
  **unchanged** from the previous run.
- **Test results.** `pnpm test` at this HEAD is **1547 tests across 209 files**
  (was 1514/208: **+33 tests, +1 file**, no regressions). One full-suite run this
  session, **fully green** — the load-sensitive flakes the P4.39/P4.40 and P5.01
  entries document (`chunked-integration.test.ts`'s wall-clock assertion and
  `lazy-plotly-pane.bundle.test.ts`'s real vite build) did not fire. Nothing was
  weakened, skipped, or retried to get there.

### ⚠️ CI on `main` is red, and it needs a human — read this before the next session

**`main` is red at the time of writing, and this session could not honestly make
it green.** The four hosted CI attempts this session, in order:

| Run         | Commit                    | Attempt    | Result  | `maxSliceMs` |
| ----------- | ------------------------- | ---------- | ------- | ------------ |
| 31207518775 | `1c3a8e1` (P5.02 code)    | 1          | **red** | 17.49        |
| 31207518775 | `1c3a8e1`                 | 2 (re-run) | green   | —            |
| 31209114428 | `37dbdb6` (**docs only**) | 1          | **red** | 11.80        |
| 31209114428 | `37dbdb6`                 | 2 (re-run) | **red** | 13.02        |

Every failure is the **same single assertion** —
`packages/solverkit/src/chunked-integration.test.ts:318`, "a 1e6-step run stays
within a small, bounded wall-clock budget per slice", `maxSliceMs < 10` — with
**1546 of 1547 passing** in each case. Three of four attempts red, on two
different commits, one of which changed nothing but a markdown file.

**What that tally means.** The P4.39/P4.40/P5.01 entries recorded this as a
load-sensitive local flake. It is no longer only that: it now fails on the
hosted runner more often than it passes, on commits that touch neither
`solverkit` nor anything `chunked-integration.test.ts` imports. The `main`
branch's CI signal is currently unreliable in the worst direction — a red that
carries no information, which is how a real red gets ignored.

**What was deliberately not done.** The 10 ms figure was not raised, the test
was not skipped, and no retry was configured. `ROADMAP.json`'s quality policy
and the P4.39 entry both say a performance assertion is not something a session
that trips over it gets to re-budget, and a session doing it to turn its own run
green is exactly the failure mode that rule exists to prevent. Getting green by
re-running until the runner cooperates would be the same thing wearing a
different hat.

**What a human needs to decide**, because it is a change to a performance
contract and no blueprint task covers it: this repo has **three** marginal
timing assertions sharing one parallel suite — `chunked-integration`'s 10 ms
slice budget, `canvas-viewport.test.ts` (35.9 s in the run above, against a 60 s
hook timeout) and `lazy-plotly-pane.bundle.test.ts` (a real vite build against
30 s). They are one problem. The plausible fixes, none of which is a session's
call to make alone: run the timing assertions in a non-parallel project so they
are not measuring contention; assert on _work per slice_ (steps, `nRHS`) rather
than wall-clock, which is what the cooperative-yield property actually cares
about; or raise the budget with a documented measurement of what the runner
actually delivers. The middle one looks strongest — it is the only one that
makes the assertion mean the same thing on every machine — but that is a
recommendation, not a decision.

**The code itself is fine.** `1c3a8e1` passed all 16 steps on its second
attempt, and the P5.02 change is a new pure-geometry module plus its tests in
`packages/analysis`. This is a test-harness problem, not a regression.

---

## 2026-08-07 (2nd run) — P5.01 (observable framework) — **Phase 5 opens**

- **Done: P5.01**, the first task of Phase 5 (optimization and inverse problems).
  `packages/analysis/src/observables.ts` exports `timeOfFlight`, `range`, `apexHeight`, `apexTime`,
  `apex` (the `{t, height}` pair), `impactSpeed` and `missDistance` — all pure functions of a
  `Trajectory`, which is what P5.03–P5.06 will drive to zero. **Next task is P5.02** (target model).
- **Channel indices come from a layout table, not from hard-coded constants.** `TrajectoryLayout`
  (`PLANAR_LAYOUT`, `SPATIAL_LAYOUT`) names which channels hold position and velocity, so one
  implementation serves both shipped projectile models and whatever Stage B (§2.4) adds. Its
  `vertical` field indexes _into_ position/velocity rather than into `channels`, so a caller
  reading horizontal components never needs the absolute numbering.
- **The impact observables do no interpolation, and that is the point.** `integrate` root-localizes
  every terminal crossing and dispatches the _localized_ state to its sinks before returning
  (`integrate.ts` ~line 517), so the recorder's final row already sits on the event surface.
  Range, ToF, impact speed and miss distance therefore **inherit** their accuracy from event
  localization rather than producing it — stated in the module doc along with the corollary that a
  solve which ended by exhausting `tspan` or `maxSteps` has a perfectly ordinary final row these
  functions will happily, and meaninglessly, report as an impact.
- **Apex is the one observable that does real numerical work.** It rarely coincides with a step
  boundary, so the row-wise maximum it replaces is only $O(h^2)$ — nowhere near 1e-9 at any step
  size a solver would actually use. Each **downward** $v_y$ zero-crossing is refined with the cubic
  Hermite basis of §4.9, using the recorded $v_y$ channel as the derivative — free here, since
  $\dot y = v_y$ is a state channel and needs no extra `rhs` call. The derivative of that cubic is
  a quadratic, solved in closed form with the sign-stable
  $q = -\tfrac12(b + \mathrm{sign}(b)\sqrt{b^2-4ac})$ root rather than the textbook formula,
  whose cancellation costs digits in exactly the near-degenerate case a small step produces.
- **Drag-free exactness is by construction, not by luck.** There $y(t)$ is a quadratic and $v_y(t)$
  is linear; a cubic Hermite reproduces any cubic exactly, so the interpolant _is_ the true arc and
  its stationary point _is_ the true apex. Under drag it degrades to $O(h^4)$ near the apex rather
  than $O(h^2)$.
- **Every crossing is scanned, not just the first**, with the recorded endpoints kept as
  candidates. That covers a bouncing trajectory (P4.11), whose later arcs each have their own apex,
  and the two monotonic cases with no interior crossing at all — a downward launch (apex = launch
  point) and a solve cut off while still climbing (apex = final row).
- **Validation is against closed forms, never against a prior run of this code.** 39 assertions
  over five drag-free launches. **Two of the five launch from height on purpose**: at $y_0 = 0$ the
  flight time collapses to $2v_{y0}/g$ and the apex sits exactly halfway, so a sign error or a
  factor-of-two can cancel itself — a raised launch breaks that symmetry. Impact speed is checked
  against $\sqrt{v_0^2 + 2gy_0}$, which is energy conservation and therefore **independent** of the
  flight-time formula rather than an algebraic restatement of it.
- **Negative-controlled.** Disabling the apex refinement failed **12** assertions; including the
  vertical axis in `range` failed **3**; making `timeOfFlight` absolute failed **1**. The `range`
  control is the informative one: it fails _only_ the raised-launch and 3D cases, because the three
  $y_0 = 0$ cases land at $y \approx 0$ and literally cannot see that bug — which is precisely why
  the raised launches are in the table. The coarse-step apex test also carries an anti-vacuity floor
  (row-wise error must exceed 1e-6) so it cannot pass by the apex happening to land on a boundary.
- **A guard-rail test found a real gap and the implementation moved to meet it, rather than the
  test being adjusted to fit.** Validating channels lazily on read was not enough: a planar
  trajectory has _enough_ channels to partly satisfy `SPATIAL_LAYOUT`, so `range` would skip the
  vertical axis, read `vx` as if it were `z`, and return a confidently wrong number instead of
  throwing. `requireLayout` now validates the whole layout up front.
- **Measured at this session's HEAD**: `pnpm typecheck` clean; `pnpm lint` clean; `pnpm lint:deps`
  **no violations**; `pnpm --filter @ballista/app build` green with the bundle at **65.6 kB
  gzipped** against the 300 kB §2.6 budget; typedoc for both `engine` and `solverkit` green.
  (Per the P4.40 entry's caveat, the `lint:deps` module counts are build-state dependent and are
  deliberately not quoted here; the no-violations result is the invariant part.)
- **Test results, stated with the flake record.** `pnpm test` at this HEAD is **1514 tests across
  208 files** (was 1475/207 at session start: **+39 tests, +1 file**, no regressions). Three
  full-suite runs this session: **two fully green, one red**. The red run was the **known
  load-sensitive flake the P4.39/P4.40 entries document** — `chunked-integration.test.ts`'s
  wall-clock assertion, `maxSliceMs` **14.41** against a <10 ms budget — plus a 30 s timeout in
  `packages/viz/src/lazy-plotly-pane.bundle.test.ts`, which runs a real vite build and is
  timing-sensitive under the same load. Both passed in the two green runs. **Neither was weakened,
  skipped or deleted.**
- **Hosted CI is green at this HEAD.** Run **`31189458511`** at `b25bcd6` (push-triggered) passed
  **all 16 steps** in 3m39s: typecheck, lint, import boundaries, **`pnpm test` in 1m46s**,
  benchmark and cross-engine-drift soft checks, both typedoc steps, app build and bundle-size
  budget. Notably the hosted runner's `pnpm test` was green in one attempt — including both
  tests that flaked locally — which is further evidence those two are load-sensitive rather
  than regressions.
- **Analysis package only.** No engine, solverkit, runtime, viz, ui or app behaviour changed;
  `packages/analysis` went from a package skeleton to its first real module.
- **Next session: P5.02** — "Target model: point / ring / raised-platform with hit predicate + miss
  vector", validation "miss vector zero at exact hit (constructed)". It builds directly on
  `missDistance` above, which deliberately stops at the scalar magnitude: the signed miss _vector_
  and the point/ring/platform predicates are P5.02's job, and the module doc says so. Read §9.1
  before starting. The standing constraint still applies: **symplectic integrators are for
  conservative dynamics only** — any dissipative path stays on standard RK.

## 2026-08-07 (1st run) — P4.40 (physics reference docs) — **Phase 4 complete**

- **Done: P4.40**, and it was the last Phase 4 task — **all 40 Phase-4 tasks are now `done` and
  the next task is P5.01** (observable framework). `docs/physics/` holds nine subsection pages plus
  an index, generated by `scripts/generate-physics-docs.mjs` from the blueprint's §3.1–§3.9.
- **"Regenerated from §3 sources" was taken literally.** The generator slices §3 out of the
  blueprint and copies the prose through **verbatim**; the blueprint was **not edited**, because it
  is the source of truth for architecture and this task is a docs pass, not a scope change. What
  the generator adds is provenance headers, prev/next/index navigation, and an equation→code
  Implementation table.
- **The implementation map lives in `docs/physics/implementation-map.json`, not in the Markdown.**
  That is the whole reason the pages can be regenerated without losing the mapping — 51 curated
  entries across the nine sections, each naming a symbol, the file that exports it, and its role.
- **The validation criterion is machine-checked rather than asserted in prose.** "All equations
  render; cross-links valid" is documentary — a session could mark it done and nothing could ever
  contradict that. Instead `packages/validation/src/physics-docs.test.ts` carries **49 assertions**:
  pages byte-identical to a fresh regeneration; `$`/`$$` delimiters balanced; braces, `\left`/`\right`
  and `\begin`/`\end` balanced inside each math block; every `\tag{3.N}` the blueprint defines
  present in the pages; every relative link resolving to a real file; every anchor resolving to a
  real heading; every page reachable from the index; every implementation-map symbol a real **named
  export** of the file it points at.
- **The equation-tag check is guarded against passing vacuously.** It derives the tag list from the
  blueprint and then looks for it in the generated pages — which would trivially pass if the list
  were empty, so it asserts **≥19 tags found** first. That floor is not decorative: it was the
  assertion that fired when the generator was deliberately broken (see below).
- **Negative-controlled, not just observed green.** Six deliberate breakages were introduced and
  reverted: a hand-edited page (**1** test failed), a renamed symbol (**2**), a nonexistent file
  (**3**), a duplicated note (**2**), a stray `$` inserted into the blueprint (**1**), and a
  generator truncating section bodies (**12** — including the anti-vacuity floor firing at 5 tags
  found vs 19 required). Without those checks the new assertions could have been passing for free.
- **Two of this session's own test ideas were wrong and were replaced rather than papered over.**
  A `{{`/`}}` "unsubstituted template slot" check fired immediately — `}}` occurs constantly in
  legitimate LaTeX (`\lVert\mathbf{v}_{\text{rel}}\rVert`); it now checks for what a broken
  generator actually emits (`undefined`, `[object Object]`, empty table cells). And a
  minimum-note-length check failed on a note reading "Eq. (3.9), Re." — **padding prose to clear a
  character count I invented would have been busywork, not rigor**, so it now asserts notes are
  non-empty, sentence-terminated and mutually distinct.
- **`docs/physics/*.md` is prettierignored**, joining the blueprint and `*.derivation.md` which are
  already exempt for the same reason: prettier reflows the LaTeX. Here it would additionally make
  the generator's own `--check` comparison fail against its output. **`CLAUDE.md` also fails
  `format:check`, but that is pre-existing** — verified by stashing this session's work — and
  `format:check` is not a CI step, so it was left alone rather than swept up as a drive-by fix.
- **Measured at this session's HEAD**: `pnpm typecheck` clean; `pnpm lint` clean; `pnpm lint:deps`
  clean — **no violations**; `pnpm --filter @ballista/app build` green with the bundle at
  **65.6 kB gzipped** against the 300 kB §2.6 budget; typedoc for both `engine` and `solverkit`
  green.
- **A caveat on the `lint:deps` module count, because the P4.39 entry quotes one as if it were
  stable.** This run measured **1203 modules / 3267 dependencies** before building the app and
  **1152 / 3096** after — reproducibly 1152/3096 across three consecutive runs at the end. The
  cause is that `.dependency-cruiser.cjs` sets only `doNotFollow: node_modules` and does **not**
  exclude `dist/`, so build artifacts are cruised: `tsc -b` emits many per-file outputs into
  `packages/*/dist`, and `vite build` then empties `packages/app/dist` and replaces them with a
  few bundled chunks. **The "no violations" result is invariant; the counts are not**, so they
  should not be compared across sessions without knowing the build state. Filed as an observation
  only — excluding `dist/` from the cruise would be a real improvement but is a scope change, not
  this task.
- **Test results, stated with the flake record.** `pnpm test` at this HEAD is **1475 tests across
  207 files** (was 1426/206 at session start: **+49 tests, +1 file**, no regressions). Three
  full-suite runs this session: **two fully green, one red**. The red was the **same known flake the
  P4.39 entry documents** — `packages/solverkit/src/chunked-integration.test.ts`'s wall-clock
  assertion, `maxSliceMs` 10.94 against a <10 ms budget. Run in isolation that file passed **5/5**,
  so it is load-sensitive rather than a regression from this task. It was **not** weakened, skipped
  or deleted.
- **One commit in this run did not typecheck when it was made** (`81824a1`: the test passed vitest
  but not `tsc -b` under `noUncheckedIndexedAccess`). It was **fixed forward** in `a49de3d` rather
  than by rewriting history. Recorded here because `policy.commitRules` asks every commit to build,
  and quietly amending would have hidden a real deviation.
- **Hosted CI is green at this HEAD.** Run **`31155906382`** at `0f4310e` (push-triggered, arriving
  within seconds of the push) passed **all 16 steps** in 3m37s: typecheck, lint, import boundaries,
  **`pnpm test` in 1m44s**, benchmark and cross-engine-drift soft checks, both typedoc steps, app
  build and bundle-size budget. The local test results above are therefore corroborated on a
  hosted runner too — including the `chunked-integration` timing assertion, which passed there.
- **Correcting the P4.39 entry: `ci.yml` _has_ been running on `main`.** That entry says it "has
  not run on main since `4e407f6`". The API shows push runs at `65c6119` (**success**), `0b57bf2`
  (**success**) and `7c08b7b` (**failure**) after `4e407f6`, all on 2026-08-06. The claim was
  wrong, and left standing it would have sent a future session hunting a nonexistent trigger
  problem. What is true is that one run did conclude `failure` — at `7c08b7b`, which is consistent
  with the known `chunked-integration` flake, though **that specific run's logs were not inspected
  this session**, so this is stated as consistency, not as a diagnosis.
- **Doc, script and test only.** No engine, solverkit, app or viz behaviour changed.
- **Next session: P5.01** — "Observable framework: pure functions Trajectory→scalar (range, apex,
  ToF, impact speed, miss distance to target)", validation "unit tests vs analytic values". This
  opens Phase 5 (optimization and inverse problems), so read blueprint §7 Phase 5 before starting;
  P5.02–P5.05 (target model, Brent root-find, shooting residual, FD Jacobian) build directly on it.
  Note the standing constraint still applies as Phase 5 begins: **symplectic integrators are for
  conservative dynamics only** — any dissipative path stays on standard RK.

## 2026-08-06 (3rd run) — P4.39 (rotational-dynamics ADR)

- **Done: P4.39** — `docs/adr/ADR-015-rotational-dynamics-scope.md` (Accepted) plus five assertions
  in `packages/engine/src/adr-rotational-dynamics-scope.test.ts`. Full decision text and revisit
  trigger in `ROADMAP.json` under P4.39. **Only P4.40 now stands between this repo and Phase 5.**
- **ADR-015, not 016 or 018**: the blueprint reserves 017 for P5.31, 019 for P6.30 and 023 for
  P7.27, and 001/004/007/011/014 already exist, so 015 is the next free number with no forward
  collision. The blueprint's own §7 list of ADRs ends in "…" and was **not** edited — it is the
  source of truth for architecture, and this run did not change scope, only record it.
- **The validation criterion is machine-checked rather than asserted in prose.** "ADR merged with
  decision + revisit trigger" is documentary, which normally means a session marks it done and
  nothing can ever contradict that. Instead: the tests assert the file exists and is `Accepted`,
  that it carries both a `## Decision` and a `## Revisit trigger` section, and that the trigger
  section holds **≥3 concrete bulleted conditions** rather than an empty heading.
- **The fourth and fifth assertions are the ones that will catch a real regression**: no _projectile_
  model declares an orientation channel, with `PLANAR_CHANNELS`, `SPATIAL_CHANNELS` and
  `PLANAR_SPIN_CHANNELS` pinned exactly and `omega`'s unit pinned to `rad/s` — a rate, not an angle.
  Adding an attitude state without reopening the ADR now fails a test instead of passing silently.
  **Pendulum and Kepler are deliberately excluded** from that check: their `theta` is a generalized
  coordinate of a different system, not projectile attitude, and sweeping them in would have made
  the assertion wrong rather than strict.
- **Negative-controlled**, not just observed green: renaming the `## Revisit trigger` heading and
  adding a `pitch` channel to `PLANAR_SPIN_CHANNELS` failed **4 of the 5** tests; both were then
  restored. Without that check the new assertions could have been passing vacuously.
- **One claim in the ADR was corrected against the code before it was written.** The first draft
  described spin as scalar-only. `ProjectileParams.spinAxis` exists — an optional constant
  $\hat{\boldsymbol\omega}$ read only by the dim-6 spatial model's 3D Magnus term (P4.24),
  defaulting to $\hat{\mathbf e}_z$. It is still **kinematic** (a fixed input direction, not an
  orientation that evolves), so the decision is unchanged, but the ADR now says so explicitly and
  its "no implicit attitude" constraint names `spinAxis` as something that must never be integrated.
- **Symplectic constraint unaffected and reaffirmed**: spin decay is dissipative and stays on
  standard RK. The ADR notes for the deferred case that $\boldsymbol\omega \times \mathbf I
  \boldsymbol\omega$ would be conservative but $\mathbf M_{\text{aero}}$ is not, so the existing
  conservative-dynamics-only rule already covers rigid-body attitude if it is ever built.
- **Doc + test only.** No engine, solverkit, app or viz behaviour changed.
- **Measured at this session's HEAD**: `pnpm typecheck` clean; `pnpm lint` clean; `pnpm lint:deps`
  clean — **no violations, 1200 modules / 3264 dependencies** cruised;
  `pnpm --filter @ballista/app build` green, app bundle **67.19 kB gzipped**.
- **Test results, and the full-suite record is mixed — read this before quoting a number.**
  `pnpm test` at this HEAD is **1426 tests across 206 files** (was 1421/205 at session start: +5
  tests, +1 file, no regressions). Across **six** full-suite runs this session it went green **three
  times** and red **three times**, and the failure was the **same single assertion** every time:
  `packages/solverkit/src/chunked-integration.test.ts` — "a 1e6-step run stays within a small,
  bounded wall-clock budget per slice", **max slice 12.97 ms and 15.88 ms against a 10 ms budget**.
  That file passes **alone** in 173–214 ms on every attempt.
- **What was measured about that flake, and what was not.** At the **pre-session** HEAD (`31089ce`)
  the full suite ran green **3 times out of 3** (1421/1421). The first two reds appeared immediately
  after this session added a 206th test file, which pointed at contention from one more parallel
  worker — so the assertions were folded into the existing `planar-projectile-spin-model.test.ts` to
  get back to 205 files and the suite was re-run: **still 1 red in 3**. That falsifies the
  extra-file explanation, so the fold was reverted and the standalone file kept (it matches the
  `docs-derivation-links.test.ts` precedent and is more discoverable). The likelier reading is that
  this container's available CPU drifted over a session that ran ten-plus full suites back to back —
  **but that is inference, not a measurement, and it is not proven.** What _is_ solid: this session
  changed no solverkit code and nothing `chunked-integration.test.ts` imports.
- **The test was not weakened, skipped, or re-budgeted.** Raising the 10 ms figure is a change to a
  performance assertion and is not part of P4.39.
- **Issue filed, NOT fixed** (scope discipline): this repo now has **three** marginal timing
  assertions in one parallel suite — `chunked-integration`'s 10 ms slice budget (new to the record
  this session) alongside `canvas-viewport.test.ts` (48.6 s against a 60 s hook timeout) and
  `lazy-plotly-pane.bundle.test.ts` (22.1 s against 30 s), both recorded in the P4.38 entry. They
  are one problem, not three, and a task that claims "make suite timing assertions robust under
  parallel load" should handle all of them together rather than a session raising one number at a
  time to get its own run green.
- **Pre-existing issue, still NOT fixed and still needing a human** (unchanged from P4.36/P4.37/P4.38,
  now surviving four sessions): the **root `pnpm build` script is broken under pnpm 11** —
  `pnpm -r --workspace-concurrency 1 run build` fails with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`
  because pnpm 11 reads `run` as the script name. Confirmed again this session. CI is unaffected
  (`ci.yml` builds via `pnpm --filter @ballista/app build`, which passes). The fix is a one-word
  `package.json` change (`run build` → `build`); it keeps being left alone because it is a
  repo-config decision, not part of any claimed task. **Four sessions is long enough that this
  should be claimed rather than re-noted.**
- **Found at close-out, and it matters more than anything else in this entry: `ci.yml` has not run
  on `main` since `4e407f6` (2026-08-06 14:48 UTC).** Session 2's push (through `31089ce`, committed
  18:47 UTC) produced **no CI run at all**, and neither did this session's push (`0b57bf2`), checked
  via the Actions API several minutes after it landed. Verified by listing `ci.yml`'s runs, not
  inferred from a red badge. **CLAUDE.md's "CI still runs on every push to `main` as a backstop" is
  therefore not currently true** — the local gate each session runs is the only gate, and two
  sessions of work have now landed on `main` with no hosted verification whatsoever.
  **`ci.yml` cannot be triggered by hand to compensate**: its `on:` block is `push` +
  `pull_request` only, with no `workflow_dispatch`. Adding one is a one-line change and the obvious
  first move, but it is a workflow-config change outside P4.39 and is left for a task that claims
  it. Root cause not determined from here — this run could not distinguish a GitHub-side
  Actions/webhook problem from push-authorship suppression, and says so rather than guessing.
- **Sharpened at the very end of the run, because the first version of the bullet above overstated
  what was measured.** Two pushes were cited as producing no CI run; only one of them is evidence.
  `31089ce` was committed **18:47:09Z** and still had no `ci.yml` run at **23:02Z** — **4h15m**,
  which no plausible queue lag explains and which stands. This session's own push `0b57bf2`
  (22:57:36Z) was checked only ~4 minutes later, far too soon to conclude anything, and citing it
  was a mistake. **The claim that holds is the narrower one**: `main` has had no CI run since
  `4e407f6` at 14:48Z, so `31089ce` and everything after it — including this session's P4.39 work —
  has landed with the local gate as its only verification. Runs may yet appear late; a session that
  wants certainty should check the age of the newest run rather than whether its own push has one
  yet.
- **Next session**: **P4.40** — "Docs pass: physics reference pages regenerated from §3 sources",
  25m/E, validation "all equations render; cross-links valid". It is the **last task in Phase 4**;
  clearing it opens Phase 5 (P5.01, the observable framework). Note that its cross-link half pairs
  naturally with the existing `docs-derivation-links.test.ts` pattern. The standing constraint holds
  unchanged: symplectic integration stays on conservative dynamics only.

---

## 2026-08-06 (2nd run) — P4.38 (SDIRK2 stepper)

- **Done: P4.38** — `packages/solverkit/src/sdirk2-stepper.ts` adds Alexander's two-stage SDIRK2
  (singly diagonally implicit, stiffly accurate, $\gamma = 1 - 1/\sqrt2$), its derivation page, and
  16 tests. Full notes in `ROADMAP.json` under P4.38. This clears the last _stretch_ item in Phase 4;
  P4.39 (rotational-dynamics ADR) and P4.40 (physics reference docs) are what remain before Phase 5.
- **SDIRK2 rather than TR-BDF2** — the task names either. SDIRK2 reaches the same L-stability at
  second order in **two** stages rather than three, and its $\gamma$ falls out of the order
  conditions rather than being chosen: $\sum b_i c_i = \tfrac12$ _is_ $\gamma^2 - 2\gamma + \tfrac12
  = 0$, whose root in $(0,1)$ is $1 - 1/\sqrt2$.
- **Both halves of the validation criterion are measured from the stepper, not asserted about the
  formula.** Slope: `measureConvergence` on the linear-drag benchmark (§3.6–3.7) against its closed
  form gives a slope inside (1.9, 2.1). L-stability: the stepper's own one-step amplification on the
  Dahlquist equation matches $R(z) = (1+(1-2\gamma)z)/(1-\gamma z)^2$ to 10 digits across
  $z \in \{-0.5, -1, -5, -50, -10^3, -10^6, 0.5, 1\}$, so a tableau that drifted from the derived one
  would fail rather than pass quietly.
- **The demo, in one number**: at $h = 10^4 \times h_\text{crit}$(explicit Euler) — $\lambda = -10^4$,
  $h = 2$, $z = -2\times10^4$, where explicit Euler amplifies by $2\times10^4$ _per step_ — one SDIRK2
  step damps by **4144×**, to $|y| = 2.4131\times10^{-4}$. The contrast case is the trapezoidal rule,
  A-stable but **not** L-stable: over the same $z$ values its $|R|$ _climbs toward_ 1 (0.9608 at
  $z=-10^2$, 0.9999999996 at $z=-10^{10}$) where SDIRK2's falls below $10^{-10}$. It is asserted on
  its $R(z)$, not on a stepper — SolverKit has no trapezoidal stepper and this run did not add one.
- **Two claims that were wrong when first written, and are now assertions of the truth.** (1) SDIRK2's
  $R(z)$ **is negative** for $z < -1/(1-2\gamma) = -2.414$, so it does _not_ avoid the stiff sign
  flip; what it avoids is the flipped component keeping its magnitude. The first version of the test
  asserted "no sign flip", failed, and now asserts that _both_ methods flip. (2) A 20-step stiff run
  was expected to reach $R^{20} \approx 5\times10^{-61}$ and instead stalled at $5.89\times10^{-16}$.
- **That stall is a real, pre-existing platform property, now pinned in a test.** `scaledErrorNorm`'s
  absolute term means a stage's _initial_ residual already scores $\le 1$ once $|y|$ falls to roughly
  `newtonAtol`; Newton then exits at iteration 0 and returns its initial guess, so the step becomes a
  no-op and the solution stops decaying. Measured: 20 steps at $z=-5000$ stall at
  $5.89\times10^{-16}$ with the default `newtonAtol = 1e-10` and reach $4.79\times10^{-61}$ with
  `1e-300`. **This belongs to the shared Newton stopping rule, not to this tableau — it applies to
  `BackwardEulerStepper` identically** — and it only bites on a solution decaying toward zero in
  absolute terms, i.e. the Dahlquist test problem, not a trajectory. It is recorded rather than
  "fixed" because changing a convergence criterion is not part of a stepper task.
- **Negative-controlled**, not just observed green: perturbing $\gamma$ from 0.29289 to 0.3 drops the
  measured convergence slope from **2.00 to 0.49** and fails both order-condition tests. Without that
  check the new assertions could have been passing vacuously.
- **Not done, deliberately**: no embedded error estimator, so SDIRK2 is fixed-step and
  `errorEstimate` stays 0 (the adaptive companion is an ESDIRK pair, a different tableau); and no
  solver-panel dropdown or advisor entry, since P4.38's validation criterion is numerical and UI
  exposure was not claimed.
- **Test results, all run locally at this session's HEAD**: `pnpm test` **1421/1421 across 205 files**
  on its best run — read the flake bullet below before quoting that as "the suite is green"
  (was 1404/204 at session start — +16 SDIRK2 tests and +1 derivation-link test, no regressions);
  `pnpm typecheck` clean; `pnpm lint` clean; `pnpm lint:deps` clean — no violations, over 1136
  modules / 3074 dependencies on the final run (an earlier run in the same session cruised
  1197/3245: the count depends on which build artifacts are on disk at the time, so treat the
  violation count as the signal and the module count as incidental);
  `pnpm --filter @ballista/app build` green, app bundle **67.19 kB gzipped**.
- **The full suite is flaky in this environment, and the honest record is 1 green run in 4.** Four
  `pnpm test` runs: one fully green (1421/1421), and three where exactly one **build-heavy** test
  timed out — `packages/app/src/canvas-viewport.test.ts` (`Hook timed out in 60000ms`) once, and
  `packages/viz/src/lazy-plotly-pane.bundle.test.ts` (`Test timed out in 30000ms`) twice. Both pass
  run alone, and the margins are why they flake: canvas-viewport takes **48.6 s against a 60 s**
  hook timeout (it vite-builds the app _and_ launches Chromium), the Plotly bundle test **22.1 s
  against a 30 s** timeout (it vite-builds the 4.8 MB Plotly bundle). Under a parallel 205-file suite
  both cross their limits. Neither can be caused by this session's change, which is solverkit-only
  and touches nothing either test imports; the solverkit suite itself (89 files, 604 tests) was green
  in every run. Previous sessions reported a green suite, so this looks like contention specific to
  this container rather than a new regression. **A small separate fix would raise both timeouts** —
  they are timeouts, not assertions, so raising them weakens nothing — but that is a change to test
  configuration outside P4.38 and was left for a task that claims it.
- **Pre-existing issue, still NOT fixed and still needing a human** (unchanged from P4.36/P4.37, now
  surviving three sessions): the **root `pnpm build` script is broken under pnpm 11** —
  `pnpm -r --workspace-concurrency 1 run build` fails with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` because
  pnpm 11 reads `run` as the script name. Confirmed again this session. CI is unaffected (`ci.yml`
  builds via `pnpm --filter @ballista/app build`, which passes). The fix is a one-word `package.json`
  change (`run build` → `build`); it keeps being left alone because it is a repo-config decision, not
  part of any claimed task.
- **Next session**: P4.39 — "Rotational-dynamics ADR: scope Euler rigid-body eqs as future work",
  15m/E, validation "ADR merged with decision + revisit trigger". Then P4.40 (physics reference docs
  regenerated from §3 sources, 25m/E). Clearing both finishes Phase 4 and opens Phase 5 (P5.01, the
  observable framework). The standing constraint still holds: symplectic integration stays on
  conservative dynamics only — SDIRK2 is an implicit RK method for dissipative/stiff paths and does
  not change that.

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
