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

## 2026-08-15 (25th run) — P0.97 (ground-level launch fired its impact event at t=0)

- **Done: P0.97**, the correctness bug the 24th run found and filed rather than fixed. Taken
  ahead of P5.24 (the next task by `seq`, and marked "optional" in its own title) because it
  was a silently wrong answer in shipped behaviour: `solveArcs` returned a low arc for a 50 m
  target that missed by 39 m, with `ok: true`, no error, and 39 iterations of a root finder
  working on a function with a cliff in it. Fix in
  `packages/solverkit/src/event-detection.ts`; suite **2198/2198 across 237 files** (was
  2169/237 — 29 new tests, no new file); typecheck, lint and `lint:deps` (1389 modules) green;
  app build green with `check-bundle-size` at **71.7 kB gzipped** against the 300 kB budget.
  Full detail in `ROADMAP.json`.
- **Reproduced before anything was edited, and the 24th run's mechanism note needed one
  correction.** It estimates the first step at "about 1.5 s"; the step is **6 s** —
  `(tFinal - t0)/DEFAULT_STEP_COUNT` = 600/100 — and 1.5 s is its _first interior sample_.
  DOPRI5 accepts that 6 s step whole because constant acceleration makes `y(t)` a quadratic it
  integrates exactly, so the error estimate is ~0 and adaptivity never shrinks it. The real
  condition is therefore `tof < h/4`, not `tof < h`, and the measured cutoff at v₀ = 60 m/s
  (θ = 0.12 fails, θ = 0.125 passes) is exactly the 0.25 sample.
- **Two faults compose, and fixing either alone is wrong — which was observed, not predicted.**
  The exact zero of `g_gnd = y` at `t0` made `(0, negative)` read as a falling crossing, and
  `brentRoot` handed `gLo = 0` returns the left endpoint without iterating. But the real
  crossing can lie entirely inside the first sub-interval, which nothing sampled. The first
  draft suppressed the spurious bracket only, turned a wrong answer into a missed event, and
  **failed 26 tests** — the outcome the 24th run's note warned about in advance. The landed fix
  adds a 12-rung geometric ladder inside that sub-interval alongside the suppression.
- **A horizontal launch from exactly ground level still lands at t=0, and that is deliberate.**
  With `v_y = 0` at `y = 0` the shot leaves _through_ the surface rather than departing it, so
  `t=0` is the right answer. `crossesInDirection` — the event's own declared direction — is what
  decides which of the two cases applies, so the rule is correct for any event rather than
  hand-fitted to the ground. This is not a curiosity: `solveArcs` evaluates θ = 0 at its lower
  angle bound on every call, and the first draft's blanket suppression broke every ground-launch
  test in `arcs.test.ts`.
- **The ladder's floor is documented rather than hidden.** Its last rung resolves an excursion
  about `6.1e-5` of a step — 0.37 ms on the default 6 s step, an elevation near `3e-6` rad and a
  range near 2 cm. Below that the `t0` crossing is reported instead, so the answer degrades
  continuously to the θ → 0 limit rather than failing.
- **Failing-first evidence, measured against the pre-fix scanner rather than asserted:** 4 of
  the 6 new `event-detection.test.ts` cases fail, and 13 of the 23 new `arcs.test.ts` cases fail
  — all 13 at targets of 1–100 m, with 130 m and beyond passing before the fix. That band is
  exactly what the mechanism predicts and is why the defect stayed invisible for so long. The
  cases that pass both before and after are pinning behaviour the fix preserves, and they say so.
- **Next run:** the next task by `seq` is **P5.24** (discrete-adjoint note, "optional" in its own
  title, `H`), then P5.25 (regression: optimization goldens pinned) and P5.26 (Levenberg–Marquardt
  fallback). If a shorter run is wanted instead, **P0.98** is newly filed and self-contained: a
  drag-free bouncing ball has closed-form impact times, and no test covers a bounce whose flight
  is shorter than a quarter step — the regime every restitution solve enters as it loses height.
  Note P0.94 (`format:check` not in CI) and P0.96 (the wall-clock assertion that flakes) are both
  still open and both still one-decision items for a human.

## 2026-08-15 (24th run) — P5.23 (ill-conditioning exhibit at the reachability envelope)

- **Done: P5.23.** `packages/analysis/src/ill-conditioning.ts` (`solveArcsWithConditioning`,
  `sweepEnvelopeConditioning`, `conditioningLevel`, `geometricMargins`, `logLogSlope`) plus
  `buildConditionNumberFigure` in `lazy-plotly-pane.ts`. Suite **2169/2169 across 237 files**
  (was 2131/236 — 38 new tests, 1 new file); typecheck, lint and `lint:deps` (1391 modules)
  green; app build green with `check-bundle-size` at **71.6 kB gzipped** against the 300 kB
  budget, unchanged — nothing imports either piece yet, so both tree-shake out. Full detail in
  `ROADMAP.json`.
- **The obvious Jacobian is the wrong one, and picking it would have produced a flat line.**
  P5.05's `shootingJacobian` differentiates against the full aim `(θ, v₀)`, and the ground-impact
  event pins its vertical row — so it is rank 1 for _every_ aim, its condition number sits around
  `1e11` a kilometre inside the envelope and a millimetre outside it alike, and it says nothing
  about the envelope at all. It is a fact about the _terminal event_. The fold the blueprint means
  (§ "Globalization": _"the two solution arcs merge and det J → 0"_) is in the **fixed-speed**
  problem P5.08 solves — one unknown `θ`, one equation — where `det J` is the single number
  `∂R/∂θ` and it really does vanish, because the envelope _is_ the maximum of `R(θ)`. Free `v₀`
  too and there is no fold: a target past the envelope at one speed is reached at a higher one.
- **"Spikes" is a rate, not a magnitude, and the rate is a square root.** Near the quadratic
  maximum a target short by `s` is hit at `θ_p ± √(2s/|R''|)`, so three things follow together:

  | quantity                 | law        | measured (drag-free) | measured (`cd` 0.47) |
  | ------------------------ | ---------- | -------------------- | -------------------- |
  | sensitivity `\|∂θ/∂R\|`  | `s^(-1/2)` | **−0.4999**          | **−0.5009**          |
  | arc separation `θ₊ − θ₋` | `s^(+1/2)` | **+0.5000**          | **+0.4999**          |

  The drag columns are the ones that earn the word _exhibit_: a `−1/2` law visible only drag-free
  could be an artifact of the closed form rather than of the fold. The practical reading is that
  the blow-up is real but **gentle** — κ only doubles per factor of four in margin — which is
  precisely why it is worth quantifying instead of gesturing at.

- **The thresholds key off a dimensionless number, and the first attempt at them was wrong.**
  A `rad/m` sensitivity is scale-dependent: the same well-posed shot reads `1.5e-3` at 60 m/s and
  something else at 600, so no absolute threshold separates "ordinary" from "at the fold" across
  problems. The first cut used one anyway, at `1e-3`, and duly flagged **every ordinary shot** as
  ill-conditioned. It was replaced rather than tuned. The relative condition number works because
  drag-free it is exactly `tan(2θ)/(2θ)` — **1** at zero elevation, divergent at the 45° peak — so
  `κ ≈ 1` is what a well-posed shot _is_ here, and thresholds at 10 and 100 are real decades above
  a real baseline, read as significant digits lost.
- **Both closed forms are used as external references at every sampled target, not just
  asymptotically**, and the tolerance is five significant figures rather than six for a reason
  that is this module's own subject. A central difference truncates at `(h²/6)·R'''`, so its
  _relative_ error is `(h²/6)·R'''/R'` — and `R' → 0` at the fold while `R'''` does not. The
  measurement of the conditioning is itself conditioned by the thing it measures. A separate test
  pins that the agreement degrades towards the fold, so the tolerance is a measurement rather than
  a concession; shrinking `h` trades it for the integrator noise `shooting-jacobian.ts` documents
  and lands worse.
- **Found while building it, filed as `P0.97`, not fixed — and it is a correctness bug in shipped
  code.** Launching from **exactly** `y = 0` makes the impact event true at `t = 0`, and whenever
  the entire flight fits inside the integrator's first step the detector localizes _that_ root:
  `ok: true`, `timeOfFlight: 0`, impact at the launch point. `solveArcs` inherits it and returns,
  for a 50 m target at 60 m/s drag-free, a **low arc that misses by 39.32 m** — silently, with no
  error of any kind. A 25 m target misses by the full 25 m; targets from 100 m out are fine, and
  both high arcs are fine throughout, which is why `arcs.test.ts` never caught it. The mechanism is
  measured rather than guessed: the residual dump shows `nSteps: 1` with a ~1.5 s first step, and
  the 0.1229 rad cutoff is exactly the elevation whose drag-free flight time `2v₀sinθ/g` equals
  1.5 s. **Raising the launcher by `1e-9` m fixes it outright** — at θ = 0.05 rad, `h = 0` gives
  `tof 0, x 0` and `h = 1e-9` gives `tof 0.611575, x 36.6486`, the closed form. Blast radius:
  P5.08, and through it P5.20, P5.21 and P5.22. Left unfixed on purpose — it is outside P5.23 and
  the fix belongs to the event detector — but it outranks the rest of the backlog on this repo's
  own priority order, so **it is the recommended next task**. This run's module guards its own
  measurement against it (a zero flight time is rejected as hard as a failed solve) after
  differencing across the cliff produced `4.5e5 m/rad` against a drag-free maximum of `734`; that
  guard is local and is not a fix.
- **Not done, deliberately: no UI panel**, the same not-yet-mounted position as P5.20's
  `BasinPanel`, P5.21's `TargetMarkerPanel` and P5.22's designer. Also not done: the _fix_ for the
  ill-conditioning. The LM fallback is P5.26 and multi-start is P5.27;
  `solveArcsWithConditioning` is a reporting wrapper that returns `solveArcs`' answer unchanged,
  so P5.26 still has an unimproved baseline to measure against.

Notes for the next run:

- **Take `P0.97` before `P5.24`.** It is a wrong answer returned silently by a solver three later
  tasks build on, and this repo's priority order puts a correctness bug above everything else.
  The suggested fix is in the task notes: an event already zero at `t0` should require a departure
  before a crossing counts, rather than being localized at the initial condition.
- **`pnpm build` at the repo root is still broken and is still not this run's change** — filed as
  `P0.90`/`P0.93`, now unfixed across four runs. The root script is
  `pnpm -r --workspace-concurrency 1 run build`, which under the pinned pnpm 11.9.0 parses `run`
  as the script name. This run's build gate was satisfied the way CI does it —
  `pnpm --filter @ballista/app build` followed by `check-bundle-size` — both green.

---

## 2026-08-12 (23rd run) — P5.22 (trajectory-designer: lock any two of θ, v₀, R)

- **Done: P5.22.** `designTrajectory(problem, request, options)` in
  `packages/analysis/src/trajectory-designer.ts`, exported from `@ballista/analysis`. The three
  locks are a discriminated union on the _unknown_, so "lock any two" is enforced by the type
  checker rather than by a runtime arity check on a bag of three optional fields — a
  `{theta?, speed?, range?}` bag would admit all eight subsets, seven of them meaningless. Suite
  **2131/2131 across 236 files** (was 2114/235 — 17 new tests, 1 new file); typecheck, lint and
  `lint:deps` (1383 modules) green; app build green with `check-bundle-size` at **71.6 kB
  gzipped** against the 300 kB budget, unchanged — nothing imports the module yet, so it
  tree-shakes out. Full detail in `ROADMAP.json`.
- **The three locks are not three variations on one solve, and the differences are the content.**

  | locked | unknown | cost                                  | answers          |
  | ------ | ------- | ------------------------------------- | ---------------- |
  | θ, v₀  | R       | one flight                            | exactly one      |
  | v₀, R  | θ       | a peak location + two Brent solves    | **two**, or none |
  | θ, R   | v₀      | a bracket expansion + one Brent solve | one, or none     |

  `(θ, v₀) → R` is not a solve at all — both aim components are fixed, so it flies once and reads
  the impact, and it is the only lock that cannot fail on feasibility grounds. `(v₀, R) → θ`
  delegates **wholly** to P5.08's `solveArcs`, inheriting its two answers, its _measured_ peak and
  its low/high labels; deriving a single "the" angle here would have duplicated that work and
  thrown away the second solution, which for a designer is the interesting half.

- **`(θ, R) → v₀` is the only new numerics, and it is the easy one for a structural reason worth
  stating: range is monotone in speed at fixed elevation.** Fire the same elevation harder and it
  goes further, with no peak in between — so unlike the angle problem there is no branch
  structure and at most one root. That is _why_ this lock returns one solution and the θ lock
  returns two; it is a fact about the physics, not a choice. `brentRoot` is bracketed by geometric
  expansion from the drag-free inverse `v₀ = √(gR / sin 2θ)`, which is exact without drag and a
  strict _under_-estimate with it, so the expansion almost always runs upward — the direction the
  bracket is guaranteed to be. Monotonicity is exploited but not assumed: a cap reached without a
  sign change is reported `unreachable` rather than solved past. This follows `min-energy.ts`,
  which already brackets `brentRoot` on speed; that precedent is reused, not reinvented.
- **`R` means downrange displacement from the launch point** — not distance from the origin, not
  slant range. A raised launch is first-class throughout this package, so measuring from the
  launcher is the only reading that keeps the three locks consistent with one another. Two tests
  pin it by moving the launcher 100 m downrange and requiring the answers not to move.
- **Infeasibility is a value, never a throw** (`unreachable`, `degenerate-elevation`,
  `non-positive-range`, `max-iterations`); a _malformed aim_ — negative speed, NaN angle — still
  throws. A caller bug and an out-of-reach target must not come back looking alike.
- **On the tests, and why the cross-lock section runs with drag on.** The criterion is "all three
  lock combinations function", read as three claims. Each lock alone is checked against the
  drag-free closed form `R = v₀² sin2θ / g` and its two analytic inverses — none of which the
  implementation knows — plus `R/√(2h/g)` for the raised zero-elevation case, where `sin 2θ = 0`
  leaves no seed formula and the fallback has to carry the solve. Then the locks are checked
  against _each other_, **with drag on deliberately**: without drag, three independent
  re-derivations of the same closed form would agree with one another while all being wrong, and
  the round trip would prove nothing. With drag there is no formula to agree with, so agreement
  can only come from genuinely inverting the same integrated trajectory. The cross-lock elevation
  is 22.5°, chosen clear of this problem's _measured_ drag-lowered peak (~36°, max ~397 m at
  95 m/s); sitting on the peak would collapse the two arcs and let a real disagreement pass. Arc
  labels are checked against **flight time**, not elevation ordering, which is true by
  construction of the brackets and so would survive a label swap.
- **One test failed first and the code was right.** The cross-lock round trip initially requested
  420 m at 95 m/s with `cd` 0.47 and came back with zero solutions. That range is genuinely
  outside the envelope — measured 397 m at the peak — so the failure was the test's number, not
  the solver's answer. The request was moved inside the measured envelope and the envelope written
  into the comment, rather than the assertion being loosened.
- **Not done, deliberately: no designer UI panel.** The criterion is about the lock combinations
  functioning, and the solver is the thing that has to function. A panel is the natural follow-up
  and would sit in the same not-yet-mounted position as P5.20's `BasinPanel` and P5.21's
  `TargetMarkerPanel`.
- **Found, not fixed — the root `pnpm build` script is broken under the pinned pnpm.**
  `package.json`'s `"build": "pnpm -r --workspace-concurrency 1 run build"` fails with
  `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT: None of the selected packages has a "run" script` on
  **pnpm 11.9.0**, the version `packageManager` pins. All eight workspace packages _do_ have a
  `build` script; pnpm 11 parses `--workspace-concurrency 1` sitting _before_ `run` as making
  `run` the script name. Confirmed by moving the flag after the subcommand —
  `pnpm -r run --workspace-concurrency 1 build` — which builds all eight cleanly. CI does not
  catch this because `ci.yml` never invokes the root script; it runs
  `pnpm --filter @ballista/app build` directly. `CLAUDE.md` nonetheless tells every session to run
  "build" as part of the pre-push gate, so the documented gate cannot be run as written. **Left
  unfixed on purpose** — it is outside P5.22 and the blueprint governs what tasks exist here, so
  filing it beats a drive-by edit. It is a one-line fix for whoever picks it up. This run's gate
  was satisfied by the CI-exact command plus the corrected-flag-order recursive build, both green.

## 2026-08-12 (22nd run) — P5.21 (draggable target marker: solve-on-drop with arc choice)

- **Done: P5.21.** A target marker the user drags across the plot and drops; the drop issues one
  `solveArcs` call and the two aims that reach that point come back, with a low/high chooser, the
  aim readout, and the drag→solution latency. Pieces: `packages/ui/src/target-marker-logic.ts`
  (drag state machine, `worldFromPointer`, arc choice, readouts) and
  `packages/ui/src/target-marker-panel.tsx` (`TargetMarkerPanel`), both exported from
  `@ballista/ui`. Suite **2114/2114 across 235 files** (was 2081/233 — 33 new tests: 21 logic,
  11 panel, 1 measurement); typecheck, lint and `lint:deps` (1377 modules) green; app build green
  with `check-bundle-size` at **71.6 kB gzipped** against the 300 kB budget, unchanged. Full detail
  in `ROADMAP.json`.
- **The criterion is met with about an order of magnitude of headroom, and the number is measured
  rather than asserted from theory.** `solveArcs` timed over 15 distinct drops across the reachable
  band of a planar quadratic-drag shot at 60 m/s:

  | statistic | ms   |
  | --------- | ---- |
  | fastest   | 15.2 |
  | median    | 19.2 |
  | slowest   | 50.9 |

  Fifteen _distinct_ targets rather than one repeated, because repeating a single drop would let
  the adaptive stepper's history flatter a number a real drag never gets. The test asserts the
  criterion (median < 200 ms) and not the measured value, so a slower machine still passes while a
  regression that ate the headroom would not; the slowest solve carries a backstop ten times looser
  so a GC pause on a loaded runner cannot fail the suite. "Typical" is read as the median on
  purpose — a median is what a user meets drop after drop, a maximum is whatever the collector did
  once.

- **Why solving happens on drop and not during the drag.** A pointer move fires tens of times a
  second; at ~19 ms a solve, solving per move would queue work faster than it retires and the
  marker would visibly lag the pointer by a growing margin — the standard way to make a fast solver
  feel slow. So a drag is pure state and exactly one solve is issued per drop, which the panel test
  asserts directly rather than by inspection. Two orderings follow and are both tested: a second
  drop aborts the solve still in flight, and a solve that answers _after_ the user has resumed
  dragging is discarded rather than repainted onto a target they can see they have left. The drag
  is tracked in world metres and not pixels, so a resize mid-drag cannot silently move the target.
- **Not done, deliberately: the panel is not mounted in an app route yet**, exactly as P5.20's
  `BasinPanel` is not — it is a library component with its criterion measured. That is also why the
  bundle is unchanged at 71.6 kB: nothing imports it, so it tree-shakes out. Wiring it into a route,
  behind a real trajectory plot instead of the bare pointer box it renders now, is the natural
  follow-up.

Notes for the next run:

- **`pnpm build` at the repo root fails under pnpm 11.9.0, and it is not this run's change.** The
  root script is `pnpm -r --workspace-concurrency 1 run build`; under this pnpm it reports
  `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT — None of the selected packages has a "run" script`, i.e. the
  flag placement makes `run` parse as the script name. `pnpm -r run build` succeeds and was used
  for this run's build verification, and `packages/app`'s `check-bundle-size` is green off that
  build. `package.json` was last touched in `34e8d52`, well before this run. CI calls the root
  script, so this is worth a one-line fix by whoever picks it up — moving the flag ahead of `run`.
  Not fixed here: it is outside P5.21 and the routine forbids drive-by changes.
- P5.22 (trajectory-designer mode: lock any two of θ, v₀, R and solve the third) is next by `seq`,
  and its three lock combinations are independent enough to checkpoint between.

## 2026-08-12 (21st run) — P5.20 (basin-of-attraction map: initial-guess grid coloured by converged arc)

- **Done: P5.20.** `sweepBasins` runs a grid of _initial guesses_ through `newtonShooting` and
  paints each cell by the arc it converged to, answering "which of the two aims will the solver
  give me if I start here?" — a question P5.08's arc pair raises and nothing so far answered.
  The first half of the criterion, _two-arc basins render_, holds: 136 low / 153 high on a 17×17
  grid over θ₀ ∈ [0.05, 1.5] rad and v₀ ∈ [40, 80] m/s against a 140 m target with drag and wind,
  nothing unconverged, nothing unreachable. Pieces: `packages/analysis/src/basin-of-attraction.ts`,
  `PlotlyHeatmapTrace`/`buildBasinFigure` in `lazy-plotly-pane.ts`, and `BasinPanel` +
  `basin-panel-logic.ts`. Suite **2081/2081 across 233 files** (was 2032/230 — 50 new tests);
  typecheck, lint, `lint:deps` (1365 modules) green; app build green with `check-bundle-size` at
  **71.6 kB gzipped** against the 300 kB budget (was 71.5 kB). Full detail in `ROADMAP.json`.
- **The second half of the criterion came out the other way, and that is the result, not a
  shortfall.** _"boundary fractal-ish structure noted"_ — measured, the boundary is **smooth**.
  Boundary cells per row (`n × boundaryFraction`, the scale-free form: an `n × n` grid has `n²`
  cells, so a `k`-per-row boundary has fraction `k/n`):

  |                        | n = 9     | n = 17    | n = 33    |
  | ---------------------- | --------- | --------- | --------- |
  | shipped solver         | **2.000** | **2.000** | **2.000** |
  | `rankTolerance: 1e-14` | 1.823     | 2.556     | 3.432     |

  Exactly two cells per row at every refinement is the pair straddling a single curve crossed once
  — there is nothing at the finer scales to find. Drop `rankTolerance` below the ground-impact rank
  deficiency P5.05 measured at ≈ `1e-11`, so the near-null singular value is **retained** rather
  than truncated, and the same sweep speckles: isolated cells of the opposite label well inside both
  basins, and a count that grows with refinement instead of holding. **So the fractal-ish boundary
  the blueprint expected is what an unguarded Newton produces, and P5.06's truncated-SVD
  minimum-norm step is exactly what removes it.** Both cases are asserted. Reported as a scaling
  observation over three levels and deliberately **not** as a box-counting dimension, which three
  levels do not support (§8.4).

- **Why the arc label is the sign of `∂R/∂θ` and not a second solve.** The branch boundary _is_ the
  maximum-range elevation — the point where that derivative changes sign — so reading the sign at
  the converged aim is the definition of "low" and "high" rather than an approximation of it. It
  costs one central difference per cell instead of a full `solveArcs` sweep per cell: on a 33×33
  grid, ~2000 extra integrations against ~50 000. The step is `1e-4` rad, sized against the adaptive
  integrator's own accuracy rather than against `√ε`, because differencing at `1e-8` would measure
  the error tolerance instead of the physics. A slope that cannot be measured, or is exactly zero,
  gives `"unconverged"` rather than a guessed label — a cell on the peak belongs to neither arc.
  Relatedly, a cell is judged on its **downrange** miss and not on `result.converged`: the vertical
  Jacobian row is zero for every aim, so against a raised target the solver's expected terminal
  state is `"stalled"` with an honestly non-zero residual, and keying the map off `converged` would
  render a uniform sheet of failures.
- **Not done, and not claimed as done: no app route mounts `BasinPanel`.** `runSweep` is an injected
  prop, the same way `ConvergenceTracePanel` takes `runOptimize`, and outside the tests nothing
  supplies it. Wiring it needs a sweep job in `@ballista/runtime`'s worker protocol — `n²` Newton
  solves must not run on the UI thread — which is its own change and was not started. **Next
  session:** either add that job and mount the panel, or take **P5.21** (draggable target marker,
  solve-on-drop with arc choice), which is the next roadmap task and touches the same solver
  surface. The `ArcLabel` this task colours by is the same label P5.21's arc picker needs.

---

## 2026-08-12 (20th run) — P5.19 (convergence trace plot: log‖F‖ vs iteration)

- **Done: P5.19.** The trace panel now draws `‖F‖` on a log axis against a linear iteration index
  above the table P5.18 built, reading the same streamed rows rather than re-solving — so the curve
  and the numbers are one stream rendered twice and cannot disagree. The criterion, _slope doubling
  per iter near root (assert last-3 ratio)_, is asserted on **real** `newtonShooting` solves:
  **1.999** for the drag-free problem against a closed-form target, **2.003** with drag and wind.
  Pieces: `packages/analysis/src/newton-convergence-order.ts` (`plottableTracePoints`,
  `meritLogSlopes`, `meritSlopeRatios`, `finalMeritSlopeRatio`), `buildNewtonTraceFigure` in
  `lazy-plotly-pane.ts`, and `traceMeritPoints`/`traceSlopeRatio`/`formatSlopeRatio` in the panel.
  Suite **2032/2032 across 230 files** (was 1994/229 — 38 new tests); typecheck, lint, `lint:deps`
  (1347 modules) green; app build green with `check-bundle-size` at **71.5 kB gzipped** against the
  300 kB budget (was 71.2 kB). Full detail in `ROADMAP.json`. **Next task is P5.20**
  (basin-of-attraction grid), a different figure; `NewtonTraceCurve` is already a list, so a
  multi-solve overlay would need no signature change.
- **Why the diagnostic is a ratio of slopes and not a fitted exponent.** Squaring the residual is
  doubling in log space: with `L = log₁₀‖F‖`, quadratic convergence gives `L₍ₖ₊₁₎ = 2Lₖ + c`, so the
  plotted slope `sₖ = L₍ₖ₊₁₎ − Lₖ` satisfies `s₍ₖ₊₁₎ = 2sₖ`. The unknown constant `C` **cancels out
  of the ratio**, which a least-squares fit of `p` in `‖F₍ₖ₊₁₎‖ = C‖Fₖ‖ᵖ` would need, and the
  three-point window uses only the residuals nearest the root — where the asymptotic law is
  actually in force. A fit over the whole history is dragged towards 1 by the pre-asymptotic head.
- **The quadratic tail does not continue forever, and the first attempt at the criterion measured
  0.892 rather than 2.** That was not a bug in the diagnostic. Forcing `residualTolerance: 1e-10`
  buys one Newton iteration past the point where the trajectory integrator can still resolve the
  miss distance — `1.782e-8 → 2.275e-13`, about 5 decades where doubling predicts 11 — so the last
  residual is limited by integrator noise, not by Newton's law. At the default tolerance the same
  solve stops at `1.782e-8` and reports **1.999**. The floor case is pinned by its own test
  (`< 1.5`), because it is the first thing that will look like a bug in the plot; and
  `formatSlopeRatio` prints the number **without** a "quadratic / not quadratic" verdict for the
  same reason — a healthy solve near the floor would be libelled by one.
- **The alignment that would have been wrong.** A `TraceRow` describes a _step_: `merit` is `‖F‖` at
  the iterate it started from, `nextMerit` at the iterate it produced. So row `k` plots at `k+1`,
  with one extra point at the front for the initial aim. Plotting `merit` at `k` shifts the whole
  curve one iteration left and makes the solve look a step faster than it was. Adjacent rows share
  a residual, so taking `nextMerit` from every row and `merit` from only the first counts each
  exactly once — a test asserts `n` rows give `n+1` points.
- **The existing suite caught a bundle regression, and the lesson generalises.** Importing
  `plottableTracePoints` into `lazy-plotly-pane.ts` _by value_ put all of `@ballista/analysis` into
  that module's static graph, and P3.30's `lazy-plotly-pane.bundle.test.ts` failed at once: initial
  chunk **5 kB → 141 kB**, defeating the one thing that module exists for. The import is now
  type-only and the predicate inlined, with a test importing the analysis version and asserting the
  two agree case for case over `0`, `-1`, `NaN`, `±Infinity` and `MIN_VALUE`. Any future `viz`
  module reaching into `analysis` should expect the same trap.
- **Mixed axes are deliberate**, unlike every neighbouring figure: those are log-log because their
  x is a continuous quantity whose power law is a straight line, whereas here x is an iteration
  _count_ and the feature is a curve that steepens. A log x-axis would flatten exactly what the
  plot is for. Both jsdom tests that mount the panel now stub
  `renderLazyPlotlyPane`/`disposeLazyPlotlyPane` — `plotly.js-dist-min` expects a browser and was
  throwing 18 unhandled errors per run — while every figure builder stays real.
- **Unchanged and still open: P0.96**, the flaky wall-clock assertion in
  `chunked-integration.test.ts`. It **did** trip once this session, measuring **10.313 ms** against
  its `< 10` bound in an intermediate full-suite run, and passed in the runs before and after
  — which is what a flaky test does, and is independent of anything this task touched. **The test
  was not weakened.** Its notes still ask a human to choose between moving the timing to
  `bench:solverkit` and keeping the test while asserting only its deterministic half. **P0.93**
  (root `pnpm build`) is also untouched — this run used the two commands CI actually runs,
  `pnpm --filter @ballista/app build` and `check-bundle-size`.

## 2026-08-11 (19th run) — P5.18 (optimize job type in the worker pool, with iteration streaming)

- **Done: P5.18.** `#/inverse-solver` runs a Newton shooting solve in a real Worker and fills a
  convergence-trace table row by row as the iterations arrive, with a Cancel button that stops it —
  which is the criterion, _UI shows live convergence trace; cancel works_. The pieces:
  `newtonShooting` gains an `onIteration` option (its three `history.push` sites became one
  `record()` helper, so the stream and `history` cannot drift apart);
  `packages/runtime/src/optimize-job.ts` holds the structured-cloneable job;
  `worker-pool.ts` gains `runOptimize`; `optimize-worker-entry.ts`, `ConvergenceTracePanel` (+ its
  reducer), `optimize-worker-factory.ts` and `inverse-solver-route.tsx` complete the path.
  **Next task is P5.19** (convergence trace plot: log‖F‖ vs iteration), which should read the
  `TraceRow` this run already produces rather than re-derive it. Suite **1994/1994 across 229
  files** (was 1951/225 — 43 new tests, nothing else moved); typecheck, lint, `lint:deps` green;
  app build green with `check-bundle-size` at **71.2 kB gzipped** against a 300 kB budget (was
  69.2 kB). Full detail in `ROADMAP.json`.
- **Cancel terminates the worker, and the reason is not squeamishness about `postMessage`.** A
  solve is a synchronous loop of trajectory integrations, so a worker in the middle of one never
  drains its message queue — the one thing a cancel must not wait for. A `SharedArrayBuffer` flag
  the loop polls needs cross-origin isolation (COOP/COEP headers this app does not set), and
  chunking the solve into macrotasks means restructuring a solver that is correct. So the pool
  terminates the worker and refills the slot from the same factory; the `workers` array became
  mutable for exactly that, and a test cancels and then runs another job on the same pool.
- **The bug that was avoided is the one worth reading.** `NewtonShootingStep` carries no iterate,
  so `runOptimizeJob` recovers it from the last residual evaluation — which is right only when the
  line search accepted a trial. On the two paths that record a step without accepting one
  (`alpha === 0`) the last evaluation is a **rejected** aim, and reporting it would put a point on
  the trace the solve never visited. Reproduced deterministically with `maxBacktracks: 0` from
  θ = 1.5, v₀ = 20, which fails Armijo on iteration 0: the test asserts the reported aim is the
  initial one and that `evaluations > 1`, so "last evaluated" would have differed. The
  accepted-but-short case needed its own configuration — `armijoC: 0.99, maxBacktracks: 6`, which
  accepts α = 0.25, 0.25, 0.25, 0.5, 0.5, 1, 1, 1 — because the default options accept α = 1 at
  every iteration on this problem and would never exercise the distinction at all. Every reported
  iterate is re-evaluated through the residual and checked against the step's own `nextMerit`.
- **The live part is tested as live, not as "it renders".** The panel takes `runOptimize` as a
  prop, so its test emits one iteration, asserts the DOM has one row **while the promise is still
  pending**, emits another, asserts two. A fake that resolved immediately would pass an
  "it shows the iterations" test while proving nothing about the only property the task is about.
  The route test fakes only the thread — it runs the real `postOptimizeResult` one message per
  macrotask — so route → pool → job → stream → DOM is covered end to end.
- **Two things deliberately not done**, so the next run does not think they were missed: the trace
  is a table rather than a plot (that is P5.19), and the target and initial aim are fixed constants
  on the route (P5.21 makes the target draggable, P5.22 the unknowns selectable).
- **Unchanged and still open: P0.96**, the flaky wall-clock assertion in
  `chunked-integration.test.ts`. It passed in every run this session, which is what a flaky test
  does; its notes still ask a human to choose between moving the timing to `bench:solverkit` and
  keeping the test while asserting only its deterministic half. **P0.93** (root `pnpm build`) is
  also untouched — this run ran the two commands CI actually runs, `pnpm --filter @ballista/app
build` and `check-bundle-size`, rather than the broken root script.

## 2026-08-11 (18th run) — P5.17 (wind-robust aim: expected miss under wind uncertainty)

- **Done: P5.17.** `packages/analysis/src/robust-aim.ts` exports `WindScenario`, `RiskMeasure`,
  `VaryAim`, `ScenarioMiss`, `RobustAimOptions`, `RobustAimStatus`, `RobustAimResult`, `robustAim`
  and `robustAimIsFeasible`. A nominal aim drives the P5.04 residual to zero for _one_ wind; this
  minimizes a risk measure of the miss over a **weighted ensemble** of winds and reports both aims
  plus the gap, which is what the criterion — _robust aim differs from nominal in headwind-vs-gust
  scenario (measured)_ — is stated against. **Next task is P5.18** (optimization job type in the
  worker pool with iteration streaming). Suite **1951/1951 across 225 files** (was 1930/224 — the 21
  new tests and nothing else moved); typecheck, lint, `lint:deps` green; app build green with
  `check-bundle-size` at **69.2 kB gzipped** against a 300 kB budget. Full measurements in
  `ROADMAP.json`.
- **The measurement.** Exhibit: 1 kg 5 cm sphere, `Cd` 0.47, point target 400 m downrange, nominal
  headwind **−6 m/s** against a **−16 m/s** gust, equally likely, launch speed held at the nominal
  solve's **104.9387636174 m/s**. Nominal **θ = 0.6339044229** (miss 2.2e-12 m — a genuine hit,
  recomputed from the returned aim rather than read off the inner solver's own flag). Robust
  **θ = 0.5584788851**, i.e. **0.0754255378 rad — 4.32° — lower**. RMS miss **45.489 m → 43.106 m**.
  The trade in full: **2.669 m** given up under the nominal wind to recover **3.429 m** under the
  gust (64.331 → 60.902).
- **A difference is the cheapest thing in the world to produce, so it is pinned from four
  independent directions** a perturbation-shaped bug has no reason to satisfy. It vanishes
  **exactly** — `shift === 0`, not merely small — on a one-scenario ensemble, where the risk _is_ the
  miss. It is monotone in gust **severity** (0.01522 / 0.02178 / 0.02839 / 0.03504 / 0.07543 rad at
  −7 / −8 / −9 / −10 / −16 m/s) and again in gust **probability** (robust θ 0.5706031 / 0.5629515 /
  0.5584789 as the gust goes 1:9 → 3:9 → 9:9). And at a mild gust it is visibly a **trade** rather
  than a drift: at −7 m/s the robust shot goes _long_ under the nominal wind — a sign flip from
  exactly zero — in order to fall less short under the gust. Weight scaling is **bit-identical**,
  not close: `[1,1]` and `[7,7]` agree to the last bit, because normalization precedes any
  arithmetic.
- **The two-variable problem is unbounded, and that is physics rather than a bug**, so it is
  documented at the top of the module and **pinned by a test** rather than left as a footnote a later
  reader might "fix". Wind acts for as long as the shot is airborne, so flatter-and-faster is always
  more robust and nothing in the objective pushes back: as `v₀ → ∞` with `θ → 0` the time of flight
  and the risk both tend to zero, the infimum is 0, and it is **not attained**. Measured: an
  unbounded solve walks off to `θ ≈ 3.1e-4 rad, v₀ ≈ 3.59e3 m/s`, cutting RMS miss to 0.60 m and
  still descending when the iteration cap stops it. Hence `vary: "theta"`, which holds the launch
  speed fixed — the well-posed form, the one a real launcher faces since speed is a property of the
  machine, and the **only** one with an _interior_ optimum. Bounds make the answer finite but not
  interior: at `speedMax` 110 the minimizer sits **on** the cap at 110.000000 with risk 33.509 m,
  feasibility recomputed through P5.16's `aimActiveSet`.
- Two things **found by measurement rather than assumed**. The default seed for a pinned component
  now comes from a full two-variable Newton solve, not from `smartInitialAim` directly — seeding the
  held speed from the initial guess pins it below the speed the target needs and reports
  `"nominal-failed"` on a perfectly solvable problem, which is how it first showed up: three spurious
  failed exhibits. And at the −16 m/s gust the target is **out of reach altogether** at that speed
  (max range ≈ 339 m), so the robust aim there is damage limitation and worst-case degenerates to
  maximizing range under the gust; the −7 m/s exhibit exists to show the genuinely two-sided balance.
- Reuse and constraints, unchanged from the phase's ladder: the outer loop is **P5.11's
  `nelderMead`**, derivative-free on purpose because a gradient needs P5.05's Jacobian once per
  scenario per step and that Jacobian is rank 1 under a ground-impact terminal event; bounds reuse
  **P5.16's `AimBounds`** rather than restating them. Wind is **dissipative** — it enters through the
  drag force's relative velocity — so every solve stays on the embedded RK path the residual already
  requires. **No symplectic scheme is admissible here and none is used.**
- **CI went red after this run's second push, on a flaky wall-clock test that this run did not
  touch. Filed as P0.96; the test was NOT weakened.** `packages/solverkit/src/chunked-integration.test.ts`
  (P2.40, line 318) asserts `maxSliceMs < 10` on a `performance.now()` measurement and reported
  **12.668292 ms** on run `31506207711`; 1950 of 1951 tests passed. The evidence that it is load and
  not this run is about as clean as it gets: **`8536d49`, which contains the whole of P5.17 — every
  line of code this run wrote — was CI `success`** (run `31505994904`), and the commit that failed
  two minutes later, `5bafdff`, changes **only `CHANGELOG.md` and `ROADMAP.json`** — markdown and
  JSON, nothing under `packages/solverkit`, nothing any test reads. Text cannot slow an integrator.
  Main's own history shows the same intermittency before this run (failures at `f951754` and
  `79322ba` on 2026-08-10 between successes). **Confirmed by re-run: `rerun_failed_jobs` on the same
  run, the same commit, not one byte changed, came back `success` — so `main` is green again and
  nothing was edited to make it so.** A test that passes and fails on identical input is flaky by
  definition. Raising the constant is the wrong fix — any wall-clock
  assertion on a shared runner can lose a timeslice — so P0.96 proposes moving the timing to
  `bench:solverkit`, which already soft-warns, or asserting the deterministic half and merely
  reporting the milliseconds. The 10 ms cooperative-yield target is worth keeping as a target.
- **Branch cleanup could not be completed, and this is the record of that.** CLAUDE.md asks that no
  long-lived `claude/*` branches be left behind. This run worked on `claude/upbeat-ride-uhifsa`,
  merged it into `main` and pushed `main` (fast-forward `e84f8ab..8536d49`), deleted the local branch —
  and then found that **`git push origin --delete` fails in this sandbox every time**, with
  `fatal: the remote end hung up unexpectedly` across four attempts at 2/4/8/16 s backoff. The GitHub
  MCP server offers `create_branch` but no delete-branch tool, so there is no second route. The
  leftover ref points at the **old** `main` (`e84f8ab`) and is fully merged, so it holds nothing.
  Filed as **P0.95** with the wider finding: the remote carries **76** `claude/*` branches, **7** of
  them fully merged into `main` and therefore pure cruft. The credential these runs use appears unable
  to delete refs at all, so the policy stays unmeetable until that is fixed at the permission level —
  which is a better fix than any one run tidying up after itself.
- Filed, not fixed: **P0.94** — `pnpm format:check` fails on `CLAUDE.md` at `HEAD`, confirmed
  pre-existing by stashing this run's changes and re-running. It survives because `ci.yml` does not
  run `format:check`, so nothing enforces it between the husky pre-commit hook's staged-file pass and
  a human running it by hand. The fix is one command; the decision worth making alongside it is
  whether `format:check` joins the CI gate. **P0.93** (broken root `build` script) remains open and
  untouched; the build evidence above is CI's own `--filter @ballista/app build`.

## 2026-08-11 (17th run) — P5.16 (constraint handling: bounds on θ and v₀, penalty + projection)

- **Done: P5.16.** `packages/analysis/src/constraints.ts` exports the box-bounds vocabulary
  (`AimBounds`, `projectAim`, `aimActiveSet`, `boundsPenaltyRows`, `withBoundsPenalty`) and the
  `constrainedShooting` entry point the task's criterion — _constrained solutions respect bounds;
  active-set reported_ — is stated against. Both halves are checked **from the outside**:
  feasibility is recomputed with `aimActiveSet` from the _returned_ aim and the bounds, never read
  off a flag the solver set about itself, so a solver reporting `feasible: true` on an out-of-box
  aim would fail the test rather than pass it. **Next task is P5.17** (wind-robust aim: optimize
  expected miss under wind uncertainty). Suite **1930/1930 across 224 files** (was 1897/223 — the 33
  new tests and nothing else moved); typecheck, lint, `lint:deps` and build all green. Full
  measurements and what is _not_ done are in `ROADMAP.json`.
- **Projection is threaded into P5.06 rather than bolted on after it**, as an optional `projection`
  hook that turns the Armijo search into a search along the **projected arc** `α ↦ P(x + αΔ)`.
  Clamping only the final answer would let the iteration converge to an exterior point and then
  report its projection — an aim that is feasible and solves nothing. On the exhibit (1 kg 5 cm
  sphere, `Cd` 0.47, target 400 m downrange; unconstrained `θ = 0.6475`, `v₀ = 95.47` in 3
  iterations) a binding cap is respected **exactly** — `v₀ = 70.000000000000` against 70 m/s — with
  the active set reporting `speed:"upper"`, and the 116.76 m of miss left over is the honest answer
  that the target is out of reach at that cap. Tightening the cap raises the irreducible miss
  monotonically: **116.76 / 92.33 / 68.59 m at 70 / 75 / 80 m/s**. A non-binding 200 m/s cap
  reproduces the unconstrained aim to 9 decimals with an empty active set. The unconstrained path is
  untouched — the new stall test applies only when a projection is supplied, and a regression test
  pins the bare solve at 3 iterations.
- **The stall test had to move to the projected displacement, and the corner case is why.** With
  `thetaMax` and `speedMax` both below the unconstrained answer the Newton direction leaves the box
  in _both_ coordinates, so the trial projects back onto the current aim for every `α`, the merit
  never changes, and the Armijo condition — which asks for a strict decrease — is unsatisfiable all
  the way down. Measuring the distance actually travelled rather than the distance proposed stops it
  in **≤ 2 iterations** with `"stalled"`; without it the search spends its full 25-backtrack budget
  and reports `line-search-failed` at the exact moment it had reached a constrained stationary point.
- **The penalty measurement refuted the theory the doc was first written from, and the doc was
  corrected before the exhibit was written** — the 15th run's failure mode, caught again. The
  textbook exterior-penalty story is a violation of order `1/√w` shrinking smoothly with weight.
  Swept across ten orders the behaviour is **non-monotonic with a usable window in the middle**:
  `w = 1e0`–`1e2` grossly infeasible (**9.35 → 2.23 m/s** over the cap, and `1e2` does not converge
  at all); `w = 1e3`–`1e7` feasible, landing **~5e-11 _inside_** the bound; `w = 3e7`–`1e9`
  infeasible again (**1.9e-5 → 1.2e-6**). The plateau is not a smooth balance: the hinge is exactly
  zero inside the box, so once feasible the penalized problem is _locally identical_ to the
  unconstrained one and pushes back out, the penalty rows pull it back, and the iteration chatters
  onto the face — an inexact projection, not a trade. At the top end the `√w` rows degrade the
  Jacobian's conditioning and **more weight is less feasible**, which `1/√w` cannot express at all.
  `DEFAULT_PENALTY_WEIGHT = 1e6` is now picked from inside the measured window rather than from the
  argument, and the doc records that the window was measured on **one** problem.
- **A second doc claim was measured false and corrected: the projection makes every _iterate_
  feasible, not every _evaluation_.** `shootingJacobian`'s difference stencil is not projected and
  reaches one step past an active face — **exactly 5 of 56 evaluations, every one 4.8444e-4 m/s past
  a 70 m/s cap**, which is the speed column's difference step and nothing larger. Harmless where the
  residual is defined just outside the box, as it is here; not harmless at a bound marking the
  model's _domain_, where the stencil would evaluate an aim with no trajectory and the whole Jacobian
  would fail at an otherwise healthy iterate. **Filed as P0.92** rather than fixed mid-task.
- Scope held deliberately: no general nonlinear constraints, no working-set iteration, no Lagrange
  multipliers, no KKT test beyond what `aimActiveSet` reports. A box on two variables does not
  justify an active-set QP, and the task that has general constraints to justify one is not this.
- **The gate figures above are the CI commands, not the root `build` script, because that script does
  not work — and it did not work before this run either.** `pnpm build` exits 1 with
  `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`; only `@ballista/app` defines a `build` script. Verified
  pre-existing by running it against `origin/main`'s `package.json`, where it fails identically, so
  this is reported rather than blamed on the change. CI never calls it — `ci.yml` runs
  `pnpm --filter @ballista/app build` and `check-bundle-size`, both green here (**69.2 kB** gzipped
  against the 300 kB budget, unchanged — nothing imports `constraints.ts` yet). It matters only
  because `CLAUDE.md` names `build` in the pre-push gate every session is told to run. **Filed as
  P0.93.**

---

## 2026-08-10 (16th run) — P5.15 (min-energy targeting, minimize v₀ subject to a hit)

- **Done: P5.15.** `packages/analysis/src/min-energy.ts` exports `minimumSpeedToHit`. The task's
  substance turned out to be the formulation rather than the search: minimizing `v₀` subject to a
  hit is not a shooting solve with an extra unknown, because the hit condition is one equation in
  two unknowns — above a threshold speed **two** elevations hit (P5.08's arcs), below it none do,
  and the minimum is where they merge, which is exactly where the target sits **on** the P5.09
  envelope. So the problem reduces to solving `envelopeHeight(x*; v₀) = y*` for `v₀`, and that _is_
  the task's KKT criterion rather than a proxy for it. **Next task is P5.16** (constraint handling:
  bounds on θ and v₀, penalty + projection). Suite **1897/1897 across 223 files** (was 1871/222 —
  the 26 new tests and nothing else moved); typecheck, lint, `lint:deps`, app build and bundle
  budget (**69.2 kB** gzipped against 300 kB, unchanged — nothing imports this yet) all green.
  Full measurements and what is _not_ done are in `ROADMAP.json`.
- **The nesting the task asks for is real and reuses the phase's own ladder**: outer `brentRoot`
  (solverkit) on launch speed, inner elevation maximization via P5.09's `maxHeightAtDownrange`, with
  P5.14's `maximizeRange` supplying max range for the second margin branch, and the bracket started
  from `smart-init`'s drag-free `√(g(Δy+R))` — **a rigorous lower bound, not a guess**, since a
  dissipative model can only shrink the reachable set. Nothing was re-derived.
- **Tangency is checked three independent ways**, because stationarity alone only proves the
  root-find converged. (1) The target lies on the envelope, re-measured through the public envelope
  entry point rather than trusting the reported margin. (2) **Geometric tangency** — the optimal arc
  and the envelope have the same _slope_ where they meet; drag-free this is checked against the
  closed-form parabola slope `−g·x/v₀²`, which the implementation never computes. (3) **Minimality**
  — `assessReachability`, a separate entry point, confirms 0.999·v misses and 1.001·v hits. The
  drag-free closed form is recovered exactly over four geometries.
- **Two doc claims were written from theory, measured false, and corrected — the 15th run's failure
  mode recurring, and caught this time.** The `theta` note claimed a `√ε` resolution floor from the
  merged-arc degeneracy; that reasoning was wrong twice over (the reported θ comes from the inner
  height maximization, a better-conditioned problem) and the measured floor is **7.4e-10 rad**, far
  finer. It is also **geometry-dependent**, which one measurement hid — 7.378e-10, 9.974e-9,
  1.277e-8, 1.618e-8 across the four test rows. An intermediate draft asserted `1e-8`, the first
  row's figure generalized to three rows it had never been measured on, and **two of them failed
  it**; the bound now sits above the worst measured row. Separately, the `speedTol` doc warned
  against tightening below the inner search's noise, and measurement refuted that too: it is
  honoured across eight orders (`1e-12 → 5.2e-13`).
- **Two implementation defects found by measurement, both fixed before the exhibit was written.**
  The first version reported `"below-bracket"` for _every_ drag-free problem — there the drag-free
  bound is the answer, so the margin at it is zero-to-rounding and read as "already reachable",
  which is precisely the wrong answer in the case the module is most confident about. Fixed by
  contracting the bracket downwards for a genuine sign change instead of thresholding a
  metres-valued margin whose scale the module does not know. `arcSeparation` was also reading a
  discrete trajectory row instead of the interpolated crossing and returned `null` at every
  tangency.
- **Filed P0.91**, not fixed here: `downrangeAxisOf` now has a **fourth** private copy (`arcs.ts`,
  `envelope.ts`, `smart-init.ts`, and now `min-energy.ts`). Adding the fourth rather than
  consolidating was the deliberate call — the refactor touches three modules this task had no other
  business in. Every copy is correct today; four copies of a convention a spatial layout could
  change is the kind of thing that diverges quietly.
- **P0.90 (the root `build` script's flag placement) is still open and was still not hit by this
  run**, for the same reason the 15th run recorded: CI never calls that script. The pre-push gate
  here used `pnpm --filter @ballista/app build` and `check-bundle-size` directly, as CI does.
- **No flake seen.** The 14th run's one-in-five red at `chunked-integration.test.ts:318` did not
  reproduce; that is now four consecutive clean full runs, which remains a weak test of a
  one-in-five event and is not evidence it is gone. **The wall-clock budget there is still
  un-addressed and still a real decision** — widen it, make it a soft warn, or measure something
  other than wall clock.

---

## 2026-08-13 (15th run) — P5.14 (optimal-angle problem, argmax_θ range with drag)

- **Done: P5.14.** `packages/analysis/src/optimal-angle.ts` exports `maximizeRange` — coarse sweep to
  bracket the interior maximum, then P5.13's `brentMinimize` on the negated range, which is the
  consumer that module was written for. **Next task is P5.15** (min-energy targeting: minimize `v₀`
  subject to a hit, `θ` free, via nested Brent/shooting). Suite **1871/1871 across 222 files** (was
  1856/221 — the 15 new tests and nothing else moved); typecheck, lint, `lint:deps`, app build and
  bundle budget (**69.2 kB** gzipped against 300 kB, unchanged — nothing imports this yet) all green.
  Full measurements, the perturbation table and what is _not_ done are in `ROADMAP.json`.
- **The suite was green on three consecutive full runs**, which is recorded because the 14th run saw
  one red in five at its own HEAD and could not reproduce or identify it. Three clean runs is not
  proof the flake is gone — it was one in five, so three runs is a weak test of it — but it is the
  evidence this run has, and per the 14th run's own instruction the output was captured to a file
  rather than watched, so a red run would have named its files instead of scrolling away. None
  appeared. The `chunked-integration.test.ts:318` wall-clock budget the 14th run identified as the
  likely culprit is **still un-addressed and still a real decision** — widen it, make it a soft warn
  like the benchmark step, or measure something other than wall clock.
- **`pnpm build` is broken in this repo and was not fixed here — filed as P0.90.** `pnpm -r
--workspace-concurrency 1 run build` fails under pnpm 11.9.0 with "None of the selected packages
  has a `run` script": the space-separated flag value swallows the subcommand. It is **not masking
  anything** — CI never calls that script, it runs `pnpm --filter @ballista/app build` and
  `check-bundle-size` directly, and both pass, as does `pnpm -r run build`. Left as a task because
  this run was on P5.14. Worth noting `CLAUDE.md`'s pre-push checklist names "build", so anyone
  following it literally will hit this.
- **The first draft of the exhibit asserted numbers I had predicted rather than measured, and four
  of them were wrong.** Recorded because the failure mode is the one worth not repeating: the
  comment table said the low-Π optimum was 42.35° (it is 44.87°) and the extreme-Π one 27.44° (it is
  29.95°), and the "±5° costs under 1%" claim was false (1.51%). The fix was to measure the sweep
  first and write the table from the output. **Nothing about the physics changed — only the
  assertions, which had been aspirational.**
- **The 30–43° band in the task's criterion does not hold across the whole Π range, and the exhibit
  says so rather than trimming the sweep.** It holds over `0.5 ≲ Π ≲ 10`. Below that the optimum
  must return to 45° and does (44.86° at Π = 0.023); above Π ≈ 20 it keeps falling past 30° (29.95°).
  Both tails are their own assertions. Dropping those rows would have made the band look universal
  and the sweep look tidier while removing exactly the two points that show the limit is the correct
  one.
- **`pnpm typecheck` caught two errors `vitest` had run straight past, and one of them mattered.**
  `new ConstantAtmosphere(RHO, ETA)` — the class takes no constructor arguments and always samples
  sea-level ISA — meant the exhibit's Π column was computed from literals the drag force had never
  seen. It agreed by coincidence (`ISA.rho0` is 1.225, and η does not enter Π at all for a
  `ConstantCd`, whose value ignores Reynolds number), which is the kind of agreement that stops being
  true the moment someone switches to a `CdTable`. The constants now come from `ISA` and
  `sutherlandViscosity`. **Worth generalising: vitest's transform is not a typechecker, so a test
  that passes is not a test that compiles.**
- **One of my own tests did not discriminate, was measured as not discriminating, and was changed.**
  The "evaluates the upper bound exactly" case used `maxAngle = 0.7` with 7 samples, where the
  accumulated `0 + 6·(0.7/6)` rounds back to exactly 0.7 — so it passed whether the guard it was
  testing existed or not. Found by perturbing the guard away and seeing zero failures. It now uses
  0.9, where the two differ by an ulp, and asserts the accumulated value is _absent_ as well as the
  exact one present. Five perturbations in total, table in the test file header.
- **Next run:** P5.15, min-energy targeting. It is the first task in this phase that nests two
  solvers — an inner shooting solve for `θ` given `v₀` (P5.06's `newtonShooting`, or `solveRangeRoot`
  for the flat-ground case) inside an outer 1D minimization over `v₀` (P5.13's `brentMinimize`, the
  same pairing this run used). Two things to settle before writing it: the inner solve's tolerance
  has to be tighter than the outer one's or the outer objective is noisy and Brent's parabolic step
  will thrash — this run's `MeasuredErrorIsDiscretisation…` analogue is the check to write — and the
  objective is only defined where the target is reachable, so the unreachable region needs the
  `NO_IMPACT`/`NaN` inadmissibility convention `optimal-angle.ts` documents rather than a thrown
  error. `maximizeRange` is directly reusable for the `θ`-free upper end: the minimum `v₀` that can
  reach a range `R` is the one whose _maximum_ range is exactly `R`.

---

## 2026-08-10 (14th run) — P5.13 (golden-section / Brent 1D minimizer)

- **Done: P5.13.** `packages/analysis/src/brent-minimize.ts` exports `goldenSectionMinimize` and
  `brentMinimize` plus their shared option/result types. **Next task is P5.14** (optimal-angle
  problem: `argmax_θ` range with drag, against the 45° folklore). Full suite **1856/1856 across 221
  files** (was 1811/220 — the 45 new tests and nothing else moved); typecheck, lint, `lint:deps`,
  app build, bundle budget (**69.2 kB** gzipped against 300 kB, unchanged — nothing imports this
  yet) and both API-doc builds all green.
- **The suite is not reliably green at this HEAD, and the run that failed was not diagnosed —
  stated plainly rather than reported as a clean sweep.** `pnpm test` was run **five times**: four
  gave 1856/1856 across 221 files, and one reported **2 failed files, 1837 passed, 19 skipped, and
  zero individually failing tests** — the shape of a file-level timeout or hook error rather than a
  wrong answer. **Which two files was not captured before the output scrolled**, and four
  subsequent runs at the same HEAD could not reproduce it, so it is recorded here as unidentified
  rather than pinned on the load-sensitive chunked-integration flake the 12th and 13th runs
  logged — that remains the most likely candidate and is _not_ the same thing as evidence. The new
  module is not implicated: `brent-minimize.test.ts` was run three more times in isolation, 45/45
  each time, and its 45 tests are accounted for in every full run including the failing one.
  **Next session should capture the failing file names** (`pnpm test 2>&1 | tee`) the first time
  it sees a red run rather than immediately re-running, which is what lost the evidence here.
- **CI is green at this HEAD, and it was red at the one before — the flake, not this task.** Run
  **`31401470739`** at **`fd7e942`** is `success`, every step including the full test job. The
  previous HEAD `f951754` — the 13th run's own last commit, a docs-only change — had failed as run
  **`31364821995`**, and its log names the culprit exactly: `chunked-integration.test.ts:318`,
  **`expected 11.5173309999999 to be less than 10`**, the P2.40 cooperative-yield budget. So
  `main` arrived at this session already red on a timing assertion that nothing in P5.13 touches,
  and this push turned it green without addressing it. **That identification is the useful part of
  the undiagnosed local run above**: same suite, same shape, and the local machine failed one run
  in five where CI has now failed two of the last four. The assertion is a wall-clock budget
  compared against a fixed 10 ms on shared runners, so it will keep doing this. Worth a real
  decision — widen it, make it a soft warn like the benchmark step, or measure something other
  than wall clock — rather than another session's re-run.
- **The criterion could not be asserted flat, and splitting it is the substance of this task.**
  "Unimodal test functions to 1e-10" means two different things depending on the function, and a
  single assertion over both would have been asserting something false. On a **smooth** minimum the
  _value_ is easy — `f − f* = O(δ²)`, so the default tolerance delivers ~`1e-17` — while the
  _location_ is impossible, and on a **kink** it is exactly the other way round. Both directions
  are now tests rather than prose.
- **The location floor, and the part of it that is usually stated wrong.** A method that only
  _compares_ values cannot separate two points once `½f''δ²` drops under the rounding error
  `O(ε|f(x*)|)`, which puts its floor at **`δ ≈ √(2ε|f(x*)|/f''(x*))`**. The term that matters is
  `|f(x*)|` — **the floor scales with the minimum's value, not with `|x*|`**, which is the folklore
  version. Predicted against measured, for golden section at a tolerance 1000× tighter than the
  floor: `x·ln x` **7.75e-9 vs 5.03e-9**, `−cos x` **2.11e-8 vs 1.05e-8**, `eˣ−2x` **1.17e-8 vs
  1.25e-8**, `cosh(x−0.7)` **2.11e-8 vs 1.49e-8** — every one inside a factor of two, and none of
  them moves when the tolerance is tightened another 1000×. `−cos x` (`x* = 0`) and `cosh(x−0.7)`
  (`x* = 0.7`) floor at the _same_ place, which is the direct refutation of the `|x*|` version.
  Where the numerator vanishes the floor vanishes with it: `(x−1.3)⁴` and both kinked functions
  have `f(x*) = 0` and are located exactly or to ~1e-15.
- **`brentMinimize` beats that floor by one to three orders, and the reason is worth keeping
  straight** — "you cannot do better than √ε" is usually repeated without its caveat. The floor
  binds _comparison_. Interpolation fits three points that can sit **outside** the flat region,
  where the values still carry information, so the computed vertex is better than any comparison
  between points near the minimum: `−cos x` to **4.5e-12** against a 2.1e-8 floor. On an exactly
  quadratic objective it is the answer to the last bit from any three points — `(x−2)²+3` returns
  `x = 2` exactly in **6 evaluations**. That, more than the **9–15 evaluations against golden
  section's 43–45**, is the reason to default to it on smooth problems.
- **What a caller has to do differently on a kinked objective, since the default is wrong for it.**
  `f − f* = O(δ)` there, so a location good to the default `√ε·|x*| ≈ 4.5e-9` yields a _value_ good
  only to about the same — a hundredfold short of 1e-10. The compensation is that a kink has no
  location floor, so tightening `xTolAbsolute` actually works, which at a smooth minimum it does
  not. Tighten for kinks, don't bother for smooth ones.
- **Both live in `@ballista/analysis`, and `brentRoot` staying in `solverkit` is the intended split
  rather than an inconsistency to tidy.** Blueprint line 1153 groups golden-section with
  Nelder–Mead as the derivative-free optimizers and line 119 puts optimization in this package;
  root-finding and linear algebra stay in `solverkit`. The two Brents are also different
  algorithms sharing an author and a safeguarding idea — one contracts a _sign-change bracket_ by
  inverse quadratic interpolation, the other contracts an _interval_ by fitting a parabola for its
  stationary point — and neither is expressible in terms of the other.
- **One design decision that a "best value seen" implementation gets wrong.** Golden section picks
  its answer from the three candidates still _inside_ the final interval, not from the lowest value
  seen anywhere. At a minimum flat enough that every nearby point returns the identical double —
  `−cos x` near 0 is one — a running best latches onto whichever point reached that value first,
  and the function then returns an `x` that its own reported `bracket` excludes. Caught by the
  invariant test, not by a failing criterion.
- **Next session — P5.14, and one carried item.** `envelope.ts`'s `goldenSectionMaximum` and
  `arcs.ts`'s `locatePeakAngle` are hand-rolled contractions whose **own comments** say they should
  move onto P5.13 once it lands; both negate to minimize. That migration is deliberately _not_ in
  this run: it changes two working exhibit paths with golden-trajectory implications and P5.13's
  criterion does not cover them, so it wants its own commit and its own before/after check. Worth
  doing before P5.14 builds a third caller.

---

## 2026-08-10 (13th run) — P5.12 (Nelder–Mead)

- **Done: P5.12.** `packages/analysis/src/nelder-mead.ts` exports `nelderMead` and its option/result
  types. **Next task is P5.13** (golden-section / Brent 1D minimizer). Full suite **1811/1811 across
  220 files**; typecheck, lint, `lint:deps`, app build, bundle budget (**69.2 kB** gzipped against
  300 kB, unchanged — nothing imports this yet) and both API-doc builds all green.
- **It went in `@ballista/analysis`, not `solverkit`, and that is the blueprint's call not a
  preference.** Line 119 assigns "Optimization (shooting, Nelder–Mead, gradient)" to the analysis
  package. The pull the other way is real — `brent-root-finder.ts` and `dense-linear-solve.ts` are
  general numerics and they live in `solverkit` — so the split being drawn is root-finding-and-linear-
  algebra in `solverkit`, optimization in `analysis`. Worth knowing before P5.13 puts a _1D
  minimizer_ next to a 1D _root finder_ in a different package.
- **Rosenbrock met the criterion by 21 orders, and the point is the stronger claim than the value.**
  From the literature's `(−1.2, 1)`: `f = 2.09e-29` at `(1.000000000000004, 1.0000000000000082)`,
  277 iterations / 540 evaluations / 1 restart, against the criterion's `1e-8`. Both the value and
  the minimizer are checked against the closed form `f(1,1) = 0`, never a recorded run — `f ≤ 1e-8`
  near that valley floor still permits `|x − 1| ~ 1e-4`, so asserting only the value would be much
  weaker than it looks. Four other scattered starts and a 6-D Rosenbrock also land there.
- **"Restarts on collapse" needed a real collapse, and manufacturing one was the hard part of this
  task.** A correct Nelder–Mead does not collapse on ordinary problems: Powell's singular function
  and a 6-D Rosenbrock were both tried and neither could be made to fail — with restarts off they
  still converged to `1e-37` and `1e-29`. McKinnon (1998) constructs families that provably converge
  to a non-stationary point, and they are defined by their **initial simplex**, not by a starting
  point, which is why an `initialSimplex` option exists at all. It is API added to make a documented
  failure testable, not for convenience. On `τ=2, θ=6, φ=60` with the simplex
  `{(1,1), ((1+√33)/8, (1−√33)/8), (0,0)}`: restarts disabled gives **194 iterations that are every
  one of them inside contractions**, terminating at the origin with `f = 0` — non-stationary, since
  `∂f/∂y = 1 > 0` there — and reporting itself `converged`. With restarts it escapes in 358
  iterations / 2 restarts to `f = −0.25` at `(1.5e-9, −0.4999999975)`, the closed form `f(0,−½)`.
  **That "converged" on a wrong answer is the reason a first pass here never certifies itself.**
- **Bounds are a reparametrization, and clipping would have been the easy wrong answer.** Clipping an
  out-of-box vertex back onto the face makes the objective flat outside the box, so the simplex sees
  a plateau, stops distinguishing directions, and collapses onto the face — converging to a bound
  that is not a minimum. `tanh` two-sided and `softplus` one-sided instead, so every point the
  objective is asked about is feasible by construction; a test records all ~500 evaluated points and
  asserts it. Softplus rather than `exp` because `exp` overflows at `y ≈ 710` and distorts the scale
  a caller wrote down; it is asymptotically linear, so far from a bound the transform is nearly the
  identity.
- **A subtle consequence, handled rather than discovered later: every convergence test reads the `x`
  images, never the simplex coordinates.** Near an active bound the transform saturates — `x` stops
  moving while `y` keeps growing — so a `y`-space diameter test would never fire and the solve would
  spin to its iteration cap on a problem it had already solved.
- **Stated rather than hidden:** a minimum sitting exactly on a bound is approached asymptotically,
  not reached. In practice it arrives to double precision (the active-bound test lands on `x₀ = 0.5`
  exactly, `f = 0.25`, both closed form), but the guarantee is not there and real constraint handling
  is **P5.16**.
- **CI at this HEAD is RED, on the known P2.40 wall-clock flake and not on anything P5.12 touched.**
  Run **`31363803136`** at `79322ba`: `Test` failed with **1810/1811 passing across 220 files**, the
  sole failure being `packages/solverkit/src/chunked-integration.test.ts:318` —
  `expected 10.446028999999953 to be less than 10`. Typecheck, lint and import boundaries passed
  before it; **the six steps after it (benchmark, drift, both API-doc builds, app build, bundle
  budget) were `skipped`, so CI did not verify them at this HEAD** — all six were run locally and
  passed, but that is a local measurement and is not the same evidence.
- **Why this is not this run's regression, stated with the reasons rather than asserted.** The
  assertion is a wall-clock budget on `chunked-integration` in `@ballista/solverkit`; P5.12 adds one
  new file to `@ballista/analysis` and imports nothing into that path. The same assertion has now
  failed at **17.49, 11.80, 13.02** (12th run, three hosted attempts) and **10.45** ms — one of those
  earlier failures on a commit that changed only a markdown file. **10.45 is the closest to budget
  yet**, which is consistent with a loaded runner rather than with a step change in cost.
- **Not re-run, and not re-budgeted.** `ROADMAP.json`'s quality policy and the 12th run's entry both
  say a session that trips a performance assertion does not get to raise it, and that re-running
  until the runner cooperates is the same evasion by another route. This entry records the result
  and leaves the decision where the 12th run left it: **a human needs to choose** between raising
  the budget with a stated rationale, making the assertion robust (best-of-N or a median rather than
  a max), or moving it out of the correctness suite into the soft-warn benchmark step where a slow
  runner cannot redden `main`. **It has now blocked two consecutive runs' CI.**
- **Follow-up, same run: `main` is GREEN again and the P5.12 code is now CI-verified in full.** The
  changelog commit above (`57eb22a`) triggered run **`31364232725`**, which passed **every step** —
  including `Test`, and including the six that were `skipped` at `79322ba` (benchmark, drift, both
  API-doc builds, app build, bundle budget). **`57eb22a` differs from `79322ba` by 20 lines of this
  file and nothing else** (`git diff --stat 79322ba 57eb22a`) and contains both `nelder-mead.ts` and
  `nelder-mead.test.ts`, so this run is a full hosted verification of the P5.12 tree — the earlier
  entry's caveat about locally-only evidence is now discharged.
- **This was not a re-run, and the distinction matters.** Run `31363803136` was left failed; nothing
  was re-dispatched and no budget was touched. `31364232725` is a separate run triggered by a real
  commit that had to be made anyway. **It is evidence, not a retry.**
- **The flake is now confirmed load-sensitive rather than a step change**, which is the useful part:
  the identical assertion on the identical code measured **10.45 ms (fail)** and then passed minutes
  later on another hosted runner. Four failures now stand at **17.49 / 11.80 / 13.02 / 10.45** ms
  against a 10 ms budget, with passes interleaved. **The human decision this needs is unchanged and
  is not urgent-because-red — it is worth making because a wall-clock `max` in the correctness suite
  will keep reddening `main` at random.** Best-of-N, a median, or a move to the soft-warn benchmark
  step all remove that without weakening a real check. **The run for this very commit is not tracked
  further** — that regress has no end, and `main` being green at `57eb22a` is the fact worth having.
- **Two pre-existing issues found and deliberately not fixed here.** `CLAUDE.md` fails
  `prettier --check` on `main` — confirmed against a clean tree, so it is not from this change; it is
  invisible to CI, which runs no format gate, and would have been a drive-by. And the root
  `pnpm build` is still broken exactly as the 12th run recorded (pnpm 11.9 reads `pnpm -r run build`
  as a request for a script named `run`), so the build gate was again run as CI's own
  `pnpm --filter @ballista/app build`. Both are worth a task; neither is this one.

---

## 2026-08-09 (12th run) — P5.11 (sensitivity channels UI)

- **Done: P5.11.** `packages/ui/src/sensitivity-panel-logic.ts` + `sensitivity-panel.tsx`, wired into
  the default route's analysis drawer in `packages/app/src/app.tsx` — which until now was a
  placeholder paragraph. **Next task is P5.12** (Nelder–Mead). Full suite **1792/1792 across 219
  files**; typecheck, lint, `lint:deps`, app build, bundle budget (**69.2 kB** gzipped against 300 kB)
  and both API-doc builds all green.
- **Validation met three ways.** Read literally — the panel's `dR/dθ`, `dR/dv₀` and `dR/dC_d` match an
  independently constructed `createTangentLinearFlight` + `rangeSensitivity` to **1e-9** relative.
  Against the drag-free closed form the panel never evaluates: `dR/dθ = 2v₀²cos2θ/g` and
  `dR/dv₀ = 2v₀sin2θ/g` to **1e-8** at four elevations. Against a central difference of the whole
  solve with drag on: all three channels to **1e-6**, `dR/dC_d` included.
- **One augmented solve, not three.** All three channels ride a single tangent-linear solve. That is
  not only cheaper — it is the only way they are guaranteed mutually consistent, since a second solve
  would choose its own step sequence.
- **The `C_d` row refuses rather than lies, and there are two distinct ways to have no number.** A
  scenario with no `drag-quadratic` force wired reads the coefficient nowhere, so the variational
  solve returns an exact **0** — which reads as physics ("drag doesn't matter here") and is really an
  artefact of the force list. This is precisely the fixture trap P5.10's own tests document, surfaced
  one layer up. Separately, a `tabulated-reynolds` drag model has no scalar `C_d` to displace at all.
  Both render blank with the reason in the row's title, and a test pins each.
- **The stepper is always `dopri5`, whatever the scenario picked, and the panel says so on screen when
  they differ.** `createTangentLinearFlight` requires dense output: without an interpolant the impact
  row is the last grid point _before_ the ground crossing, so both the state and its sensitivity would
  be read off a point that is not on the event surface. Half the selectable steppers expose none — and
  those are exactly the ones a learner reaches for while studying step-size error, so honouring the
  scenario's choice would blank these readouts when they are most interesting. Tolerances and step
  budget still come from the scenario.
- **Excluded rather than approximated:** spatial models, whose aim carries an azimuth as well as an
  elevation — printing only `dR/dθ` for one would answer a different question than the row label asks.
  Degenerate aims and shots that never land come back as a `failure` string, not a throw, since this
  runs on every commit.
- **Cost, measured rather than assumed.** The synchronous augmented solve costs **0.3–2.7 ms** on six
  of the seven presets and **22 ms** on the dust grain, the deliberately stiff one. That worst case is
  one dropped frame _per commit_, not per frame, and commits are already rate-limited to one per
  animation frame. Moving it to the worker pool carries a real message-protocol surface and belongs to
  a task that says so, not to this one.
- **Two things stated rather than hidden.** `rangeSensitivity` differentiates the impact `x`
  coordinate while `observables.ts`'s `range` is `|x_imp − x₀|`; they agree for any shot launched
  downrange, which is every scenario this panel is reachable from, and would disagree for one
  travelling in −x. And the root `pnpm build` script is broken **independently of this change** —
  pnpm 11.9 reads `pnpm -r run build` as a request for a script named `run` — so the gate was run with
  CI's own `pnpm --filter @ballista/app build`, which is what `ci.yml` actually invokes. Worth a fix,
  but not a drive-by one.

---

## 2026-08-09 (11th run) — P5.10 (tangent-linear / variational integration)

- **Done: P5.10.** `packages/analysis/src/tangent-linear.ts` exports `createTangentLinearModel`,
  `createTangentLinearFlight`, `aimParameters`, `rangeSensitivity` and their types. **Next task is
  P5.11** (sensitivity channels UI). Full suite **1766/1766 across 217 files**; typecheck, lint,
  `lint:deps`, app build, bundle budget (65.6 kB gzipped against 300 kB) and both API-doc builds all
  green.
- **Validation met twice, and the second reference is the stronger one.** Against the criterion's own
  finite difference: with drag at θ = 0.7, `dR/dθ`, `dR/dv₀`, `dT/dθ` and `dT/dv₀` each agree with a
  central difference of the whole solve (rtol 1e-12) to better than **1e-6 relative**, from a raised
  launch point as well, and for a `C_d` parameter. Against a closed form the module never evaluates:
  drag-free, `dR/dθ = 2v₀²cos2θ/g` and `dR/dv₀ = 2v₀sin2θ/g` to **1e-9** relative at four elevations.
- **What the task buys, and why it is downstream of P5.05.** `shooting-jacobian.ts` documents that a
  finite difference of an _adaptive_ solve carries a noise floor set by the integration tolerance, not
  by machine epsilon, because two nearby aims are integrated on two different step sequences.
  Differentiating the ODE rather than the solver has no such floor: `dS/dt = (∂f/∂y)S + ∂f/∂μ` rides
  the same stepper and inherits its error control.
- **The event-time correction is the substance of the task, not a refinement on it.** `S(T)` is
  `∂y/∂μ` at _fixed_ time; every impact observable is `y(T(μ))` with `T` itself a function of `μ`.
  Measured: on the drag-free 45° shot the true `dR/dθ` is **0** while the uncorrected number is
  **−163 m/rad** — the correction is the entire answer there — and below the optimum the two carry
  **opposite signs**, since raising the elevation lengthens the shot but at fixed time moves the
  projectile backwards. Both are returned separately, because a fixed-time consumer wants the raw one.
- **The check that catches a sign error first** is the vertical impact sensitivity, which must be
  exactly zero: the ground pins the impact height for every `μ`, so the correction has to cancel that
  row exactly.
- **A test-fixture trap worth naming.** `dR/dC_d` at `C_d = 0` is nonzero even though the drag force
  vanishes there — `∂f/∂C_d` is the full drag acceleration per unit coefficient. The obvious fixture
  drops `QuadraticDragForce` from the model at `cd === 0`, and then displacing `C_d` moves nothing and
  the sensitivity is a **structural** zero that reads as physics. The test wires the force at zero
  coefficient instead.
- **Rejected at construction rather than mishandled:** a terminal event carrying a reset map (P4.11's
  bounce needs its own jump condition on `S`), more than one terminal event (the correction
  differentiates whichever fired, and the report does not say which), and grazing impacts, where
  `dT/dμ` is genuinely unbounded — reported with the measured tangency rather than as a large number.
- **Knowingly duplicated, not quietly.** The module keeps an allocation-free copy of the engine's
  `finiteDifferenceJacobian`, because that function documents itself as _not_ on a zero-allocation hot
  path and here it runs once per rhs evaluation. A test pins the copy against the original so the two
  cannot drift.
- **Stated rather than assumed away:** the augmented solve is not the base solve. Its controller sees
  the sensitivity channels — order 100 m/rad next to positions of order 10 m — and picks a different
  step sequence, so `flight.state` matches `createFlight` to the tolerance, not bitwise. The test
  asserts 1e-9 relative rather than equality.
- **Still open from the 10th run, untouched (no drive-by):** the root `pnpm build` script fails under
  the pinned pnpm 11.9.0 (`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`, the redundant `run`); latent because CI
  builds with `pnpm --filter @ballista/app build`, which passes and passed here.
- **Not verified this run:** Playwright e2e and the cross-engine drift measurement — no browsers in
  this environment, unchanged from previous runs.

---

## 2026-08-09 (10th run) — P5.09 (reachability envelope + distance-to-envelope)

- **Done: P5.09.** `packages/analysis/src/envelope.ts` exports `maxHeightAtDownrange`,
  `computeEnvelope` and `assessReachability`; `observables.ts` gains `heightAtDownrange` and
  `shooting-residual.ts` gains `createFlight`. **Next task is P5.10** (tangent-linear
  integration). Full suite **1741/1741 across 216 files**; typecheck, lint, `lint:deps`, app
  build, bundle budget (65.6 kB gzipped against 300 kB) and both API-doc builds all green.
- **Validation met, against a closed form this code never evaluates.** An unreachable target is
  reported with its Euclidean distance to the boundary, and four geometries — above the boundary
  mid-range, past max range on the ground, beyond-and-above, and 2 m outside — each agree with a
  brute-force minimization over the analytic **parabola of safety** to better than **1e-3
  relative**. The boundary height matches `v₀²/2g − gx²/2v₀²` to **<1e-6 relative** at five
  abscissae, max range matches `v₀²/g` (**<1e-6**) at 45° (**<1e-4 rad**), and the touching arc's
  elevation matches `atan(v₀²/gx)` to **<1e-4 rad**.
- **The independent reference is what caught the only real bug, and it is worth naming.** `x =
R_max` is reached by _exactly one_ elevation, so the feasible θ set there collapses to a point
  and no finite sweep can land in it. A target past the maximum range therefore measured its
  distance to the last abscissa the sweep happened to resolve — **42.5 m against a true 40.79 m,
  4% long** — while looking entirely plausible. Nothing but an outside reference finds that. The
  ground endpoint is `(R_max, 0)` by construction and is now used directly.
- **The other end is degenerate the opposite way.** At the launch abscissa the bound is attained
  by the vertical shot, whose path is a _segment_, not a graph over `x`; the first-crossing rule
  honestly returns the launch point, which would have made the sampled curve appear to **rise**
  from 0 to `v₀²/2g`. `computeEnvelope` samples strictly to the right of the launch point instead.
  Both ends are documented in the module rather than smoothed over.
- **Scope.** This is the 2D reachable set, not the scalar ground check: P5.08's `shortfall` is
  exactly this module's distance-to-envelope restricted to `y* = 0`. What was missing was the
  airborne target — unreachable while sitting well inside the maximum range.
- **Knowingly duplicated, not quietly.** The golden-section contraction is a near-twin of
  `arcs.ts`'s `locatePeakAngle`. Folding them together needs a general 1D minimizer, which is
  **P5.13** and unclaimed; writing it here would claim a task out of order. When P5.13 lands both
  local copies should go.
- **Limitation, stated rather than assumed away.** The distance minimization is a coarse sweep
  plus a contraction, so it is the global minimum only where squared-distance-to-boundary is
  single-basined — true for the parabola and every library scenario tried. `boundarySamples` is
  the knob if a wavier boundary appears.
- **Discovered, not fixed (no drive-by):** the root `pnpm build` script (`pnpm -r
--workspace-concurrency 1 run build`) fails under the pnpm version this repo pins itself
  (**11.9.0**) with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`, which parses `run` as the script name.
  It is latent because CI never invokes it — `ci.yml` builds with `pnpm --filter @ballista/app
build`, which passes. A future session should drop the redundant `run`.
- **Not verified this run:** Playwright e2e and the cross-engine drift measurement. No browsers
  are installed in this environment; `check:cross-engine-drift` runs but records both engines as
  `unavailable`, which would have **overwritten a real committed Chromium measurement** (drift 0)
  with a failure notice. That write was reverted and the file is unchanged.

---

## 2026-08-09 (9th run) — P5.08 (multi-solution handling: low/high arcs)

- **Done: P5.08.** `packages/analysis/src/arcs.ts` exports `solveArcs`, `locatePeakAngle` and
  their types. **Next task is P5.09** (reachability envelope with distance-to-envelope
  reporting), which owns the envelope this task only measures in passing.
- **Validation met: all 20 library entries.** 19 return two arcs, found and correctly
  labelled; the 20th (`dust-grain`) has no second arc to find and is discussed below.
  Downrange miss below **1e-6 m** on every arc of every entry. The drag-free case is checked
  against the closed form rather than against itself: the roots agree with
  `½asin(gR*/v₀²)` and its complement to π/2 to **1e-9 rad**, and the flight times with
  `2v₀sinθ/g`.
- **The labels are checked against flight time, not against θ ordering, and that is the
  whole point of the second half of the criterion.** `low.theta < high.theta` is true _by
  construction_ — the two roots come out of brackets either side of the peak — so a test
  asserting it proves only that the bracketing ran. A label swap anywhere between the
  bracket and the returned object survives that check. It does not survive "the lofted arc
  is in the air longer", which is a property of the trajectories and not of the method.
- **Most of the task was reuse, and the one part that could not be reused was the peak.**
  P5.03's `solveRangeRoots` already brackets each branch, and it takes the range function as
  a parameter precisely so an integrated range could be substituted for its drag-free closed
  form later — its own doc comment says so. What it cannot supply is the maximum-range
  elevation: its `DRAG_FREE_PEAK_ANGLE` default is π/4 = 0.785 rad, against a **measured
  0.320 for `golf-drive` and 0.212 for `density-altitude-2000m`**. A wrong peak is not a
  loss of accuracy but a structural failure — it puts both roots in one bracket and none in
  the other — so `locatePeakAngle` measures it: a 24-point sweep for a bracket, golden
  section to `1e-4` rad inside it. Golden section rather than a derivative method because
  each evaluation flies a trajectory, so a difference quotient would cost two of them and
  return the adaptive solver's step noise.
- **Two findings, both handled rather than worked around.** (1) **A boundary peak is a real
  case.** `dust-grain` — a micron particle whose Stokes relaxation is far shorter than its
  9 mm flight — has a carry that _falls_ across the whole of `[0, π/2]`: no interior peak,
  one branch, one arc. `solveRangeRoots` rejects a non-interior peak, correctly for itself,
  so `solveBranches` handles the monotone interval directly and labels the single root by
  which bound the peak sits on. (2) **The two-arc band is bounded below as well as above.**
  `density-altitude-2000m` launches from 2000 m and already carries **93.9 m of its 95.8 m
  envelope at 0°**; every target closer than that is reachable only on the lofted arc,
  because the flat one would need a depression the default bounds exclude. `low: null` there
  is the correct report, and the library harness measures each entry's band instead of
  assuming it starts at zero.
- **`maxDownrange` is a lower bound on the true envelope, not an equality**, because the
  peak is located to `peakTol` and range is quadratic there. A target within microns of the
  envelope therefore reads as _unreachable_ — the conservative direction, and pinned by a
  test rather than left to be discovered.
- **The "UI selects" half of the task's title was deliberately not built.** P5.21 is
  "Target UI: draggable target marker; solve-on-drop with arc choice", and building a picker
  here would claim it out of order. What this task owes P5.21 is two labelled, independently
  valid solutions, which is what it returns.
- **Full gate green, run locally before pushing:** `pnpm typecheck` 0 errors · `pnpm lint`
  clean · `pnpm lint:deps` clean (1251 modules, 3432 dependencies) · `pnpm test`
  **1701/1701 across 215 files** · `pnpm --filter @ballista/app build` + bundle budget
  (65.6 kB gzipped against 300 kB) both pass. Note `pnpm format:check` reports `CLAUDE.md`
  as unformatted; that is **pre-existing and untouched by this run**, and CI does not run
  that check. Filed as a backlog note rather than fixed here, on scope discipline.
- **Not measured this run:** `pnpm bench:solverkit` and `check:cross-engine-drift`, both of
  which CI runs as soft warnings only. Neither is affected by a new analysis module.
- **CI on `main` is now failing about two runs in three, on a wall-clock test this run did
  not touch. It is the most important thing for the next session to pick up.**
  `packages/solverkit/src/chunked-integration.test.ts:318` (P2.40's cooperative-yield
  budget) asserts `maxSliceMs < 10` and measured **10.0385 ms** — over by **0.4%** — on run
  `31299263980` at `1cbc741`. `rerun_failed_jobs` on that identical commit passed
  **1701/1701**. It then failed _again_ at `49a46af`, run `31299576581`, on the same line.
- **That second failure is the proof, because `49a46af` changes nothing but this file.** A
  CHANGELOG-only commit cannot regress a solverkit timing budget, so the failure is the
  runner's wall clock rather than the tree: same line, same assertion, two different commits
  one of which has no code in it. The three preceding pushes (`0418b0b`, `f6b63e7`,
  `a188d3c`) were green and the full suite passes locally, so this is a test that has become
  marginal against its own budget, not a regression introduced here.
- **The test was left exactly as it is, and should not simply be relaxed.** Raising the
  number until it stops complaining would delete the only check that P2.40's cooperative
  yield still holds. The fix is to make the _measurement_ robust — best-of-N slices, or a
  budget with headroom justified by a measured distribution rather than a round 10 — and it
  is a task of its own, not a drive-by edit inside P5.08. Flagged here on scope discipline.

---

## 2026-08-09 (8th run) — P5.07 (smart initializer: drag-free closed-form aim)

- **Done: P5.07.** `packages/analysis/src/smart-init.ts` exports `dragFreeAim`,
  `SmartInitOptions` and `smartInitialAim`. **Next task is P5.08** (low/high arc
  reporting), which owns the arc selection this task deliberately left out.
- **Validation met: 20 of 20 library targets, success rate 100%.** Each of engine's
  20 `SCENARIO_LIBRARY` entries becomes a shooting problem whose target is the impact of
  its _own_ launch aim — reachable by construction, so the measurement is of the basin and
  not of the target. `newtonShooting` converges from the closed-form init on **every one**,
  in **at most 5 iterations**: 0 for the two drag-free entries (`drag-free-reference`,
  `energy-drift-gravity-only`), where the closed form is already the answer to solver
  tolerance, and 5 for `smooth-sphere-drag-crisis` and `density-altitude-2000m`.
- **The initial miss is large, and that is the criterion working as intended.** 1040 m for
  `cannonball-muzzle`, 225 m for `smooth-sphere-drag-crisis`, 116 m for `golf-drive`. A
  drag-free guess undershoots badly in a drag-dominated regime; a _basin_ criterion asks
  whether Newton recovers, not whether the guess was close. It does, in ≤ 5.
- **The real design decision was which solution to return, not how to compute it.** The
  drag-free reachability condition for a point is one equation in two unknowns — the same
  degeneracy P5.05 measured as a rank-1 Jacobian — so a closed form must pick a point on a
  curve. This picks the **minimum-speed** one (`θ = π/4 + φ/2`, `v₀ = √(g(Δy + R))`) because
  it is the only point the geometry alone determines; every alternative needs a muzzle speed
  or an elevation supplied from outside, and choosing between the arcs that result **is
  P5.08**. No drag correction was added: it would be either a fitted constant or the Newton
  iteration this feeds.
- **A cancellation defect was found and fixed while testing, not shipped and noted.**
  `Δy + R` is a difference of nearly equal magnitudes for a target _below_ the launcher —
  a 1 m offset 400 m down gives `Δy = −400`, `R = 400.00125` — and keeps about 3 of the 16
  digits it was formed from. Since `R² − Δy² = Δx²` exactly, the `Δy < 0` branch evaluates
  the identical `Δx²/(R − Δy)`, where nothing cancels. **Measured on the test's own grid:
  relative error `4.0e-11` before, `4.2e-16` after** — the naive form was not wrong, it was
  four orders looser than its own arithmetic. The test's bound is `1e-14`, which only the
  fixed branch meets.
- **Gravity is sampled, not assumed.** From the problem's own environment at the launch
  point, into a _fresh_ `EnvSample` rather than `ctx.env` (the rhs hot-path scratch buffer,
  ADR-004; a test pins that it is left untouched). The library ships
  `density-altitude-2000m` with altitude-dependent gravity, which a hard-coded `G_STD`
  would have silently misjudged.
- **P5.06's own criterion can now be re-measured, and this run did not do it.** P5.06 says
  "≤ 8 iters from smart init" and was measured from hand-chosen aims because no initializer
  existed, so its 3 was recorded as an upper bound. The harness here shows ≤ 5 with drag and
  wind from the real initializer, inside P5.06's 8 — but against targets this task chose,
  not against P5.06's own. **Re-running P5.06's criterion with `smartInitialAim` is a
  one-session follow-up and was left out of this run on scope discipline.**
- **Full local gate green at this HEAD** (Node 22.22.2, pnpm 11.9.0): `typecheck` clean ·
  `lint` clean · `lint:deps` **no violations (1245 modules, 3406 dependencies)** ·
  `pnpm test` **1664/1664 across 214 files** (up from 1644/213) · engine and solverkit
  typedoc green · app build 29.8s · bundle **65.6 kB gzipped** against the 300 kB budget.
- **One flaky failure is reported rather than buried.** The first full-suite run failed
  `packages/solverkit/src/chunked-integration.test.ts` — "a 1e6-step run stays within a small,
  bounded wall-clock budget per slice", **11.02 ms against its 10 ms budget**. It is a
  wall-clock assertion on a shared sandbox CPU, in a package this run does not touch; it
  passed 3/3 in isolation and passed on the immediate re-run of the full suite, which is the
  1664/1664 quoted above. **Nothing was changed to make it pass** — no test was weakened,
  skipped or retried in the repo. Filing it as a backlog item (an under-load timing
  assertion in CI) would be reasonable and this run did not do so.
- **Observed, not acted on** (scope discipline — no drive-by fixes):
  - **The root `pnpm build` script still does not run**, exactly as the 7th run recorded:
    `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` under pnpm 11.9.0, the flag before `run` being eaten.
    CI does not use it (`pnpm --filter @ballista/app build`), which is what this run used.
    One flag-order edit fixes it; it is a claimable item, not a drive-by.
  - `CLAUDE.md` still fails `prettier --check`, pre-existing and untouched — the 6th and 7th
    runs recorded the same. Note for future runs: `pnpm format` **writes** and will
    reformat it as a side effect; this run reverted that hunk to keep the diff to P5.07.
  - Plotly.js is still bundled statically at **4.84 MB** (1.47 MB gzipped) in `dist/assets`.
    Lazy-loading it remains a legitimate backlog item to claim, not a drive-by change.

---

## 2026-08-09 (7th run) — P5.06 (Newton shooting with a rank-aware step)

- **Done: P5.06.** `packages/analysis/src/newton-shooting.ts` exports
  `NewtonShootingStatus`, `NewtonShootingStep`, `NewtonShootingOptions`,
  `NewtonShootingResult`, `MinimumNormStep`, `minimumNormStep` and `newtonShooting`.
  **Next task is P5.07** (drag-free closed-form smart initializer) — and it owns half of
  P5.06's own validation criterion, see the caveat below.
- **Validation met: drag + wind, 3 iterations.** Quadratic drag (`C_d` 0.47, 1 kg, 0.05 m)
  with a 6 m/s headwind, point target at `x = 236.1502 m`, started from a deliberately
  rough `θ = 0.45 rad`, `v₀ = 65 m/s`. `‖F‖` runs
  **`2.270e+1 → 4.598e-1 → 2.007e-4 → 3.860e-11 m`** at `α = 1` every step — digit-doubling,
  not linear decay. Three other starts (0.3/70, 0.45/65, 0.95/60) all land inside 8.
- **The criterion says "from smart init" and that initializer is P5.07, which does not
  exist yet.** Every solve here starts from a hand-chosen rough aim instead, which makes 3
  an _upper bound_ on what a smart init would need rather than a measurement of it. P5.07
  should re-run this criterion with the real initializer rather than inherit the number.
- **The rank-1 prediction from P5.05 was measured, and it is worse than "ill-conditioned".**
  On the real drag+wind Jacobian: downrange row `~1.996e+2`, vertical row `~2.779e-11`,
  ratio **`1.39e-13`**. Drag-free the ratio is **exactly 0** — the vertical row is not small,
  it is zero in floating point. A negative control runs that matrix through solverkit's
  `solveLinearSystemInPlace`, which **refuses it** at its `1e-12` pivot threshold: an
  unguarded Newton step here does not merely lose accuracy, it has no answer.
- **So the step is a truncated-SVD minimum-norm least-squares solve.** Singular values below
  `rankTolerance · σ_max` are discarded and the step lands in the row space of what survives.
  Chosen over the previous entry's suggested "lock `v₀` and solve `θ`" deliberately: it lets
  the matrix pick the expendable direction rather than hard-coding which unknown is, and
  keeps working if a later task adds a terminal event that does not pin the vertical
  component. Levenberg–Marquardt is **P5.26 and was not built**.
- **Two things that are decisions rather than defaults.** _Columns are scaled before the step
  is taken_, and the step norm is measured in the scaled variables — `θ ~ 1 rad` and
  `v₀ ~ 60 m/s`, so "minimum norm" in raw units resolves the rank-1 ambiguity by declining to
  move the angle, for no reason but the unit it happens to be measured in. And _the Armijo
  condition compares against the linear model's predicted reduction_ `‖F‖ − ‖F + JΔ‖`, not
  against `(1 − cα)‖F‖`. The textbook form assumes the step can remove all of `‖F‖`, which is
  false here: with an irreducible residual component it is unsatisfiable for every `α` once
  the reducible part is gone, so the line search would report failure at the exact moment the
  solver had done everything the problem allows. A raised-platform test (12 m up, ground
  impact) pins the corrected behaviour: status `stalled`, `|F_x| < 1e-6 m`, `F_y = −12 m`.
- **`rankTolerance` defaults to `1e-7` and is constrained from below, not picked.**
  `minimumNormStep` takes its singular values from the eigenvalues of the `2×2` Gram matrix
  `JᵀJ`, which squares the ratio being tested, so any threshold under `√ε ≈ 1.5e-8` asks a
  `double` to resolve a Gram eigenvalue below its own rounding. `1e-7` sits an order above
  that floor and four orders above the `1e-11`–`1e-13` deficiency it must catch. The cost is
  stated in-file: a caller needing to resolve a genuine `1e-9` singular value needs a
  Golub–Kahan SVD, not this.
- **Line search exercised on a real overshoot, not a contrived one.** Target 240 m from
  `v₀ = 25 m/s`, where quadratic drag makes range _concave_ in `v₀` so the linear model
  overpromises: `α` sequence `0.5/0.5/1/1/1/1/1`, 7 iterations, every accepted step a strict
  decrease. Found by sweeping a grid of starts rather than guessed — the first candidate
  (start near `θ = π/2`) took full steps throughout and measured nothing.
- **Full local gate green at this HEAD** (Node 22.22.2, pnpm 11.9.0): `typecheck` clean ·
  `lint` clean · `lint:deps` **no violations (1239 modules, 3380 dependencies)** ·
  `pnpm test` **1644/1644 across 213 files** (up from 1626/212) · engine and solverkit
  typedoc green · app build 46.6s · bundle **65.6 kB gzipped** against the 300 kB budget.
- **Observed, not acted on** (scope discipline — no drive-by fixes):
  - **The root `pnpm build` script does not run.** `pnpm -r --workspace-concurrency 1 run
build` fails under the pinned pnpm 11.9.0 with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT: None of
the selected packages has a "run" script` — the flag before `run` is being eaten. Every
    package does have a `build`, and `pnpm -r run build` works. CI does not use the root
    script (`.github/workflows/ci.yml` runs `pnpm --filter @ballista/app build`), which is
    how this went unnoticed; `pnpm verify` is unaffected. One flag-order edit fixes it.
  - `pnpm bench:solverkit` reports 3 soft-warn regressions (heun-rk2 16.2%, classical-rk4
    16.1%, position-verlet 15.4%, all relative to explicit-euler against a 15% threshold).
    These are ratios of micro-benchmarks on a shared sandbox CPU and the script itself says
    "soft warn only, not failing CI"; **no claim is made here that this run caused or did not
    cause them** — nothing in this run touches a stepper.
  - `CLAUDE.md` still fails `prettier --check`, pre-existing and untouched, as the 6th run
    also recorded.

---

## 2026-08-08 (6th run) — P5.05 (FD Jacobian of the shooting residual)

- **Done: P5.05.** `packages/analysis/src/shooting-jacobian.ts` exports
  `FiniteDifferenceScheme`, `DEFAULT_NOISE_FLOOR`, `AIM_COLUMNS`, `JacobianOptions`,
  `ShootingJacobian`, `finiteDifferenceStep` and `shootingJacobian`. **Next task is P5.06**
  (Newton shooting with an Armijo line search) — and read the rank note below before
  writing it, because the obvious 2×2 Newton step does not work on this problem.
- **The step size is derived from a declared noise floor, not from machine epsilon, and
  that is the whole task.** Balancing truncation `C·hᵖ` against amplified noise `ε_F/h`
  gives `h* = scale · noiseFloor^(1/(p+1))` — square root of the floor for a forward
  difference, cube root for a central one. At `ε_F = ε` a central difference wants
  `h ≈ 6e-6`; at `ε_F = 1e-6`, an inner solve at `rtol = 1e-6`, it wants `h ≈ 1e-2`.
  **Three and a half orders larger.** Keeping the machine-epsilon step while loosening
  tolerance is not conservatism, it is sitting far up the noise branch of the V.
- **Measured plateau** (drag-free, fixed step `h = 0.01`, against the exact analytic
  `∂R/∂θ = 196.396 m/rad`): relative error over FD steps `1e-10 → 1e-1` is `7.6e-5, 5.8e-6,
4.2e-7, 4.5e-8, 1.3e-8, **2.7e-10**, 6.6e-9, 6.7e-7, 6.7e-5, 6.7e-3`. A clean V —
  minimum **2.7e-10 at `h = 1e-5`**, truncation branch scaling _exactly_ as `h²` (a factor
  of 100 per decade, asserted as a ratio rather than a pinned magnitude, since `h²` is what
  makes the scheme second order), noise branch rising as `1/h` below it. Central bottoms at
  2.7e-10 against forward's 1.9e-7 — a factor of ~700, the order difference showing up as
  plateau depth. The module's default step lands inside the plateau and a test asserts it.
- **The tolerance-noise control needed a different problem, and that is the part worth
  carrying forward.** Drag-free motion is quadratic in `t` and Dormand–Prince integrates it
  **exactly**, so the embedded error estimate vanishes and every tolerance from `1e-4` to
  `1e-12` picks the identical step sequence. The first version of the test ran the negative
  control drag-free and got **byte-identical curves** for loose and tight tolerances —
  measuring nothing, while looking like a passing test. Quadratic drag makes the controller
  actually adapt.
- **Measured blowup** (drag, `C_d` 0.47, range 230.53 m, identical sweep): fixed step
  reaches **2.0e-10**, while `rtol = 1e-5` **floors at 8.5e-6** and stays flat across four
  decades of FD step, never going lower. **Ratio 4.2e4.** The floor is flat rather than
  `1/h`-rising because the loose residual is not randomly noisy but _biased_ — the
  controller makes locally identical step decisions for nearby aims, so the `rtol`-level
  bias is a smooth wrong function whose derivative is wrong by a fixed amount. Refining `h`
  recovers nothing, and the test asserts exactly that. This is the practical face of
  "tolerance-noise blowup": not a visible explosion, but a floor no step size beats.
- **The Jacobian is structurally rank 1, and P5.06 has to be built around it.** A
  ground-impact terminal event pins `y_impact` to the ground for every aim, so the vertical
  row is zero to `<1e-8` — **regardless of target height**, since a raised target only
  shifts `F_y` by a constant (pinned at 12 m). A ground-impact shot is one scalar equation
  in two unknowns, which is precisely why P5.08 speaks of low and high arcs and P5.22 of
  locking two of three quantities. **P5.06 must not hand this to an unguarded 2×2 solve**:
  it needs a rank-aware step — lock `v₀` and solve `θ`, or fall through to LM (P5.26).
- **Full local gate green at this HEAD** (Node 22.22.2, pnpm 11.9.0): `typecheck` clean ·
  `lint` clean · `lint:deps` **no violations (1233 modules, 3356 dependencies)** ·
  `pnpm test` **1626/1626 across 212 files** · app build green in 21.4s.
- **Observed, not acted on** (scope discipline — no drive-by fixes): `CLAUDE.md` fails
  `prettier --check` at this HEAD, pre-existing and untouched by this run; `format:check`
  is not a CI step, which is how it drifted. And the `analysis` package has **no
  `typedoc.json`**, so a co-located `*.derivation.md` would not be wired into the docs the
  way solverkit's are — that belongs to **P5.29** (Analysis API docs), so this task
  documented the plateau in TSDoc plus printed test measurements instead.
- **Repo-state note for whoever reads this next:** the local clone's `main` had diverged
  from `origin/main` — two unrelated root commits, 50 commits each side, remote
  force-updated. `origin/main` was verified to be a strict content superset (no file
  deleted, every P4.36 file present) before the local branch was pointed at it. **Nothing
  was force-pushed and no remote history was rewritten**; only the local pointer moved.

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
