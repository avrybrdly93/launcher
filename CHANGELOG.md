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

## 2026-09-05 (79th run) — **P0.118 fixed but NOT closed: the fix is real, the local validation is worthless, and Firefox is why**

- **`main` arrived at `a810a60`.** `git fetch` again reported a **forced update** of `origin/main`; again it was the shallow-clone artefact this file warned about. After `git fetch --unshallow`: **one** root (`6291665`), HEAD and `origin/main` **0/0**. Nothing was rewritten. The warning worked — it was read before the measurement rather than after.
- **The write path was probed first, as the settled practice here.** The claim commit went up alone before any code. It cost one push and it mattered this run in a way worth recording: the sibling `paper-trader` repo was worked first under the routine's recency rule and is **read-only**, so probing first is the only reason nothing was lost there either.
- **P0.118 was taken AHEAD of `seq` order, and the departure is stated rather than smuggled.** `policy.taskSelection` would pick **P7.03** at seq 257; P0.118 is at seq 316. The 78th run's handover named taking it as one of its two honest options and asked that a run doing so say so explicitly. Said: this defect is what makes CI a coin flip on a suite where every test passes, and Phase 7's bit-identity rewrites need a signal worth trusting.
- **A correction to the inherited handover, read from the API rather than repeated.** It says "main is red on CI". That was true of the head it measured and **false of the head this run started from**: run **312** on `a810a60` concluded **success**. The sequence is 308 success, 309 **failure**, 310 **failure**, 311 success, 312 success — **two of five red, every test passing in all five**. The accurate statement is _intermittently_ red, which is a sharper description of the defect than "red".
- **ROOT CAUSE, and it is a plain one once seen.** `renderLazyPlotlyPane` awaits the Plotly dynamic import and then calls `newPlot`, with nothing reconsulting the caller across that await. A hashchange during the import runs the mount anyway, against a container the effect has already released. With `responsive: true` that is **not** a harmless no-op: Plotly installs resize/auto-margin handlers that hold the graph div, so what is left behind is a live plot on a **detached** node with no cleanup left that can reach it. Those handlers are what later dereference a `gd` the route change dismantled — the reported `_redrawFromAutoMarginCount` read.
- **The fix is two parts because there are two interleavings, and neither part alone is sufficient.** `shouldMount` is consulted **after** the import resolves and immediately before `newPlot`, so an abandoned mount does not happen at all; `LazyPlotlyView` latches it in its own effect cleanup, **per effect run** rather than shared, or a superseded render would cancel the live one that replaced it. And a **per-container operation queue** serialises every Plotly call on one container, because a `purge` scheduled by a route change could otherwise land inside a `newPlot` already past its own await.
- **All five Plotly-bearing routes are covered by one fix, checked rather than assumed.** basin, convergence-study, convergence-trace, energy-drift and stability-explorer all mount through the single `LazyPlotlyView`. This task's instruction to "check every Plotly-bearing route, not only the one the walk happened to be on" is satisfied by there being one mount path — not by five separate fixes.
- **Teeth by mutation, sources restored from real backups after each.** Dropping the `shouldMount` guard fails **2**; checking it before the import instead of after fails **1**; removing the queue fails **1**; storing the raw queue promise instead of the swallowed handle fails **1**; never latching the flag on cleanup fails **2**; sharing one flag across effect runs fails **1**.
- **One of those mutations caught a false test, which is the reason mutation testing is done here at all.** The ordering test's first version passed **with the queue removed** — releasing `newPlot` synchronously never gave `purge` a turn to run early, so the assertion held for the wrong reason. It now flushes a macrotask before releasing, and the comment says why. A test that cannot fail is not evidence, and this one could not.
- **A dead branch was found and removed rather than left in as defensive-looking noise.** `previous.then(operation, operation)` looked like it kept a rejected predecessor from stalling the queue; it does nothing, because the _stored_ handle already normalises rejections. The mutation that should have failed passed, which is how it surfaced. The guarantee is real — it is just provided somewhere else, and the code and its comment now say where.
- **THE VALIDATION IS INCONCLUSIVE, AND THIS IS THE MOST IMPORTANT LINE IN THIS ENTRY.** Twenty consecutive full-suite runs on the fixed tree left `app-routes.e2e.test.ts` green **20 of 20**, no unhandled rejection — the criterion as written. Because twenty green runs _after_ a fix cannot distinguish "it works" from "it does not reproduce here", a pre-fix baseline was taken over the same protocol from a worktree at `0501f00`: **green 20 of 20 there too**. So the local protocol passes with the fix and without it, and **the post-fix twenty is not evidence of anything about the fix.** It is recorded that way. The commit that reported the post-fix result committed _in advance_ to this write-up if the baseline came back green.
- **Firefox is the reason, and it is decisive.** The suite targets `[chromium, firefox]`; this sandbox has **only chromium** — every local run logs `Skipping firefox: no usable browser binary`, and `playwright install firefox` fails on a blocked download. **The CI failures this task was filed from are Firefox ones**: the stack is `FFPage._onWebSocketOpened`. So all **forty** local runs, pre- and post-fix, exercised a browser on which this defect has never been observed and could not have reproduced it whatever the code said.
- **That indicts the criterion, mildly but usefully.** "Twenty consecutive full-suite runs leave `app-routes.e2e.test.ts` green" is satisfiable on any Firefox-less machine **by doing nothing**. It is not wrong, but it only means something where both targets actually launch. P0.118's notes now require a run to state which browsers its twenty covered. **Do not record a local twenty against this criterion without naming the browsers.**
- **What the evidence actually supports, stated at its real strength.** The mechanism is identified and pinned by mutation at the unit level; the end-to-end criterion is unmeasured on the browser that fails. CI is the only discriminating evidence available: `app-routes` went **red pre-fix in runs 309 and 310**, and is **green post-fix in 314, 315 and 316**. Three samples, not twenty, and no rate is claimed from them. **P0.118 stays `in-progress`.**
- **main's redness is NOT all P0.118, and this run measured that too.** `ci.yml` run **313** — this run's **docs-only** claim commit, no code — failed on **P0.123**, the 10 ms per-slice budget, at 14.427 ms. Run **316** failed the same way at 14.272 ms, with `app-routes` passing. And in the twenty post-fix local runs, **4 of 20** failed on P0.123 (12.639, 11.992, 10.423, 14.672 ms) and **none** on `app-routes`. **On this evidence P0.123 is the larger of the two causes of a red `main`**, and closing P0.118 will not by itself make CI trustworthy. Recorded under P0.123 as a rate for _this runner only_, with the point that the code under the assertion did not change between the green sixteen and the red four — further evidence it measures the runner, exactly as its filing argues. **Nothing was done to P0.123 and it is not closed.**
- **P0.124 filed, then corrected in the same run.** All five `LazyPlotlyView` call sites build a fresh figure spec every render, so the `[spec]` effect tears the pane down and remounts it whether or not the figure changed — churn that widens the very window P0.118 narrows. The filing commit claimed **three of the five already pass a stable `figureSpec`**; that was **false**, checked only afterwards. Those three assign the result to a local named `figureSpec` and pass that, which _reads_ as memoised and is recomputed every render; there is no `useMemo` in any of the five. Corrected in the task's own notes rather than quietly edited, because it changes the work: five sites, no existing site doing it right to copy, and "give the view a structural comparison" is now the stronger option.
- **Nothing was skipped, disabled, widened, filtered or serialised** to get anything green, and no existing assertion was loosened — two were updated to the new three-argument call, which is a contract change rather than a weakening.
- **Full gate** on the pushed tree: `pnpm typecheck` clean; `pnpm format:check` clean; `pnpm lint:deps` clean over **1735** modules; `pnpm build` exit 0; `pnpm lint` carries only the **one pre-existing** unused-import warning in `golden-mc-results.test.ts`, unchanged from arrival; **3622 passed / 304 files**, up from 3613 / 304 (**+9 cases**).
- **Next, in priority order.** **(1)** Finish P0.118's validation the only way that can discriminate: count `app-routes` specifically across accumulating CI runs on the fixed tree — **not** the run conclusion, which P0.123 reddens independently — or validate where Firefox launches. Do not close it on the local twenty. **(2)** Take **P0.123**. It is now the bigger source of red, its filing already names the fix (calibrate against a same-process reference loop and assert the ratio; keep the 10 ms figure as an idle-machine check), and **the 10 ms number must not be raised**. **(3)** Then **P7.03** at seq 257, still the first `todo` in `seq` order, with `stepEnsembleReference` as its bit-identity oracle and `explicit-rk-kernel.ts`'s documented per-component operation order as the thing that must not be reassociated.

## 2026-09-05 (78th run) — **P7.02 closed: Phase 7 opens with the container, so the three rewrites behind it have something to be wrong against**

- **`main` arrived at `bec781c`, the head this run starts from.** The arrival tree's gate was not taken as a separate baseline; every figure below is measured on this run's own tree.
- **The write path was probed before the work, and it is now unremarkable here.** The claim commit went up on its own as the first act in this repository. It cost one push and proved the token before any effort was spent — which is exactly what the sibling `paper-trader` repo did _not_ get this run: see the budget note at the end.
- **The task was taken by the roadmap's own rule and claimed before any code.** `policy.taskSelection`: first `in-progress`, else first `review`, else first `todo` in `seq` order. There is no `in-progress` and no `review`; the first `todo` is **P7.02** at seq 256, which is what the 77th run's handover named and which **opens Phase 7**.
- **A five-minute detour that a future run should not repeat, because it looked exactly like a disaster.** `git fetch origin main` reported a **forced update** of `origin/main`, and on the clone as it arrived, `878a940` and `bec781c` had **no merge base**, **two different root commits**, and **50 commits each** — the signature of a force-push over unrelated history. All of it was a **shallow-clone artefact**: the harness clones at depth 50, and the "roots" were the graft boundaries. After `git fetch --unshallow` there is **one** root (`6291665`), `878a940` **is** a clean ancestor of `bec781c`, and the counts are 622 and 681. **Nothing was rewritten.** Recorded because the false reading is entirely plausible-looking and does not error — it answers, and the answer is wrong. **Run `git fetch --unshallow` before any `merge-base`, root-commit or commit-count claim in this repository.**
- **What P7.02 ships is the container, and the decision worth recording is that it ships _without_ the kernel.** Phase 7's next three tasks — P7.03's SoA inner loops, P7.04's monomorphic call sites, P7.05's specialized compiled RHS — are each a rewrite of arithmetic that **must not change a single bit of the answer**. A rewrite under that constraint needs its reference to exist and be green _first_, not to be built alongside the thing it is supposed to be judging. So the layout, the gather/scatter, and an oracle land here; the fast path lands in P7.03 against them.
- **No benchmark was run by this task and no performance claim is made anywhere in it** — not in the module, not in the tests, not in `ROADMAP.json`. Phase 7 is a performance phase and this is its first task; a speedup number invented at the container stage would be a rumour that later tasks inherit as a baseline.
- **The layout, and why the transpose is the whole idea.** One `Float64Array` per batch holding `[param block | state block]`, each block row-major over replicates, so element `(i, r)` sits at `row * replicates + r`. A batch loop over replicates at a fixed channel then walks **unit stride**; the array-of-structures arrangement `Model.rhs` requires would make that same loop stride by `stateDim`. Exactly one of the two shapes can win, and SoA is the one the batch loop wants.
- **Parameters share the buffer, and their position is a safety argument rather than a convention.** A replicate _is_ a drawn parameter vector plus the trajectory it produces (`runtime/mc-job.ts`), so a batch carrying state alone is half a batch, and one allocation is one worker transfer rather than two. They come **first** because the state block is written every step while the parameter block is written once: putting the mutable half at the end means `stateBlock()` runs to the end of the allocation, so a kernel writing past its channel hits a **`Float64Array` bounds check** instead of silently corrupting a parameter that some later replicate then integrates with.
- **Parameters are opaque scalars here, which keeps §3.7 intact.** SolverKit imports nothing projectile-specific, and `ProjectileParams` is not a vector of numbers anyway — it carries function-valued fields like `dragCoefficient`. So the layout stores `paramDim` anonymous scalars and knows nothing about them; installing replicate `r`'s numbers into an `EvalContext` is the caller's job via `applyParams`. `paramDim: 0` is legal and is what a study varying only initial conditions wants. `lint:deps` clean over **1735** modules; **no layering rule was widened**.
- **`stepEnsembleReference` is labelled an oracle in its own doc comment, not a fast path.** It gathers each replicate, hands the contiguous copy to the **existing, already-validated** `stepExplicitRK`, and scatters the result back — so every floating-point operation is performed by the same kernel, in the same order, on bit-identical inputs. Bit-identity therefore holds **by construction**, and that is precisely what makes it useful: when P7.03's real SoA arithmetic disagrees with it, the disagreement is unambiguously in the new arithmetic and **not** in the container. It is asserted anyway — a structural argument that is never checked is a comment.
- **The criterion is checked on bits, not on numbers.** `toEqual` over two `Float64Array`s would accept `-0` where `+0` was expected, so the comparison reinterprets both buffers as `BigUint64Array` and compares the raw patterns. Two runs are pinned: a five-replicate batch over **40** steps against an independent per-replicate loop, and the single-replicate degenerate case, which is the one an off-by-one in a batch loop survives.
- **Three of the seventeen assertions are about failure modes a passing batch would otherwise hide.** Reordering the batch must **permute** the answers and change nothing else — what would fail if a kernel ever leaked one replicate's stage buffer into its neighbour, and the reason replicate independence is tested rather than assumed. The parameter block must be **bit-unchanged** by stepping. And a scatter must touch **only** its own replicate's column.
- **The test fixture is a _damped_ spring, deliberately.** A conservative spring is exactly where a symplectic method belongs, and this repository's standing constraint is that symplectic integration applies to conservative dynamics only — dissipative paths use standard RK. So the fixture for an RK4 batch is chosen dissipative: the regime RK4 is the right tool for.
- **Teeth by mutation, module restored from a real backup copy and re-run green after each.** Four faults injected in turn: array-of-structures indexing fails **1** — the unit-stride assertion, and _only_ that, because an internally consistent relabeling is still a correct container, which is the honest result and is recorded rather than tidied; never calling `applyParams` fails **2**; `scatterState` always writing replicate 0 fails **3**; putting the parameter block last fails **2**.
- **What was deliberately _not_ done.** No SoA inner loop (P7.03), no rhs specialization (P7.04/P7.05), no pooled buffers (P7.06), and **nothing in `runtime/mc-job.ts` was rewired** to use the layout. Widening this task into P7.03 would have meant landing the container and the arithmetic that depends on it in one step, with no green reference in between — which is the one thing the ordering exists to prevent.
- **Full gate**: `pnpm typecheck` clean; `pnpm lint:deps` clean (1735 modules); `pnpm build` exit 0; `pnpm format:check` clean; `pnpm lint` carries only the **one pre-existing** unused-import warning in `golden-mc-results.test.ts`, unchanged from arrival; **3613 passed / 304 files**, up from 3596 / 303 (+17 cases, +1 file). No test skipped, disabled or weakened; no existing assertion touched; no golden moved.
- **Both known flakes stayed green _locally_, across two full suites, and that is all that claim covers.** P0.118's Playwright rejection and P0.123's 10 ms per-slice budget were silent on both local runs. **Nothing was done to either task and neither is closed.** Two local runs are two samples; the filings stand exactly as written.
- **On CI, P0.118 fired — and it fired in the second manifestation its own filing already describes, right down to the test name.** `ci.yml` run **309** on `e7e2c6c` (the code commit) reported **3613 passed / 304 files — every test green — and still exited 1**, on an _unhandled rejection_ rather than a failed assertion: `Error: Assertion error` thrown inside `playwright-core` at `FFPage._onWebSocketOpened`, attributed by vitest to `packages/app/src/app-routes.e2e.test.ts`, latest test `#/inverse-solver's back link returns to the simulator`. P0.118's notes record exactly that stack, that file and that same test name from CI run 302 attempt 2 on 2026-09-04. **This is a recurrence of a filed defect, not a new one, so nothing was filed and nothing was touched** — no test skipped, no assertion widened, no message filtered, no re-run spent. Whether this run's change made it _more likely to fire_ is a separate question and is treated as open two bullets below.
- **Run 310 failed the same way, and `main` is therefore RED on CI at the end of this run.** `ci.yml` run **310** on `db46312` (the close-out commit) also reported **3613 passed / 304 files** and exited 1 on the **identical** `FFPage._onWebSocketOpened` rejection, same file, same test name. So the score is: run **308** (`44bad4c`, `ROADMAP.json` only) **success**; runs **309** and **310** **failure**, every test passing in both.
- **A correction, recorded because this file was briefly wrong about it.** An earlier version of this entry stated that run 310 concluded `success` and drew a "red then green on consecutive pushes" conclusion from it. **That was false.** It came from a polling script that reported a terminal status the GitHub API had not actually settled on; the run's real conclusion, read back from the API and confirmed against the job log, is `failure`. The wrong claim was committed and pushed before it was caught. It is corrected here rather than quietly overwritten, because a changelog that silently repairs its own errors is exactly as untrustworthy as one that makes them. **Read a run's conclusion from the API after `status == "completed"`, and confirm it against the job log before writing it down.**
- **Whether this run's change made P0.118 more likely is genuinely open, and is not being waved away.** Against: P7.02 adds a **pure-numeric** module to `@ballista/solverkit`, which sits below `app` in the layering `lint:deps` enforces, has no browser surface, and is imported by nothing but the package barrel — it cannot reach the Plotly/Playwright teardown path that throws. The signature also predates it, by P0.118's own notes, from CI run 302 attempt 2 on 2026-09-04. **For**: P0.118 is explicitly **load-dependent** — its filing records the walk passing in isolation and failing inside the full parallel suite — and this change adds **one test file and 17 cases** to that suite. A change that adds load can raise the probability an existing race fires **without being a defect in the change**, and that is a real possibility here, not a hypothetical. Three CI samples (one green on a ROADMAP-only commit, two red with the code) cannot separate those, and **no rate is claimed from three runs.** What is certain either way: every one of the 3613 tests passed in all three, and nothing was skipped, widened, filtered or serialised to make that so.
- **Budget note, recorded because it is a cross-repo fact this repository's own practice bears on.** This run's copy of the routine prompt orders repositories by state-file recency, which put **`paper-trader` first**. That repo's write path was **not** probed first, and **nine green commits are stranded behind its 403** — the `F6` check-gate task plus the `.gitignore` and `.env.example` its own backlog recorded as done while both were absent. That is the sixth time the routine has lost work that way. **This repository's claim-commit-first practice is the fix and it worked here; it needs to travel.**
- **Next, and read this before P7.03: `main` is red on CI and the next run should decide what to do about it.** Every test passes; the redness is entirely P0.118's unhandled rejection. The honest options are (a) take **P0.118** itself — it is a `todo`, it is now the thing standing between this repository and a usable CI signal, and its filing already names the likely fix (purge/cancel Plotly on unmount, guarding pending relayouts against a detached node); or (b) run the load experiment recorded in P0.118's notes to settle whether P7.02's extra test file raised the firing rate. **Neither option is "push again and hope."** Taking P0.118 would be a departure from strict `seq` order, which `policy.taskSelection` does not provide for — so if a run takes it, say so explicitly rather than quietly reordering.
- **Then**: **P7.03** — "Batched RK4 kernel over ensembles (structure-of-arrays inner loops)" at seq 257 — is the first `todo` in `seq` order and is unblocked, with `stepEnsembleReference` as the oracle it must match bit-for-bit. Two things to read first. **(1)** Bit-identity stops being structural there: reassociating the stage sum across replicates is exactly what changes rounding, and `explicit-rk-kernel.ts`'s doc comment already spells out the per-component operation order that must be preserved (`y[i] + h * (b1*k1[i] + b2*k2[i])`, **not** `(y[i] + h*b1*k1[i]) + h*b2*k2[i]`). **(2)** P0.123 proposes calibrating a timing budget against a same-process reference loop rather than a wall-clock constant — Phase 7 is where that filing starts to matter, so read it before writing any new timing assertion.

## 2026-09-05 (77th run) — **P6.30 closed: the when-to-use table is a data module, because a prose one cannot fail**

- **`main` arrived at `6679958`, the head this run actually starts from.** Local gate on that tree before any change was not taken as a separate baseline pass; the arrival state is instead the previous entry's, and every figure below is measured on this run's own tree.
- **The write path was probed before the work, as the first act in this repository.** The claim commit was pushed on its own. That is now the settled practice here and it earned its keep an hour earlier in the sibling `paper-trader` repo, whose 403 stranded exactly **one** commit this run instead of the 5, 7, 7, 12 and 11 that five previous sessions lost by doing the work first.
- **The task was taken by the roadmap's own rule and claimed before any code.** `policy.taskSelection`: first `in-progress`, else first `review`, else first `todo` in `seq` order. There is no `in-progress` and no `review`; the first `todo` is **P6.30** at seq 254, which is also what the 76th run's handover named. Marked `in-progress` and committed before a line was written.
- **The scope came from the gap, not the one-line title.** Phase 6 built five ways to answer a question about an uncertain shot — P6.03 plain MC, P6.13 control variates, P6.14 Latin hypercube, P6.15 scrambled Sobol', P6.23 importance sampling. Every one carries a long, careful module header, and **none of them answers the question a reader at the dashboard actually has**, which is _which of these do I want_. That question is comparative, so it cannot be answered from inside any single module — each header is written by someone who has already decided to use it.
- **The table is a data module rather than prose in the ADR, and that is the whole decision.** A Markdown table in a document is one source of truth for exactly as long as nobody changes anything: rename `sobolReplicates`, move `control-variate.ts`, re-record a measurement, and the table keeps rendering, keeps looking authoritative, and is wrong. **Nothing fails.** That is the same defect ADR-016 and ADR-017 each describe in a different setting — a wrong answer arriving with every outward sign of a right one — and this repository's standing answer to that shape is to make the claim executable. So the rows live in `packages/analysis/src/estimator-glossary.ts` and both the ADR and the dashboard derive from them.
- **Placement was a layering question decided before any code.** `analysis` is the lowest layer that can see both the samplers (`engine`: `latin-hypercube.ts`, `sobol.ts`) and the estimators (`analysis`: `control-variate.ts`, `importance-sampling.ts`). Putting it there lets `viz`, `ui` and `app` all read it without any of them reaching past their layer, and **widened no rule to accommodate a document**. `lint:deps` clean over 1729 modules.
- **Every assertion checks a row against the repository, never against itself.** `estimator-glossary.test.ts` requires each row's module to exist, its named entry point to be **genuinely exported as an `export` declaration** rather than merely mentioned in a comment (which a bare `toContain` would have accepted), the credited validation test to exist, and **every measured figure quoted to appear verbatim in that test**. A second assertion requires the same figures in the row's own prose — without it the figure list could drift away from the sentence it is supposed to be guarding and every check would still pass.
- **Two further assertions are about what a row is allowed to say.** Each must carry a **precondition and a failure mode**, because a row that says when to reach for a method and never when not to is an advertisement; and **no two rows may carry identical guidance**, because the table's content _is_ the contrast between rows. Three of the five entries exist mainly to record where a method stops working.
- **The sharpest thing the table says is about the page it sits on.** The dashboard's hit probability is an **indicator function** — a discontinuity, unbounded Hardy–Krause variation — so QMC, the row with the best rate, is the wrong tool for it; while the range mean in the section directly above is exactly the smooth, near-additive observable a Latin hypercube integrates almost exactly. **Two adjacent numbers on one page want different estimators.** That is the argument for putting the table in front of the reader rather than in a document nobody opens.
- **The measured figures are quotations with attribution, not fresh measurements.** Each is the value its own validation test recorded on the specific problem that test constructs: MC/QMC slopes of `-0.65`…`-0.35` against `-0.85` or steeper (`sobol-convergence.test.ts`); LHS SE `6.037` m against `0.410` m, ratio `0.068`, **and `1.10` — no improvement at all — on a purely interactive observable** (`latin-hypercube-variance-reduction.test.ts`); CV variance ratio `0.00115` from mean ρ `0.99952`, **and `0.994` on a deliberately poor control** (`control-variate-variance-reduction.test.ts`); IS at `p = 1.59109e-4` needing `6.28e5` brute-force draws for 10% relative error at a merely `3.6-sigma` event (`importance-sampling-variance-reduction.test.ts`). **No benchmark was run by this task and none is claimed.**
- **Teeth by mutation, not by assertion.** Five faults injected in turn, tree restored from a real backup copy and re-run green after each: unmounting the panel from the dashboard fails **3**; dropping the _do-not-when_ half from the panel fails **2**; a row citing a module that does not exist fails **2**; a row quoting a figure its measuring test does not contain fails **1**; a row naming an entry point the module does not export fails **1**.
- **The guard caught the ADR twice while the ADR was being written, and both times the document was fixed rather than the test.** First the ADR named each method without citing its implementing module; then the QMC row's full name did not appear in it. Recorded because a guard that only ever passes is not evidence of anything.
- **Two omissions were caught by the repository's own existing guards rather than by me, and both were fixed in the docs.** `analysis-docs.test.ts` requires an API-map section in `docs/analysis/README.md` for every module the package re-exports — the new module had none. Its sibling assertion then rejected the first phrasing of a table cell for containing a bare `undefined`, which that check exists to catch as an un-interpolated template artefact. Neither guard was touched.
- **What was deliberately _not_ done.** No sampler is wired into the dashboard. P6.30 is a documentation task, and a selector carries its own reproducibility question — **LHS needs `N` before it can draw at all**, since the design is a joint construction over all `N` replicates, and the dashboard's cancel-and-resize flow does not currently guarantee that. Recorded in the ADR's Consequences rather than smuggled in under a docs task. Antithetic variates are likewise mentioned in prose but are **not** a sixth row: they are not an alternative to the five, they pair draws inside whichever scheme is already in use, and the suite asserts the table has exactly five.
- **Full gate**: `pnpm typecheck` clean; `pnpm lint:deps` clean; `pnpm build` exit 0; `pnpm lint` carries only the **one pre-existing** unused-import warning in `golden-mc-results.test.ts`, unchanged from arrival; **3596 passed / 303 files**, up from 3556 / 301 (+40 cases, +2 files). No test skipped, disabled or weakened; no existing assertion touched; no golden moved.
- **Both known flakes stayed green across two full local runs, and that is reported as an observation rather than as a fix.** The 76th run recorded that with two independent contention-sensitive assertions "a green CI run on this suite is close to a coin flip", and this run's two full local suites were **3596/3596 both times** — P0.118's Playwright rejection and P0.123's 10 ms per-slice budget both silent. **Nothing was done to either task and neither is closed.** Local is not CI, two samples are not a rate, and this machine's contention is not the runner's; the filings stand exactly as written. It is recorded only so a future run reading "close to a coin flip" knows the sample it came from is small.
- **And CI went green on both of this run's pushes, which bears on the previous entry's strongest claim.** `ci.yml` run **305** on `28288fa` (the claim commit) and run **306** on `a4518d0` (the code) both concluded **`success`**, first attempt, no re-run. The 76th entry concluded that "with two independent contention-sensitive failure modes, this suite cannot reliably go green on CI at all today" and that _is `main` green?_ had stopped being a usable signal. **Two consecutive first-attempt greens on CI, plus two green full local suites, is evidence against the strong form of that** — but it is four samples, taken on one day, and **it refutes nothing**: an intermittent failure that does not fire is exactly what an intermittent failure looks like most of the time. **P0.118 and P0.123 stay open, unmodified, and neither was touched.** The 10 ms budget was not raised, no test was serialised, no assertion was widened, and no re-run was spent. Recorded so a future session reading "close to a coin flip" weighs it against this run rather than inheriting it.
- **Next**: **Phase 6 is complete.** Every task from seq 233 to 254 is `done`, and the first `todo` in `seq` order is now **P7.02** (SoA ensemble state layout: `Float64Array` blocks `[param | state]` per replicate) at seq 256, which opens **Phase 7**. Note before starting it that P0.123 proposes calibrating the chunked-integration timing budget against a same-process reference loop and asserting the _ratio_ — Phase 7 is a performance phase whose tasks will be measured by exactly the sort of wall-clock assertion that filing is about, so read P0.123 before writing a new one.

## 2026-09-04 (76th run) — **P6.29 closed: the uncertainty lab asks three different questions of one column of numbers**

- **`main` arrived GREEN, read at the head this run actually starts from** (`57f67f5`). Local gate on that tree before any change: typecheck, lint (one pre-existing warning), `lint:deps`, and **3502 tests / 299 files**, all passing. **P0.118 did not reproduce this run** — the previous entry recorded it red under full-suite contention and this run's arrival baseline was 3502/3502. Recorded as an observation, not as a fix; nothing was done to it and its load-dependent filing stands.
- **The write path was probed before the work, not after it.** The claim commit was pushed on its own as the first act in this repository. That is the practice the sibling `telehealth` repo's status file has been asking for across five sessions of stranded commits, and this run had already earned the lesson the hard way an hour earlier — see the budget note at the end.
- **The task was taken by the roadmap's own rule and claimed before any code.** `policy.taskSelection`: first `in-progress`, else first `review`, else first `todo` in `seq` order. There is no `in-progress` and no `review`; the first `todo` is **P6.29** at seq 253. Marked `in-progress` and committed before a line was written.
- **The scope came from the P5.28 precedent, not the one-line title.** `inverse-exercises.ts` established that a guided exercise carries both a _stored_ key and a `recompute()` deriving it from the real solvers, with the test asserting they agree — because a key that is merely pinned records whatever the code said on the day it was written, including whatever it got wrong. Every study here does the same.
- **Three estimators, not one estimator three times, and a test asserts that rather than trusting it.** All three studies read the same kind of output — a column of 96 ranges — and the whole lab is the observation that three questions about that one column have three different answers, none a substitute for the others. Study 1 is a **sample standard deviation** (`mc-stats`), study 2 a **Student-`t` interval for the mean** (`confidence-interval`), study 3 a **Wilson score interval for a proportion** (`hit-probability`). The suite asserts the three name different methods, ask for different quantities, and that **no study's answer grades correct against another study's key** — which is what would happen if the lab were teaching one thing under three titles.
- **Studies 1 and 2 share a dataset on purpose**, and that is a design decision rather than an economy. Their contrast is the most useful thing in the lab: σ̂ describes the world and does not shrink when you buy more replicates, while the half-width on the mean describes your own ignorance and falls as `1/√N`. Reading the first as the second is the standard error in this subject, and putting both questions on one dataset is what makes the difference visible instead of asserted. Study 3 moves to the Magnus study because a proportion is a different animal again — asymmetric, and bounded at 0 and 1.
- **The reference solutions are P6.28's pinned goldens, which is what its handover asked for.** A guided study whose checker has no pinned reference is grading itself. Because those studies are bit-pinned and seeded, every answer here is a deterministic function of a fixture `golden-mc-results.test.ts` already guards, so **a key going stale is a test failure there before it is ever a wrong grade**. The third golden, `raised-release-mass-lognormal`, is not the subject of an exercise; it is cited as measured evidence inside study 1's insight, and that citation is asserted rather than trusted.
- **Study 1 is checkable against algebra that owes nothing to this codebase.** A drag-free ground-to-ground shot has `R = 2·vx₀·vy₀/g` exactly, so for independent normal components the population variance follows from `Var(XY) = μx²σy² + μy²σx² + σx²σy²` scaled by `(2/g)²`: **exactly 12.2636 m**. The 96-replicate estimate is **11.2993 m — 7.9% low, about one standard error of an SD estimate at this n** (σ/√(2(n−1)) ≈ 0.89 m). That gap is not a defect to be tuned away; it _is_ study 1's lesson, and study 2 is about how to state it. A **negative control** requires a drag-bearing study to violate the same closed form, so the check cannot pass as an artefact of how observables are computed.
- **Every tolerance was made to discriminate the mistake it names, and that is asserted rather than eyeballed.** Study 1's 0.05 m rejects the n-divisor standard deviation, which sits 0.059 m away — the Bessel correction is the lesson, so the tolerance has to be able to see it. Study 2's 0.02 m rejects the z-instead-of-t half-width at 0.029 m away; that substitution is the entire point of the study, and **a tolerance that accepted it would grade nothing**. Study 3's 0.05 percentage points rejects the Wald lower bound (2.80), p̂ (8.33) and the Wilson centre (9.94) against an answer of 4.28. A further case asserts all three still accept an answer worked by hand to four significant figures, so the tightness grades the estimator and not the learner's arithmetic.
- **The prose is checked.** Every number quoted in a study's insight — the exact 12.2636, the 11.2993 estimate, the 7.9% shortfall, the 0.89 m standard error, `t₉₅` = 1.9853, the 2.2603 z-answer, the 8-of-96 count, the Wald and Wilson figures, and the third golden's 0.032% relative spread — is asserted against what the pipeline actually produces. Guidance that quietly drifts into claiming something the code does not do is the failure mode a lab like this invites, and the only defence is to test the sentences.
- **The grading core was extracted first, in its own commit, because two copies of it would drift.** `exercise-grading.ts` (14 tests) now owns the comparison P5.28 had worked out: inclusive at the stated boundary, bought with a few ulps of slack because `solution + tolerance` is a rounded double whose distance back from `solution` is _not_ `tolerance` — a naive `error <= tolerance` grades the published boundary as a miss. One test asserts the keys grade correct exactly on the boundary and **a second asserts at least one of those boundaries really does overshoot**, so the first cannot pass for the wrong reason; a third rejects a submission 100× the slack past the boundary, proving the slack is a representation correction and not a widened tolerance. `inverse-exercises.ts` delegates, its public API untouched, **its 42 tests passing unchanged** — which is the evidence the behaviour did not move. Each lab keeps its own wording: "check the branch you solved on" is advice about root-finding and means nothing to someone estimating a proportion.
- **Teeth by mutation, not by assertion.** Six faults injected in turn, tree restored and re-run green after each: study 1's key set to the n-divisor value fails 3; study 2's tolerance loosened to accept z fails 1; study 3 pointed at the drag-free study fails 4; its threshold moved 265 → 262 fails 3; study 2 given study 1's method string fails 1; insight prose quoting numbers the pipeline does not produce fails 1. **The first attempt at this probe was itself wrong and is recorded rather than quietly redone** — the restore step used `git checkout` on a file git did not yet track, so the mutations accumulated silently and every "result" after the first was measured on a compounded tree. Redone against a real backup copy. A restore that fails without erroring makes every subsequent measurement plausible and wrong, which is the same shape of trap as this repo's shallow-clone rule.
- **Full gate**: typecheck, `lint:deps` clean; `pnpm build` exit 0; lint carries only the **one pre-existing** unused-import warning in `golden-mc-results.test.ts`, unchanged from arrival; **3556 passed / 301 files**, up from 3502 / 299 (+54 cases, +2 files). No test skipped, disabled or weakened; no existing assertion touched; no golden moved.
- **One correction made during the work, recorded because it is the kind that hides.** A hand-computed Wald lower bound of 2.8052 was written into a test before the pipeline was asked; the real value is 2.804575. The _test constant_ was wrong, not the code, and it was fixed by taking the computed value rather than by loosening the comparison. The study's insight quotes "2.81%", which rounds correctly from either, so nothing downstream was affected — but a looser tolerance would have buried the discrepancy instead of surfacing it.
- **No UI.** P6.29 is exercise _content_ and ships as a library module exported from `@ballista/runtime`. Wiring it into a route is not in this task's scope and was not done.
- **CI on `main` is RED at this run's head, on two pre-existing load-dependent flakes rather than on this change, and P0.123 is filed for the one that had no filing.** Run **302** attempt 1 failed on `chunked-integration.test.ts`'s **10 ms per-slice wall-clock budget** at **16.9 ms**. Attempt 2, at the identical head, reported **all 3556 tests passed across 301 files** and still exited 1 — on an _unhandled Playwright rejection_ out of `app-routes.e2e.test.ts` (`Assertion error` at `FFPage._onWebSocketOpened`), which is **P0.118's file in a manifestation its own filing does not describe**. Both observations are recorded on their tasks.
- **The timing failure was diagnosed rather than re-run away, and the evidence is structural.** `@ballista/solverkit` sits _below_ `runtime` in the layering `.dependency-cruiser.cjs` enforces, so it cannot import this run's new modules; running that file **in isolation** loads only solverkit and engine, and **it failed there anyway** — on a code path from which this diff is structurally absent. Then the same bytes passed on the re-run, so the input that changed is the machine. Characterised before filing: **12 consecutive isolated runs on an idle machine, 0 failures**; the one isolated local failure came while a background job held a core; **4 local full-suite runs, 3 green**. **The 10 ms was not touched** — it is P2.40's own literal blueprint criterion, and raising it would discard the budget rather than measure it. P0.123 proposes calibrating against a same-process reference loop and asserting the _ratio_, so a genuinely slower integrator still fails while a busy scheduler does not.
- **The honest half of that, stated rather than buried**: "not caused by" and "did not make it likelier" are different claims and only the first is established here. This run adds 54 cases and two files to the parallel suite, including studies that push 96 replicates through the integrator, so it plausibly raises the contention both assertions are sensitive to — the same caveat the 75th run recorded about P0.118. **Two independent contention-sensitive assertions now make a green CI run on this suite close to a coin flip**, which is why P0.123 argues for a policy covering both rather than a patch to one.
- **One re-run, and only one.** The repo's own rule is that a flake is not a root cause and a re-run may only confirm a failure the diff cannot reach. That budget is spent; a third attempt was not launched and the red run is reported as red.
- **And then run 303 settled it beyond argument.** That commit changed **only `ROADMAP.json` and `CHANGELOG.md`** — not one line of source, not one test — and CI failed on **both** flakes at once: the timing budget at **11.363924** _and_ the `app-routes.e2e.test.ts` Playwright rejection. Three attempts at effectively identical source, three different outcomes: 302/1 timing red; 302/2 all 3556 green with the Playwright rejection; 303/1 both. **Nothing in the diff can explain a difference because there is no diff in the code.** So causation is settled — neither flake is P6.29's — and the stakes of the filing rise with it: **with two independent contention-sensitive failure modes, this suite cannot reliably go green on CI at all today**, and "is `main` green?" has stopped being a usable signal until one or both are fixed. That is the priority argument for P0.123 and P0.118, not background noise.
- **This entry is where the run stops chasing it.** Documenting a red CI in a commit produces another CI run that will also probably be red, and a session that keeps writing that down never terminates. The evidence is recorded, both tasks carry it, and no further attempt was made.
- **Next**: the first `todo` in `seq` order is now **P6.30** (ADR-019: estimator glossary + when-to-use table for MC/LHS/QMC/CV/IS), whose validation is "merged; linked from dashboard help". It is the natural closing task for Phase 6 and it now has a concrete consumer to point at — the three studies above are exactly the "when to use which" question in worked form, so write the ADR against them rather than in the abstract. After that Phase 6 is complete and **P7.02** (SoA ensemble state layout) opens Phase 7.

## 2026-09-04 (75th run) — **P6.28 closed: MC goldens pinned for three studies, and the drag-free one is checkable against algebra**

- **`main` arrived GREEN, read at the head this run actually starts from** (`2a70e99`) rather than from the run the previous entry cites. Local gate on that tree before any change: typecheck, lint, lint:deps and **3480 tests / 298 files**, all clean.
- **The task was taken by the roadmap's own rule and claimed before any code.** `policy.taskSelection`: first `in-progress`, else first `review`, else first `todo` in `seq` order. There is no `in-progress` and no `review`; the first `todo` is **P6.28** at seq 252. Marked `in-progress` and committed before a line was written.
- **The scope came from blueprint §8.4, not the one-line title**, which says only "golden MC results pinned for 3 studies". §8.4 requires a stored hash _and_ the recorded result, **bit-exact comparison on the same platform**, a documented 1e-13 cross-platform tolerance, and movement only via an explicit `--update-goldens` re-record whose commit says why the numbers moved.
- **This is not P6.27 again, and the difference is the whole reason the task exists.** `mc-study-reproducibility.test.ts` compares a run against _another run of itself_ — twice in a process, across pool sizes, across chunk arrival orders. That catches nondeterminism and is **structurally blind to a change that moves every replicate identically**, because it recomputes both sides. A recorded fixture is the only form in which an _intended_ numerical change becomes a diff a human has to narrate. P6.27's own header deferred the pinned constant here; neither subsumes the other.
- **The three studies are different questions, and a test asserts that rather than trusting it** (distinct seeds, distinct hashes, distinct force sets, one parameter overlay, one non-normal family). `drag-free-velocity-spread`: gravity alone from ground level. `magnus-drive-velocity-spread`: gravity + quadratic drag + Magnus, the longest right-hand side in the preset library. `raised-release-mass-lognormal`: draws **`projectile.mass`** rather than an initial condition — a different path through the replicate generator — from a **lognormal**, released above the ground. Three recordings of one study would have satisfied "3 studies" on a count and covered one code path.
- **Bit-exact, not within tolerance, and the constant that exists is deliberately not used.** Every field is compared with `Object.is` and the drift must be **exactly `0`**. `MC_STATS_CROSS_PLATFORM_REL_TOL` is the cross-engine budget and its own doc comment says a same-platform check must never reach for it; loosening this would let a real reduction-order regression pass as rounding. The store carries **no per-case tolerances** because there is nothing to widen — the recorded quantity is a deterministic function of a fixed seed.
- **Both the hash and the full statistics are recorded**, which §8.4 asks for and which earns its file size: a hash alone says _something_ moved and cannot say what, since every field folds into the same 16 hex characters. With the statistics stored the diff names the observable and the field.
- **The store is not self-referential, which is the failure mode a fixture invites.** A recorded file only ever proves today's answer equals the day it was recorded. The drag-free study additionally satisfies exact identities among **its own recorded observables** — `apex = g·T²/8` and `|v_impact| = hypot(R/T, g·T/2)` for a gravity-only ground-to-ground flight — so a regression baked in _at record time_ cannot hide behind a matching hash. **Measured** worst relative residual over its 96 replicates: **2.1e-15** for the apex and **7.9e-16** for the impact speed; the assertion allows 1e-12. A **negative control** requires the drag-bearing study to _violate_ the same identity, so the check cannot pass by being an artefact of how observables are computed.
- **Teeth were established by mutation, not asserted.** Five faults injected in turn, each caught by exactly the cases meant to catch it, the tree restored and re-run green after every probe: a corrupted recorded hash fails 1; **one recorded statistic perturbed by a single ULP fails 2** — the bit-exact case and the drift case, which is what proves the drift check resolves to the ULP rather than to the 1e-13 budget; a changed study seed fails 3; the drag-free case pointed at a drag-bearing preset fails 3, all inside the analytic block; all three cases collapsed onto one seed fails 7.
- **Placement was decided before any code and is a layering question, not a filing preference.** `@ballista/validation` holds the other two golden stores, but `.dependency-cruiser.cjs` lets it import `engine`, `solverkit` and `analysis` only — and the MC job lives in `@ballista/runtime`. The store went where its subject already is rather than widening a layering rule to accommodate a test. `lint:deps` passes.
- **`pnpm run update-goldens` now drives this fixture alongside the other two**, so the newest golden is not the one that has to be regenerated by hand — which is precisely what §8.4's re-record rule exists to prevent.
- **Full gate**: typecheck, lint, lint:deps clean; `pnpm build` exit 0; **3501 passed / 1 failed of 3502** (+22 cases, +1 file, from 3480 / 298). No test was skipped, disabled or weakened; no existing assertion was touched; no golden moved.
- **The one failure is P0.118, pre-existing and already filed, and it was not worked around.** `app-routes.e2e.test.ts`'s hashchange walk failed with three page errors reading `Cannot read properties of undefined (reading '_redrawFromAutoMarginCount')` — **P0.118's documented signature, exactly**. Its filing calls it load-dependent, and this run reproduces that: **2809 ms and red inside the full parallel suite, 875 ms and 48/48 green in isolation.** It is **not caused by this change**, which adds a pure-numeric module in `@ballista/runtime` with no browser surface that nothing in `app`/`ui`/`viz` imports. But this change **does** add three 96-replicate studies to the parallel suite, so it plausibly raises the contention P0.118 needs to surface — recorded here rather than glossed, because "unrelated" and "did not make it likelier" are different claims and only the first is true. Per its filing it was **not** fixed by widening the assertion, filtering the message or serialising the test.
- **Nothing was measured about throughput this run and P0.122 is untouched.** Its prohibition on lowering the budget or moving `ACCURACY_CEILING` / `THROUGHPUT_STEP_LADDER` carries over unchanged. No cross-engine measurement was taken and none is claimed.
- **Next**: the first `todo` in `seq` order is now **P6.29** (uncertainty lab: 3 guided studies with auto-check). It is the direct consumer of the three studies pinned here — a guided study whose checker has no pinned reference is grading itself — so read `golden-mc-store.ts` before choosing its scenarios rather than inventing a fourth set.

## 2026-09-04 (74th run) — **P6.27 closed: the full MC study is reproducible end to end, and the cross-platform half needed a comparator that did not exist**

- **`main` arrived GREEN, read at the head this run actually starts from** rather than from the run the previous entry cites — the check the 72nd entry demanded after its own closing push went red unnoticed for eight hours. Head is `f695db4`. **Local gate on that tree before any change**: typecheck, lint, lint:deps and **3467 tests / 297 files**, all clean.
- **The task was taken by the roadmap's own rule and claimed before any code.** `policy.taskSelection` says first `in-progress`, else first `review`, else first `todo` in `seq` order. There is no `in-progress` and no `review` task in the file; the first `todo` is **P6.27** at seq 251. Marked `in-progress` and committed before a line was written.
- **The scope came from blueprint §8.5, not from the one-line title, and that changed what the task was.** §8.5: _"same ScenarioSpec + seed ⇒ identical SHA-256 of result buffers across runs, across main-thread/worker execution, and across pool sizes (via fixed reduction order, P6.05)"_. Read that way the task has three axes and a second half, and two of them were not reachable — recorded in the claim commit **before** starting rather than discovered as an excuse afterwards.
- **What was actually missing was the end-to-end assertion, and it is worth being precise about why the existing tests do not cover it.** `mc-stats.test.ts` proves the reduction is order-independent — over **synthetic columns it fills itself**, so no integrator runs and a solver that became run-to-run unstable would not show up. `mc-job.test.ts` proves `runMcRange` agrees with `runMcReplicate` across partitionings — and **stops before the reduction**. Neither runs `spec → generateReplicate → integrate → assembleMcColumns → mcStats → hashMcStats`, which is the only form in which §8.5's sentence is checked at all. `packages/runtime/src/mc-study-reproducibility.test.ts` now does, in **7 cases**: run-to-run, six pool sizes from one chunk to one-per-replicate, shuffled chunk arrival, a fixture guard, a one-ULP perturbation, and both drift cases.
- **The cross-platform half needed a comparator, because a bitwise hash cannot answer it by construction.** `hashMcStats` folds IEEE-754 bit patterns, so it is unequal across engines whether or not they agree. `mcStatsRelativeDrift` and `MC_STATS_CROSS_PLATFORM_REL_TOL` (= 1e-13, §2.6's stated budget) are new in `analysis/mc-stats.ts`, with **6 cases** of their own.
- **The two checks answer different questions and the docs now say so, because swapping them is the mistake that would matter.** Same platform the requirement is **bit-equality** — the test asserts drift is exactly `0`, not merely under tolerance, since loosening that would let a real reduction-order regression pass as rounding. The tolerance exists **only** for the case where bit-equality is unavailable.
- **Two judgements are inside the comparator rather than left to callers.** A differing `count` or `landedCount` returns `Infinity`, never a scaled number: those are integers, so a disagreement means two platforms ran different work or **disagreed about whether a replicate reached the ground** — the likelier cross-engine failure, and one where every continuous field can still match to the bit while the answer differs. And two `NaN`s compare as **agreement**: an all-non-landing batch has a `NaN` mean by design, and two platforms both reporting "no answer" have not drifted, though `NaN !== NaN` would say they had.
- **The constant is labelled a budget, not a measurement, in its own doc comment.** 1e-13 is what the project has committed to tolerate. What a second engine actually drifts by is P2.45/P7.11's to measure and publish. This entry claims **no cross-engine measurement whatsoever** — none was taken.
- **Teeth were established by mutation, not asserted.** Three faults injected in turn, each caught by the case meant to catch it: assembling chunks in **arrival order** instead of at the global index fails 2; drawing a replicate at its **chunk-local** index fails 2; a **process-global counter** leaking into the columns fails 4. On the comparator: removing the count guard fails 2, narrowing the field loop to `sum` alone fails 2. The tree was restored and re-run green after every probe. Without these, seven passing equality assertions would be indistinguishable from seven vacuous ones.
- **The fixture deliberately differs from `mc-job.test.ts`'s.** That file uses the drag-free preset because it wants closed forms to check observables against; this one takes the preset with the **most force terms**, because a reproducibility check is worth as much as the arithmetic it covers. A fixture guard asserts the study has a non-trivial landed subset and a finite, positive-variance range — without it every equality below it could pass vacuously on a study where nothing landed.
- **Three things are NOT covered, and the next session should not assume otherwise.** (1) **Main-thread vs worker execution**, which §8.5 also asks for: there is no second execution path, because the MC job does not go through `WorkerPool` at all — that is **P0.119**, still open, and it must **extend this file** rather than start another. Writing a test against a hand-rolled fake of a pool that does not exist would have graded the fake. (2) **A pinned hash constant**: that is **P6.28**. This file asserts self-consistency, which is what catches nondeterminism; a golden additionally catches _intended_ numerical change, and choosing which studies deserve one is P6.28's call. (3) **A fresh-process run**, genuinely stronger than repeating in-process, but the only route to these modules from a subprocess is through `packages/*/dist`, which is gitignored and only `pnpm typecheck` emits — **P0.111** exactly, and one instance of that bug in the suite is enough.
- **Full gate**: typecheck, lint, lint:deps clean, **3480 tests / 298 files** green (+13 cases, +1 file, from 3467 / 297), plus `pnpm build`. No test was skipped, disabled or weakened; no existing assertion was touched; no golden moved (none was in scope).
- **Nothing was measured about throughput this run and P0.122 is untouched.** It remains the open item the 73rd run filed, and its prohibition on lowering the budget or moving `ACCURACY_CEILING` / `THROUGHPUT_STEP_LADDER` carries over unchanged.
- **Next**: the first `todo` in `seq` order is now **P6.28** (goldens for 3 studies), which is the direct consumer of `mcStatsRelativeDrift` and should use it rather than hand-rolling a comparison.

## 2026-09-03 (73rd run, addendum) — **CI 297 reads 15423.96 traj/s, `meetsBudget` TRUE; P6.26 and P0.121 close, and the projection in the entry below was wrong**

- **This addendum exists because the entry below made a prediction and the very next CI run falsified it.** That entry said 8871.89 x 1.05 projects about 9.3e3, _"short by roughly 7%"_, and told the next session to read the real number. This run read it instead of leaving a wrong number standing — which is the same discipline the 72nd run's entry applied to its own optimistic projection, one turn on.
- **The number, read from run 297's throughput step at `ca551d6`** ([run 33792624320](https://github.com/avrybrdly93/launcher/actions/runs/33792624320), all 19 steps green): `stepSize` 0.05, **`trajectoriesPerSecond` 15423.956118622737**, `relativeRangeError` 1.3262690391304223e-9, **`meetsBudget` TRUE**. Section 2.6's budget is 1e4. `ACCURACY_CEILING` and `THROUGHPUT_STEP_LADDER` are untouched and the verdict rung is still h=0.05.
- **So P6.26 and P0.121 are closed — on a rule written before the outcome was known.** P6.26's notes committed to exactly this reading while no CI figure existed at all: _"if a CI artifact clears 10000, this task's criterion is met by that artifact and it can be closed against it."_ Honouring a pre-registered rule is the opposite of moving the goalposts, and refusing it because the draw was lucky would have been a post-hoc reinterpretation of a criterion this project deliberately fixed in advance. Closed exactly as written.
- **And the reason it cleared is mostly not the code, which is filed as P0.122 in the same breath.** This run's change is worth about **1.05x**, measured as 8 interleaved A/B pairs. The gap between CI 295's 8871.89 and CI 297's 15423.96 is **1.74x**. The other **1.65x is the runner**.
- **Three CI measurements of nearly the same code now read 7916.57 (291), 8871.89 (295), 15423.96 (297) — a 1.95x spread, with the budget sitting inside it.** The `relativeRangeError` is identical to every digit across all three, so it is the same workload on machines of very different speed, and `meetsBudget` currently reports **which machine ran**, not whether the code is fast enough.
- **This corrects a conclusion in the record, and the correction is the most useful thing in this addendum.** The 71st and 72nd runs concluded that a GitHub-hosted runner is _simply the slower machine_ — 0.863x and 0.829x this container, "measured twice", stated as a property of the runner class — and told the next session not to re-check a CI artifact expecting it to clear 1e4. It cleared by 54%. **Two consistent measurements looked like a property and were two draws from a wide distribution.** Nothing was done wrong: two points cannot show a spread. The transferable form is that a cross-machine ratio is not a claim until it has more than two samples, and this one now has three.
- **P0.122 is the follow-up, and it is explicit that the answer is not to lower the budget.** The prohibition on moving `ACCURACY_CEILING` or extending `THROUGHPUT_STEP_LADDER` carries over unchanged. Its three candidates: best-of-N within one job (the shape `Query.test.ts`'s per-sample minimum already uses, for the same noisy-neighbour reason, and probably the right one); normalising against an in-job calibration loop, which is decision 0023's in-process-control pattern and the most correct and most work; or requiring the number on two consecutive runs, which is cheapest and still a coin flip twice.
- **One thing is already sound and P0.122 says not to touch it:** the accuracy half of the verdict is stable across every machine measured, to every digit printed. Only the throughput half is machine-dependent.
- The committed `scripts/batch-throughput-results.json` is **still not re-recorded**, for the reason the entry below gives and which this addendum strengthens: if a _runner_ can vary by 1.65x, a record taken on one container is worth even less as a baseline than it looked.

## 2026-09-03 (73rd run) — **P0.121: `Math.pow` out of Sutherland's law for a measured 5.05%; the task stays open and the CI number is why**

- **`main` arrived GREEN, and this was read at the head this run actually starts from** rather than from the last run the previous entry cites — the trap the 72nd entry was written about, and the check it demands. CI **296** at `8903cec`, `success`. **Local gate on that same tree before any change**: typecheck, lint, lint:deps and **3462 tests / 296 files**, all clean.
- **The task was taken by the roadmap's own rule.** `policy.taskSelection` says take the first `in-progress` task, which is **P6.26**; P6.26's remaining work is filed as **P0.121**; P0.121 was `todo`, so it was marked `in-progress` and committed **before any code was written**.
- **The first measurement reshaped the whole run: this container is not the machine the record was taken on.** `bench:throughput` on the _unchanged_ tree reports **17368.30 traj/s** at the h=0.05 verdict rung with `meetsBudget` true — **1.62x** the committed 10704. The accuracy ladder is identical rung for rung (`relativeRangeError` 1.3262690391304223e-9, matching both the committed local figure and CI's), so it is a speed difference and not a different workload. **No local number can settle this task**, whose criterion is a CI artifact.
- **The defect was the same shape P0.120 found, in the other function `model.rhs` calls on every evaluation.** `sutherlandViscosity` computed $(T/T_{ref})^{3/2}$ with `Math.pow`. V8 takes a generic path for any non-integer exponent; `Math.sqrt` is one instruction. **1303.7 ms against 222.9 ms at 2e7 evaluations, 5.85x.** The profile of the _current_ tree ranks it 5.8% self in mc-batch, and it runs once per environment sample, so four to five times per fixed step.
- **One item on this task's own candidate list is now struck off rather than left to be rediscovered.** P0.121 was filed against "`interpolant` at 8.4% self". On this tree that is the **cubic Hermite** interpolant, not DOPRI5's: a flat four-term basis called three times a step by the event scan. There is no redundant work in it to hoist. The 8.4% is inherent, and the next session should not spend an hour finding that out again.
- **A single before/after on this machine would have been worthless, and this is the transferable part.** Two consecutive runs of the _unchanged_ benchmark differed by **6.6%**; across 8 runs each arm spans **13.9%**. The effect being measured is smaller than that. So it was measured as **8 interleaved A/B pairs**, with the order flipped for the last four to cancel any thermal or noisy-neighbour drift: **pow median 16781.3, sqrt median 17660.1 traj/s, median per-pair ratio 1.0506, mean 1.0531, sqrt winning 7 of 8 pairs.** Pairing is what makes a 5% effect measurable against a 14% noise floor; P0.120's straight before/after would not have resolved it.
- **The measurement agrees with a prediction made before it, which is the check that it is real**: 5.8% self time removed at 5.85x predicts **4.8%**, and 5.05% was measured. That agreement, not the raw number, is the reason to believe it.
- **P0.121 DOES NOT CLOSE, and the projection says so before CI does.** Its criterion is a CI artifact at or above 1e4. CI last measured **8871.89**; 8871.89 x 1.05 is about **9.3e3** — short by roughly 7%. **Read the actual CI number rather than trusting that**: the 72nd run's own projection was optimistic by 4%, and it says so in the entry directly below.
- **The committed artifact was deliberately NOT re-recorded.** `scripts/batch-throughput-results.json` still holds the 72nd run's 10704. Writing this container's ~17.7e3 into it would raise the committed baseline to a machine **1.62x faster than the one that set it**, turning every later run on ordinary hardware into an apparent regression. Recording is opt-in and "a deliberate local act" per the script's own header. This was not the machine to do it on.
- **This is a golden-trajectory change and the goldens do not move: 0 of 23 hashes, both fixture files byte for byte.** That is established against **two controls**, not asserted. Re-recording the **unchanged** tree first reproduces the committed goldens bit for bit, so the recorder is deterministic. And a deliberate **1 ulp** perturbation of `sutherlandViscosity`'s result moves **4 of 23** hashes — so the fixtures genuinely resolve changes at this scale, and the zero is a real zero rather than a blind spot. **Without that second control the zero would have been worthless**, and it is the same lesson as the 72nd run's re-record control, applied to the opposite outcome.
- **The zero is nonetheless partly luck, and the doc comment says so rather than banking it.** Swept at 4e6 points over 150-350 K, the two forms are **bit-identical on 79%** of the range (82% of the ISA troposphere) and differ by at most **4.440826e-16 — exactly 2.0000x `Number.EPSILON`** — at T = 236.05 K. The golden scenarios' temperatures land in the agreeing majority. A future golden that reaches a differing temperature _will_ move, and that is a property of those scenarios, not a guarantee about this function.
- **`packages/engine/src/units.test.ts` (5 cases) turns the trade into an enforced contract**, mirroring `vec2.test.ts` deliberately. The bound is **4 ulp against a measured maximum of 2.0000** — a 2x margin, because a bound set at the measured maximum sits one unlucky rounding from failing. One case asserts the two forms are **not** bit-identical, at the sweep's argmax: without it, an implementation that simply went back to `Math.pow` would satisfy every other assertion and the file would stop grading what it was written for. Confirmed to have teeth in both directions.
- **No tolerance was loosened, and none needed to be** — unlike P0.120, no stored-solver-output test moved at all. No test was skipped, disabled or deleted.
- **Full gate**: typecheck, lint, lint:deps, **3467 tests / 297 files**, all green, plus `pnpm build`. The +5 is `units.test.ts`. Three `cross-engine-drift-record` cases fail on a fresh checkout until `pnpm build` has run — they shell out to a fixture that imports `packages/engine/dist` — which is a property of the clean tree and not of this change; CI builds first and does not see it.
- **Where the remaining ~7% has to come from**, with the list one shorter than P0.121 was filed with: `generateReplicate` at 8.2% inclusive (its `scenarioSpecSchema` re-parse shows as `_parse` at 2.0% self — **read that function's doc comment before touching it**, the re-parse is a real validation and deleting it would be rejection sampling on the output and would bias the estimator), `resolveModel` at 1.8% inclusive, and the two rows nobody has yet examined for an implementation defect as opposed to inherent cost: **`stepExplicitRK` at 20.1% self and `runIntegrationSteps` at 11.3%**. The prohibition is unchanged: this does not close by raising `ACCURACY_CEILING` or extending `THROUGHPUT_STEP_LADDER`.

## 2026-09-03 (72nd run) — **P0.120 closed: §2.6's throughput budget is met, and the fix was neither candidate**

- **`main` arrived RED, on P0.117, and this entry originally said the opposite — corrected below rather than edited away.** The claim as first written was "`main` arrived green", sourced from the 71st run's addendum recording CI **293** at `3843e54` as `success`. That was the wrong run to read. The addendum's _own_ push, at `987e05d`, is CI **294**, and it concluded **`failure`** — which is precisely the trap that addendum was written to describe, sprung on the addendum itself: a closing-entry push goes red and survives unnoticed because the session that wrote it is told not to chase its own run. It survived about eight hours this time. **Read the run at the head you actually start from, not the last run the previous entry mentions** — an entry's own closing push is by construction the one it cannot have checked.
- **The failure is P0.117, signature for signature, and not this run's.** Read from the job record: **295 files and 3458 tests passed, 0 failed, 1 error** — an unhandled rejection in `playwright-core`'s Firefox transport, `assert` ← `FFPage._onWebSocketOpened` ← `FFSession.emit`, attributed to `packages/app/src/app-routes.e2e.test.ts`. `987e05d` is a **CHANGELOG-only** commit, so there is no mechanism by which its diff could produce a browser race; that is the same argument run 288 supplied and it needs no re-derivation here. Nothing was re-run, and no target was skipped or disabled — P0.117 forbids closing it that way and this run did not try. One consequence worth recording because it compounds: Test failing skips steps 12-17, so run 294 produced **no batch-throughput artifact at all** ("No files were found with the provided path"), which is part of why P6.26's CI question was still open coming into this run.
- **Local gate before any change**, on that same tree: typecheck, lint, lint:deps and **3458 tests / 295 files**, all clean — the identical count CI 294 reported passing, which is what identifies its failure as the escaped rejection rather than a real regression.
- **The task was taken by the roadmap's own rule rather than by preference.** `policy.taskSelection` says take the first `in-progress` task, and that is **P6.26**; P6.26's notes say its remaining work lives in **P0.120**; P0.120's notes said P7.01 should come first, and the 71st run closed P7.01. So P0.120 was the continuation, not a new claim, and it was marked `in-progress` and committed **before any code was written**.
- **The gap was a 30x implementation defect hiding inside a correctly-identified hotspot.** `vec2.norm` was `Math.hypot(a[0], a[1])`. V8's `Math.hypot` scales its arguments by a power of two so intermediates cannot overflow or underflow; at projectile magnitudes that protection is unreachable by about a hundred and fifty orders of magnitude, and the scaling is its entire extra cost. Measured here, 2e7 evaluations at trajectory scale: **1113.6 ms against 36.6 ms**, a **30.4x** difference, agreeing to a maximum of 3.085e-16 (about 1.4 ulp). `norm` has exactly two production callers, both the `ctx.speedRel` line RK4 reaches four times per step.
- **Result, measured on one machine inside one session so the comparison means something**: the verdict rung went from **9176.95 to 10704.27 traj/s** at h=0.05, **1.167x**, and `meetsBudget` flipped **true** for the first time. Reproducible across two consecutive runs (10710.67, then 10704.27, 0.06% apart). **`ACCURACY_CEILING` and `THROUGHPUT_STEP_LADDER` were not touched**, the verdict rung is still h=0.05, and its relative range error moved only in the eighth significant digit against a 1e-8 ceiling. Note the machine variance this exposes, because it would otherwise look like a bigger win: this container measured **1.10x the committed 8370 record before any change**, so a comparison against the committed record alone would have overstated the result by a tenth.
- **P7.01 had this function in its top three and wrote it off in a sentence, and that is the transferable lesson.** Its report said `norm` "is not an anomaly worth chasing: it is `vec2.norm` computing |v| for the drag force ... and RK4 evaluates the RHS four times per step". Every clause of that is true and the conclusion does not follow. **A profile names the function, not the reason it is slow** — "intrinsic and called often" and "implemented badly" produce the same row in the same ranking, and reading the first forecloses the second. The paragraph is left standing in `docs/notes/profiling-baseline.md` with a correction under it rather than edited away, because the error is more instructive than the fix. P0.120's own two candidates — the per-replicate resolve path (2.5%) and Hermite dense output (8.4%) — remain unclaimed and were not needed.
- **This is a golden-trajectory change, and the re-record was verified before it was taken.** Re-recording against the **unchanged** code reproduces the committed goldens **bit-for-bit** (0/11 hashes moved), which is what makes the shift attributable to this change rather than to re-record noise — without that control the amplification movements look alarming and mean nothing. With the change, 9/11 hashes move and **every entry stays inside its own reviewed tolerance**, margins 2.5x to 3.8e4x. The tightest, `frozen-ou-gust` at 4.0e-8 against 1e-7, is exactly what its recorded amplification of 2.6e8 predicts for a 1.4-ulp perturbation (2.6e8 × 1.4 × 2.2e-16 ≈ 8e-8). No tolerance was widened; one tightened a decade on re-measured amplification.
- **Three tests then failed, and none was made green by relaxing it to fit.** Two were stored solver outputs — `constraints.test.ts`'s `UNCONSTRAINED_AIM` (θ moved 9.3e-12, speed 6.7e-11; the `toBeCloseTo` precisions were **not** loosened, 12 decimals still holds) and `inverse-exercises`' `max-range-angle` (40.05839098344464 → 40.058390383890014, 6.0e-7 deg). The second is large only because it is the location of a **maximum**: a quadratically flat peak turns an O(ε) change in the curve into an O(√ε) move in the argmax, which is why a last-bit change shows up near 1e-7 there and near 1e-12 at a root. It stays 2.5e5x inside its own grading tolerance.
- **The third failure was a fragile test, and it was proved fragile rather than assumed to be.** `newton-shooting`'s negative control asserted that an unguarded 2×2 elimination on the rank-deficient Jacobian blows up by **more than 1000x** against the guarded step; after the change it blew up by 84x. That ratio comes from dividing by a pivot that is zero to rounding, so it is set by the last bits and not by the problem. **Measured before touching it**: sweeping the start aim across 25 values spaced 1e-11 rad apart — physically the same problem — gives, **on the original unchanged code**, 14 refusals and **11 ratios from 11x to 136x, none above 1e3**. The committed threshold passed only because θ = 0.45 exactly was an outlier in its own neighbourhood; any last-bit change anywhere would have re-rolled it. Lowered to **10x**, which 23 samples support, and the assertions carrying the test's scientific content — vertical row < 1e-8, guarded step < 10, rank 1 — are untouched. Recorded plainly because it is a threshold change on someone else's negative control and should be visible as one.
- **A new `vec2.test.ts` turns the accuracy trade into an enforced contract** rather than a comment to be trusted: agreement with `Math.hypot` to within 2 ulp across the documented domain, exactness where it exists, and an explicit assertion of the overflow/underflow limits that domain **excludes** — so the reason the naive form is acceptable stays a domain argument rather than becoming a claim that the two forms are interchangeable. Confirmed to have teeth: all four cases fail against an L1-norm implementation.
- **P6.26 did not close with P0.120, and this run read the CI artifact itself rather than leaving the question to the next one.** Its criterion is the **CI** artifact, not the local one, and its notes committed to that reading before any of this. **CI 295 at `5f43860` concluded `success` across all 19 steps, and its throughput verdict reads `trajectoriesPerSecond` 8871.889046294264, `meetsBudget` FALSE.** So P6.26 stays `in-progress`, and the residual is filed as **P0.121**. Read from the throughput step's stdout — the artifact itself is unfetchable both ways from here (`api.github.com` CONNECT 403, and the browser-facing artifact URL 403s too).
- **The change did help on CI, by close to the predicted amount, and the prediction is corrected rather than left standing.** CI measured **7916.57 before** and **8871.89 after** — **1.121x**, against 1.167x on this container. The projection written earlier in this same run was "roughly 9.2e3"; the actual is 8871.89, so **the projection was optimistic by about 4%** and the entry says so rather than quietly matching. The remaining gap is **12.7% on the CI machine**, down from the ~20% this chain began with. A GitHub runner is confirmed the slower machine on both sides of the change: **0.863x** this container before, **0.829x** after.
- **One incidental result worth keeping.** CI's relative range error at the verdict rung is **1.3262690391304223e-9 — identical to this container's to every digit.** That is a cross-machine determinism check passing for free, and it says the two machines differ in **speed alone**, which is exactly the assumption every projection in this entry rests on.
- **Full gate after the change**: locally typecheck, lint, lint:deps, **3462 tests / 296 files**, all green — the +4 being the new `vec2` cases. No test was skipped, disabled or deleted. On CI: all 19 steps green, including the four the local gate cannot cover — benchmark regression, batch throughput, cross-engine drift (chromium 149 and firefox 151 both at `maxRelativeDrift` 0.000e+0) and both typedoc steps — plus Build app and the bundle budget at 83.5 kB gzipped. **P0.117 did not fire on this push**; one observation, and it narrows nothing.

## 2026-09-02 (71st run, addendum) — **CI 293 green at `3843e54`, all 19 steps**

- **Closes the loop the 71st run's push opened, and this run closed it itself rather than leaving it to the next one.** That is the point of the addendum: the entry below deliberately claimed only the local gate, and the standing trap in this file is that a closing-entry push goes red and survives unnoticed because the session that wrote it is told not to chase its own run. It survived seven hours the last time. Read from the **job** record rather than the run record, per the stale-status trap.
- **The four steps the local gate cannot cover all passed**, which is the part worth having: benchmark regression (9 s), batch throughput (45 s), cross-engine drift (3 s) and both typedoc steps. **Scoped honestly** — those typedoc steps build `engine` and `solverkit`, not `runtime`, so they are **not** evidence that this run's own `profile-harness-entry.ts` TSDoc resolves. That is exactly the latent-`{@link}` gap the 44th run found, and it is still open.
- Test **3m23s**, 6m22s end to end; Build app and the bundle budget both passed after it. **P0.117 did not fire** on a push that adds a module to `packages/runtime` — one observation, and it narrows nothing.
- One follow-up entry, then stop; run **294**, triggered by this addendum, is not chased.

## 2026-09-02 (71st run) — **P7.01: the profile that says P0.120's first guess is worth 3%**

- **`main` arrived GREEN, and the 70th run's entry is out of date on that point.** It closed saying "`main` arrived red and this run did not fix it", pointing at CI 289 and 288 failing on **P0.117**. CI **291** at `440c464` — that entry's own push — concluded **`success`**, all 19 steps, Test included. So the red spell was 288-290 and it ended without anyone acting on it, which is what P0.117 predicts of a non-deterministic Firefox transport race. **This is one observation and it narrows nothing**: a race that does not fire is not a race that is gone, and P0.117 stays open with its criterion untouched. Nothing was re-run and no target was disabled.
- **P6.26 was worked first, because it was the `in-progress` task, and it closed its last open question in the negative.** Its notes listed exactly one thing as unestablished — what a CI runner measures, with the explicit clause that "if a CI artifact clears 10000, this task's criterion is met by that artifact". **It does not clear it.** Read from CI 291's throughput-step stdout at `440c464`, the artifact's verdict block is `stepSize 0.05, trajectoriesPerSecond 7916.5665013194375, relativeRangeError 1.3262692586953941e-9, meetsBudget false`, and the script's own line reads `Committed record: 8370 traj/s at h=0.05 (4 CPUs). This run is 0.95x that.` **A GitHub-hosted runner is the slower of the two machines, not the faster one** — a **21%** shortfall against §2.6's 1e4 where this container is 16%. The accuracy ladder agrees rung for rung across the two (h=0.02 → 3.3739e-11 both; h=0.01 → 2.1879649454236208e-12 against 2.188e-12), which is what makes that a like-for-like speed comparison rather than a coincidence. **The "wait for a faster runner" route is now closed by measurement rather than left open as a hope.** The uploaded artifact itself could not be fetched — `api.github.com` is blocked by this container's egress proxy, CONNECT 403 — so the numbers come from the job log, which prints the same JSON.
- **Then P7.01, and the chain that leads there is written into the task rather than assumed.** P6.26 stays `in-progress` and its remaining work is filed as **P0.120**; P0.120's notes say P7.01 "is the next task by seq and should come first rather than this one guessing"; the 70th run's entry nominates P7.01 by name. Taking P6.26 a second time would have been taking a task whose remaining work lives elsewhere. Claimed before any code, with the scope fixed in writing first: **this task profiles and does not optimize.** No solver code was changed.
- **The finding is what the profile rules out, not what it ranks.** P0.120 named two candidate hotspots. Measured inclusive (subtree) time over 4000 replicates at h=0.05: `integrate` **81.1%**, `generateReplicate` **10.5%**, `resolveModel` **2.3%**, `resolveStepper` **0.2%**, `resolveSolverConfig` **0.0%**.

  1. **Candidate (a) is worth 2.5% all together.** The per-replicate resolve path — the "40 000 models and contexts" this task was filed on — cannot close a 20% gap even if hoisted out of the loop entirely, which is the most any optimization of it can win.
  2. **Candidate (b) is real but bounded**: the Hermite dense output shows as `interpolant` at **8.4%** self time. The larger of the two guesses, still not 20% alone.
  3. **A third cost neither candidate anticipated**: `generateReplicate` — drawing the replicate's parameter vector, including schema parsing — at **10.5%** inclusive, over four times `resolveModel` and the largest non-`integrate` cost in the batch.

- **Self time alone could not have found that, and that is the methodological point worth carrying.** Candidate (a)'s cost is almost entirely _beneath_ `resolveModel` rather than in it, so in a self-time ranking it appears as a dozen small unrelated rows and ranks nowhere. That is how a real hotspot hides — and equally how a suspected one turns out not to be there. The report carries both rankings for exactly this reason.
- **Batch top three by self time**, as the criterion asks: `stepExplicitRK` **21.5%**, `runIntegrationSteps` **8.6%**, `norm` **8.6%**. `norm` is `vec2.norm` computing |v| for the drag force, and RK4 evaluates the RHS four times a step — recorded as expected rather than left looking like an anomaly for the next run to chase.
- **The interactive profile ships with a warning against reading it the obvious way.** Its top rows are `EmbeddedRKStepper.interpolant` 14.9%, the garbage collector 11.8%, `runIntegrationSteps` 9.4%, `brentRoot` 6.6% — and they are **not** "where the integrator spends its time". The default preset solves with adaptive `rk45` at rtol 1e-6 and converges in about **four accepted steps**, so the profile is dominated by per-solve fixed costs. At 0.159 ms a solve the interactive path is far inside a 60 Hz frame and is not where §2.6 is at risk.
- **A test asserted the opposite of that and was wrong, which is how the four-step fact was found.** The first draft of `profile-harness-entry.test.ts` required the interactive solve to record more than 20 rows; it records 4. The code was right and the test encoded a wrong belief about the physics, so the test was corrected — bounded on both sides now, so a drop to 1 or a jump into the hundreds both fail — and the consequence was written into the report rather than quietly absorbed.
- **Three measurement choices that decide what the numbers mean**, each recorded in the script: `node:inspector` rather than `--cpu-prof`, because the latter profiles a whole process and two workloads must not be mixed into one profile; single-threaded, because P6.26 already established parallel efficiency at 90% of ideal and a four-worker profile would divide the per-trajectory cost by four and add bookkeeping that is measurably not where the time goes; and self time from `samples` + `timeDeltas` rather than `hitCount`, because a hit count assumes every sample cost the same. The bundle is deliberately **not** minified — a hotspot list of `a`, `t` and `n` is not a hotspot list, and inlining would move time from the function that owns it to its caller.
- **The `.cpuprofile` files are the flamegraphs** (132 kB for both), loading directly into Chrome DevTools and speedscope. No SVG is rendered and none is claimed: a generated bitmap no test can check, committed in place of the data it was drawn from, is the weaker artifact.
- **Stated in the report as not established**, rather than left implied: what any optimization would actually win (a hotspot's share is an upper bound on removing it, and removing it is rarely free); what a GitHub runner would profile, since both profiles come from the development container that P6.26 measured as the faster machine; and the 1-2% tail of a sampled ranking, which is not precise — the artifact keeps 15 rows per workload so the tail is visible rather than implied.
- **Gate at the pushed tree, run in CI's order**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm lint:deps` (**1690 modules, 4804 dependencies**), `pnpm test` — **3458 passed across 295 files**, up from 3448/294 — plus `pnpm --filter @ballista/app build` and the bundle budget at **83.5 kB gzipped** against 300 kB. All clean. **Not covered locally and not claimed as green**: `pnpm bench:solverkit`, `pnpm check:cross-engine-drift` (no browser install in this container) and both typedoc steps. That is **P0.110**'s gap, still open and still doing what it was filed to make visible.
- **Branch note, unchanged from the 68th-70th runs and for the same reason.** `CLAUDE.md` asks for direct commits to `main` and no `claude/*` branches left behind; the harness pinned `claude/upbeat-ride-zulham`. Development happened on `main` directly and **the harness branch was never created or pushed** — this environment cannot delete a remote ref, so every pushed harness branch is permanent and makes **P0.95/P0.107** worse. **Verified rather than asserted this time**: `git ls-remote --heads origin claude/upbeat-ride-zulham` returns **nothing**. A stale `remotes/origin/claude/upbeat-ride-zulham` tracking ref existed locally and was pruned; it is a clone-time artefact and not a ref on the remote, and a run that read `git branch -a` without checking `ls-remote` would have concluded the opposite.
- **P0.107's count, measured in passing and not acted on**: `git ls-remote --heads origin` returns **94** `claude/*` branches, against the **84** recorded when P0.107 was filed on 2026-08-18. **None of the ten is this run's.** No branch was deleted — that task's validation forbids deleting one without first showing its work is on `main`, and this run showed that for none of them. The number is recorded here only so the next reader sees it is still growing.
- **Next run picks up P0.120** — now the first `todo` whose path is measured rather than guessed. Read `docs/notes/profiling-baseline.md` first: it says where the time is, and it says which of that task's own two candidates is worth chasing. P6.26 remains `in-progress` behind it and closes when P0.120 does.
- **Not this run's work, recorded because the routine visits three repositories**: `paper-trader` had **twelve** green commits stranded behind a 403 (the Claude GitHub App has no write access there), and `telehealth` was verification-only for the 28th session running, its `Ready` column genuinely empty.

## 2026-09-02 (70th run) — **P6.26: the throughput harness, and a budget that is 16% short with the coarser step sitting right there**

- **P6.26 claimed as the first `todo` by `seq` (250)**, nothing `in-progress` and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written, and the 69th run's entry nominates it by name. Claimed before any code, in its own commit. **It stays `in-progress`**: the harness, the tests and the artifact are done, and the number the criterion is about is short. `ROADMAP.json` carries the full record.
- **VALIDATION NOT MET, and that is the entry's headline rather than a footnote.** The criterion is "CI perf artifact meets §2.6 budget" — ≥1e4 full trajectories/s on 4 workers, fixed-step RK4, observables-only. Measured here (Node 22.22.2, linux x64, **4 CPUs**, 40 000 replicates, 4 real worker threads): **8370 traj/s** at the verdict rung. The artifact records it, the CI step uploads its own, and the task is not closed.
- **The step size is the one knob that decides pass/fail, so the rule that picks it was committed before the harness existed.** Fixed-step RK4 throughput is nearly inversely proportional to the step, so _any_ step can be defended after the fact and picking the one that clears 1e4 is the whole integrity risk in this task. The rule, written into `ROADMAP.json` in the claiming commit: publish accuracy **and** throughput for every rung of a fixed ladder, and read the verdict at the coarsest rung whose relative range error is within **1e-8** — two orders inside §2.6's own 1e-6 accuracy budget.
- **And the rule immediately cost something, which is the only reason it is worth having.** The ladder measured:

  | h    | relative range error | traj/s (4 workers)      |
  | ---- | -------------------- | ----------------------- |
  | 0.1  | 2.187e-8             | **14035**               |
  | 0.05 | 1.326e-9             | **8370** ← verdict rung |
  | 0.02 | 3.374e-11            | 4166                    |
  | 0.01 | 2.188e-12            | 2329                    |

  The coarsest rung clears the budget by 40% and is ineligible on accuracy by a factor of 2.2. Moving `ACCURACY_CEILING` from 1e-8 to 3e-8 — still 30× inside §2.6's accuracy budget, and entirely arguable — would have turned this run's outcome from "missed" to "met" with a one-character diff. It was not moved, the ladder was not extended, and `P0.120`'s validation forbids closing it that way either.

- **The gap is per-trajectory cost, not scheduling, and that is measured rather than assumed.** One thread does ~2324 traj/s at h=0.05; four ideal threads would be ~9300; 8370 is **90%** of that. Parallel efficiency is fine and adding workers cannot find the missing 20%. So `P0.120` is solver work, and it names two candidate hotspots as candidates rather than conclusions — a model, context and stepper rebuilt for every replicate, and a `HermiteDenseOutputStepper` doing real work on every accepted step for an interpolant consulted once at impact. **P7.01 (profiling baseline, `seq` 255) is next by `seq` and should come before P0.120 rather than P0.120 guessing.**
- **`runMcRange` is the primitive; `runSweepRange` is not.** "Observables only" is the criterion's own phrase and it excludes the sweep path, which attaches a `TrajectoryRecorder` — precisely the thing P6.04's batch was built not to do. A throughput number taken with a recorder attached would be of a different workload than the budget names.
- **Real threads, not the pool.** `worker-pool.ts` dispatches to browser `Worker`s and a CI script cannot construct one, so the script spawns `node:worker_threads` over an esbuild bundle (the same answer `measure-cross-engine-drift.mjs` gives to the same bare-specifier problem) and reproduces the pool's _policy_ rather than its mechanism: contiguous index-addressed chunks, reassembled by start index and never by arrival order. That policy is asserted in the suite by running one study under **three different partitions** and requiring bit-identical columns — §5.6's determinism-under-parallelism made executable.
- **Two anti-measurement guards that are not decoration.** Each worker returns a checksum of its chunk's ranges, because without a value crossing the thread boundary nothing observes the columns and a runtime is entitled to elide work the number is supposed to include; the parent rejects a checksum that is zero or non-finite, and rejects a run whose chunks did not cover every replicate. And the default is **40 000** replicates, not a few thousand: measured, the identical configuration reports ~5.3e3 traj/s at 4000 and ~9.4e3 at 40 000, and the entire difference is worker spawn being amortized. A benchmark that moves that much with N is reporting startup.
- **The benchmark study varies its replicates on purpose.** A study with no overlays draws the same parameter vector every replicate, and a JIT may notice; the throughput would then describe a workload no batch runs. It varies the same three inputs the dashboard study does, and a test asserts the four ranges are distinct.
- **17 tests, and the load-bearing ones are the accuracy leg**: the solver carries no adaptive field (an `rtol` surviving there would change the workload without changing the stepper id), every replicate _lands_ rather than timing out against `MC_T_MAX_SECONDS`, every rung is inside §2.6's 1e-6, and the ladder's error falls at **fourth order** — which is what would notice if "fixed-step RK4" stopped describing what runs. There is deliberately **no timing assertion in the suite**: a number measured under vitest sharing a machine with 3400 other tests is not the number the budget is about, and a loose one would only teach everyone to ignore it.
- **Soft warn, like the two perf checks either side of it.** A missed budget prints `::warning::` and exits 0. Absolute throughput on a shared runner is not something to gate a build on — the reasoning `check-benchmark-regression.mjs` and `measure-cross-engine-drift.mjs` already carry — and the _artifact_ is the deliverable, not the exit code. CI runs it without `--record` (the write would land in the runner's workspace and be discarded) and uploads the numbers with `actions/upload-artifact`.
- **Gate at the pushed tree, run as CI runs it**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm lint:deps` (**1684 modules, 4782 dependencies**), `pnpm test` — **3448 passed across 294 files**, up from 3431/293 — and `pnpm bench:throughput`. All clean. **Not covered locally and not claimed as green**: `pnpm bench:solverkit`, `pnpm check:cross-engine-drift` (no browser install in this container), both typedoc steps, the app build and the bundle budget. That is **P0.110**'s gap, still open, doing what it was filed to make visible; this run's diff adds no runtime dependency and does not touch `packages/ui` or `packages/app`, so the bundle is unchanged, but "unchanged" is an argument and not a measurement.
- **`main` arrived red and this run did not fix it.** CI 289 at `e03c3b1` failed on **P0.117** — the Playwright Firefox transport rejecting unhandled with every test passing — and CI 288 before it, on a `CHANGELOG.md`-only diff. Nothing here addresses it: this run claimed P6.26, the fix is a browser-lifecycle change rather than a retry, and **P0.117 must not be closed by dropping the Firefox target**. It cannot be reproduced in this container at all, which has chromium only.
- **Branch note.** `CLAUDE.md` asks for direct commits to `main` and for no `claude/*` branches left behind; the harness pinned `claude/nice-keller-ykpshr`. Development happened on `main` directly and **the harness branch was never created or pushed**, following the 68th and 69th runs' precedent and for the same reason: this environment cannot delete a remote ref, so every pushed harness branch is permanent and makes **P0.95/P0.107** worse.
- **Next run picks up P7.01** (`seq` 255, profiling baseline: flamegraphs of interactive solve and MC batch, hotspot list). Read `P0.120` first — its two candidate hotspots are exactly what a profile of the MC batch should confirm or refute, and P7.01 is the task that turns those guesses into measurements.
- **Not this run's work, recorded because the routine visits three repositories**: `Computing-Platform` closed `[P2] Mixed-BC-per-axis Poisson2D/Poisson3D variant` and pushed; `islebound` follows this entry.

## 2026-09-02 (69th run, addendum) — **CI 289 red at `e03c3b1` on P0.117, and `main` was already red before this push**

- **The push is red, every test passed, and both facts are true at once.** CI 289 failed at step 11, `Test`, with Vitest reporting **293 files passed, 3431 tests passed, 0 failed** and separately **1 error**: an unhandled rejection inside playwright-core's Firefox transport, `assert ← FFPage._onWebSocketOpened ← FFSession.emit`, attributed to `app-routes.e2e.test.ts` at `#/inverse-solver's back link returns to the simulator`. That is **P0.117**, filed on 2026-09-01, signature for signature.
- **`main` was already red on arrival, and nobody had noticed.** CI **288** at `708e3df` — the 68th run's own closing commit, a **`CHANGELOG.md`-only diff** — failed identically at 07:19Z. This run inherited a red `main` and did not cause one. **This is the trap the 261st entry named**: a closing entry triggers a run that the session writing it is told not to chase, so a red landing there survives until the next session happens to look. It survived seven hours here.
- **Run 288 is the strongest evidence P0.117 has produced, precisely because its diff is documentation.** Every earlier sighting had to argue "this commit has no mechanism to cause a browser race". A `CHANGELOG.md`-only commit does not need the argument. Recorded in the task.
- **The rate has changed, and no rate is claimed.** Run 283's attempt 2 passed on its own commit, so the failure is still not deterministic — but 288 and 289 are two consecutive reds, and that is 3 of the last 7 runs. The runs are not a controlled sample and nothing is instrumented, which is exactly why P0.117's criterion asks for a _measured_ rate or a fix at the source. **The one re-run the rules allow was unavailable**: `rerun-failed-jobs` returned **HTTP 403**.
- **Nothing was skipped, disabled or weakened, and P0.117 was not fixed.** This run claimed P6.25; the fix is a browser-lifecycle change rather than a retry, and taking it would have been scope creep. P0.117's standing instruction is repeated in the task because a red `main` is exactly the pressure that invites breaking it: **do not close it by dropping the Firefox target.** A rejection escaping to the process can swallow a real failure as easily as it manufactures a phantom one.
- **What is not established.** Because `Test` failed, steps 12-17 were skipped, so CI has verified **none** of the four checks the local gate cannot cover at this commit. They passed locally except `check:cross-engine-drift`, which could not measure an engine in this container. So the honest position on `e03c3b1` is: all 3431 tests pass, the local gate is green, and **the CI-only steps are unverified at this head** — not green, not red.
- **Escalated to the owner** by push notification, because a red `main` that no session caused and none may fix within its own scope is not something a changelog entry alone reaches anyone with.

## 2026-09-02 (69th run) — **P6.25: the estimate now tightens while you watch, and the test that would have been easy to write is the one that would have been wrong**

- **P6.25 done, taken because it is the first `todo` by `seq` (249)**, with nothing `in-progress` and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written, and the 68th run's entry nominates it by name. Claimed before any code, in its own commit. `ROADMAP.json` carries the full record, as `policy.commitRules` requires, and this entry does not restate it.
- **VALIDATION MET.** The criterion is "CI band visibly narrows during run", and it is asserted at all three layers rather than claimed once: the study's suite checks the Wilson half-width at the end of a 64-replicate run against the width at its first partial; the pane's render test drives two partials through a mounted component and requires the **rendered text** to change; and the route test does the same on the real golf drive through `runGolfDriveStudy`, the exact callback the pane is fed by. `packages/runtime/src/mc-dashboard-study.ts`, `packages/ui/src/monte-carlo-page{,-logic}.{tsx,ts}`, plus **28 tests** — 12 study, 8 pane logic, 5 pane render, 3 route.
- **The monotonic test is the one that would have been wrong, and not writing it is the most useful judgement this run made.** "The interval narrows" invites `expect(width[i+1]).toBeLessThanOrEqual(width[i])`, which is easy, reads well, and encodes a belief about confidence intervals that is **false**. Consecutive partials are nested prefixes of one ensemble and therefore correlated; a later replicate that disagrees genuinely widens the band. That test would have passed on this seed and gone red later for a reason nobody could have reconstructed from the failure. The criterion is asserted end-to-end instead, with a companion test proving the first partial is drawn from strictly **fewer** replicates so the observed narrowing cannot be vacuous.
- **The partial is a prefix, not a sub-sample, and the test asserts identity rather than agreement.** P6.03 makes replicate `i` a pure function of the seed and `i`, so the first `n` replicates are a fixed, reproducible prefix of the very ensemble the final result summarizes — the partial at `n = N` **is** the returned `hit`. Asserting the two merely _agree_ would pass today and permit a drift whose visible symptom is an interval that jumps at the instant the run completes; `toEqual` on the whole object forbids it.
- **Not knowing is reported by absence, never by a zero.** `hitProbability` throws on an empty ensemble by design (P6.11), because "we never found out" and "it never hits" are different claims. A prefix in which nothing has landed yet yields **no partial at all**, and the pane renders no section rather than a zero-width band at `p̂ = 0` — which would be a claim. **Mutation-checked**: removing the guard makes a study whose replicates all outrun the horizon throw mid-stream, and that test fails.
- **Cadence, because a partial is a reduction and not a read.** Re-scoring the landed prefix costs `O(n)` at replicate `n`, so one per replicate would make the cheapest stage quadratic for a refresh rate no display can use. `DEFAULT_PARTIAL_EVERY` is 16, with the final ensemble replicate always taking one regardless so the last partial covers the whole ensemble. Never emitted on `fan` steps: the fan re-runs replicates the ensemble already scored, so a partial there would restate the final estimate while appearing to refine it.
- **One formatter, not two.** `formatHitEstimate` was narrowed from `McDashboardResult` to an `McScoredEstimate` — the `{hit, unlandedCount}` pair both a finished result and a partial satisfy — so the live number and the final one cannot drift apart in presentation. The live section clears on completion (the finished result owns that section; two intervals for one quantity side by side is the worse dashboard) and on cancel, so a stale number is never left looking live.
- **What this run did NOT do, recorded because the 68th run's entry expected it.** The study was **not** moved to a worker and no `mc` job was added to `WorkerPool`. The criterion is about estimates tightening live, and P6.24's generator driven with a macrotask hop every 16 replicates is a sufficient seam for that. The worker move is real, separate work rather than a piece of P6.25 left half-finished, and claiming it here would have been the dishonest option. **Filed as P0.119** with the request/response shape called out as its bulk. The pane still says out loud that the study runs on this thread, and that notice belongs to P0.119 to remove.
- **Mutation-checked rather than assumed, three ways**: dropping the end-of-stage partial fails 2 study tests; dropping the empty-ensemble guard fails 1; ungating the live estimate from the running status fails 2, one in the pane logic and one in the render suite.
- **Gate at the pushed tree, run as CI runs it rather than as `CLAUDE.md` lists it** (P0.110's point, still open): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm lint:deps` (**1672 modules, 4758 dependencies**), `pnpm test` — **3431 passed across 293 files**, up from a 3403/293 baseline — `pnpm bench:solverkit` (no method regressed), **both typedoc steps**, `pnpm --filter @ballista/app build`, and the bundle budget: **83.5 kB gzipped against 300 kB**, up from 83.1 kB. All clean.
- **One CI step could not be covered locally and is not claimed as green.** `pnpm check:cross-engine-drift` reported _"No engine could be measured, so no cross-engine drift was checked. This is not a pass."_ — the container has no Playwright browser install for it. It is a soft-warn step in CI, which does install chromium and firefox, so CI covers it; this run does not, and says so rather than folding it into an all-green claim. That is P0.110's gap doing exactly what it was filed to make visible.
- **The arrival baseline was green, but only after `tsc -b`, and that ordering is worth writing down.** A bare `pnpm test` on the fresh clone failed 3 tests in `cross-engine-drift-record.test.ts` with `ERR_MODULE_NOT_FOUND` on `packages/engine/dist/index.js`. Nothing is broken: those tests shell out to a script that imports the **built** engine, and `pnpm typecheck` is `tsc -b`, which is what emits `dist/`. CI runs typecheck first so it never sees this. A session that runs the suite before the typecheck will, and should not go looking for a defect that is not there.
- **Branch note.** `CLAUDE.md` asks for direct commits to `main` and for no `claude/*` branches left behind; the harness pinned `claude/upbeat-ride-6ouzt3`. Development happened on `main` directly and **the harness branch was never created or pushed**, following the 68th run's precedent and for the same reason: this environment cannot delete a remote ref, so every pushed harness branch is permanent and makes **P0.95/P0.107** worse. Nothing about P0.107 was tested and nothing about it is claimed; the count was simply not increased.
- **Next run picks up P6.26** (`seq` 250, throughput benchmark: ≥1e4 trajectories/s on 4 workers, fixed-step RK4, observables-only). Note it needs the worker path P0.119 describes, so read that task first — a throughput number measured on the UI thread would not be the number P6.26 asks for.
- **Not this run's work, recorded because the routine visits three repositories**: `paper-trader` is **still unpushable** — `git push` 403s, the Claude GitHub App is not installed for it — which is now four runs in a row. This run's six commits there (backlog `F6`'s single `scripts/check.sh` gate, its 15 tests, the `.gitignore` that repository has never had, and the `docs/development_log.md` its own `CLAUDE.md` has required since day one and which never existed) were exported as a bundle and a patch series to the owner, and escalated by push notification. `telehealth` had **no claimable work** for the 27th consecutive session — every row is owner-gated — and closed out cleanly on `main` via its auto-merge.

## 2026-09-02 (68th run, addendum) — **CI 287 green at `578c0ae`, all 35 steps**

- **Closes the loop on the 68th run's push.** Read from the **job** record rather than the run record, per the standing stale-status trap. 4m20s end to end, Test 2m29s.
- **The four steps `CLAUDE.md`'s local gate cannot cover all passed** — benchmark regression, cross-engine drift, Engine API docs and SolverKit API docs — plus Build app and Bundle size budget. That is P0.110's gap, still open, and the reason a green local gate is not the same claim as a green CI.
- **Scoped honestly**: the two typedoc steps build `engine` and `solverkit`, not `runtime`, `ui` or `app`, so they are **not** evidence that P6.24's own `{@link}` tags resolve. That is exactly the gap the 44th run's latent-`{@link}` finding lives in, and this run's three new modules all carry such tags.
- **P0.117 did not fire.** The Firefox transport rejection that made CI 283 attempt 1 red did not recur, on a push that adds a tenth route to the very suite it was attributed to (`app-routes.e2e.test.ts`, now 48 tests). **One observation; the task is not narrowed and must not be closed by disabling or skipping the Firefox target.** Nor did P0.112's wall-clock budget or P0.118's Plotly teardown race — the same non-result as the local baseline and the local gate, and for the same reason it proves nothing about either: a race that does not fire is not a race that is gone.
- Run 286 at `b387a9b` was superseded by this one and is not chased; **one follow-up entry, then stop** — the commit carrying this entry will itself trigger run 288, which no session should chase either.

## 2026-09-02 (68th run) — **P6.24: the Monte Carlo dashboard, and a Cancel button that had to be made real before it could ship**

- **P6.24 done, taken because it is the first `todo` by `seq` (248)**, with nothing `in-progress` and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written, and the 67th run's entry nominates it by name. Claimed before any code. `ROADMAP.json` carries the full record, as `policy.commitRules` requires, and this entry does not restate it.
- **VALIDATION MET.** The criterion is "end-to-end run of golf-drive uncertainty study from UI". `#/monte-carlo` runs the library's golf drive with ball speed, launch angle and backspin drawn from normals, and renders all four output families the title names. **P0.114's browser walk generates its cases from `ROUTE_HASHES`, so the route was covered the moment it was registered** — it renders with one `h1` and a working back link in chromium, no page errors — and a unit test integrates the study for real and asserts the ensemble _varies_ rather than only that a component mounted. `packages/runtime/src/mc-dashboard-study.ts`, `packages/ui/src/monte-carlo-page{,-logic}.{tsx,ts}`, `packages/app/src/monte-carlo-route.tsx`, plus **83 tests**.
- **The fan is a sub-sample of the same ensemble, not a second study, and that is the whole design.** P6.04's batch retains no trajectories on purpose, so a fan — which needs whole trajectories — cannot be built from it. The obvious repair is a second, smaller run; it is also wrong, because two runs are two ensembles and the bands would then describe replicates the histogram beside them never saw. P6.03 makes replicate `i` a pure function of the study seed and `i`, so re-running indices `[0, fanReplicates)` reproduces _those same replicates_. **Checked by mutation rather than by reading**: seeding the fan's `generateReplicate` with `seed + 1` fails two tests — the grid span against the columns' own prefix, and the bands themselves, reconstructed at levels `{0, 1}` over two replicates from trajectories re-derived through `generateReplicate` + `integrate` + `resampleOnGrid`.
- **A Cancel button that cannot work is a lie in the interface, not a limitation of it — so the study became a generator.** The work is CPU-bound JavaScript on the UI thread until P6.25 moves it to a worker. One synchronous call blocks the event loop for its whole duration, and during that time the click cannot be delivered, the progress bar cannot paint, and the `AbortSignal` **cannot possibly become aborted**. `mcDashboardStudySteps` therefore yields once per replicate and the route's driver awaits a macrotask every 16; `runMcDashboardStudy` is that generator drained, so there is one implementation and not two that can drift. **Mutation-checked**: pinning the yield interval to `Infinity` fails the test that queues a macrotask _before_ the study and requires it to have run _during_ it. A synchronous driver passes every assertion the pane's own suite makes and still freezes the tab. The page says out loud that the study runs on this thread.
- **The landed-subset filter survived the first draft of its own tests, and finding that out is the most useful thing this run did.** `hitProbability` is scored on the replicates that reached the ground; a replicate that ran out of horizon has a final row but not an impact point, and scoring "wherever it was at 60 s" is a coin flip dressed as evidence. Mutating the filter away — score everything — **passed all 27 tests**, because every golf drive lands, `unlandedCount` is 0, and "shots === landedCount" and "shots === count" are the same statement there. A second fixture was built for it: drag-free flight has `T = 2·vy0/g`, so `T > MC_T_MAX_SECONDS` is exactly `vy0 > 294.3 m/s`, and an overlay centred there strands about half the ensemble. The mutation now fails. The estimate is conditional on landing, the page prints the caveat with the count, and **omits it when nothing was stranded** — a caveat repeated where it does not apply trains a reader to skip it.
- **Two layering facts, recorded because neither is a preference.** The histogram is binned in `@ballista/ui` rather than in the study: `buildImpactHistogram` lives in `@ballista/viz`, which already depends on `@ballista/runtime`, so binning inside the orchestrator would close a cycle. And `mc-job.ts`'s private `layoutFor` became the exported `mcObservableLayout`, because the orchestrator builds its own sink to read `impactPoint` off and a second copy of that ternary would agree right up until a third model kind arrived. No behaviour change in either.
- **The preset is looked up by curated scenario id, and P0.115 is why.** Two presets share a projectile id, so `find` by projectile silently returns the wrong one. A test asserts the study carries the `magnus` force and a nonzero spin, so a lookup that drifted would fail rather than quietly study a baseball.
- **The fan is an inline SVG, not Plotly.** Five polylines in a unit box that the geometry helper has already projected, `NaN` samples omitted rather than interpolated across — past a replicate's own flight there is no value, and a chord through empty air is a drawn claim nothing supports — and `commonSupportEnd` marked and captioned, because bands past it are conditional on survival. Reaching for the plotting library here would add a lazy-load boundary and a teardown path (**P0.118**) to a chart that needs neither.
- **Gate at the pushed tree, run as CI runs it rather than as `CLAUDE.md` lists it** (P0.110's point, still open): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm lint:deps` (**1672 modules, 4758 dependencies**), `pnpm test` — **3403 passed across 293 files**, up from a 3316/289 baseline — **both typedoc steps**, `pnpm --filter @ballista/app build`, and the bundle budget: **83.1 kB gzipped against 300 kB**, up from 73.1 kB, which is this route and its pane. All clean.
- **The baseline was fully green on arrival, and that is worth recording because the 67th run's was not.** Both failures that run saw on the untouched tree — `chunked-integration.test.ts`'s wall-clock budget (P0.112/P0.96) and the `app-routes.e2e.test.ts` Plotly teardown race (**P0.118**) — passed here, in the baseline and again in the final gate. **That is one observation each and narrows neither task.** Both are filed as load-dependent and this container was fast enough; a green run is not evidence that a race is absent.
- **Next run picks up P6.25** (`seq` 249, progress + partial-result streaming — estimates tighten live). It is the task that moves this study off the UI thread, and the generator this run added is the seam it should use: a worker entry drains it and posts each step, instead of the route's macrotask driver. Note that P6.25 will want an `mc` job on `WorkerPool`, which does not exist yet — `runSweep` and `runOptimize` are the only two — so budget for the request/response shape as part of it.
- **Branch note, and this run did one thing differently from the 65th–67th.** The harness pinned `claude/upbeat-ride-lm5cj2` while `CLAUDE.md` asks for direct commits to `main` and for no `claude/*` branches left behind. Development happened on the branch and was merged into `main` as a fast-forward, which is where the work lands — but **the branch was never pushed, and was deleted locally instead**. Earlier runs pushed theirs, which is why `claude/vibrant-faraday-up239g` and `claude/vibrant-faraday-v9vy0a` are on the remote today and why **P0.95/P0.107 keep growing**: this environment cannot delete a remote ref, so every pushed harness branch is permanent. Pushing one adds nothing once `main` carries the commits, and it makes a filed defect worse. **Do not push the harness branch here.** Nothing about P0.107 was tested this run and nothing about it is claimed — the count was simply not increased.
- **Not this run's work, recorded because the routine visits three repositories**: `paper-trader` is **still unpushable** — `git push` 403s and `create_branch` returns `Resource not accessible by integration`, so the Claude GitHub App is not installed for it. That is now three runs in a row; this run's seven commits there (backlog `F6`, the single `scripts/check.sh` gate, its 13 tests, and the `.gitignore` that repository had never had) were exported as a bundle and a patch series to the owner rather than left to die with the container. `telehealth` had **no claimable work** for the 25th consecutive session — every row is owner-gated — and closed out cleanly on `main`.

## 2026-09-01 (67th run) — **P6.23: an estimator that cannot police itself, and three numbers that can**

- **P6.23 done, taken because it is the first `todo` by `seq` (247)**, with nothing `in-progress` and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written, and the 66th run's entry nominates it by name. Claimed before any code. `ROADMAP.json` carries the full record, as `policy.commitRules` requires, and this entry does not restate it.
- **VALIDATION MET, and against an _exact_ number rather than against a slower estimate of the same unknown.** The criterion is "IS estimate matches brute force at 10× fewer samples (constructed tail)". Over 200 independent replications at `p = 1.59109e-4`: brute-force RMSE **8.935e-5 at N = 20000** against importance-sampling RMSE **7.761e-6 at N = 2000** — an **11.5× smaller error at the 10× fewer draws the criterion names**. Since Monte Carlo error falls as `1/sqrt(N)`, brute force would need about `11.5² = 132×` more than its 20000 to match. `packages/analysis/src/importance-sampling.ts` plus **44 tests**.
- **The tail is a real hit probability whose closed form nevertheless survives, and that is the whole design of the demo.** Drag-free range `v0² sin(2θ)/g` is _strictly increasing_ in `v0`, so "the shot carries past a no-go line at `R_t`" is exactly "`v0 > sqrt(R_t g / sin 2θ)`" — a Gaussian upper tail with an analytic probability. Both estimators are scored against that number rather than against each other: **two noisy estimators agreeing is not evidence**, and a brute-force estimate at these sample sizes is far too noisy to be anyone's reference. The monotonicity step is asserted in the suite, not assumed, because it is what makes the closed form legitimate.
- **"Matches" could not be read as "one IS study lands near one brute-force study", and saying why is half the work.** At this `p` a single 20000-draw brute-force study sees about 3 hits, so its estimate is a small integer over 20000 and cannot be close in relative terms; that comparison would pass or fail on the seed. It is read instead as three claims that have content: smaller RMSE, **both estimators unbiased** (`|z| = 0.68` for IS, `1.57` for brute force on their means over replications), and a single study being informative — **200/200** IS studies land within 25% of the truth against **39/200** for brute force at ten times the cost. The unbiasedness half is the control: the RMSE claim alone would be satisfied by an estimator returning a well-chosen constant.
- **Three diagnostics ship beside `pHat`, because a bad proposal does not fail loudly.** It returns a plausible number computed from one or two draws, and its _sample_ standard error — computed from that same degenerate sample — is small, so the estimate and its error bar agree with each other and are both wrong. Measured: an over-tilted proposal (`ν = μ + 12σ`) puts **100%** of draws in the event, which looks like a triumph, and returns **`3.00e-16` against a true `1.59e-4`** — wrong by twelve orders of magnitude, reporting a standard error of `3e-16`, i.e. content with itself. Kish's ESS of **1.09 out of 2000** is the only thing that says otherwise. Both failure modes show `ESS ≈ 1` for opposite reasons: the untilted study saw one hit; the over-tilted one made 2000 hits of which **one carries 96% of the answer**.
- **Two negative controls, because the machinery is not what helps.** With `ν = μ` every weight is **exactly** 1 — the closed-form log-ratio short-circuits at `d = 0` rather than subtracting two equal squared z-scores, so the suite asserts `weights.every(w => w === 1)` rather than a tolerance — and the estimator collapses to brute force, seeing 1 hit in 2000 draws. Plus the over-tilt above. **`σ` is deliberately shared between `f` and `g`**: widening the proposal instead of shifting it gives likelihood ratios unbounded in the far tail, which is the textbook way to build an _infinite-variance_ estimator whose every individual draw still looks fine.
- **One number in a draft of the note was wrong and was corrected against a measurement, not reasoned away.** The diagnostics table first recorded the untilted proposal's weight efficiency as 1.00 on the argument that equal weights are perfectly even. They are — but efficiency is `ESS/N`, and with one hit in 2000 draws that is `0.0005`. Every figure in `docs/notes/rare-events.md` and the `docs/analysis/README.md` section is now a value printed by the suite.
- **Gate at the pushed tree, run as CI runs it rather than as `CLAUDE.md` lists it** (P0.110's point, still open): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm lint:deps`, **both typedoc steps**, `pnpm test` — **3316 passed across 289 files** (up from 3272) — and `pnpm build`. All clean.
- **P0.118 filed: a Plotly teardown race, found on the untouched baseline before this run wrote a line.** `app-routes.e2e.test.ts`'s hashchange walk failed with three page errors reading `Cannot read properties of undefined (reading '_redrawFromAutoMarginCount')` — Plotly's own autoMargin redraw counter, dereferenced off a graph object that is gone. **It is load-dependent and the evidence is clean**: 3941 ms and red inside the full 287-file parallel suite, 1077 ms and 1274 ms and green on two consecutive isolated runs. So it is a race, not a wrong value — under load the route walk outruns a redraw scheduled against a div the next hashchange has already torn down. **Filed as a defect, not a flake, and the distinction is the point**: P0.96 and P0.112 are wall-clock _assertions_ that flake under contention, where the measurement is load-sensitive and the code is fine; here a real unhandled error escapes from the _application_ during an ordinary user action and the test is correctly reporting it. Do not fix it by widening the assertion or filtering the message. Whoever takes the lazy-Plotly item should read P0.118 first — an async mount boundary widens exactly this race.
- **The baseline was red on arrival, on `main`, with two failures — and neither reproduced in the final run.** `chunked-integration.test.ts` measured **47.467 ms** against its 10 ms per-slice wall-clock budget (P0.112/P0.96, already filed, this container is slow enough to overshoot by 4.7×), and the P0.118 walk above. Both were green in the gate run. **That is one observation each and neither task is narrowed or closed**, exactly as the 64th and 65th runs recorded for P0.112.
- **Next run picks up P6.24** (`seq` 248, the MC dashboard route: inputs → hist, fan, hit prob, sensitivities). It is the first consumer of P6.10's fan, P6.21's clustering and P6.22's overlay — none of which is reachable from the app yet — and it is where that changes. Note that it is a Plotly-bearing route, so **P0.118 is directly upstream of it**; consider fixing that first rather than adding a tenth route to the race.
- **Branch note, unchanged from the 65th run.** This run's harness pinned `claude/nice-keller-ja19gj` while `CLAUDE.md` asks for direct commits to `main` and for no `claude/*` branches left behind. Both were honoured the way `CLAUDE.md` sanctions: developed on the branch, merged into `main`, which is where the work lands. Deletion of the remote ref remains impossible in this environment — first-hand confirmation of P0.95 and P0.107 for the third run running.
- **Not this run's work, recorded because the routine visits three repositories**: `Computing-Platform` closed `[P2] Convection-diffusion matrix generator` and pushed 7 commits to its `main` (1030/1030 on three presets, 1031/1031 on the fourth). `islebound` follows this entry.

## 2026-09-01 (66th run) — **P6.22: painting P6.21's partition, and a stability claim that belongs one layer down**

- **P6.22 done, taken because it is the first `todo` by `seq` (246)**, with nothing `in-progress` and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written. Claimed before any code. `ROADMAP.json` carries the full record, as `policy.commitRules` requires, and this entry does not restate it.
- **VALIDATION MET.** The criterion is "legend/count per cluster; stable colors across reruns (seeded)". The legend recovers the two-arc fixture's **40/40** split, one row per cluster with distinct swatches and fractions summing to 1; two seeded reruns give byte-identical membership colours. `packages/viz/src/cluster-overlay.ts` plus **20 tests**.
- **The stability half is inherited from P6.21, not created here, and the suite is built to say so.** k-means labels are arbitrary names for one partition — two runs can agree perfectly and still return `[0,0,1,1]` and `[1,1,0,0]`. `canonicaliseLabels` already fixes a total order by first appearance, so a fixed label-to-slot mapping is stable for free. This module could not have fixed that if it were broken, so **a control asserts the failure mode**: a permuted labelling of the _same_ partition does change the colours, and canonicalising puts them back. Without it the stability test would pass equally well against a function returning one constant colour.
- **It lives in `@ballista/viz`, not beside P6.21, and the reason is a cycle.** The palette comes from `@ballista/runtime`, which already depends on `@ballista/analysis`; a palette-aware module in `analysis` would close the loop. `CLUSTER_PALETTE` aliases `COMPARE_PALETTE` (Okabe-Ito 2008) rather than copying it — one categorical palette, one thing to keep colourblind-safe, and no second definition for `colormap-enforcement.test.ts` to find. **`k > 8` throws rather than cycling**, following `compare-store.ts`'s refusal of a ninth pin: a cycled hue makes two clusters indistinguishable, and a legend that says otherwise is worse than no legend.
- **`commonSupportEnd` is reported per cluster, and that is the substantive commitment.** The two modes' times of flight differ by `sin 60°/sin 30° = 1.73`, so on a union grid the short mode's median is `NaN` over a stretch where the long mode's is still a real curve. One ensemble-wide number would hide it and a chart trusting it would draw a line through empty air. A test builds the union grid deliberately and asserts the short cluster's last sample is `NaN` with count 0 while the long cluster's is finite. An **empty cluster keeps its row** with an all-`NaN` median, because dropping it would renumber every cluster after it.
- **The median is `buildEnsembleFan` at a single level of 0.5**, not a median written here — reusing the tested resampling and, more to the point, the tested `NaN` handling. A singleton-cluster test pins it to the analytic arc to 6 dp, so the reuse is checked rather than assumed.
- **One test assertion was wrong on the first run and was fixed in the test, not the module**: `canonicaliseLabels` relabels _in place_ and returns the old-to-new permutation, so the assertion had been comparing a length-`k` permutation against a length-`n` colour array.
- **The default clone was shallow again, and it reported a false divergence.** `git status` on arrival said `main` was **ahead 50, behind 50** of `origin/main` with an _empty_ merge-base — the "unrelated histories" reading that telehealth's BL-039 record warns about by name. `git fetch --unshallow` first, every time: after it, `main` was **0 ahead / 73 behind**, a clean fast-forward with merge-base `d337cab`. Nothing was reconciled by hand and nothing needed to be. Recorded because a run that took that first reading at face value could have "resolved" a conflict that does not exist.
- **Gate at the pushed tree, run as CI runs it**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm lint:deps` (**1639 modules, 4636 dependencies**, no violations), `pnpm test` **3272 passed across 287 files** (up from 3252), `pnpm build`, and the bundle budget (**73.1 kB gzipped** against 300 kB, unchanged — this module tree-shakes out until P6.24 imports it). All clean.
- **Next run picks up P6.23** (`seq` 247, rare-event note + importance-sampling demo), then **P6.24**, the MC dashboard route that is the first consumer of P6.10's fan, P6.21's clustering and this module. Nothing in this run's work is reachable from the app yet, and P6.24 is where that changes.
- **CI 283 attempt 1 was red at `117dfd2`, and P0.117 is filed for why.** The Test step exited 1 **with every test passing** — 287 files, **3272 passed, 0 failed**, and separately `1 error`: an unhandled rejection from inside playwright-core's Firefox transport (`assert` ← `FFPage._onWebSocketOpened` ← `FFSession.emit`), attributed to P0.114's `app-routes.e2e.test.ts`. **Attempt 2 on the same commit passed all 35 steps**, carrying on through the four the local gate cannot cover plus Build app and the bundle budget — so the run is green and the failure is non-deterministic, established by the one re-run the rules allow rather than asserted. It is **not this run's**: the commit touches only `packages/viz`, the new module has no browser surface, nothing imports it yet and the bundle is unchanged, so there is no mechanism. **It could not be reproduced locally and nothing here claims it was** — `tryLaunch` skips a target whose binary is absent and this environment has chromium only, so the Firefox half of every browser suite runs exclusively on CI. Filed rather than retried: a rejection escaping to the process is a lifecycle bug, and the same race can drop a real failure as easily as a phantom one. **Do not close P0.117 by disabling, skipping or retrying the Firefox target** — P0.114 exists because nine routes had no browser coverage. First sighting; one observation is not a rate.
- **Not this run's work, recorded because the routine visits three repositories**: `paper-trader` is **still unpushable** — `git push` 403s and the GitHub API returns `Resource not accessible by integration`, so the Claude GitHub App is not installed for it. That is now two runs in a row; this run's five commits there were exported as a patch and a bundle to the owner rather than left to die with the container, and the blocker was escalated directly. `telehealth` has **no claimable work** (24th consecutive session; every row is owner-gated) and closed out cleanly.

## 2026-09-01 (65th run) — **P6.21: clustering an ensemble that a fan chart averages away, and a fixture built so that passing it means something**

- **P6.21 done, taken because it is the first `todo` by `seq` (245)**, with nothing `in-progress` and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written. Claimed before any code. `ROADMAP.json` carries the full record, as `policy.commitRules` requires, and this entry does not restate it.
- **VALIDATION MET.** The criterion is "bimodal two-arc ensemble separates into 2 clusters (ARI > 0.9 on labeled fixture)". 80 replicates, two modes, labels known by construction: **ARI = 1.0**, sizes 40/40, converged. `packages/analysis/src/trajectory-clustering.ts` plus 36 tests.
- **The fixture uses complementary angles on purpose, and that is the interesting part.** The modes launch at 30° and 60°. In vacuum those give _identical range_ — `v² sin(2θ)/g` is symmetric about 45° — so the single most obvious observable cannot separate these populations at all, and a feature vector that quietly collapsed to "range" would score near zero. A test asserts exactly that: clustering on range alone scores **below 0.5**. What does separate them is the shape of `y(t)` and the time of flight, which differ by `sin 60°/sin 30° = 1.73`.
- **ARI = 1.0 on one fixture cannot tell a working pipeline from a metric that always says 1**, so three controls sit beside it. Shape alone, no observables, also clears 0.9 — the resampled `y(t)` block does work rather than riding on the scalars. Modes moved to 40°/50° overlap genuinely and land strictly between chance and perfect, so the score is not saturated. And **80 replicates drawn from one distribution but labelled as two score ARI ≈ 0 while still being split into two non-empty clusters** — the "a partition is not evidence that k populations exist" caveat, tested rather than asserted in a comment. That last one is also why the criterion is an ARI: the unadjusted Rand index reads 0.5 there and looks like signal.
- **The grid is the intersection of the supports, not the union, and one `NaN` is why.** P6.10's `buildCommonGrid` spans the union because a fan chart must thin honestly past the first impact — so a replicate that landed early resamples to `NaN` out there, deliberately. Feed one `NaN` into a Euclidean distance and every distance involving that row is `NaN`; **`NaN < best` is `false`**, so the row silently sticks to whichever centroid it met first and k-means returns a confident, meaningless partition. `buildCommonSupportGrid` samples only where every replicate has a value, the observables carry what happens after the first landing, and `buildTrajectoryFeatures` refuses to emit a non-finite feature at all rather than let one reach the metric. A test feeds it the union grid and asserts the throw.
- **Standardising fixes the units and not the dimension count.** `y(t)` is metres in the hundreds against a time of flight in the tens, so raw columns make the distance a statement about metres and the observables decoration. Z-scoring settles that; 32 correlated shape columns still outvote 2 observables on count alone. `blockWeights` defaults to `1/sqrt(blockSize)` per block so the two contribute equally — **a modelling choice, documented as one** in the module and the README, not a law.
- **Labels are canonicalised so P6.22's colours cannot flicker.** Two runs can agree perfectly on the partition and still return `[0,0,1,1]` and `[1,1,0,0]`; every metric worth computing is invariant to that and a legend is not. Cluster 0 is always the one holding the lowest-indexed row — a total order independent of the feature values, so it survives a rescale. Seeding is `PCG32` per §8.5/ADR-011, k-means++ with 10 restarts.
- **Four test assertions were wrong on the first run and were fixed in the test, not the module.** Two traced to one real fact worth recording: **`y(t=0) = 0` for every replicate**, because they all launch from the ground, so the first shape column is genuinely constant and contributes no energy — the zero-variance branch of the standardiser, seen from outside. The assertions now state that instead of assuming every column has variance. A third was a fixture bug: `range` is not recoverable from `y`/`vy` alone, because `T = 2·vy₀/g` makes time of flight and `vy₀` perfectly collinear, so `arc()` now records `x` and `vx` too.
- **The docs check caught the missing README section — the suite was red before the docs commit, not after someone noticed by hand.** `packages/validation/src/analysis-docs.test.ts` requires an API-map row for every module `index.ts` re-exports.
- **Gate at the pushed tree, run as CI runs it rather than as CLAUDE.md lists it** (P0.110's point, still open): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm lint:deps` (**1633 modules, 4617 dependencies**, no violations), `pnpm test` **3252 passed across 286 files**, both typedoc steps, `pnpm --filter @ballista/app build`, and the bundle budget (**73.1 kB gzipped** against 300 kB) — all clean.
- **P0.112's `chunked-integration` wall-clock flake did not fire this run.** One observation, not evidence it is gone; **P0.112 stays open and un-narrowed**, exactly as the 64th run recorded.
- **Branch note.** This run's harness pinned a `claude/upbeat-ride-bm6tdd` development branch while `CLAUDE.md` asks for direct commits to `main` and for no `claude/*` branches left behind. Both were honoured the way `CLAUDE.md` itself sanctions: the work was developed on that branch and then merged into `main`, which is where it lands. **The branch was then deleted — attempted, and refused.** `git push origin --delete claude/upbeat-ride-bm6tdd` fails here with `send-pack: unexpected disconnect while reading sideband packet` / `the remote end hung up unexpectedly`, twice, and `git ls-remote --heads` confirms the ref is still there afterwards. So this run **adds one more stale `claude/*` branch to the remote** despite `CLAUDE.md` asking for none, and it is recorded rather than glossed: its content is fully merged into `main`, so nothing is stranded, but the ref remains. **This is first-hand confirmation of exactly what P0.95 and P0.107 already say** — the environment cannot delete remote branches — and it is one more for the 84 those tasks count.
- **Not this run's work, recorded because the routine visits three repositories**: `paper-trader` remains unpushable (HTTP 403, the Claude GitHub App is not installed for it) and seven finished commits are stranded there; they were exported as a patch to the owner. That belongs in that repository's log and is mentioned here only because the ordering rule sent this run there first.

## 2026-08-31 (64th run) — **P0.114: nine routes had no browser coverage, and the first run of the new suite found two defects**

- **P0.114 done.** `packages/app/src/app-routes.e2e.test.ts` — 22 cases per browser target, driving **all ten routes** (the nine `ROUTE_HASHES` plus the default) in a real browser against the vite **dev** server on port **3002** (`BALLISTA_E2E_PORT` overrides; the 3000-3010 band the owner's instruction named). 44/44 green on chromium in 20 s; firefox skips here exactly as every browser suite in this repo does, and runs for real in CI, which already installs both. `ROADMAP.json` carries the full record, as `policy.commitRules` requires, and this entry does not restate it.
- **Claimed against an explicit owner instruction, and the claim landed mid-work rather than before it.** The scheduled prompt said: run the dev server on a port in 3000-3010, write a comprehensive Playwright suite for the UI, run it, iterate until it passes. The routine's step 3 wants the claim recorded before any code; here the ROADMAP rows went in after the first draft of the test file, because the shape of the gap was only knowable after reading what coverage already existed. Recorded rather than tidied up.
- **The gap, stated precisely, because it is the interesting part.** `app.e2e.test.ts` (P3.46) is a smoke suite for the **default** route: load, scrub, pin, share-URL. Each of the other nine routes has a `*-route.test.tsx` beside it and they all pass — but those mount one component under jsdom, and **not one of them goes through `main.tsx`'s `renderRoute` switch**. So a route could be declared in `routes.ts`, wired into the switch, unit-tested and green, and still be dead on arrival from a bad import or a module-scope throw. `routes.test.ts` compares the two _tables_ and by construction cannot see it. The new cases are generated from `ROUTE_HASHES`, so a tenth route cannot be added uncovered.
- **P0.115 done — a real correctness bug, and the console was reporting it the whole time.** `convergence-study-route.tsx` and `stability-explorer-route.tsx` each built their scenario `<select>` as `PRESET_SCENARIOS.map((spec) => ({ id: spec.projectile.id, label: spec.projectile.name, spec }))`. A projectile is not a scenario: presets 5 and 6 are the **matched headwind/tailwind pair** `scenario-library.ts` exists to let a user compare — same ball, same launch, wind reversed — so both options came out `id="baseball"`, label `"Baseball"`. `SCENARIO_OPTIONS.find((o) => o.id === scenarioId)` returns the first match, **so selecting the tailwind entry silently studied the headwind one, and the tailwind scenario was unreachable from either route.** Preact had been warning `two or more children with the same key attribute: "baseball"` on every load of both; nothing was listening until a test started asserting on `console.error`. Fixed by deriving the options from `SCENARIO_LIBRARY`, whose `PRESET_CURATION` half already carries a unique id and human title per preset (`"headwind"` / "Batted ball into a headwind"). **No engine or library data changed** — the duplicate `projectile.id` is correct, it genuinely is the same ball, and it was never the bug.
- **P0.116 filed, not fixed.** `packages/app/index.html` declares no `<link rel="icon">`, so the browser asks for `/favicon.ico` on its own and gets a 404 on every load. Filed rather than fixed because an icon is a product decision, and because the request is issued by the browser process — it never appears in Playwright's request events at all, only as a console message, which is why P0.114's suite filters it by message text and says so in a comment rather than quietly widening its assertion.
- **One refactor, deliberate and contained**: browser acquisition (the sandbox-Chromium override, and the rule for when skipping a browser is legitimate) moved to `packages/app/src/e2e-browser.ts`, and `app.e2e.test.ts` now imports it instead of carrying its own copy. Two copies of a "when may a browser test skip" rule is precisely the duplication that drifts until one of them silently stops running. `app.e2e.test.ts`'s own build+preview server was left alone: the two suites want different servers **on purpose** — that one is about the shipped bundle, this one is about the routes.
- **Gate at the pushed tree**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm lint:deps` (1627 modules, 4598 dependencies, no violations) all clean; `pnpm test` figures in the note below.
- **Not claimed, and worth being explicit about**: `pnpm test` was **3172 passed across 284 files** on the pre-change baseline measured this run, including `chunked-integration.test.ts` — so P0.112's wall-clock flake did **not** fire locally today. That is one observation, not evidence the flake is gone, and P0.112 stays open and un-narrowed. This run adds 44 browser cases, which is exactly the "adding tests meets the flake" trigger P0.112 predicts, so a red `chunked-integration` on the CI run for this push is **that** flake and not this work.

## 2026-08-31 (63rd run) — **P6.20 done: two charts that must not share a scale, and a cancel that is not a censoring**

> **Addendum — CI 278 red at `f7e4244`, and it is P0.112, not P6.20.** Job `99407111165`,
> read from the **job** record per the standing stale-status trap. Steps 1-10 green
> (typecheck, lint, **format**, import boundaries); the **Test** step failed on
> **one** assertion out of **3172 across 284 files**:
> `packages/solverkit/src/chunked-integration.test.ts` at **12.195367 ms** against its
> 10 ms per-slice wall-clock budget. That is the already-filed P0.112 / P0.96 flake, in
> `solverkit`, **a package this run does not touch** — and all three of this run's new
> test files passed there, `sensitivity-study-panel.test.tsx` included (9 tests, 112 ms).
> **The assertion was not weakened, skipped or retried.**
>
> **This is the first time it has fired on CI, and that is the part worth carrying
> forward.** Every earlier sighting was local, and the 61st run's local-red/CI-green
> split was itself used as evidence that the assertion tracks the developer's machine.
> A GitHub-hosted runner is a different machine and it fails there too, so the reading
> narrows to the one P0.112 already argues: **wall-clock under a parallel pool measures
> contention, not the chunker.** This run added 50 tests in 3 files — precisely the
> trigger P0.112 predicted would meet it again — so a later session should expect this
> when it adds tests and **not go hunting for a bug in its own work**. P0.112's notes
> carry the full record.
>
> **A cost not previously recorded:** because steps 12-17 are skipped once Test fails,
> this flake also takes out the benchmark, cross-engine-drift, both typedoc steps, the
> app build and the bundle-size budget — the four CI-only checks P0.110 exists for. So
> `main`'s HEAD has **no CI evidence** for those today. All six were run locally before
> the push and passed (bundle 73.1 kB gz against 300 kB), which is not the same thing
> and is not claimed as such.
>
> `ci.yml` here has **no `workflow_dispatch`** — unlike the sibling repo's — so there is
> no way to re-trigger without a commit. This addendum's own commit creates run **279**,
> which is therefore a de-facto re-run of the flaky assertion on essentially the same
> tree; per this file's convention it is **not chased**. One follow-up entry, then stop.

- **P6.20 done, criterion met on the half of it that is easy to miss.** `runSensitivityStudy` in
  `packages/runtime/src/sensitivity-study.ts`, `sensitivity-study-panel-logic.ts` and
  `sensitivity-study-panel.tsx` in `packages/ui/src`, all three exported from their package
  indexes. 50 tests. `ROADMAP.json` carries the full numbers and the design reasoning, as
  `policy.commitRules` requires, and this entry does not restate them. The criterion —
  "recompute streams progress; cancellable" — is about the drive rather than the drawing, so the
  DOM test holds a **deferred** study open and asserts the progress element reads 0.05 then 0.60
  **while the study is still unresolved**. A test that only checks a finished study cannot reach
  that, and would have passed against a pane with no streaming at all.
- **The one real design decision: stopping a run must not be expressible as censoring.** The
  obvious way to cancel mid-flight is to have the wrapped `evaluate` return `null` — but `null`
  already means "this point has no answer" to both estimators, so a cancelled run would come back
  as a heavily _censored result_: a wrong statement about the physics rather than the absence of a
  statement. The wrapper throws instead, and unwinds out of whichever estimator is running.
  Censoring is a claim about the model; cancelling is a claim about the user, and the type system
  will not keep them apart on its own.
- **The two charts are normalised separately, and that is the pane's whole honesty argument.** A
  tornado bar is a length in output units; a Sobol' bar is a dimensionless share of variance.
  Tornado bars scale against the widest, but Sobol' bars stay on a fixed `[0,1]` scale, because
  rescaling them to the largest index would render a decomposition where _nothing_ dominates
  identically to one where something does. Same reasoning one level down: Sobol' bar **widths**
  clamp at zero while the reported **numbers** keep their sign, so a negative `S_k` — which is the
  signal that `N` is too small — still reads as `-2.0%` beside a zero-width bar rather than being
  laundered into a resolved zero.
- **Progress is counted, not estimated.** Both estimators cost exactly the number of times they
  call the model, so the module wraps the caller's callback and counts entries rather than
  instrumenting the estimators. The denominator is then an arithmetic fact — `2d+1` and `N(d+2)` —
  that cannot drift out of step with the implementations it describes, and a test pins the run to
  exactly that count, arriving strictly one at a time.
- **Baseline was red on arrival and that was P0.111, not this work.** `pnpm test` on a fresh clone
  failed 3 assertions in `cross-engine-drift-record.test.ts`; running `pnpm typecheck` first (which
  emits `packages/engine/dist`) clears them, exactly as P0.111 says. **Read that task before
  spending a suite run rediscovering it** — this is the third run to hit it. Final gate in CI's own
  order: typecheck, lint, `lint:deps` (no violations, 1618 modules), `pnpm test` **3172 passed /
  284 files**, plus `format:check` clean, `@ballista/app` build green and `check-bundle-size`
  **73.1 kB gzipped against a 300 kB budget**. Baseline for comparison was 3122 / 281.
- **Scoped out rather than quietly absorbed.** The pane is not mounted on a route — that is P6.24,
  and `runStudy` is a prop for the same reason `BasinPanel`'s `runSweep` is. No CSS: no panel in
  this repo ships a stylesheet and `app-shell.css` carries no panel rules at all, so adding one
  would have been a new convention rather than this task. **P0.113 is inherited and visible in the
  UI**: the pane's "within 2 s.e. of zero" flag reads `firstStandardError`, which under the default
  `sobol` sampling is not the quantity its name says, so the flag is a heuristic and is left as
  P0.113's to fix rather than worked around here.
- **Not verified from this run, and not claimed:** CI itself. The two typedoc steps build `engine`
  and `solverkit`, and this run touched neither — so, as the 62nd run's addendum said of `analysis`,
  they are not evidence that this run's own TSDoc resolves. No CI run is chased in this entry.

---

## 2026-08-30 (62nd run) — **P6.19 done: the variance a tornado cannot attribute, and the invariance this module claimed before it had it**

> **Addendum — CI 276 green at `c531467`, event `push`, all 35 steps; `main` is green.**
> Read from the **job** record rather than the run record, per the standing stale-status
> trap: `get_workflow_run` still said `in_progress` after steps had completed. Test 1m57s,
> 3m52s end to end. The four steps the local gate cannot cover all passed — benchmark
> regression, cross-engine drift, Engine API docs and SolverKit API docs — which is worth
> naming for this run specifically, because `sobol-indices.ts` carries several `{@link}`
> tags and the 44th run's finding is that a doc comment can be latently broken until
> something inlines the type. **Scoped honestly:** those typedoc steps build `engine` and
> `solverkit`, not `analysis`, so they are not evidence that this run's own TSDoc resolves.
> **`P0.112` did not fire on CI either**, matching this run's local full-suite pass — the
> first run in three where both came in green on the same tree, and still not evidence the
> flake is fixed. Run 277, created by this addendum's own commit, is not chased: one
> follow-up entry, then stop.

- **P6.19 done, criterion met with two orders of magnitude to spare.** `sobolIndices` in
  `packages/analysis/src/sobol-indices.ts`, re-exported from `index.ts` and documented in
  `docs/analysis/README.md` under "Sobol' indices, and the variance a tornado cannot
  attribute". 21 tests. Saltelli et al. 2010 for the first-order estimator, Jansen 1999 for
  the total, over one 2d-dimensional scrambled Sobol' sequence from the engine split into
  the `A` and `B` matrices. `ROADMAP.json` carries the full numbers, as `policy.commitRules`
  requires, and this entry does not restate them.
- **A doc comment claimed an invariance the module did not have, and the test that was
  written to demonstrate the claim is what disproved it.** The first-order numerator is
  written `f_B (f_k − f_A)` rather than `f_A f_k − mean²`, and the module header said the
  differenced form is therefore invariant to an output offset. It is not. Under `f → f + c`
  the term picks up `c (f_k − f_A)`, whose mean is zero **in expectation** and not in a
  finite sample; at `c = 10⁶` against a spread of order 1 the residual swamped the estimate
  and `S₀` came back **13.43** where the analytic value is **0.762**. The fix is to centre
  both samples on the pooled mean before forming any term, which makes the invariance exact
  because the pooled mean absorbs `c` by the same arithmetic that introduced it. The header
  now records the measurement instead of the claim, and the offset test is kept as a
  regression test. This is the second run running in which a doc comment asserted something
  the measurement contradicted — see the 61st run's `asymmetry` bullet — and in both cases
  the correction went into the doc, not the tolerance.
- **The criterion's own function cannot fail the way this module exists to catch, so it is
  not the only reference.** "Indices on an additive test function match analytics ±0.05" is
  met on `4x₀ + 2x₁ + x₂` to a maximum deviation of `1.0e-4` — but an estimator that ignored
  interactions **entirely** would pass every additive assertion, because an additive model
  has none. Ishigami is in the suite for that reason, and its third input is the case that
  matters: `S₃ = 0.000570` against an analytic **0**, `S_T₃ = 0.243593` against **0.243684**.
  It moves a quarter of the output's variance and none of its mean, so `tornado.ts` draws it
  a short bar. That short bar is exactly the failure P6.18's own header filed this task to
  fix, now demonstrated rather than asserted.
- **A negative index is reported unclamped, and that is the deliberate choice.** Jansen's
  total form is a mean of squares and so is non-negative by construction; the Saltelli
  first-order form is not. A small negative `S_k` is a legitimate estimate of a near-zero
  index, and clamping it to zero would erase the single cheapest signal that `N` is too small
  to resolve that input. The suite asserts the sign guarantee on the total and the absence of
  one on the first order, in the same result.
- **The reported standard error is honest about being the wrong formula for the default
  sampler, and that gap is filed rather than papered over.** It is the plain i.i.d. figure,
  which is the quantity its name says only under `sampling: "random"` — asserted there as a
  three-sigma bracket. The default is scrambled Sobol', whose points are deliberately
  correlated, so under it the suite only **measures** that the deviation sits inside the
  figure (`1.0e-4` against `0.0185` on the additive reference) rather than describing the
  relationship as a bound, which it is not. **`P0.113`** filed for the real fix: the spread
  across R independent scrambles, which the engine's `sobolUniform` already supports since it
  takes the scramble seed.
- **Full gate green at `51a87e7`, run locally in full:** `pnpm typecheck`, `pnpm lint`,
  `pnpm lint:deps` (1600 modules, 4533 dependencies), `pnpm format:check`, `pnpm test`
  **3122 passed across 281 files**, and `pnpm build`. **`P0.112`'s `chunked-integration`
  flake did not fire in this run's full-suite pass** — one datum, in the direction that
  note's own argument predicts, and not evidence it is fixed.

### Next run

- **`P6.20`: "Sensitivity UI pane: tornado + Sobol' bars with N controls"**, the direct
  successor now that both of its inputs exist. Read `docs/analysis/README.md`'s two adjacent
  sections before designing it: the pane's whole job is to show a reader why the two pictures
  disagree, and `interactionShare` is the number that explains it.
- **The `N` control is the part that needs a decision, not the bars.** Sobol' indices converge
  slowly and the slowest case is a _small_ index against a large variance, where the error does
  not shrink because the quantity does not. A UI that lets a reader turn `N` down until the
  bars look clean is worse than no UI, so whatever the pane shows must carry the standard error
  alongside the bar — and note that under the default `"sobol"` sampling that figure is not a
  confidence interval (see `P0.113`), which the pane must not imply that it is.
- **Do not treat a red `chunked-integration.test.ts` as your own regression.** It did not fire
  here, but the 61st run's measurement stands: the assertion measures host contention, not the
  chunker. Read `P0.112` before reading your own diff.

---

## 2026-08-30 (61st run) — **P6.18 done: the cheapest ranking of parameter influence, and the three places it lies**

> **Addendum — CI 274 green at `ed6cbe6`, event `push`; `main` is green, and the
> P0.112 flake did not fire there.** Read from the run record, which concluded
> `success` — the standing stale-status trap is a run reporting `in_progress`
> after its jobs finish, so a `completed`/`success` run record is not subject to
> it. The `Test` step passed, which is the part worth recording: this run's own
> local full-suite pass came in **red** on `chunked-integration.test.ts` at
> 14.228 ms and CI's came in green on the same tree. That is one more datum for
> P0.112 in the direction its notes already argue — the assertion measures the
> host's contention, not the chunker, so it fires on the local container and not
> on the CI runner. It is **not** evidence the flake is fixed, and a later run
> that sees it red locally should still read P0.112 rather than its own diff.
> Run 275, created by this addendum's own commit, is not chased: one follow-up
> entry, then stop.

- **P6.18 done, criterion met.** `oneAtATimeTornado` and `compareTornadoToFirstOrder` in
  `packages/analysis/src/tornado.ts`, re-exported from `index.ts` and documented in
  `docs/analysis/README.md` under "One-at-a-time tornado, and what a bar chart cannot show".
  32 tests. `ROADMAP.json` carries the full notes, as `policy.commitRules` requires, and this
  entry does not restate them.
- **The criterion compares a finite difference against a derivative, and that framing is the
  task.** "Bar order matches the `|∂R/∂μ|σ` ranking" sounds like a sorting check. It is not:
  a bar's half-span is a _central difference_, `c|∂R/∂μ|σ + O(c³σ³R''')`, while the
  contribution is a derivative. On a linear response they are equal in floating point — the
  suite asserts that with `toEqual` — and where they differ, the difference **is** curvature
  over the interval the input spans. That is P6.17's condition arrived at from the other
  side, which is why agreement is reported as `identical` **plus** Kendall tau-b **plus** the
  discordant pairs: one adjacent swap between two near-indistinguishable inputs and a
  wholesale reordering both falsify `identical`, and they are not the same finding.
- **A doc comment made a claim the measurement disproved, and the claim was the one being
  shipped.** `asymmetry = |highShift + lowShift| / span` was documented as "growing towards
  1". It is not bounded by 1. Once the bar straddles a local extremum both endpoints move the
  same way, so the numerator survives while the denominator collapses: measured **0.415** at
  `scale = 1` and **3.506** at `scale = 8` on the drag-free range at `θ₀ = 45° − 0.06`. The
  doc was corrected against the measurement rather than the test written around the doc.
- **The case where both measures agree and both are wrong is in the suite deliberately.** At
  `θ = 45°` exactly, `∂R/∂θ = 0` so the contribution is zero, and the bar's endpoints are
  equal by symmetry so the span is zero. The rankings agree perfectly — and the response is
  not flat: it drops by `v₀²(1 − cos 0.1)/g` on _both_ sides. Only `monotone` separates the
  two situations. Without that test a future reader would take the agreement at the apex as
  evidence the method works, which is exactly backwards. It is also the case the P6.17
  section's closing sentence warned about, now demonstrated rather than asserted.
- **The ranking is a statement about an interval, so `scale` is a knob, not a constant.**
  Measured bar growth from `scale = 1` to `scale = 8`: **8.000000** for `v₀` (exactly the
  linear factor) and **7.185531** for θ, which is sub-linear because widening past the apex
  adds no span. Two inputs can therefore change relative order with the interval width while
  neither response changed.
- **What OAT structurally cannot do**, stated in the module header and the docs so P6.19 is
  not asked to be a refinement of it: `2n` evaluations, all on the axes through the nominal,
  are blind to interactions. That is the method's shape, not a resolution problem more points
  fix — it is what Sobol' total indices exist for. And bars combine **in quadrature**, so
  summing them overstates the spread.
- **A censored bar sorts last and blocks the comparison.** An input that can be moved to a
  value where the problem has no answer gets `span: null`, not `span: 0`; the latter would
  rank the input that _broke the problem_ as the least influential one, and
  `compareTornadoToFirstOrder` refuses a censored tornado outright rather than ranking it.

### The gate, and one red test that is not this run's

- **Green:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm lint:deps`, app build,
  `check-bundle-size` (73.1 kB gzipped against a 300 kB budget).
- **`pnpm test`: 3100 of 3101 passed, and the one failure is the filed flake `P0.112`, not
  this run's work.** `chunked-integration.test.ts`'s `maxSliceMs < 10` — a wall-clock budget
  measured inside a vitest pool running 280 files in parallel — came in at **14.228 ms**. It
  is in `packages/solverkit`, which this run does not touch; it passed **3 of 3** standalone
  runs immediately afterwards; and the baseline run before P6.18 landed passed it.
- **`P0.112`'s own note predicted this failure and was right.** It said the next test file
  heavy enough to load the pool would tip the assertion again, and that the failure would
  "look like a bug in whatever landed alongside it rather than in the assertion". P6.18's
  32-test file did exactly that. The note has been updated with this run's measurement: the
  58th run's mitigation is **spent**, and the overshoot is **growing** (10.768 ms → 14.228
  ms), so a session reading a red suite here can no longer use the margin to judge whether it
  is this flake.
- **The assertion was not weakened, skipped, retried or deleted.** The 10 ms budget is a real
  P2.40 requirement. The fix wanted is still an assertion that measures the chunker rather
  than the machine — step count per slice, or the median slice, or a serial benchmark outside
  the pool — and `P0.112` records that those three are not equivalent and that whoever takes
  it must decide which one P2.40 needs.

### Next run

- **`P6.19`: Sobol' first-order + total indices (Saltelli estimator)**, validation "indices on
  an additive test function match analytics ±0.05". It is the direct successor: P6.18's
  module header and docs both name the interaction blindness that Sobol' total indices exist
  to fill, so the gap is already written down and does not need rediscovering.
- The Ishigami function is the conventional analytic reference for this and has closed-form
  indices, but read `tornado.test.ts`'s header first for the pattern this repo's sensitivity
  suites use — a reference whose derivatives are _exact_, so a discrepancy is attributable to
  the estimator rather than to the reference.
- **Do not treat a red `chunked-integration.test.ts` as your own regression.** See above.

---

## 2026-08-30 (60th run) — **P6.17 done: the cheap uncertainty estimate, and the measurement that says when to stop trusting it**

> **Addendum — CI 272 green at `890714f`, event `push`; `main` is green.** Read from the run
> record, which concluded `success` — the standing stale-status trap is a run reporting
> `in_progress` after its jobs finish, so a `completed`/`success` run record is not subject to
> it, and no job-level re-read was needed. This closes the "CI on this push is not yet
> observed" caveat in the gate bullet below, which was accurate when written. Run 273, created
> by this addendum's own commit, is not chased: one follow-up entry, then stop.

- **P6.17 done, both halves of its criterion measured.** `firstOrderSpread`,
  `monteCarloSpread` and `compareFirstOrderToMonteCarlo` from
  `packages/analysis/src/first-order-sensitivity.ts`, re-exported from `index.ts` and
  documented in `docs/analysis/README.md` under "First-order spread, and when to stop
  believing it". `ROADMAP.json` carries the full notes, as `policy.commitRules` requires,
  and this entry does not restate them. The headline numbers: **+1.0%** agreement at
  σ_θ = 0.002 rad and **+20.4%** divergence at σ_θ = 0.8 rad, the latter at **27.7 standard
  errors** of the Monte Carlo estimate.
- **The interesting part of the task was not the formula, it was deciding what counts as
  evidence.** `σ_R ≈ sqrt(Σ (∂R/∂μ_k)² σ_k²)` is four lines. The task's criterion is
  "divergence shown for large σ", and a discrepancy outside 10% shows nothing on its own —
  a small enough study disagrees with anything. So a point is `significant` only when the
  discrepancy beats a multiple of the Monte Carlo σ's own standard error, and that standard
  error comes from the sample's **fourth central moment** rather than the Gaussian
  `σ/sqrt(2N)`, because the large-σ end where divergence gets claimed is precisely where the
  output stops being Gaussian. Using the Gaussian formula there would have been the shape of
  error where the number is plausible and the reasoning is circular.
- **Two things about this response that a straightforward sweep would have got wrong, and
  both are now asserted.** The discrepancy is **not monotone in σ** — on `R = v₀²sin(2θ)/g`
  at 30° it runs to **−5.7%** near σ = 0.3 rad, the truth spreading _more_ than the slope
  predicts, before turning positive and running away. A test sampling only the extremes
  would have read that crossing as agreement, so the dip is pinned at three σ values.
  And at the **45° stationary point** `∂R/∂θ` is exactly zero, so the first-order estimate
  predicts **no spread at all** against a true 4.56 m. That failure is not a percentage and
  shrinking σ does not fix it.
- **P6.18 should read that second point before it draws anything.** Its criterion is "bar
  order matches the `|∂R/∂μ|σ_μ` ranking", and `firstOrderSpread` now returns exactly those
  terms as `contributions` — but a chart that ranks by them is blind in the same way at a
  near-stationary gradient, and ranks an input that dominates the true spread last. The
  terms also combine **in quadrature, not additively**: 3 and 4 give 5, not 7, which is the
  arithmetic a tornado chart's total is easiest to get wrong.
- **P6.16's default paid out immediately, as its note predicted.** The σ sweep reuses one
  standard-normal draw matrix across every scale, so the trend in the discrepancy is
  attributable to the response's nonlinearity rather than to fresh noise per scale — the
  same common-random-numbers argument as `windReplication: "shared"`, one level up. It is
  checked to floating point rather than argued: on an exactly linear response the Monte
  Carlo spread rescales **exactly** with σ, 4× and 16× to ten decimals.
- **Gate, all measured locally at `5b6eb6a` before the close-out commit**: `pnpm typecheck`
  clean, `pnpm lint` clean, `pnpm format:check` clean, `pnpm lint:deps` clean (1588 modules,
  4515 dependencies), `pnpm test` **3069 passed across 279 files** (27 of them new here,
  0 failed), `pnpm --filter @ballista/app build` ✓ in 23.00s, bundle **73.1 kB gzipped**
  against the 300 kB budget. CI on this push is **not** yet observed — the run this entry's
  own commit creates is left for the next session to read, and nothing here claims it green.
- **One thing this run tripped over and the next should know.**
  `packages/validation/src/analysis-docs.test.ts` treats **any** `docs/analysis/README.md`
  table row starting `` | ` `` whose first two cells are both backticked as an API-map row,
  and asserts the first cell is a named export of the second. A field-description table
  (``| `relativeError` | `(firstOrder − mc.sigma) / mc.sigma` |``) therefore fails as
  "`relativeError` is not exported from `(firstOrder − mc.sigma) / mc.sigma`". The guard is
  right and the fix is to write per-field documentation as a **bullet list**, not a table.
  Not worth a ROADMAP filing; worth the thirty seconds it costs to know.
- **Next: P6.18** (`seq` 242), one-at-a-time tornado chart, 20m, E. Its inputs are already
  in place — `contributions` is its bar length and the 45° caveat above is its known failure
  mode. **`paper-trader` was not reached this run** and the reason is not budget: the
  GitHub App's grant there is read-only, `git push --dry-run` returns
  `403 Resource not accessible by integration`, and per this repo's own standing note the
  write path was probed **before** any work was done there, so nothing was stranded.

---

## 2026-08-29 (59th run) — **P6.16 done: the wind becomes an uncertain input, by choice rather than by default**

> **Addendum — CI 270 green at `3176717`, all 35 steps; `main` is recovered.** Step 14,
> **Engine API docs**, the one that was red at `09ae9bf`, passes in 5s, and steps 15-17 —
> SolverKit API docs, Build app, Bundle size budget — ran rather than being skipped. Test
> 2m25s, 4m21s end to end. Read from the **job** record rather than the run record, per the
> standing stale-status trap. Run 271, created by this addendum's own commit, is not chased:
> one follow-up entry, then stop.

- **P6.16, one frozen OU path per replicate, done.** `windReplication` on
  `UncertainScenarioSpec`; `replicateWindSeed`, `WIND_OVERLAY_INDEX` and `MAX_OVERLAYS` from
  `replicate-generator.ts`; `STOCHASTIC_WIND_KINDS` and `isStochasticWind` from
  `scenario-spec.ts`. Documented in `docs/analysis/README.md` beside the four sampling
  options; `ROADMAP.json` carries the full notes, as `policy.commitRules` requires, and this
  entry does not restate them.
- **The task turned out to be three lines of mechanism and one real decision.** ADR-011
  already resolves stochastic wind into a frozen path _before_ integration, so "give each
  replicate its own turbulence" reduces to "give each replicate its own scenario `seed`" —
  `seed` is the only input `toWind`'s `frozen-ou-gust` branch reads. No SDE solver, no second
  RNG discipline, and the determinism contract carries over untouched. That is ADR-011 paying
  out exactly as it was written to.
- **The decision is that this is opt-in, and the reasoning is worth keeping.** Sharing one
  frozen path across replicates looks like a limitation P6.16 exists to remove. It is not: it
  is common random numbers. Holding the gust field fixed while the parameters vary is what
  makes a difference between two replicates attributable to the parameters — which is
  precisely what **P6.17**'s finite-difference sensitivity rests on. Under per-replicate wind
  those two replicates differ in their parameters _and_ their weather, and the difference
  isolates nothing. So neither setting is right in the abstract, the choice is explicit in the
  spec, and `"shared"` is the default only because it is what every study written before today
  already meant. **Whoever takes P6.17 wants the default; it is not an oversight if their
  study does not set this field.**
- **The reserved slot is the part that would have been easy to get subtly wrong.** The wind
  seed is drawn on `WIND_OVERLAY_INDEX = OVERLAY_STRIDE - 1`, which no overlay can occupy, so
  switching the option on changes the wind and _nothing else_ — the drawn parameter vectors
  are asserted identical either way. Taking the **top** slot rather than slot 0 is what keeps
  it backward-compatible: freeing slot 0 would have shifted every overlay's substream and
  moved every replicate of every study ever run, with all tests still green, because they
  compare a study to itself.
- **Two refusals rather than two silent no-ops.** A per-replicate study on a non-stochastic
  wind is rejected at parse time. Ignoring it was the tempting alternative and is the worse
  one: the seed would change nothing, the study would still run, still report `N` replicates,
  and hand back parameter scatter dressed as turbulence spread — the silently-wrong-answer
  shape **P0.99** and **P0.101** were filed for, and worse here because the number produced is
  entirely plausible. A study that varies `seed` through an overlay _and_ asks for
  per-replicate wind is refused for the same reason: both write one field, and the study would
  quietly get whichever wrote last.
- **Antithetic partners deliberately share their primary's wind.** A seed has no distribution
  to reflect about — "the opposite gust field" is not a thing an OU path has — and sharing it
  keeps a pair's variance reduction (P6.12) attributable to the mirrored parameters rather
  than to two unrelated realizations.
- **The criterion is a seed criterion and the seed is not what matters, so both are checked.**
  Six partitions of twelve replicates (one batch, twelve singletons, 5+7, 7+5, 3×4, and an
  uneven 1+4+2+5) agree with generating each replicate alone and with the lazy generator — on
  the seed, and on the **frozen wind path** sampled through the PCHIP interpolant. The second
  is the one that would catch a seed written into the spec but never read by `toWind`, which
  satisfies every determinism assertion while changing nothing physical. Both path comparisons
  also assert the path is not identically zero, so neither passes vacuously.
- **One doc-test friction worth knowing about, since it will catch the next person.**
  `analysis-docs.test.ts` treats _any_ README table row starting with a backticked cell as an
  API map and requires cell 1 to name a file exporting cell 0. A prose table whose first
  column happened to be code-formatted therefore failed it. The table was rewritten as a list;
  the test was not touched, and should not be — its coverage check is what stops the API map
  rotting.
- **`main` was already red when this run started, and P0.110 is exactly why.** CI run **269**
  at `09ae9bf` — the 58th run's own closing commit — failed step 14, **Engine API docs**, and
  skipped 15-17 with it. typedoc fails on warnings and reported that
  `nestedUniformScramble`'s comment links to `laineKarrasPermutation`, a module-private
  helper, so the `{@link}` resolves to no rendered page. P6.15 therefore landed green locally
  and red on CI, because CLAUDE.md's documented gate (typecheck, lint, lint:deps, test) does
  not include the two typedoc steps CI runs. **That is P0.110's filing, unchanged and still
  open, biting for the second time** — the 43rd run hit the same gap.
  Fixed here rather than filed: the link is demoted to plain code text, which is what the
  54th run did to a cross-module link for the same reason, and exporting a private helper to
  please a doc tool would widen the public API. Pushing P6.16 onto a red `main` would also
  have attributed run 269's failure to this task.
  **The transferable part: run the two typedoc steps before pushing, whatever CLAUDE.md
  says.** A closing docs-only commit still creates a CI run that no session reads, and a
  `{@link}` can sit latent until something renders it — the 44th run's finding, now with a
  second instance.
- Gate green before the push, run in CI's own order rather than CLAUDE.md's: `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `pnpm lint:deps` (1522 modules, 4306 dependencies) all
  clean; `pnpm test` **278 files / 3042 tests passed** in 112.51s, up 14 from the 58th run's
  3028, all of them this task's; **both typedoc steps** exit 0; app build **28.56s**; bundle
  **73.1 kB gzipped** against the 300 kB budget. `P0.112`'s `chunked-integration` flake did
  not reproduce in either of this run's two full-suite passes.

---

## 2026-08-29 (58th run) — **P6.15 done, and a slope that says the scramble is the real thing**

- **P6.15, quasi-Monte Carlo with a scrambled Sobol' sequence, done.**
  `packages/engine/src/sobol.ts`: `sobolReplicates`, `generateSobolReplicate`,
  `sobolUniform`, `sobolInteger`, `nestedUniformScramble`. Exported from
  `@ballista/engine` and documented in `docs/analysis/README.md` beside the other three
  sampling options; `ROADMAP.json` carries the full notes, as `policy.commitRules`
  requires, and this entry does not restate them.
- **The criterion was beaten by more than it should have been, and chasing that down was
  the interesting part of the run.** The task asks for an `N^(-1)` slope on a smooth
  two-parameter problem; the measurement came back at **−1.4598** against plain MC's
  **−0.4522**. That is not a bug and not luck: Owen (1997) gives `O(N^(-3/2))` RMSE for a
  smooth integrand under _nested_ uniform scrambling, against `O(N^(-1))` for a plain
  digital shift. Five independent seed families give −1.4598, −1.3749, −1.3648, −1.4044,
  −1.3888; the same Sobol' points under an XOR shift give **−1.0297**. So the theory is
  confirmed from both sides, and the file now asserts **−1.2** alongside the criterion's
  −0.85 — a bound that a shift would fail and that every structural test would miss.
- **The structural tests exist because a rate cannot localise a fault.** A wrong direction
  number, a scramble that is not a bijection, and an off-by-one in the index loop all
  present identically: an error curve that is merely less good than it should be. So the
  properties underneath the rate are checked directly — every dimension is a
  `(0,1)`-sequence (which grades the _direction numbers_, failing on any even `m_k` or any
  wrong recurrence), dimensions 1 and 2 form a `(0,2)`-net (joint, so it grades dimension
  2's polynomial), and the scramble is a bijection on the leading `k` bits for every `k`,
  which is bijectivity and Owen nesting in a single assertion.
- **Two implementation choices that look like premature caution and are not.** The direct
  XOR-over-set-bits construction is used rather than the faster Gray-code recurrence,
  because the recurrence makes a point a function of the _enumeration_ rather than of its
  own index and a worker holding one range cannot start it — P6.03 would be lost. And the
  set-bit loop is arithmetic rather than bitwise, because `&` sees a negative int32 for
  indices past `2^31`.
- **The property P6.14 could not have.** A Sobol' point depends on its index and the
  scramble key, not on the replicate count, so extending a study keeps every replicate it
  already drew — asserted directly. Whoever takes **P6.17** should read that together with
  the 57th run's warning about LHS: a convergence sweep under Sobol' is refining one
  design, where the same sweep under LHS compares unrelated ones.
- **Where it does not help, measured rather than hedged.** On an indicator observable —
  unbounded variation in the Hardy–Krause sense — the slope falls to **−0.7834**. Better
  than MC, nowhere near the smooth case, and _both_ bounds are asserted so the option
  cannot drift into looking unconditionally good.
- **A flake surfaced while establishing the baseline, and it is filed rather than forgotten.**
  `chunked-integration.test.ts`'s `maxSliceMs < 10` failed once in five full-suite runs, at
  **10.768 ms**. It is a wall-clock budget measured inside a pool running 277 files in
  parallel, so it reads machine contention as much as the chunker; standalone the file passed
  6/6, and `main` passed three full runs clean. This run's own heaviest test was part of the
  load — the discontinuous-observable case built its reference on a `4096²` grid, 16.7M
  evaluations — so that grid was cut to `1024²`, which a measured convergence table puts within
  **1.3e-6** of `8192²`, three orders of magnitude below the smallest RMSE being fitted. All
  three slopes unchanged to four decimals; the file's test time fell 2070 ms → 647 ms; five
  consecutive full-suite runs clean after. **That is a mitigation, not a fix**, so **P0.112** is
  filed: the next heavy test file will tip the assertion again and it will look like a bug in
  whatever lands beside it. The test was not weakened, skipped or retried — the 10 ms budget is
  a real P2.40 requirement — and the filing asks for an assertion that measures the chunker
  rather than the machine.
- **Next run:** P6.16, stochastic-wind replicates with one frozen OU path per replicate
  (ADR-011 integration). Note for whoever takes it: `ou-gust.ts` already exists, and the
  question this task really has to settle is which stream the frozen path draws from, so
  that a replicate stays reproducible from its index alone under all four samplers now
  available — plain, antithetic, Latin hypercube and Sobol'.
- Full suite green: 277 files, 3028 tests. `typecheck`, `eslint`, `lint:deps` and `build`
  all clean.

---

## 2026-08-29 (57th run) — **P6.14 done, and an orientation bug that only a quantile could see**

- **P6.14, Latin hypercube sampling, done.** `packages/engine/src/latin-hypercube.ts`:
  `latinHypercubeReplicates`, `generateLatinHypercubeReplicate`, `latinHypercubeStratum`,
  `latinHypercubeUniform`. Exported from `@ballista/engine` and documented in
  `docs/analysis/README.md` beside the other two variance-reduction options;
  `ROADMAP.json` carries the full notes, as `policy.commitRules` requires, and this entry
  does not restate them.
- **The design problem was P6.03's guarantee, not the sampling.** Replicate `i` must be a
  pure function of `(seed, N, overlay, i)` so any worker partition reproduces the same
  ensemble. LHS is inherently joint across all `N` replicates, and the textbook
  implementation materialises a Fisher–Yates permutation per dimension — `O(N)` to answer
  for one replicate, so `O(N²)` to pull a study one at a time, and simply unavailable to a
  worker that knows only its own range. So the permutation is **never materialised**: a
  four-round Feistel network over the enclosing power-of-two domain plus cycle walking
  gives `π_j(i)` pointwise in `O(1)`. A Feistel network is a bijection whatever its round
  function does, which is the guarantee that matters — "exactly one replicate per stratum"
  is the entire content of _Latin_, and a hash reduced mod `N` would collide and quietly
  degrade to stratified sampling with replacement.
- **A prerequisite, and the bug it exposed.** LHS needs a monotone map from a stratified
  uniform, and `sampleDistribution` is not one — untruncated normals go through
  Box–Muller, which consumes two uniforms and is monotone in neither. Adding
  `distributionQuantile` surfaced that **`placeUniformInTruncatedNormal` is not
  consistently oriented**: its `alpha < 0` branch increases, its `alpha >= 0` upper-tail
  branch _decreases_. Harmless for a draw, since `u` and `1 − u` are both uniform and each
  branch samples the correct law. Fatal and silent for a quantile: stratum `k` would land
  in band `N − 1 − k` whenever a truncation sat above zero, transposing a hypercube along
  one dimension while every marginal law stayed correct and every histogram looked right.
  The quantile orients each branch explicitly; **the sampler was left bit-for-bit alone**,
  because every golden trajectory and determinism test depends on its exact output.
- **Both halves of the criterion measured.** Stratification: bijectivity onto `[0, N)` for
  eleven values of `N` across three dimensions, plus per-dimension independence and
  end-to-end stratification after the quantile map. SE improvement: 400 studies of
  `N = 64` on the closed-form range, **6.037 m → 0.410 m**, ratio **0.068** — a 93% cut in
  standard error, 216× in variance — with unbiasedness held against the analytic
  `E[range]` at the LHS estimator's own tighter SE.
- **The counterexample took two attempts, and the failed one is the more interesting.** A
  threshold observable in one dimension is not a counterexample at all: with the step at
  the median it lands exactly on a stratum boundary, so 32 of 64 strata sit above it in
  every study and the estimator is **exact**, SE `0.0000000` against `0.0628`. The real
  limit is dimensional — LHS removes main-effect variance and leaves interaction variance,
  measured at ratio **1.10** on a pure interaction. Both are recorded in the test file.
- **Next run:** P6.15, Sobol' sequence with scrambling, which `distributionQuantile` now
  unblocks — it needs exactly the same monotone map. Note for whoever takes P6.17: an LHS
  study cannot be refined incrementally in `N`, so a convergence sweep under it compares
  unrelated designs.
- Full suite green: 275 files, 3000 tests. `typecheck`, `eslint`, `lint:deps` and `build`
  all clean.

---

## 2026-08-26 (56th run) — **P6.13 done, and the test that was wrong instead of the code**

- **P6.13, control variates, done.** `packages/analysis/src/control-variate.ts`:
  `controlVariateMean(y, x, knownMeanX, {coefficient?})`, `dragFreeRangeControlMean` for the
  exact control mean, and `formatControlVariateEstimate`. Exported and documented in
  `docs/analysis/README.md`; `ROADMAP.json` carries the full notes, as `policy.commitRules`
  requires, and this entry does not restate them.
- **Both halves of the criterion measured**, 400 studies of `N = 64`. Factor: estimator
  variance ratio **0.00115**, a 99.9% cut, mean `rho` **0.99952**, mean reported factor
  **9.63e-4** — and the _reported_ factor is asserted against the _measured_ reduction, not
  merely printed. Unbiasedness: held to its **own** standard error (29.5× tighter than plain
  MC's) against an **analytic** truth.
- **The analytic truth is why the drag model is a closed form.** The observable is
  `(v0^2 - b v0^3) sin(2t)/g`, chosen so `E[R]` follows from `E[v0^3] = mu^3 + 3 mu sigma^2`
  exactly. A large Monte Carlo reference was the first draft, and it would have been useless
  here: its own error is the same order as the effect the test needs to resolve. Picking the
  test's reference before picking its tolerance is the lesson worth carrying.
- **The first draft's unbiasedness assertion failed, and the code was right.** It asserted the
  default estimator hits the truth within its own standard error; it missed at **4.5 SE**. That
  is not noise — it is the documented `O(1/N)` bias from estimating `c` on the same sample
  becoming _resolvable_, because the control-variate standard error is finally small enough to
  see it. Probing `N = 16..512` over 20k studies settled it: **`N x bias` is constant at
  1.56-1.95** while the bias itself falls `1.1e-1 -> 3.0e-3`, and the fixed-`c` estimator sits
  within 1.8 SE at every `N`. So the test encoded a wrong belief about the code, and the suite
  now asserts what is true: unbiasedness for a **fixed** `c` (a theorem, 4 SE against the
  analytic truth), the estimated-`c` bias as **real** (>5 SE over 4000 studies) and as
  **`O(1/N)`** (an 8× span, ratio bounded 4-16, which separates `1/N` from the 2.83 of
  `N^-1/2` and the 1 of no decay at all). **The bias was not tolerated by loosening a bound;
  it was measured and then asserted.**
- **Why the biased estimator stays the default**, stated because "there is a small bias" is not
  a reason on its own: at `N = 64` it is ~17% of a **single study's** standard deviation, so no
  real run can see it, and being one order below the `O(N^-1/2)` standard error it shrinks
  faster and never becomes the binding term. A caller who needs exactness passes `coefficient`.
- **Two counterexamples measured, per the standard the P6.12 exhibit set.** An uncorrelated
  control degrades to plain MC (ratio **0.994**) rather than doing harm, because `c-hat`
  correctly estimates near zero. And a **wrong control mean shifts the estimate by exactly
  `c*d` while leaving the standard error bit-identical** — the module's silent failure mode,
  and the concrete reason `dragFreeRangeControlMean` carries the `sigma^2` term in
  `E[v0^2] = mu^2 + sigma^2` rather than using `mu^2`.
- **Two figures in an early draft of the source comments were guesses and are now measurements**
  (the reduction and the uncorrelated-control ratio). The 55th run made the same correction
  about its own "about 89%"; the pattern is worth naming — a comment written before the
  measurement lands tends to survive it.
- **Local gate clean at `adbf8dc`** (Node 22.22.2, pnpm 11.9.0): `pnpm typecheck` 0 errors,
  `pnpm lint` clean, `pnpm lint:deps` **no violations (1558 modules, 4417 dependencies)**,
  `pnpm format:check` clean, `pnpm test` **2945 passed across 272 files**, `pnpm build` ✓ in
  20.65s. Baseline before this run was 2911 across 270; the 34 new tests are P6.13's.
- **A trap for the next run, and it is not a regression.** `pnpm test` **before** `pnpm
typecheck` fails 3 tests in `packages/validation/src/cross-engine-drift-record.test.ts`:
  they shell out to `scripts/cross-engine-drift-fixture.mjs`, which imports
  `packages/engine/dist/index.js`, and `tsc -b` is what emits it. A fresh clone has no `dist`,
  so the failure looks like a real one and is only build ordering. CI does not see it because
  its Typecheck step precedes its Test step. **Run `pnpm typecheck` first; do not go looking
  for a drift bug.**

---

## 2026-08-26 (55th run, addendum) — **CI 265 green on all 35 steps at `465af37`**

- Run **265** concluded `success`, 5m17s end to end, Test step **2m32s**. Read from the job record
  rather than the run record, per the stale-status trap.
- **The four steps `CLAUDE.md`'s local gate does not cover all passed**: benchmark regression,
  cross-engine drift, Engine API docs and SolverKit API docs. That last pair matters for this run
  specifically — `sampleDistributionAntithetic` and the three new `replicate-generator` exports carry
  `{@link}` tags, and the engine typedoc step is what resolves them. The 44th run's latent-`{@link}`
  finding says a doc comment can be broken and surface only once something new inlines the type, so
  the new TSDoc being rendered rather than merely written is worth stating.
  **Scoped honestly: the typedoc steps build `engine` and `solverkit`, not `analysis`**, so the
  validation exhibit's own comments are not covered by them.
- CI also runs a **Format** step (`prettier --check`) that `CLAUDE.md`'s documented five-command gate
  omits — it passed, because the repo's `lint-staged` hook formats on commit, but the omission is the
  same P0.110 gap and this run did not close it.
- One follow-up entry, then stop — run 266 is not chased.

## 2026-08-26 (55th run) — **P6.12 done**: an antithetic mirror that is per-distribution, and the counterexample asserted rather than warned about

- **P6.12 is done and its criterion is met.** `packages/engine/src/distribution.ts` gains
  `sampleDistributionAntithetic`; `replicate-generator.ts` gains `generateAntitheticReplicate`,
  `generateAntitheticPair` and `antitheticReplicates`. Both flow out through the engine index's
  `export *`. Full detail is in `ROADMAP.json` and is not restated here.
- **The obvious implementation is a stream-level `1 - u` wrapper, and it is wrong.** Every textbook
  statement of antithetic variates says "use `1 − u`", and for an inverse-CDF sampler that is exactly
  right. This engine is only _partly_ one: an untruncated normal or lognormal goes through
  Box-Muller, which is **not monotone in either of its two uniforms**. Feed `nextGaussian` the pair
  `1 − u₁, 1 − u₂` and you get a perfectly valid standard normal bearing **no** relationship to the
  direct draw — correlation near **zero** instead of −1, so the entire variance reduction quietly
  does not happen while every determinism test still passes. The sense is therefore threaded down to
  each sampler, which mirrors in whichever domain is correct for it: `1 − u` for `uniform` and for
  the inverse-CDF truncated branches, `−z` for the untruncated normal and lognormal. **Neither rule
  works alone** — `−z` walks off a one-sided support, and `1 − u` has no single `u` under Box-Muller.
- **The criterion, measured: variance ratio `0.0246`, a 97.5% reduction**, on `dragFreeRange` at π/4
  with `v₀ ~ N(40, 6)`, N=64 replicates over 400 independent studies. That is a large number and it
  has a closed-form reason rather than a lucky one: with range ∝ `v₀²` and `v₀ = μ + d`, the pair
  mean is `((μ+d)² + (μ−d)²)/2 = μ² + d²`, so the linear `2μd` term that carries nearly all the
  variance **cancels exactly** and only `d²` survives. The assertion is pinned at ratio < 0.10, not
  at the measured value.
- **The counterexample is asserted, not warned about.** Antithetic sampling is not free: on
  `f(v₀) = (v₀ − 40)²`, symmetric about the draw's mean, mirroring cancels nothing and a 32-pair
  average replaces a 64-draw one — the paired estimator is measurably **worse**, and a test asserts
  that degradation rather than a comment mentioning it. This is why `replicates()` stays the default
  and P6.12 shipped as an **option**. A suite that only demonstrated the win would have made the
  feature look unconditionally good, which it is not.
- **Three numbers measured instead of trusted.** (1) The lognormal pair attains its _analytic_
  countermonotonic bound `(e^{−s²} − 1)/(e^{s²} − 1) = −0.852` at `s = 0.4` — reaching the
  theoretical minimum is not something an approximate mirror does, which makes this the strongest
  available statement that the partner is the true mirror. (2) A normal truncated to `[2, ∞)` reaches
  only **−0.731**; that is a property of a skewed marginal, not a defect, since no coupling of that
  marginal with itself does better — and its mirror-image spec `(−∞, −2]` reaches the _identical_
  figure to 10 places, which is what checks the `β ≤ 0` reflection branch, the one place a sign error
  would still look plausible. (3) **A test failure that was the test's fault and is recorded as
  such:** the marginal-law KS check rejected at 1% on every truncated spec (0.0605 against a 0.0515
  critical value). The control that settled it was direct-against-direct under the _same_ seeding,
  which rejects just as hard at 0.0655 — so the non-uniformity was building a fresh `PCG32` per
  observation from seeds in an arithmetic progression and taking one draw from each, and had nothing
  to do with the mirror. Drawn sequentially from one stream the same comparison gives 0.0170. That is
  the concrete cost of the hazard `replicateSeed` hashes through splitmix64 to avoid, so it is
  written into the test rather than worked around.
- **Two of this run's own errors, corrected before landing and named here rather than buried.** The
  validation comment first guessed the reduction at "about 89%" from theory; the measurement says
  97.5%, and the comment now carries the measured number. And the draw-spread check first asserted a
  ±15% band on a _single_ seed and drew 1.161 — a 64-draw sample variance carries about 18% standard
  error, so the interval was narrower than the statistic. Fixed by averaging over the 400 studies,
  which is the sound measurement, rather than by widening the bound, which would have been the
  cheaper move.
- **A red commit landed locally and was amended before push, and the cause is worth naming.** The
  pairing commit was made with a failing `tsc` because the verification was written as
  `pnpm typecheck 2>&1 | tail -2 && …` — the pipe makes the exit status `tail`'s, which is always 0,
  so the `&&` chain sailed past a type error. Nothing was pushed; the commit was amended once the fix
  was green. **Use `set -o pipefail`, or do not pipe a gate command into `tail`.**
- **Notes.** No symplectic integrator was touched — nothing here is dissipative-dynamics work.
  Nothing was wired into the P6.04 `mc` worker job and no UI surface was added: `antitheticReplicates`
  is a drop-in replacement for `replicates()` at that call site, but **nothing calls it yet**, which
  is the first thing a follow-up should fix. Full gate green before push: typecheck 0 errors, lint,
  `lint:deps` (1549 modules, 4398 dependencies), **2911 tests across 270 files** (from 2860/267),
  build 31.6s. One clause on the scheduled prompt, carrying nothing forward: this run's text says the
  repo is "currently in Phase 4 (advanced aerophysics)" — phases 4 and 5 are complete and P6.12 is a
  phase-6 task, so that line is stale. The routine's own precedence rule says the repo's docs win,
  and `ROADMAP.json` was authoritative here as designed.

## 2026-08-25 (54th run) — **P6.11 done**: a Wilson interval, and two numbers checked instead of trusted

- **P6.11 is done and its criterion is met.** `packages/analysis/src/hit-probability.ts` scores an
  ensemble of impact points against a `Target` and reports the hit fraction with a Wilson score
  interval. Impacts go through `targets.ts`'s existing `isHit`, so the package still has exactly one
  definition of a hit. Full detail is in `ROADMAP.json` and is not restated here.
- **Wald is not a stylistic runner-up here, it is unusable.** Its half-width is proportional to
  `√(p̂(1−p̂))`, so at `k = 0` or `k = n` it is **exactly zero** — "0 hits in 20, ± 0", certainty
  claimed from twenty observations. And a hit probability is a quantity that _lives_ at its
  endpoints: a tight ring at long range is missed every time until it isn't, an over-wide tolerance
  is hit every time. The two configurations a user is most likely to try are the two Wald cannot
  report on. Wilson inverts the score test instead, keeps non-zero width there, and stays inside
  `[0, 1]` without clamping.
- **The criterion turned out to be a coverage measurement, not a formula check, and that is the
  point.** "Matches binomial simulation on constructed case" is satisfied by 4000 seeded binomial
  samples at each of four `(n, p)`, asserting the interval covers the true `p` near its nominal 95%.
  Every realistic implementation error — a wrong `z`, a wrong denominator, a half-width off by a
  factor — surfaces as coverage that is not nominal, which no closed-form spot check would catch.
  A head-to-head in the same suite shows **Wald under-covering at `p = 0.05, n = 40`**, where `k = 0`
  makes its interval empty of the truth about 13% of the time.
- **The first draft's "published" reference values were wrong, and the test was corrected rather
  than the code.** The 7-of-20 case was written as `[0.18106, 0.56890]` from recall. An independent
  evaluation of the Wilson formula at `z = 1.9599639845400536` gives **`[0.1811918241,
0.5671457233]`**, which is what the implementation returns to ten digits. Worth recording because
  the failure was two assertions disagreeing with correct code, and the tempting move — nudging the
  tolerance until it passed — would have cemented a wrong reference in the suite forever. The values
  now carry their provenance in a comment and are asserted to 8 decimals rather than to
  `toBeCloseTo`'s loose default.
- **The finding, fixed rather than tolerated:** at `k = n` the analytic upper bound is
  `denom/denom = 1`, but `center + halfWidth` rounds **one ulp low**, to `0.9999999999999999`. One
  ulp is numerically irrelevant and semantically not — "every shot hit, so the bound is 1" is a
  thing a caller may reasonably test for, and an interval that never quite reaches 1 makes that test
  silently false. Endpoints are now exact, and a companion test asserts the _far_ bound is still
  strictly interior, so exactness cannot have been bought by collapsing the interval.
- **A `NaN` impact throws instead of voting.** A diverged solve is not evidence about where the shot
  landed, and `NaN <= tolerance` is `false`, so scoring it naively would record a **miss** and bias
  `p̂` downward by exactly the failure rate — invisibly, since the result still looks like a
  probability. Callers must filter failures deliberately, which also keeps `n` honest.
- **One assumption the arithmetic cannot check, so it is documented rather than implied:**
  independence. The interval assumes `n` Bernoulli trials with a common `p`, true for ADR-011's
  per-replicate substreams and false for an ensemble sharing one frozen wind path or sweeping a
  parameter grid. Nothing in the counts can detect the difference, and the error runs toward an
  interval that is **too narrow**.
- **Local gate green before the push**: `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`,
  `pnpm format:check`, **2860/2860 tests across 267 files** (up from 2836/266; the 24 are this
  task's), app build, bundle **72.8 kB gzipped** against the 300 kB budget — _unchanged_, since the
  new module tree-shakes out until a UI consumes it. The four steps the local gate cannot cover
  (benchmark regression, cross-engine drift, and the two typedoc API-docs jobs) are CI-only, as
  always.
- **Addendum — CI 263 green at `06637a2`, all 35 steps**, read from the job record rather than the
  run record per the 39th and 46th runs' stale-status trap. Test 2m00s, 4m24s end to end. The four
  steps the local gate cannot cover all passed: benchmark regression, cross-engine drift, Engine API
  docs, SolverKit API docs. **Scoped honestly:** the two typedoc steps build `engine` and
  `solverkit`, not `analysis`, so they are _not_ evidence that this run's new TSDoc renders — the
  44th run's latent-`{@link}` trap lives in exactly that gap, and `hit-probability.ts` carries
  several `{@link}` tags that no CI step resolves today. One `{@link MeanConfidenceInterval}` was
  demoted to plain code text before the push for that reason, since the symbol lives in another
  module. This is the one follow-up entry; per the 51st run's convention, run 264 is not chased.
- **Not touched, and still open:** P0.96's wall-clock flake (`chunked-integration.test.ts:318`) did
  not fire in this run's suite. The stale `claude/*` branches of P0.95/P0.107 were not counted or
  cleared. **Next**: `P6.12` (antithetic variates option, `M`, criterion "variance reduction measured
  > 0 on monotone observable (range vs v₀)") is the topmost `todo` by `seq`. Note that its criterion
  > needs the _monotonicity_ to be real — antithetic pairing only reduces variance for an observable
  > monotone in the uniform driving it, so the pairing must be applied to the input draw, not to the
  > output samples, and a non-monotone observable is the counterexample worth including.

---

## 2026-08-25 (53rd run) — **P6.10 done**: a fan whose nesting is structural, and a resampler that really is dense output

- **P6.10 is done and both halves of its criterion are met.** `packages/analysis/src/ensemble-fan.ts`
  puts an ensemble of adaptively-integrated replicates onto one time grid and reduces each grid point
  to its quantiles. Nothing renders here; P6.20 and P6.24 consume the arrays, the same split P6.09
  used. Full detail is in `ROADMAP.json` and is not restated here.
- **The two counterexamples are what make the criterion mean anything**, and they are the part worth
  carrying forward. "Bands nested" would be satisfied by an implementation that clamped the output
  afterwards, so the sweep over twenty-one levels also asserts that the outermost pair is _exactly_
  the sample min and max — which a repaired band is not. "Median ≈ nominal for symmetric inputs" would
  be satisfied by an implementation that averaged, since the mean of a symmetric ensemble is also the
  nominal, so a skewed ensemble is asserted to separate the two by more than a metre. Neither
  counterexample was asked for by the task; both are the difference between a criterion and a
  formality.
- **"Dense-output resampling" was read as a requirement, not as a description.** The obvious
  implementation — linear interpolation between accepted steps — is second-order and would discard
  three orders of the accuracy a DOPRI5 solve was paid for, invisibly, since the result still looks
  like a trajectory. What landed instead is cubic Hermite from the two endpoint values and the two
  endpoint _slopes_, which is available from the recorded rows alone because **for a ballistic state
  the derivative channels are already there**: `dx/dt` is `vx`, `dy/dt` is `vy`. No change to `Sink`,
  no second integration. That is a property of this model family rather than a general fact, so the
  derivative channel is an explicit argument and never a guess. Measured both ways: exact to 1e-12 on
  the ballistic parabola where linear is off by **1.226 m** at a step midpoint with `h = 1`.
- **The finding, asserted rather than patched:** a `NaN` in a recorded row takes out **both** adjacent
  intervals _including their far endpoints_, because the interpolation weights it by zero and
  `0 * NaN` is `NaN`, not `0`. The affected columns thin to the surviving replicates rather than
  voiding, which is the property that matters. A short-circuit returning `y0` at exactly `t0` while
  returning `NaN` an instant later would be a stranger surface than a clean hole, so the behaviour is
  documented in the header and in a test instead of being special-cased.
- **Local gate green before the push**: `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`,
  `pnpm format:check`, **2836/2836 tests across 266 files**, app build, bundle **72.8 kB gzipped**
  against the 300 kB budget. The four steps the local gate cannot cover (benchmark regression,
  cross-engine drift, and the two typedoc API-docs jobs) are CI-only, as always.
- **On checking CI**: the 52nd run's addendum established that each closing entry is itself a commit
  whose run nobody reads, so a red can hide in a one-run blind spot. The next run should check **the
  last completed run on `main`, whatever its number** rather than a number named here.
- **P0.96 is still open and still needs a human** (seq 294, `todo`): the wall-clock flake in
  `chunked-integration.test.ts:318`. It did not fire in this run's local suite. Nothing about it was
  touched.
- **Next**: `P6.11` (hit-probability estimator for a target + Wilson interval, `M`, criterion "matches
  binomial simulation on constructed case") is the topmost `todo` by `seq`. Note it is the natural
  consumer of P6.09's impact arrays, and that a Wilson interval is chosen over Wald precisely because
  Wald degenerates to zero width at `p̂ = 0` or `1` — which is exactly where a hit probability lives
  for a shot that misses every time, so the constructed case should include that end.

---

## 2026-08-25 (52nd run, addendum) — **CI 260 green on all 35 steps at `c136275`**; and `main` was **red** before this run's push

- **CI 260 at `c136275` is green on all 35 steps**, 3m59s end to end (Test **1m59s**, Build app 18s,
  Bundle size 1s, last step 14:48:20). Read from the job record, per the 39th and 46th runs' trap.
  **All four steps the local gate cannot cover passed** — `Benchmark regression check` 9s,
  `Cross-engine drift check` 3s, `Engine API docs` 4s, `SolverKit API docs` 3s — so the two this run
  had _not_ verified locally are now verified, and P6.09 is checked against the typedoc path as well.
- **The finding this addendum exists for: `main` was red when this run arrived, and no entry said so.**
  **CI 259 at `60c2090` — the 51st run's own final commit, and `main`'s HEAD for the seven hours
  before this push — failed.** It is **P0.96**, the filed wall-clock flake:
  `chunked-integration.test.ts:318`, `expect(maxSliceMs).toBeLessThan(10)` measuring **12.372 ms**,
  1 failed / 2783 passed. Steps 12-17 were skipped as a consequence. The diff at that commit is
  `CHANGELOG.md`-only, so nothing in it can have caused a wall-clock regression; this is the
  known machine-load sensitivity and not a new fault. **No test was touched.**
- **Why nobody saw it, and the lesson that generalises.** The 51st run's instruction — "do not open
  with a check on 258" — is sound and was followed. But it names run **258**, and the run that went
  red is **259**: the one created by the very commit that recorded 258's result. **Each closing entry
  is itself a commit whose run no session ever reads**, because that session ends first and the next
  one is told not to look back. The convention of "one follow-up entry and then stop" therefore has a
  structural blind spot exactly one run wide, and a red landing in it survives until a later run
  happens to list the history. **A later run should check the last completed run on `main`, whatever
  its number, rather than a number a previous entry named.**
- **P0.96 is unchanged and still needs a human** (seq 294, `todo`, behind P6.09's 233 so
  `taskSelection` correctly did not pick it). This is a further sighting for its record: a red on a
  docs-only commit, which is the cleanest possible demonstration that the assertion fails from load
  alone. Nothing about it was weakened, worked around, or re-run to get green.
- **Correction to the entry above.** It presents local `main` being an unrelated history as a fresh
  trap. It is not new: **the 47th run already recorded it** ("the clone's `main` and `origin/main`
  had no merge base — 50 commits each side, unrelated histories, `origin/main` force-updated"), and
  the counts still match exactly (ahead 50, behind 50). The practical advice stands and this run
  re-derived it rather than reading it, which is the cost of it living in one run's entry and
  nowhere a session reads first. Recorded as a re-derivation, not as a discovery.
- Nothing further is chased from here: this addendum's own push creates run 261, and per the 51st
  run's convention that is where the recording stops.

---

## 2026-08-25 (52nd run) — **P6.09 done**: a downsample whose guarantee is a ceiling, not a ratio

- **P6.09 is done and its criterion is met.** `packages/viz/src/impact-scatter.ts` supplies the two
  displays the task title names: `buildImpactHistogram` for the planar model's one-dimensional
  `x_impact` distribution, and `buildImpactScatter` for the spatial model's two-dimensional
  ground-plane impacts, collapsed to at most one marker per screen cell with that cell's replicate
  count carried alongside. 1e4 points reduce in **best 0.62 ms, median 0.72 ms, worst-of-15
  1.44 ms** against the criterion's 16 ms, best-of-15 after 20 warmups. Full API in `ROADMAP.json`.
- **The interesting part was discovering that the obvious claim is false.** "Density downsample"
  invites the reading that 1e4 points become a small number of markers. They do not, necessarily:
  at the default 4 px cell over a realistic dispersion ellipse, 1e4 replicates occupy **5224
  cells** — a 1.9x cut, and a different zoom gives a different figure. The ratio is a property of
  how many replicates share a cell, which is to say of the camera, and nothing here can promise
  one. **What can be promised, and what the 16 ms actually needs, is the ceiling**: markers never
  exceed occupied cells, and cells are set by the viewport. So the render cost stops growing once
  the ensemble saturates the grid, and the test asserts _that_ — replaying the same ensemble 2x and
  4x multiplies the replicates without adding a single marker — rather than a ratio picked from a
  cluster that flatters it. A tighter cluster would have made the headline number look far better
  and would have measured the cluster, not the algorithm.
- **Speed alone cannot establish this criterion, and the implementation that fails it is the fast
  one.** A pass-through returning its input unchanged beats 0.62 ms and hands the renderer 1e4 draw
  calls, which is precisely the problem the criterion exists to prevent. Three counterexamples are
  asserted alongside the timing: the marker count (5224, so no pass-through), the dial (a finer
  `cellPx` yields strictly more markers, so a downsample that ignored its own resolution would pass
  a one-sided reading and fail here), and the saturation bound above.
- **Two design commitments that a later renderer must not undo.** The per-cell **count is
  permutation-invariant** — that is what makes density readable off the markers — while the marker
  **position is not**, because it is a real replicate's landing point, chosen first-arrival, rather
  than a centroid. A centroid would be permutation-invariant and wrong: it is a position no shot
  occupies, and where shots actually land is this chart's entire subject. Off-viewport points are
  **culled and reported**, never clamped, since clamping piles every long shot onto the frame and
  invents a dense band there. A zero-variance histogram likewise collapses to a single `[v, v]` bin
  rather than accepting an invented width that would read as a spread the data does not have.
- **The camera transform is inlined and is now checked against its source.** `buildImpactScatter`
  inlines `worldToScreen` for the same reason `buildDecimatedTrajectoryPath` does — the per-call
  `{x, y}` allocation dominates at 1e4 points — and an inlined copy is a copy that can drift. A
  marker half a pixel off its own landing point is not a visible bug, it is a wrong chart, so the
  two formulas are compared directly in a test. The decimation module carries the same inline and
  the same warning comment without such a test; filing that gap is left to a future run rather than
  taken as a drive-by.
- **Gate green** at every commit: typecheck, lint, `lint:deps`, `format:check`, **2808/2808 tests
  across 265 files** (from 2784/264), app build, bundle **72.8 kB gzipped** — unchanged from the
  51st run — within the 300 kB budget (§2.6).
- **Three of the four CI-only steps were run locally this time**, which the local gate normally
  misses (P0.110's gap): `Engine API docs` and `SolverKit API docs` both regenerate clean, and
  `Bundle size budget` passes. That matters for the same reason the 51st run gave: the 44th run's
  `{@link z0}` failure showed a doc comment can be latently broken and surface only when something
  new inlines the type. `Benchmark regression check` and `Cross-engine drift check` are soft-warn
  and were **not** run locally — read them from this push's CI run, and note that neither was
  verified here.
- **CI run 258 was not checked**, per the 51st run's explicit instruction: it is a `CHANGELOG.md`-only
  diff that cannot reach any of the 35 steps, and a red there would be a finding about CI, not
  about P6.08. This run's own push should be read by the 53rd.
- **A trap in the clone that cost a few minutes and would cost a cold run more: local `main` is an
  unrelated history.** `git checkout main && git merge --ff-only origin/main` fails with _refusing
  to merge unrelated histories_; local `main` sits at `947948e` (the 36th run) and is **not an
  ancestor of `origin/main`**, which is at `60c2090`. The harness branch `claude/upbeat-ride-na8p42`
  is the ref created at `origin/main` and is the one to work from. **Do not try to bring local
  `main` forward** — check out the harness branch, confirm it equals `origin/main`, and work there.
  This is a property of how the sandbox clone was set up, not of the repository.
- **The stop-hook was left firing rather than paid off**, following the 51st run: this run pushed to
  `main` directly as CLAUDE.md requires, so any "unpushed commits on branch" report is to be
  verified against `origin/main` and then ignored. No `claude/*` branch was pushed and none is left
  behind.
- **Note on the routine's description of this repo**: it still says "Currently in Phase 4 (advanced
  aerophysics)", read in this run's own text. Stale for a second consecutive run — phases 4 and 5
  are complete and the work is in phase 6. `ROADMAP.json`'s `taskSelection` picked P6.09
  unambiguously (no `in-progress`, no `review`, first `todo` by `seq`) and the 51st run's handoff
  named it too, so the stale pointer cost nothing. Recorded once, not acted on.
- **The lazy-load-Plotly item remains untouched and remains legitimate.** This run's build still
  emits `plotly.min` at **4,840.69 kB raw / 1,468.51 kB gzipped** as a static chunk. It is not
  counted by the bundle-size budget, which measures the app entry (72.8 kB) — worth knowing before
  claiming it, since the budget being green is not evidence the problem is gone.
- **Next run: P6.10** (trajectory ensemble fan — quantile envelope bands at 5/25/50/75/95% over time
  via dense-output resampling onto a common grid). It needs dense output rather than recorded rows,
  since replicates have different step sequences and different flight times, so the first question
  is what the common grid is and what happens past a short replicate's impact — a quantile over a
  shrinking sample is not the same object as one over the full ensemble, and saying which it is
  belongs in that task. `MeanConfidenceInterval` (P6.08) and this run's arrays are both available to
  P6.10 and P6.11.

---

## 2026-08-25 (51st run) — **P6.08 done**: a confidence band checked against a truth that is exact rather than estimated

- **P6.08 is done and its criterion is met.** A 95% `t` interval covers the truth in **192 of
  200 repeats = 0.960**, which is **0.65 binomial sigma** from the nominal 0.95, measured on the
  real range observable in `packages/runtime/src/mc-confidence-coverage.test.ts`. The estimator is
  `packages/analysis/src/confidence-interval.ts`. Full API and reasoning are in `ROADMAP.json`.
- **The interesting part of this task was finding something to cover.** A coverage test needs a
  truth, and a jittered ensemble does not obviously have one: `E[f(X)] ≠ f(E[X])`, so the analytic
  range evaluated at the mean inputs is the wrong target for a general observable. Drag-free
  ground-launch range is the exception, and that is why the blueprint's criterion names it. It is
  `R = 2·vx₀·vy₀/g` — **bilinear**, not merely nonlinear — so under _independent_ jitter on the two
  components `E[R] = 2·E[vx₀]·E[vy₀]/g` holds **exactly**: no linearisation, no CLT appeal, no
  error term to bound. The independence is exactly what P6.03's substream-per-pair generator
  supplies, so this criterion doubles as a second check on that generator — correlated overlays
  would shift `E[R]` off the truth and the coverage would collapse. `y0` is forced to 0 because the
  raised-launch form carries a `√(vy₀² + 2gy₀)` term that is not bilinear and would silently break
  the identity.
- **The truth is asserted before it is used.** Over the 12800-replicate pool the mean range is
  **91.84957 m** against the analytic **91.77270 m** — **0.71 of its own standard error** away, so
  there is no detectable integrator or seeding bias. Without that check every coverage figure below
  could be measuring the wrong target while still looking entirely plausible.
- **Counterexamples are asserted, not only the passing case.** Three, each killing a different way
  the criterion could be met by something that does not work:
  - _Width alone cannot pass it._ Displacing the truth by four standard errors drops coverage to
    **0.045**. An interval of infinite width would otherwise score 100% and satisfy a one-sided
    reading of "covers ~95%".
  - _The level is a dial, not a decoration._ An 80% interval covers **160/200 = 0.800** exactly. A
    multiplier that ignored `level` and always returned the 95% one would pass the criterion and
    fail here.
  - _Why the task says **t**-based._ At `n = 5` the multiplier is 2.776 against the normal's 1.960.
    Rebuilding the same intervals with `z` gives **183/200 = 0.915**, against `t`'s **194/200 =
    0.970**. The under-coverage is measured on the real pipeline rather than argued from theory.
- **A coverage proportion needs its binomial scale or the assertion is theatre.** One sigma here is
  `√(0.95·0.05/200) = 0.0154`, about 3 successes out of 200, so a run landing on 0.94 is a third of
  a sigma away and evidence of nothing. Compared naively against 0.95, such a test either never
  fails or fails at random. `CoverageResult.standardError` reports the scale so a caller cannot skip
  it, and every band asserted here is written in those units rather than tuned to the number this
  run happened to produce. Nothing is random in any case: replicate `i` is a pure function of seed
  and index (P6.03) and each repeat is a fixed disjoint index window.
- **The `t` quantile is validated against closed forms, not against copied digits.** `df = 1` is the
  Cauchy (`tan`) and `df = 2` has an elementary inverse; both are held to 1e-12 relative. `df → ∞`
  is checked against `engine`'s `normalQuantile`, with the multiplier asserted to shrink
  monotonically toward it. Between those anchors the round-trip `Q(quantile(p)) = 1−p` holds to
  1e-12 across `df` 1…5000. The textbook 95% table appears too, to the three decimals a printed
  table actually carries, to catch the wholesale errors self-consistency would happily satisfy — an
  off-by-one in `df`, or a one-sided multiplier where a two-sided one belongs. The accuracy floor is
  the incomplete beta continued fraction's ~1e-12 rather than the root find's 1e-15, and the tests
  say so instead of asserting a precision the special function does not have.
- **"Displayed honestly with N" is read as a property of the value, not of the chart.** `± 3.1 m`
  means something different from 8 replicates than from 8000 and a reader cannot tell which, so the
  interval carries `sampleSize`, `degreesOfFreedom` and `level` alongside the bounds and no format
  option omits `n`. P6.09–P6.11's plots can render the band however they like; they cannot obtain
  one without the `n` that produced it. Below two samples `meanConfidenceInterval` returns `null`
  rather than a zero-width interval that would read as infinite precision.
- **Gate green** at every commit: typecheck, lint, `lint:deps`, `format:check`, **2784/2784 tests
  across 264 files** (from 2741/262), app build, bundle **72.8 kB gzipped** within the 300 kB
  budget (§2.6).
- **CI 257 at `0188a84` is green on all 35 steps**, 4m23s end to end (Test 2m27s, Build app 21s,
  Bundle size 1s, last step 07:07:22). Read from the job record rather than the run record, per the
  39th and 46th runs' trap. **The part worth recording is the four steps the local gate cannot
  cover** — this is P0.110's gap, and it is where the 43rd run's CI red came from: `Benchmark
regression check`, `Cross-engine drift check`, `Engine API docs` and `SolverKit API docs` all
  passed. So the P6.08 change is verified against the typedoc path too, which matters because the
  44th run's `{@link z0}` failure showed a doc comment can be latently broken and only surface once
  something new inlines the type. Nothing here is inlined into `engine`'s public API, and the docs
  steps confirm it rather than the reasoning alone.
- **Run 258 at `b87127c` is the stop-hook entry above and is `CHANGELOG.md`-only.** Not chased to
  completion, deliberately: recording each run's result is itself a commit that triggers the next
  run, so the convention here is one follow-up entry and then stop. A docs-only diff cannot reach
  any of the 35 steps except by the typedoc path, and this file is not in any typedoc entry point.
  **Next run: do not open with a check on 258** — if it is red, that is a finding about CI and not
  about P6.08.
- **The stop-hook false positive recurred, and this run did _not_ pay the branch for it.** The hook
  reported "4 unpushed commits on branch `claude/upbeat-ride-qukslu`" after the work had already
  landed on `main`. Verified rather than believed: `HEAD` and `origin/main` are both `0188a84`, and
  `git log origin/main..HEAD` is empty. **The new detail, and the one that narrows the fix: this
  run had explicitly set the branch's upstream to `origin/main` beforehand** (`git branch
--set-upstream-to`), and `git rev-parse --abbrev-ref @{upstream}` confirms it — so the hook is
  not merely defaulting to `origin/<name>` in the absence of an upstream, it is **ignoring a
  configured upstream that is present**. The 50th run's recommended fix (compare against the
  configured upstream) is therefore right and sufficient, and can be verified against this case.
  Unlike the 50th run, this one did not push the branch to clear the hook: doing so costs an
  irreversible stale branch — the pile stands at 88, P0.95 shows the delete fails with
  `send-pack: unexpected disconnect` _while exiting 0_, and there is no delete-branch call in the
  App — and CLAUDE.md forbids leaving `claude/*` branches behind. Paying permanent litter to
  silence a check whose premise is demonstrably false is the wrong trade, so the hook was left
  firing and the facts recorded here instead. **Next run: do not push the branch either; verify the
  two SHAs and move on.**
- **Note on the routine's description of this repo**: it says "Currently in Phase 4 (advanced
  aerophysics)". That is stale — phases 4 and 5 are complete, every task below `seq` 232 is `done`,
  and the work is in phase 6. `ROADMAP.json`'s `taskSelection` policy (first `in-progress`, else
  first `review`, else first `todo`, in `seq` order) picked P6.08 unambiguously, and the 50th run's
  handoff named it too. No phase was reordered and no task invented; recorded here only because the
  prompt's phase pointer will keep drifting as the roadmap advances.
- **Next run: P6.09** (impact-point scatter plot — `x_impact` histogram, or a 2D scatter in 3D
  mode), whose criterion is a performance one: 1e4 points rendered in under 16 ms, via density
  downsampling. That is the first phase-6 task with a UI surface, so expect it to need `viz`/`ui`
  rather than `analysis`, and note that P6.09–P6.11 are the plots that will consume
  `MeanConfidenceInterval` — the band is available to them now, complete with its `n`. The
  standing lazy-load-Plotly item remains a legitimate separate claim and was not touched.

---

## 2026-08-24 (50th run) — **P6.07 done**: the Monte Carlo rate measured, not assumed, on the range observable

- **P6.07 is done and its criterion is met.** `log–log slope −0.50±0.05` is **measured at
  −0.51162** on the real range observable in `packages/runtime/src/mc-convergence-range.test.ts`,
  over a pool of 49,152 replicates from the actual pipeline — P6.03's substream generator, P6.04's
  observable sink, the same integrator an interactive solve uses. Full API and reasoning are in
  `ROADMAP.json`.
- **The standard error is measured across batches, and that is the whole point.** The cheap route —
  take one batch of `N`, report `s/√N` — cannot detect a violation of the law it is testing, because
  it computes `σ/√N` by construction and so returns a flawless `−0.5` even on perfectly correlated
  draws. `mcConvergenceStudy` (`packages/analysis/src/mc-convergence.ts`) instead splits the pool
  into disjoint batches of size `N` and takes the sample standard deviation **across the batch
  means**, a quantity that knows nothing about `√N`. Each point still carries the derived value as
  `predictedStandardError`; on the range pool the two agree at ratios 0.92–1.00, and the analysis
  suite asserts they part company when independence fails.
- **What is actually under test is the premise, not the algebra.** `Var(mean of N) = σ²/N` is
  _exact_ for iid samples of finite variance — no CLT appeal, no large-`N` limit — so starting the
  sweep at `N = 16` is legitimate rather than a small-sample cheat. What breaks in practice is
  independence: correlated replicates (a reused substream, a seeding scheme that aligns) still
  produce a mean and still produce a plausible spread, but that spread stops shrinking at the Monte
  Carlo rate. A slope of `−0.5` is evidence this pipeline's replicates really are independent end to
  end.
- **Measured figures.** Pool: drag-free preset, normal jitter `stdDev 2` on `vx0` and `vy0`, seed
  `20260824`; mean range **91.7817 m**, per-replicate **σ 12.2285 m**. Measured SE **3.04905 /
  2.09942 / 1.48275 / 1.05380 / 0.74520 / 0.52770 / 0.35166** at batch sizes 16 / 32 / 64 / 128 /
  256 / 512 / 1024. Seven sizes over a factor of 64 because the SE estimate at size `N` comes from
  `POOL/N` batch means — the largest size is the least certain (48 batches, ~10% relative error) —
  and a wide lever arm in `log N` divides that noise down to an expected slope uncertainty near 0.02.
- **Batch sizes re-partition one pool, deliberately.** Drawing fresh replicates per batch would cost
  `Σ Kᵢ·Nᵢ` integrations for the precision one pool of `M` buys for `M`. The reuse correlates the
  SE estimates across sizes, which moves the fitted line up or down but **not its slope**; within any
  one size the batches stay disjoint and independent.
- **Not flaky, by construction — and this repo has P0.96 as the reason to care.** Replicate `i` is a
  pure function of seed and index, so the slope is a fixed number rather than a draw. One runtime
  assertion re-runs the pool in two halves and requires the _identical_ slope, which is P6.03's
  partitioning guarantee restated at the value level. The robustness argument that the passing slope
  is not one tuned seed lives in the analysis suite, where a pool costs microseconds instead of an
  integration each: five independent fixed seeds give **−0.4744 / −0.4982 / −0.5095 / −0.4810 /
  −0.5340**, all inside ±0.05.
- **The counterexamples are asserted, not just the passing case.** A perfectly correlated pool (each
  draw repeated 16×) has a measured SE more than 3× the derived one at the smallest batch; a pool
  whose batch means never shrink yields `slope === null` rather than a fabricated number.
- **It decides the question `mc-job.ts` explicitly deferred to this task.** A replicate that never
  reached the ground inside `MC_T_MAX_SECONDS` is excluded from the pool _before_ the estimator sees
  it — its "impact" is wherever the horizon caught it, and averaging that in biases the estimator by
  an amount nothing in the output shows. The runtime test asserts this study loses none, so a batch
  of `N` really holds `N` samples. A study that did truncate would need its batch sizes recomputed
  against the landed count, which is why the exclusion is the caller's step rather than hidden inside
  `mcConvergenceStudy`.
- **Gate green:** `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm format:check`, **2741/2741
  tests across 262 files** (27 new: 20 analysis + 7 runtime), and `pnpm --filter @ballista/app build`
  in 23.1s. `docs/analysis/README.md` gained the section `packages/validation`'s API-map test requires
  for every re-exported module — that test is what caught the omission, and it is worth knowing it
  will catch the next one too.
- **CI 253 at `7772d14` is green — all 35 steps `success`, 3m51s.** `Typecheck` 9s, `Lint` 5s,
  `Format` 7s, `Import boundaries` 3s, **`Test` 113s**, both soft-warn checks, both API-docs steps,
  `Build app` 18s and `Bundle size budget` 1s, last step completing 22:40:27. This bullet first read
  "steps 1–10 green, `Test` still running", which was true when written and understated once the run
  finished; corrected in place rather than left standing, as the 46th run's entry argues — a stale
  headline is what a later session inherits as fact. No re-run, no re-trigger: the same run was read
  again.
- **The stale-status trap has a second form, and it cost this run about 13 minutes.** The 39th and
  45th runs recorded that the _run_ record lags the _job_ record — check `completed_at` on the job.
  That is still true (run 253's run-level `updated_at` sat at 22:36:39 while its job had steps
  finishing at 22:37:47), **but the job record's `steps` array lags too.** `list_workflow_jobs`
  reported `Install Playwright browsers` as `in_progress` across four polls spanning ~13 minutes,
  and when it finally refreshed, that step had actually completed at **22:37:33, in 40 seconds**,
  with two later steps already green. So a step that appears stuck is not evidence of a hang either.
  **And the job's own `status` is the least reliable field of all: it still read `in_progress` after
  every one of the 35 steps carried `conclusion: success` and a `completed_at`** — the run was green
  and finished while the field said otherwise, which is how the green above was established.
  The guidance to carry: **no polled field here is fresh — only a `completed_at` timestamp that has
  actually appeared is evidence, and its absence is evidence of nothing.** Read the steps, not the
  status. Do not re-run a job, and
  do not diagnose an infrastructure fault, on repeated `in_progress` responses alone.
- **P0.95's count goes 87 → 88, and this run is the one that added to it.** Recorded rather than left
  for the next run to discover, as the 30th run did for its own probe branch. The work itself went to
  `main` by explicit refspec (`git push origin claude/upbeat-ride-o0f6w5:main`), so no `claude/*`
  branch was needed and none was created — but this session's harness runs a stop-hook that counts
  commits absent from `origin/<current-branch-name>`, and it reads a branch pushed only to `main` as
  7 unpushed commits. It is a false positive (branch HEAD and `origin/main` were the same SHA,
  `9bed120`, with `git log origin/main..HEAD` empty), but it fires on every attempt to end the
  session, so the branch was pushed to clear it. **The cost is exactly what P0.95 documents**: the
  18th, 30th and 35th runs each established that deleting a remote branch here fails with
  `send-pack: unexpected disconnect` _and exits 0 while doing so_, and the GitHub App exposes no
  delete-branch call — so this branch cannot be cleaned up from inside a session and joins the pile.
  **The fix is the hook, not the next run's behaviour**: it should compare against the branch's
  configured upstream (set here to `origin/main`) rather than assuming `origin/<name>`. Until then a
  run in this harness cannot both satisfy the hook and honour CLAUDE.md's "don't leave long-lived
  `claude/*` branches", and it should not waste time trying to.
- **Next run: P6.08** (CI bands on estimates, t-based, displayed honestly with `N`), whose criterion
  is a coverage test — 95% CI covers truth ~95% over 200 repeats against the drag-free analytic range.
  `standardErrorOfMean` is already exported for exactly that caller, and the drag-free closed form the
  coverage check needs is `dragFreeRange` in `range-root.ts`. Note the criterion is a _coverage_
  proportion, so unlike P6.07 it is a count of successes out of 200 and wants a tolerance band chosen
  against the binomial spread (±~3% at 1σ for p=0.95, n=200) rather than an exact figure; fix the
  seeds as here so it cannot flake.

---

## 2026-08-24 (49th run) — **P6.06 done**: streaming Welford moments and P² quantiles, matched to offline numpy

- **P6.06 is done and its criterion is met.** `matches offline numpy on fixture to 1e-10 (mean/var),
quantile ±0.5%` is checked in `packages/validation/src/mc-moments-numpy.test.ts` against a committed
  numpy fixture, not declared. Measured maxima: mean and sample variance agree with numpy to well under
  `1e-10` relative on all three columns; the worst P² quantile lands at **~0.33%** (apex height, p=0.95),
  every other estimate tighter. Full API and reasoning are in `ROADMAP.json`.
- **Two estimators, both single-pass, both O(1) storage.** `packages/analysis/src/streaming-moments.ts`:
  `WelfordAccumulator` (running mean and `M2` by Welford's recurrence) and `P2QuantileEstimator` (Jain &
  Chlamtac 1985 — one quantile tracked by five markers, no sample retained). The quantile estimator keeping
  five numbers regardless of N is the property P6.10's per-time-grid bands need over a batch that
  `ObservableSink` (P6.04) deliberately does not retain.
- **Welford, not `(sumSquares − sum²/n)/(n−1)`, and the reason is measured.** That one-line derivation from
  `mc-stats.ts`'s existing sums is catastrophic cancellation when the mean dwarfs the spread: the
  impact-speed column near 30 m/s with a 0.05 m/s spread has `sumSquares/n ≈ 900` against a variance of
  `2.5e-3`, so five leading digits cancel before the answer begins. A test in both
  `streaming-moments.test.ts` and `mc-stats.test.ts` measures Welford beating the naive form by **>100×** on
  exactly that shape. `sum`/`sumSquares` stay as the order-sensitive reduction primitives and as what
  `hashMcStats` folds; `mean`/`variance` are added beside them.
- **`McObservableStats` gained `mean` and `variance`, computed in `mcStats`'s existing canonical loop** by a
  `WelfordAccumulator` per observable — the 48th-run handoff's instruction to extend `McStats` rather than
  add a second module. They see the landed subset only, in the same fixed order the sums do, so they are as
  reproducible as the sums. `mean` is `NaN` for an empty landed subset and `variance` `NaN` for fewer than
  two landed — never `0`, which would read as a centred/precise batch. `hashMcStats` now folds both, so a
  reproducibility check keeps covering the whole struct rather than silently dropping the new fields.
- **The merge is deterministic but not associative-exact, and both halves are asserted.**
  `WelfordAccumulator.merge` (Chan, Golub & LeVeque 1979) combines chunk-local accumulators without
  revisiting values — the parallel-reduction path a worker pool takes — and it evaluates a different
  expression from sequential pushing, so it lands _within rounding_ rather than on the same bits. A test
  pins that it is not bit-identical, because a session reading "merge is equivalent" would wrongly conclude
  chunks can be merged in arrival order. They cannot; canonical merge order is the P6.05 property one level
  up. The numpy suite checks the three-chunk merge reaches the whole-stream answer to `1e-10`.
- **The fixture is committed, not regenerated in TypeScript.** `scripts/generate-mc-moments-fixture.py`
  draws a deterministic sample with numpy's Mersenne Twister across three column shapes (a well-behaved
  normal, the cancellation case, a right-skewed lognormal where P²'s markers are unevenly spaced) and writes
  the sample plus numpy's mean/variance/percentiles to `packages/validation/src/mc-moments-fixture.json`.
  The criterion is agreement with numpy on the _same_ values; reproducing numpy's RNG in TypeScript would
  test an RNG port, not the estimators, and would fail this suite while blaming the wrong code. If the
  fixture is ever regenerated the reference numbers change — say so here when doing it.
- **One property the tests do not over-claim.** `P2QuantileEstimator.markers()` before the fifth push is the
  raw unsorted buffer — the algorithm sorts on initialisation — so the ascending-marker invariant is
  asserted only for `count ≥ 5`. And P² is an estimator, not a sort: fed a monotone-sorted stream (its
  pathological case, which no real batch is) its median drifts ~0.57% on a 1001-point ramp. The unit test
  feeds a shuffled ramp and the fixture columns arrive as numpy generated them; the ±0.5% criterion is the
  fixture's, measured.
- **Verification.** `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps` (1504 modules, 4294 dependencies, zero
  violations), `pnpm format:check` and `pnpm --filter @ballista/app build` all clean. `pnpm test`
  **2714/2714 across 260 files**, up from 2676/258 — 38 new cases (23 in `streaming-moments.test.ts`, 4 in
  `mc-stats.test.ts`, 11 in `mc-moments-numpy.test.ts`).

**Next run should pick up P6.07** (MC convergence check: `SE ∝ N^{−1/2}` measured on the range observable).
`WelfordAccumulator.standardError` is the instrument it needs — `s / sqrt(n)`, already present and NaN-safe
below two samples — so P6.07 is a study over growing N asserting the log-log slope is `−1/2` within a
tolerance, not new estimator code. It should reuse the committed numpy fixture's `range` column or draw
fresh replicates through the existing MC job rather than inventing a third sample source. Note P6.08 (t-based
CI bands) then builds directly on the same standard error, so keeping P6.07's harness reusable pays off one
task later.

---

## 2026-08-24 (48th run) — **P6.05 done**: reduce a Monte Carlo batch in canonical order, and hash it so the property is checkable

- **P6.05 is done and its criterion is met.** "Shuffled worker completion ⇒ identical stats hash" is
  asserted three ways in `packages/analysis/src/mc-stats.test.ts` rather than declared: the same
  chunks handed to `assembleMcColumns` as-partitioned, reversed, and interleaved assemble to a
  byte-identical full-length buffer; two 256-replicate batches on different partitionings, each
  arriving in a shuffled order, hash the same as the source; and a right-to-left `sum` twist on the
  reduced stats DOES change the hash — the fault the module exists to prevent is the one the hash
  catches. Full API and reasoning are in `ROADMAP.json`.
- **The property is IEEE-754 non-associativity, not chunking.** A worker pool completes chunks in
  whatever order the OS scheduled them; a sum built from those chunks in arrival order therefore
  drifts at the LSB from run to run and any downstream check that hashes the numbers (P6.27's
  reproducibility test) reports drift where there was only scheduling jitter. The fix is
  assemble-then-reduce: `Float64Array.set` writes each chunk into its global slice, and one
  left-to-right loop over the assembled buffer folds the sums.
- **A coverage bitmap catches the two shapes a partition bug can take** — an overlap (two workers
  handed the same range) and a gap (a message dropped in transit) — both regardless of chunk
  arrival order. Neither is a NaN or a silent zero downstream; both throw at the seam.
- **Non-landing replicates count toward `count` and `landedCount` only.** They contribute to no
  observable sum, sumSquares, min or max, because a truncated flight's "impact point" is wherever
  it happened to be at 60 s and averaging that in with real impacts silently biases every
  estimator by an amount nothing in the output would reveal. `mc-job.ts` already flagged this per
  replicate (47th run); this session picks the reduction side of the decision the 47th-run handoff
  named. Mean is left to the caller precisely so the denominator is visible at the call site;
  Welford is P6.06.
- **Structural typing on the columns keeps the analysis package cycle-free.** Runtime already
  imports `ObservableSink` from analysis, so `mc-stats` cannot import `McColumns` from runtime; it
  declares an `McObservableColumns` interface that matches `runtime/mc-job.ts`'s shape one-for-one
  and accepts the runtime type unchanged. `splitmix64` is inlined rather than re-exported from
  `@ballista/engine` — both to avoid coupling to that module's seed-derivation property tests (46th
  run: "grade the property, not the constants" is right precisely because two callers of one mixer
  would couple two unrelated properties) and because `engine`'s copy is not exported.
- **What the tests deliberately do not pin.** Reversing the CHUNK ARRIVAL order for singleton
  chunks (1024 chunks of one replicate each, reversed) does NOT change the hash and is not caught,
  because the assembled buffer is bit-identical either way; only the REDUCTION direction matters,
  and the reversal-of-reduction case is inlined in the same test rather than exposed as a knob on
  `mcStats`. Same "test the property, not the constant" pattern as the 46th-run splitmix64 note.
- **Verification.** `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps` (1495 modules, 4275
  dependencies, zero violations) and `pnpm format:check` all clean. `pnpm test` **2676/2676 across
  258 files**, up from 2661/257 — the 15 new cases in `mc-stats.test.ts`. One pre-existing test
  had to be satisfied on the way (`packages/validation/src/analysis-docs.test.ts` asserts every
  re-exported module has a section in `docs/analysis/README.md`; that section was added).

**Next run should pick up P6.06** (streaming moments: Welford mean/variance; P² or reservoir
quantiles). `mc-stats.ts`'s `sum` and `sumSquares` are the reference the Welford pass must agree
with byte-for-byte on the same input, and its `hashMcStats` is how "agree" is checked. The
mean-computation gap is deliberate — P6.06 fills it — so P6.06 should extend `McStats` with
`mean` and `variance` fields rather than adding a second module. Non-landing exclusion stays a
property of the reduction, not of the estimator.

---

## 2026-08-23 (47th run) — **P6.04 done**: observables without the trajectory, and a criterion that its own counterexample passes

- **P6.04 is done and its criterion is met as measured.** 1e4 replicates retain **0.35 MB**
  against the 50 MB budget, read as `heapUsed` across a forced GC on both sides — P1.21's
  methodology, not an estimate. `ObservableSink`
  (`packages/analysis/src/observable-sink.ts`) plus the `mc` job
  (`packages/runtime/src/mc-job.ts`); 66 tests, 56 + 10. Full API and reasoning are in
  `ROADMAP.json`.
- **The task was the sink selection, not the batch loop.** `sweep-job.ts` attaches a
  `TrajectoryRecorder`, whose cost is O(steps × channels), and nothing downstream of a Monte
  Carlo batch ever reads those rows. The sink keeps the first row, the last row and the best
  apex candidate — O(`model.dim`) for a whole solve — and one instance is reused across the
  batch.
- **It is the same arithmetic as `observables.ts`, not an approximation, and the tests say so
  with `Object.is` rather than a tolerance.** A tolerance is precisely what would let a
  streaming reimplementation drift a little and keep passing. Exactness is reachable because
  `TrajectoryRecorder` records the initial state plus one row per `accept`, so the sink sees
  the same rows, and because `apex`'s scan is already local to consecutive pairs. Only the
  candidate _order_ had to be reproduced: `apex` compares row 0, then the final row, then
  interior crossings, on strict-greater — so ties go to the earliest **considered**, not the
  earliest in time. Streaming meets the crossings first, so the crossing maximum is kept
  separate and folded in after the endpoints.
- **The criterion is met, and the criterion is also not sufficient — that is the finding.**
  Restoring a per-replicate `TrajectoryRecorder` and retaining every trajectory, which is the
  exact implementation the criterion exists to forbid, costs **10.5 MB here and passes the
  50 MB assertion**. A drag-free preset flight is a few dozen accepted steps, so 1e4 retained
  trajectories are ~10 MB and never reach the threshold. The 50 MB number is a property of
  the fixture, not of the code. The acceptance test is kept verbatim and a second test
  measures the property instead — quadrupling N must not grow retained memory beyond the
  output columns — which fails the retaining variant by ~8 MB. **Nobody should read the
  50 MB test as protection against retention.**
- **Two bugs the tests found, both fixed rather than worked around.** The apex scan paired the
  row _before_ last with the incoming row, so every refinement after the first used a stale
  row; the sink needs one row of history, not two, and no longer keeps the second. And the
  sink's own memory test ran its long and short solves on DOPRI5, where the configured `h` is
  only an initial guess — the controller converged both to ~395 steps and the comparison was
  vacuous. It is now fixed-step RK4 under Hermite dense output, 100× apart in step count, and
  measured while holding 20 finished sinks so the signal scales with the count while GC slack
  does not.
- **One documented claim was wrong and is corrected.** `SolveReport.status` is `"ok"` for a
  solve that merely runs out of `tspan`, identically to one that hit the ground, and the
  report carries no terminal-event flag — so the first draft's "status tells an impact from an
  exhausted horizon" was false. `mc-job.ts` reports a per-replicate `landed` computed from
  `tFinal < MC_T_MAX_SECONDS`. It matters: a truncated flight's "impact point" is wherever it
  happened to be at 60 s, and averaging those in with real impacts would bias P6.07's and
  P6.11's estimators by an amount nothing in the output would show.
- **What the tests deliberately do not pin.** Relaxing the downward-crossing guard
  (`vy0 >= 0 && vy1 < 0`) to any sign change is **not** caught by any case, the bouncing arc
  included. An upward crossing refines to a local _minimum_, and a running maximum never takes
  it, so the fault cannot move the reported apex. The guard mirrors `observables.ts` and is
  right; it is simply not observable at the value level, and the passing suite is not a claim
  about it. Same shape as the 46th run's note on `splitmix64`'s second multiply.
- **Verification.** `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps` (1489 modules, 4268
  dependencies, zero violations) and `pnpm format:check` all clean. `pnpm test` **2661/2661
  across 257 files**, up from 2595/255. Seven faults injected into the sink in turn and
  reverted; five caught, two of them only by the bouncing arc and the still-climbing solve and
  one only by a non-zero launch epoch — all three cases added after the first draft passed
  everything.
- **Repository state worth recording, because it is not the code.** The clone's `main` and
  `origin/main` had **no merge base at all** — 50 commits each side, unrelated histories, and
  the fetch reported `origin/main` as a forced update. `origin/main` is the live line (P6.03,
  46th run, 2026-08-23) and the local one was stale at P5.24 from the 36th run, so this run
  reset local `main` onto `origin/main` and worked from there. Nothing was force-pushed and no
  remote history was touched. Flagged rather than diagnosed: if a future run finds the same
  split, the remote is still the one to trust, but somebody should find out what re-rooted it.

**Next run should pick up P6.05** (deterministic reduction order by replicate index for all
statistics), the next task in `seq` order. It has what it needs: `McColumns` is already
indexed by replicate and `runMcRange` already writes chunk-locally, so the reduction order
question is about the statistics layer and not about the job. Note that `landed` is a column
now — P6.05 has to decide whether a non-landing replicate is excluded from a statistic or
poisons it, and that decision belongs in the reduction, not in the job.

---

## 2026-08-23 (46th run) — P6.03 done: one substream per _pair_, and the two faults the first draft could not see

- **P6.03 is done and its criterion is met as written.** "Replicate `i` identical regardless of
  batch partitioning" is asserted three ways rather than declared: a replicate generated alone
  equals the same index taken from any range containing it; every contiguous partition of `0..N-1`
  into chunks of 1, 2, 3, 5, 7, 16 and 64 reassembles into the identical sequence; and asking for the
  ranges **backwards** gives the same result as forwards — the one that catches hidden state rather
  than a hidden index. Full API and reasoning are in `ROADMAP.json`.
- **The design decision was to give each `(replicate, overlay)` pair its own substream, not each
  replicate.** One generator per replicate meets the criterion and is still wrong, for a reason that
  only shows up when a study is _edited_ rather than re-run: distributions consume different numbers
  of raw uniforms — `normal` takes two through Box–Muller, `uniform` takes one, a truncated variant
  takes one through the inverse CDF — so changing overlay 0's _kind_ shifts every later parameter in
  every replicate. Comparing two studies that differ in one parameter, which is the whole of P6.17,
  would be comparing two unrelated ensembles. Two cases assert the independence, and both pass under
  a per-replicate stream, which is why they are kept outside the batch-partitioning block.
- **PCG32 discards the top bit of a stream id**, and that shaped the implementation. Its increment
  is `(streamId << 1) | 1` masked to 64 bits, so `s` and `s + 2^63` are the _same_ stream and any
  64-bit hash of `(i, j)` is two-to-one onto the streams. The stream id is therefore not hashed: it
  is the plain packing `i * 2^20 + j`, injective by construction and bounded below `2^63`. What is
  hashed is the seed.
- **Two injected faults were not caught by the first draft, and both were in that hashing.**
  Removing the seed hash, and replacing the derived seed with the study seed, each passed every
  value-level assertion in the file — because the streams alone already differ, so the drawn values
  differ anyway and nothing noticed the seeds had collapsed. That is what `replicateSeed` is
  exported for: two cases now grade the hash itself. **Worth carrying forward as a pattern** — when
  a module has two independent sources of variation, a test on the observable output cannot tell you
  that one of them died.
- **What those cases deliberately do not pin.** Neutering `splitmix64`'s second multiply still
  passes, because a one-round mixer still meets both properties. They grade the property, not the
  constants, and that is the right level; it is recorded so nobody reads the passing suite as a
  claim about the exact mixer.
- **Validation is on, and the cost was measured rather than guessed.** Each drawn spec is re-parsed
  by `scenarioSpecSchema` at **24.7 µs**, so 10^4 replicates pay a quarter of a second against 10^4
  trajectory integrations. A failing draw throws rather than being dropped — dropping is rejection
  sampling on the output and biases the estimator; integrating a negative mass poisons it silently.
- **Verification.** `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm format:check` and the
  engine's `typedoc` build all clean. `pnpm test` **2595/2595 across 255 files**, up from 2563/254.
  Eight faults injected in turn and reverted.

**Next run should pick up P6.04** (`mc` worker job: batch integrate, record observables only), the
next task in `seq` order. It consumes `generateReplicateRange` directly — that is the shape it was
given for — and its criterion is a memory budget (1e4 replicates, < 50 MB, no retained
trajectories), so read this module's note on structural sharing before changing
`writeSpecNumberAtPath`: it copies only the objects along the path precisely so a tabulated drag
curve is not cloned ten thousand times, and a test pins that.

---

## 2026-08-23 (45th run) — **P0.106 done**: the flaky-test class fixed at both ends, and P0.96 given a reproduction recipe

- **P0.106 is done, and its validation criterion was met as written rather than declared met.**
  The criterion is "the full `pnpm test` suite passes repeatedly on a loaded container without any
  build-heavy test crossing a timeout, and no assertion was changed to achieve it". Seven full-suite
  runs: **four on a deliberately loaded container** (two of four cores busy-looping — the load was
  real and measurable, suite duration **136-140 s under load against 100-103 s unloaded**) and three
  unloaded. **Zero build-heavy timeout failures in any of the seven.** No `Hook timed out`, and no
  failure in `canvas-viewport`, `app-shell.responsive`, `app.e2e`, `worker-pool.e2e` or either
  bundle test. Unloaded runs were **2563/2563 across 254 files** every time.
- **The class had two halves and they needed different fixes; conflating them is what kept it
  open.** The 44th run diagnosed this and its diagnosis held up.
  - **The race.** `solver-lab-route.test.tsx` awaited a real dynamic import of KaTeX by spinning a
    **fixed five macrotask turns**. No constant fixes that — five turns is not a short wait, it is a
    wait for the wrong thing. Replaced with `waitForRenderedDerivation`, polling until the panel is
    non-empty up to a 20 s deadline. **The wait condition is deliberately weaker than what the test
    asserts**: it waits for "non-empty", and the assertions still check the heading text and a real
    `.katex` node. Waiting on the assertion's own condition would have made the assertion vacuous,
    which is precisely the weakening this repo forbids. On deadline the failure now reads _"the lazy
    KaTeX import never resolved (this is a hang, not a slow machine)"_ rather than an assertion diff
    against `''` — the diff is what sent four sessions looking at the wrong thing. Verified by
    temporarily setting the deadline to 0 and confirming that message surfaces.
  - **The timeouts.** Seven call sites across six build-heavy files; hooks **60 s → 180 s**, bundle
    tests **30 s → 90 s**, per-file so an ordinary unit test that hangs still fails against vitest's
    5 s default. Standalone times were **measured first** rather than picking a round multiple and
    asserting it was enough: `canvas-viewport` 24.8 s, `app-shell.responsive` 25.8 s, `app.e2e`
    22.9 s, `worker-pool.e2e` 2.3 s, `lazy-plotly-pane` 13.0 s, `lazy-katex-pane` 0.8 s. 180 s is
    **~3.7× the slowest hook measurement on record** (P4.38's 48.6 s) and 90 s is **~4× the slowest
    bundle-test one** (22.1 s), against an observed suite-parallel inflation of ~2.4×. These are
    deadlines, not assertions, which is exactly why this half needed no human decision.
- **P0.96 now has a reproduction recipe, and it is the reason two of the four loaded runs were red.**
  This flake had only ever been seen sporadically on CI; it can now be provoked on demand. **Recipe:
  full `pnpm test` plus external CPU load.** It reproduced in **2 of 4** such runs. **Both halves are
  necessary** — the same file standalone under the same load passed **3/3**, and the full suite
  unloaded passed **3/3** — so it needs suite parallelism _and_ external load together. That is
  consistent with the filing: it is a wall-clock assertion measuring a machine that is busy doing
  something else. **It was not weakened, silenced or worked around**, and it still needs the same
  human decision it always did: whether the 10 ms cooperative-yield target is _asserted_ or merely
  _measured and reported_. No maxSliceMs number is claimed from these runs — the output was filtered
  to the failure line, so the only measured value on record remains CI 244's 11.982128 ms.
- **Task taken out of `seq` order, deliberately and on the policy's own terms.** `P0.*` filings take
  minors from 90 upward and are _appended_, so P0.106's seq of 304 records when it was filed, not
  where it belongs — `policy.taskIds` says "Ids are labels, not an ordering". Read literally,
  first-todo-by-seq is P6.03, which starts a new Phase 6 feature while a known flake can redden
  `main` at any commit.
- **Filed: P0.111 — `pnpm test` is red on a fresh clone.** Found while establishing this run's
  baseline, and filed rather than fixed as a drive-by. `pnpm install && pnpm test` fails 3 assertions
  in `cross-engine-drift-record.test.ts`, because its fixture imports `packages/engine/dist/index.js`
  and nothing has emitted it yet; `pnpm typecheck` (`tsc -b` over composite projects) is what does,
  and `ci.yml` runs Typecheck before Test so CI never sees it. The failure is actively misleading —
  it surfaces as `ERR_MODULE_NOT_FOUND` inside a drift-measurement assertion, which reads like the
  measurement is broken rather than like a missing build. It cost this run one 103 s suite run to
  diagnose.
- **Gate before every commit**, in CI's order: `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`
  (1471 modules, 4195 dependencies, no violations), `pnpm format:check`, `pnpm test`. All clean.
- **CI run 247 at `cfc2df8`'s successor `3e52cb9` is green, all 35 steps**, `Test` in 91 s. Read
  from the **job** record, not the run record: `get_workflow_run` still reported `in_progress` with
  an `updated_at` of 14:57:11 while `list_workflow_jobs` showed `conclusion: success` and a
  `completed_at` of 15:00:36. That is precisely the stale-status trap the 39th run recorded and
  acted wrongly on — **check `completed_at` on the job, not `status` on the run.** Worth noting for
  P0.106 specifically: this is one more green CI observation on the changed tree, but CI is a
  single unloaded run and the loaded local runs are the stronger evidence.
- **Corrected in this run, rather than left standing.** P0.111's filing first said the fresh-clone
  failure was "found while establishing that run's baseline", which reads as a discovery. The 38th
  run had already hit it and written it into commit `2469a3f`'s message. The filing now says so —
  and that history is the argument _for_ filing it, since a note in one commit message among 247 is
  not somewhere a session looks, which is how it came to be rediscovered seven runs later.

---

## 2026-08-23 (44th run, addendum) — CI 244 red at `07e7b23` on two different flaky tests; **CI 245 green at `cfc2df8`, `main` recovered**

- **`main` ended this run GREEN, at `cfc2df8`, but it was red at `07e7b23` first and the sequence
  is the point.** CI run 244 at `07e7b23` failed the `Test` step on **both** attempts; the commit
  recording that failure then went green as **run 245 at `cfc2df8`, all 35 steps**. Everything
  outside `Test` passed on all three — typecheck, lint, format, import boundaries. So the code
  that closed P6.02 is verified green on CI; what reddened 244 was the flake pair below, and this
  is a **third** data point on the same tree-plus-docs.
- **A note for whoever reads only headlines**: this entry's first draft said "`main` is red and
  this run did not get it green", which was true when written and false forty minutes later. It is
  corrected here rather than left standing, since a wrong headline is exactly the kind of thing
  later sessions inherit as fact.
- **The two attempts failed on _different_ tests, and each one passed in the other attempt.** That
  is the whole finding, and it is the cleanest evidence either flake has produced:
  - **Attempt 1** — `packages/solverkit/src/chunked-integration.test.ts:318`, `maxSliceMs`
    **11.982128** against the 10 ms budget (**P0.96**). `solver-lab-route.test.tsx` passed in this
    attempt, in 505 ms.
  - **Attempt 2** — `packages/app/src/solver-lab-route.test.tsx:91`, `expected '' to contain
'Explicit (Forward) Euler'` (**P0.106**). `chunked-integration.test.ts` passed in this attempt.
  - Same commit, same tree, not one byte changed between them. 2562/2563 passing both times.
- **Neither is a P6.02 regression, and the argument is mechanical rather than an appeal to
  history.** The diff touches `packages/engine` plus `ROADMAP.json`/`CHANGELOG.md`. The
  chunked-integration measurement wraps `continuation.runSlice()` on a dim-1 decay model with a
  mock Euler stepper; that file's `@ballista/engine` imports are atmosphere/gravity/wind/eval-context
  helpers this run did not touch, and the new module reaches it only as one extra barrel re-export
  evaluated at import time, outside the timed region. The full suite was **2563/2563 green
  locally** before the push, and `solver-lab-route.test.tsx` passes **3/3 standalone** in this
  container after it.
- **The solver-lab failure now has a mechanism, not just a margin — and it is a race, not a
  timeout.** The test awaits a _real_ dynamic import of KaTeX by spinning a **fixed five macrotask
  turns** and then asserting. Under the parallel suite the import plus module transform needs more
  than five turns, the panel is still empty, and `textContent` is `''`. So P0.106's "raise the
  timeout" remedy does not apply to this file; the equivalent fix that decides nothing is to poll
  for the rendered content up to a bounded deadline and then assert **exactly the same two things**
  (the heading text and a `.katex` node). Recorded against P0.106 rather than done: this run had
  already claimed P6.02, and P0.106's own criterion demands repeated loaded-container suite runs to
  verify, which is the task rather than a drive-by.
- **Nothing was weakened to get green, and nothing will be.** P0.96 is a wall-clock _assertion_ and
  its filing is explicit that raising the constant buys a longer gap between flakes rather than a
  fix, and that choosing between its two options is a human's call. One re-run was spent — the
  legitimate use, confirming whether the first failure reproduced — and it is not spent again here.
- **What a human needs to decide**: P0.96, which can redden `main` at any commit until it is
  resolved. P0.106 needs no decision, only a session that claims it.

---

## 2026-08-23 (44th run) — P6.02 done: an ordered array, because the index is a promise

- **P6.02 was taken because it is the first `todo` by `seq` (226)**, with nothing `in-progress`
  and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written.
  P0.106 (`seq` 304) and P0.109 (`seq` 307) are still the short tasks for whoever wants one.
- **VALIDATION MET.** The criterion is "serialize round-trip; validates against base schema".
  `packages/engine/src/uncertain-scenario-spec.ts` and **51 tests**, both halves asserted
  directly rather than implied.
- **The round trip is compared as text, not only as shape, and that is the point.** A
  `JSON.stringify`/`parse`/re-parse cycle is deep-equal, idempotent on a second pass, **and
  byte-identical as serialized text** — and it runs over _every_ `PRESET_SCENARIOS` entry as the
  base, since the base is the half most likely to quietly drop a field (optional spin and lateral
  channels, nested wind variants, tabulated drag tables). Deep equality alone would tolerate the
  overlays coming back reordered, and overlay order is precisely what the next two tasks rest on.
- **Overlays are an ordered array of `{path, distribution}`, not a `Record<path, …>`, and the
  reason is downstream rather than aesthetic.** P6.03 assigns each uncertain parameter its own
  PCG32 substream **by index**, and P6.05 requires statistics to reduce in a fixed order however a
  worker pool partitioned the batch. An array states that index and carries it across
  serialization; a keyed object would leave it resting on JS property-order, which is a language
  detail rather than a promise the format makes. Duplicate paths are rejected in the same spirit —
  two distributions on one parameter has no defined meaning, and last-one-wins would make a
  study's result depend on key order.
- **The base is parsed by `scenarioSpecSchema` itself, unmodified.** That is what turns "validates
  against base schema" into a property of the type instead of a convention: a study cannot
  describe a scenario the deterministic engine could not run. A negative mass, a wrong
  `schemaVersion` or an absent base each fail the study, and the issue is reported under the
  `base` path rather than the study root, so a caller can tell a broken scenario from a broken
  study.
- **Paths are resolved against the study's own base at parse time.** A typo becomes a
  configuration error naming the path, rather than a `NaN` that surfaces ten thousand replicates
  later as a quietly wrong mean. `readSpecNumberAtPath` is exported so P6.03 shares one definition
  of what a path means instead of growing a second that can drift, and it refuses
  `__proto__`/`constructor`/`prototype` and inherited keys — a path is data, and a study can
  arrive from a shared URL. It returns `undefined` rather than `0` or `NaN` for an unresolved
  path, because `initialConditions.x0` is legitimately `0` in most presets and the two must not
  be confusable.
- **Two seeds, deliberately.** `base.seed` fixes the nominal realization (the frozen-OU wind path,
  ADR-011); the study `seed` fixes the ensemble. P6.03 derives each replicate's substreams from
  the latter and the replicate index, so a study reproduces regardless of worker-pool size.
- **Applying a drawn parameter vector back onto a spec is deliberately not here** — that is
  P6.03's replicate generator. This module owns the description and its validation.
- **A latent typedoc failure surfaced and was fixed first, in its own commit.** `vz0`'s doc
  comment in `scenario-spec.ts` carried `{@link z0}`, a sibling of the anonymous object type zod
  infers for `initialConditionsSchema`. Typedoc resolves that only where it renders the type as a
  named page — and P6.02's `nominalOverlayValues`/`overlayDistributions` are the **first engine
  exports whose signatures inline a `ScenarioSpec`**, so the comment got re-rendered where the
  target has no page, producing two "exists but does not have a link" warnings. `typedoc` is
  configured to fail on warnings (exit 5). That is why CI 242 was green at `ac22925` and this
  change would have been red: the warning was always latent and P6.02 was the first thing to
  reach it. Demoted to code formatting with the reason recorded inline, so it does not get
  "improved" back into a link.
- **Full gate green before every commit**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm lint:deps` (1471 modules, 4195 dependencies, no violations), `pnpm test` **2563 passed
  across 254 files**, engine and solverkit `typedoc` both exit 0, `pnpm --filter @ballista/app
build`, and the bundle-size budget at **72.8 kB gzipped against 300 kB (§2.6)**.
- **Next**: P6.03 (`seq` 227), the replicate generator — seed + index substreams to param vectors,
  validated by "replicate i identical regardless of batch partitioning". It consumes this task's
  overlay array in order and is where `readSpecNumberAtPath` gains its write-side counterpart.

---

## 2026-08-22 (43rd run) — P6.01 done: phase 6 opens, and the tail is the whole problem

- **P6.01 was taken because it is the first `todo` by `seq` (225)**, with nothing `in-progress`
  and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written.
  It opens phase 6. P0.106 is still the short task for whoever wants one, at `seq` 304; P0.109
  is at 307.
- **VALIDATION MET.** The criterion is "sampling moments match analytics (1e5 draws, 3σ bands)".
  `packages/engine/src/distribution.ts` and `normal-distribution-functions.ts`, **48 tests**
  (27 + 21), and seven separate 1e5-draw assertions — one per family and truncation shape.
- **The bands are the estimators' own standard errors, and that is the point.** `SE(mean) =
σ/√n`, `SE(s²) = σ²√(2/(n−1))`. A tolerance written this way **tightens as `n` grows**, so a
  biased sampler cannot be hidden by drawing more samples; a hand-picked epsilon would have the
  opposite property. Only the lognormal variance band carries slack (a factor of 4), because
  excess kurtosis near 1.6 genuinely widens the variance estimator beyond the normal-theory
  formula — derived in a comment, not fitted until green.
- **Truncation is inverse-CDF, and the reason is a cost curve, not taste.** Rejection sampling's
  runtime depends on how unlikely the retained region is: the `[3σ, 4σ]` window one test draws
  from has an acceptance rate of **1.3e-3**, so producing its 1e5 samples by rejection would
  need about **8e7** draws. P6.04 runs 1e4 replicates and cannot carry a sampler whose cost is
  a function of the study's own parameters. Inverse-CDF is O(1) at every window.
- **THE FINDING, and it is arithmetic rather than statistics.** Every probability in this
  module is computed in whichever of `Φ` or `Q = 1 − Φ` stays away from 1, because the
  retained-mass `Z` is a **divisor in every truncated moment** and it is exactly the quantity
  that cancellation destroys. `standardNormalIntervalMass(4, 5)` keeps sixteen digits where
  `Φ(5) − Φ(4)` keeps eleven — both endpoints are within 3.2e-5 of 1 — and at `[10, 11]` the
  naive form has nothing left at all. A truncated distribution is _only ever used_ where its
  bounds bite, so the tail is not an edge case here; it is the normal operating regime.
- **`erf`/`erfc` carry no fitted coefficients.** They come from the regularised incomplete gamma
  at `a = 1/2` — series below `x² = 1.5`, continued fraction above — iterated to
  double-precision convergence rather than truncated at a fixed polynomial order, so there is no
  error floor to document. `normalQuantile` Halley-refines against `normalCdf`, which is why its
  A&S 26.2.23 seed (good to 4.5e-4) can sit under assertions at 1e-14: the seed sets the
  iteration count and nothing else, and a test asserts exactly that.
- **A spec can be legal on its face and unsampleable.** `[40σ, 41σ]` has both bounds finite and
  correctly ordered, and probability mass that underflows to exactly zero. The schema rejects it
  at parse time, where the study's author can see it, rather than dividing by zero at sample time.
- **Verified in both directions.** Four faults were injected in turn and reverted: the
  truncated-normal mean shift's sign (4 tests fail), truncation dropped from the sampler (4),
  the `shift²` term of the variance factor (4), and the `k·s` shift in the lognormal raw moment
  (2). Worth recording from the second of those: it is **not** caught by the support test,
  because `clampToSupport` masks it — the moment tests are what catch it. A sampler can respect
  its bounds perfectly and still be wrong inside them.
- **Two tests of the first draft encoded wrong beliefs, and were fixed rather than loosened.**
  One compared `erfc` at two points 2e-9 apart and expected agreement to 1e-14, ignoring that
  `erfc`'s own slope there is −0.2518 and produces 5e-10 of entirely genuine difference. The
  other used a trapezoid reference integral for `normalCdf` whose **own** O(h²) truncation error
  was 8e-11, which would have set the tolerance instead of the function under test; it is
  Simpson now. In both cases the implementation was already agreeing with an independently
  written Taylor series to **3e-16**. The failure was in the reference, and the fix was to make
  the reference better rather than the assertion weaker.
- **Gate green**: `pnpm typecheck` clean, `pnpm lint` clean, `pnpm lint:deps` **no violations
  across 1465 modules / 4173 dependencies**, `pnpm test` **2512 passed across 253 files** (2464
  across 251 before this run — exactly the 48 tests and 2 files added), `pnpm build` **✓ in
  29.37s**.
- **And the gate was still not enough, which is this run's other finding.** All five documented
  checks passed and CI still went red at `a7f09b9`, on step 14 of 34: `pnpm --filter
@ballista/engine run docs`. `typedoc` is configured to fail on warnings, and
  `DistributionSpec` was inferred from an **unexported** const, which it reports as a documented
  type referencing an undocumented symbol. Fixed in `b833aa2` by exporting
  `distributionSpecUnionSchema` — which `scenario-spec.ts` already does for its own component
  schemas, so the fix is the convention rather than an appeasement — and by dropping a
  doc-comment `{@link}` to a private helper, which is the same problem in a comment.
  **CLAUDE.md's pre-push gate lists five commands; `ci.yml` runs eleven steps.** The two
  `docs` steps, `Format` and `Bundle size budget` are all absent from it, so a run can do
  exactly what the repo asks and still land red. Filed as **P0.110** (`seq` 308) rather than
  fixed here, with the suggestion that CLAUDE.md point at a single `verify` script instead of a
  list that drifts. `typedoc`'s fail-on-warnings setting is **not** the thing to change: it
  caught a real omission. **Confirmed from both ends**: run 241 at `a7f09b9` failed at step 14
  of 34 with steps 15-17 skipped, and run **242** at `1fe368b` is **green on all 35 steps** —
  `Engine API docs` 5s, `SolverKit API docs` 4s, `Test` 2m24s, 4m27s end to end. The fix was
  verified by running all eleven `ci.yml` steps locally by hand before pushing, not by pushing
  and hoping.
- **Next**: `seq` 226 is `P6.02` (`UncertainScenarioSpec`: base spec + distribution overlays +
  N + seed), which is what actually attaches these distributions to named `ScenarioSpec` fields
  — deliberately not done here. It should reuse `distributionSpecSchema` as-is; the schema was
  written with no opinion about what its number means for exactly that reason. One thing P6.02
  will need to decide and this run did not: whether an overlay names a field by a dotted path
  string or by a typed accessor, given `ScenarioSpec` is a nested discriminated union. And run
  the two `docs` steps before pushing, until P0.110 makes that unnecessary.

---

## 2026-08-22 (42nd run) — P5.31 done: the square is the forward-difference case, and a loose inner solve converges

- **P5.31 was taken because it is the first `todo` by `seq` (224)**, with nothing `in-progress`
  and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written.
  P0.106 remains the short task for whoever wants one, at `seq` 304; P0.109, filed by the
  previous run, is at 307.
- **VALIDATION MET.** The criterion is "rule implemented (inner tol ≤ outer tol²-style
  heuristic) + test". `packages/analysis/src/tolerance-coupling.ts` (`coupleTolerances`,
  `checkToleranceCoupling`), **16 tests**, and
  `docs/adr/ADR-017-inner-outer-tolerance-coupling.md`.
- **The criterion quotes the square, and the square is the wrong exponent for this package.**
  `finiteDifferenceStep` already derives the optimal step `h* ∝ ε^{1/(p+1)}` for a scheme of
  truncation order `p`; substituting it back into the same error model gives the _achievable_
  relative Jacobian accuracy `η ≈ ε^{p/(p+1)}`, so the inner tolerance must satisfy
  `ε ≤ η^{(p+1)/p}`. For a **forward** difference that is `η²` — the heuristic in the form it
  is always quoted. For a **central** difference, which is `JacobianOptions.scheme`'s default
  and what every solve in this repo actually uses, it is `η^{3/2}`: **31.6× looser** at
  `η = 1e-3`, and `η^{-1/2}` looser in general. Hard-coding the square would over-tighten the
  inner solve by an order and a half of magnitude, which against `inverse-solve-perf.json`'s
  9.66 ms p50 is real time. The scheme is an input; the exponent follows from it.
- **The rule has two clauses and neither dominates.** Clause 1, the noise floor:
  `rtol ≤ 0.1·τ/L`, linear in the outer tolerance and dependent on the trajectory scale `L`.
  Clause 2 is the Jacobian one above, which does not involve `τ` at all. On the ADR's own
  295.32 m shot the crossover sits near **τ = 0.09 m** — a centimetre target is noise-limited,
  a half-metre target is Jacobian-limited — so both bindings are exhibited on one problem and
  `ToleranceCoupling.binding` reports which decided.
- **THE FINDING, and it is not the failure the task title implies.** A loose inner solve does
  **not** make the outer one thrash, stall or fail to converge. Measured on a drag-and-wind
  shot at `rtol = 1e-3` against a `1e-6` m outer tolerance: `newtonShooting` returns
  **`converged` in 3 iterations** with a reported residual of **2.148e-07 m**, at an aim that
  actually misses by **4.392e-02 m** — a discrepancy of **2.0e5**, with no diagnostic anywhere
  in the report, history or iteration count. The residual is a _smooth deterministic_ function
  of the aim at any fixed `rtol`, so the solver finds an **exact root of the wrong function**
  rather than an approximate root of the right one, and an exact root looks exactly like
  success. Same shape as P0.97 and ADR-016: a wrong answer with `ok: true`.
- **The clause-1 error model is measured, not assumed.** Across `rtol` from `1e-3` to `1e-8` —
  six decades — the true miss stays between **1.6e-2 and 1.5e-1 times `rtol · L`**, never above
  it and never near zero. The upper end is what justifies the bound; the lower end is what
  stops the test from being vacuous, since a true miss of zero would satisfy the bound and mean
  the inner tolerance never mattered. And the rule's own recommendation was run: at
  τ = 1e-6, 1e-4, 1e-2 and 0.5 m the returned aim lands inside tolerance every time, with one
  to three orders of headroom, under both bindings.
- **The rule audits rather than enforces, and `newtonShooting` is unchanged.** Three reasons,
  all in the ADR: a library that threw could not be used to _measure_ the inconsistency, which
  is what this task's own test does; deliberately loose solves are legitimate
  (`basin-of-attraction`, `multi-start`, the perf harness); and `ShootingProblem` does not carry
  `L`, which is a property of the target and has no defensible default — a 30 m lob and a 3 km
  shot differ by two orders of magnitude in what the same `rtol` buys.
- **A third failure the rule catches is not a tolerance at all.** `JacobianOptions.noiseFloor`
  and `SolverConfig.rtol` are independent numbers that must agree, and nothing else in the
  codebase relates them. `DEFAULT_NOISE_FLOOR` is `Number.EPSILON`, so a caller who integrates
  at `1e-6` and does not set it gets a difference step derived for a residual ten orders
  cleaner than the one it is differencing — the noise branch of `shooting-jacobian.ts`'s own
  V-curve, reached while every tolerance in sight looks conservative.
- **Verified in both directions.** Five faults were injected in turn and reverted: the Jacobian
  clause made linear instead of `^(p+1)/p` (4 tests fail), the stale-`noiseFloor` check removed
  (1), the trajectory scale stripped out of clause 1 (1 — and it is the _measurement_ test that
  catches it, not an arithmetic one), the binding tie-break inverted (4), and the test itself
  made to re-fly the converged aim at the loose `rtol` instead of the reference (2, including
  the headline finding). Each failed exactly the assertions it should; the suite was restored
  green after every probe.
- **One repo guard caught a real omission during the run**, which is worth recording because it
  worked: `analysis-docs.test.ts` fails if a module the package re-exports has no row in
  `docs/analysis/README.md`. Adding the export without the row turned it red immediately.
- **Gate green**: `pnpm typecheck` clean, `pnpm lint` clean, `pnpm lint:deps` **no violations
  across 1453 modules / 4150 dependencies**, `pnpm test` **2464 passed across 251 files** (2448
  across 250 before this run — exactly the 16 tests and 1 file added), `pnpm build` **✓ in
  26.30s**.
- **Next**: `seq` 225 opens Phase 6 (`P6.01`, the distribution schema for Monte Carlo). ADR-017
  records one follow-up it deliberately did not take — putting the coupling audit's verdict on
  the four outer solvers' result objects, so a `converged` status with an inconsistent
  configuration would say so. That is a breaking change to four public result types and wants
  its own task; it is **not** filed yet, because Phase 6 is the ordered work and filing it as a
  `P0.1xx` would jump the queue for something that is an enhancement rather than a bug.

## 2026-08-22 (41st run) — P5.30 done: the budget met with 5x headroom, and a p99 that is not a tail

- **P5.30 was taken because it is the first `todo` by `seq` (223)**, with nothing `in-progress`
  and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written.
  P0.106 remains the short task for whoever wants one, at `seq` 304.
- **VALIDATION MET.** The criterion is "benchmark artifact meets budget" and the budget is
  `p50 < 50 ms, p99 < 300 ms on library targets`. Recorded:
  **p50 9.66 ms** and **p99 147.48 ms** over **800 samples** — 20 `SCENARIO_LIBRARY` targets ×
  40 passes, 3 warm-up passes discarded — with every target converging in **≤ 5 Newton
  iterations**. Artifact at `packages/validation/src/inverse-solve-perf.json`, checked by
  `packages/validation/src/inverse-solve-perf.test.ts` in **19 tests**.
- **Three things the criterion does not decide were decided in the open, because each moves the
  number.** The timed region is `smartInitialAim` + `newtonShooting` and **excludes problem
  construction**, which is paid per scenario load, not per solve. The targets are read the way
  P5.07 reads them — each entry's target is the impact of _its own_ launch aim, so every one is
  reachable by construction and the measurement is of the solve rather than of an impossible
  ask. And the tolerance is **rtol 1e-12, not the library's own 1e-6**: the finite-difference
  Jacobian is not correct at 1e-6, and a budget met at the tight tolerance is met at every
  looser one. The recorded cost is a **ceiling** on what the app pays, not an estimate of it.
- **"Artifact meets budget" is one assertion against a stored file, and a file of twenty zeros
  satisfies it.** So it was read as **four** claims, and the first three are what make the
  fourth mean anything: the artifact's target ids are asserted **against the `SCENARIO_LIBRARY`
  export** (a renamed scenario lands red, not silently uncovered); the percentiles must be
  ordered, the pooled max must equal some target's max, and `samples == targets × repeats`, so
  an edited number contradicts the rows printed beside it; **the solve is run live in the suite
  and must converge on every target**, because a solver that returned instantly without
  converging would _improve_ every number in the file; and only then, the budget.
- **The live timing check is held to 4× the budget, deliberately.** This repo's own perf policy
  — `scripts/check-benchmark-regression.mjs`, "a flaky regression here should never block a
  push to main" — rules out a hard absolute-ms assertion on an unknown runner. 4× survives a
  runner several times slower than this one and does not survive an order-of-magnitude
  regression, which is the failure worth catching. The **exact** budget check is against the
  artifact, whose `machine` block names what produced the numbers.
- **Verified in both directions, not just the passing one.** An edited `p99`, a deleted target
  row, a renamed target, a status flipped off `converged`, a `p50` pushed over budget, a pooled
  max detached from the rows, and a live solve made to stop converging were each injected in
  turn; **each failed with the intended message**, and the suite was restored green after every
  probe. Without that, 19 passing tests would say only that 19 assertions ran.
- **One claim of this run's own was wrong, and the artifact is what caught it.** The harness
  docstring's first draft said a cold first solve costs "several times" its warm one. It does
  not. The cold penalty scales **inversely with how long the solve runs**: `drag-free-reference`
  warms in 0.04 ms and pays **16×**, while `density-altitude-2000m` warms in 89 ms and pays
  **1.01×** — a solve long enough to tier V8 up inside a single call has already paid for its
  own warm-up by the time it returns. Pooled, cold p50 is **1.36×** warm and cold max lands
  **below** warm max. The docstring now says what was measured, and the cold pass is asserted
  against the p99 budget as a first-shot latency in its own right.
- **The finding, and it is about how to read the number rather than about a defect.** Three of
  the twenty targets — **frozen-ou-gust 143.25 ms, dust-grain 105.09 ms,
  density-altitude-2000m 89.14 ms** — cost 10-100× the 9.66 ms median, a **3600× spread** from
  the cheapest target to the dearest. They are 3 of 20, so **15% of pooled samples are theirs
  and everything above pooled p95 is one of them**: the recorded p99 is frozen-ou-gust's _own
  median_, not a rare slow event. **p99 over this pool is a target-mix statistic, not a
  latency tail** — it moves if the library gains or loses a slow scenario. Iteration counts
  rule out the obvious cause: all three converge in 3-5 iterations like everything else, so it
  is per-iteration integration work. Filed as **P0.109** (`seq` 307) with "record `nSteps`
  first" as the opening move. `P0.107` and `P0.108` were already taken; the id was checked
  rather than assumed.
- **Gate green**: `pnpm typecheck` clean, `pnpm lint` clean, `pnpm lint:deps` **no violations
  across 1447 modules / 4127 dependencies**, `pnpm test` **2448 passed across 250 files** (2429
  across 249 before this run's additions — exactly the 19 tests and 1 file added), `pnpm build`
  **✓ in 21.06s**.
- **CI run 238 at `7c9b417` is green** — all 35 steps, `Test` **2m10s**, whole job **4m01s**,
  which is the ordinary shape for this repo.
- **A follow-up commit moves the live measurement out of vitest's collect phase**, and the
  reason it was written is worth recording alongside the reason it was kept, because they are
  not the same. Code in a `describe` body runs during **collect**, which neither `testTimeout`
  nor `hookTimeout` governs — so the first version of the file put ~120 integrations into
  collection with nothing bounding them, and a solve that hung would have hung the run instead
  of failing it. Given P0.106 is a standing filing about exactly this suite's build-heavy files
  and their timeouts, that is the wrong thing to add to it. It is now in `beforeAll` with a
  120 s ceiling and does half the work (1 warm-up + 2 timed passes, against the recording
  path's unchanged 3 + 40). Measured: this file's collect **4.00 s → 0.70 s**, its total
  **4.28 s → 2.73 s**; suite still 2448 across 250 files, and the live non-convergence probe
  re-run against the restructured file still fails the intended test.
- **The correction: this run started that change believing CI was stalled, and it was not.**
  Polling `list_workflow_jobs` returned `in_progress` for the `Test` step long after the job
  had finished, and the run read ~24 minutes of that stale status as a hang on its own push.
  **Run 238 had completed `success` at 14:47:34, four minutes after it started.** The stale
  read is the mistake; it is recorded rather than quietly dropped, because "my push hung CI"
  and "I was reading a cached status" call for very different responses and this run acted on
  the first for several minutes. **For future runs: do not conclude a job is hung from repeated
  `in_progress` responses on this endpoint — check `completed_at` on the run, or re-read after
  a longer gap.** The restructure was kept because the collect-phase argument stands on its own
  and the numbers above are real; the comment in the file cites that argument and **not** the
  stall, since the stall did not happen.
- **No UI, and no drive-by.** Lazy-loading Plotly — still **4.84 MB** in this run's build
  output, unchanged from the 40th run — remains a backlog item to be claimed, not smuggled into
  a perf task that happens to have "perf" in its name.

## 2026-08-22 (40th run) — P5.29 done: a decision table whose claims are checked against the code, and four statuses that did not exist

- **P5.29 was taken because it is the first `todo` by `seq` (222)**, with nothing `in-progress`
  and nothing in `review` ahead of it — `ROADMAP.json`'s `taskSelection` applied as written.
  P0.106 remains the short task for whoever wants one, at `seq` 304.
- **VALIDATION MET.** The criterion is "docs build; decision table present", and
  `packages/validation/src/analysis-docs.test.ts` meets it in **47 tests** against
  `docs/analysis/README.md` (the API map) and `docs/analysis/method-selection.md` (the decision
  table, **15 rows**). It was read as **two** claims, because both halves are documentary as
  literally stated: "docs build" is true of any two files that exist, and "decision table
  present" would be satisfied by three invented rows naming functions that do not exist.
- **The finding, and it arrived inside this task rather than from auditing someone else's.** The
  table's "How it fails" column quotes each solver's status literals. The first draft named
  **`singular-jacobian`**, **`trust-region-collapsed`**, **`collapsed`** and
  **`no-interior-optimum`** — and **not one of the four is declared anywhere in the package**.
  The real unions are `stalled` / `line-search-failed` / `evaluation-failed` / `max-iterations`
  for `newtonShooting`, `damping-exhausted` for `levenbergMarquardt`, `max-evaluations` for
  `nelderMead`, and `at-bound` / `no-impact` for `maximizeRange`. They were plausible, which is
  the problem: a table that reads as authoritative and quotes statuses that do not exist sends a
  reader to write a `switch` arm that never fires. The check was written first and caught all
  four before the page shipped.
- **The coverage check is what stops the table rotting**, and it is guarded against becoming
  vacuous. Fifteen solver entry points in `packages/analysis/src` must each have a row; the
  coverage list is _itself_ asserted against the real exports, so renaming a solver fails the
  suite rather than leaving the check quietly asserting nothing. A new solver added without a row
  lands red instead of undocumented.
- **Verified in both directions, not just the passing one.** A fake symbol, an invented status, a
  deleted row, a broken relative link and an undocumented module were each injected in turn; each
  failed with the intended message, and the suite was restored green after every probe. Without
  that, 47 passing tests would say only that 47 assertions ran.
- **Gate green**: `pnpm typecheck` clean, `pnpm lint` clean, `pnpm lint:deps` **no violations
  across 1441 modules / 4106 dependencies**, `pnpm test` **2429 passed across 249 files** (2382
  across 248 before this run's additions), `pnpm build` **✓ in 28.96s**.
- **One thing not claimed as clean.** The _first_ full-suite run after adding the test reported
  **`1 failed | 248 passed`** and **the failing file was not captured** — this run read the tail
  before the failure block, which is its own mistake and is recorded rather than glossed. It did
  **not** reproduce: three subsequent full runs were 2429/2429, and `canvas-viewport.test.ts`
  passed standalone twice. In the captured run that file took **37.6 s**, the same margin story
  P4.38 measured at 48.6 s against a 60 s hook timeout. Logged as a **sighting on P0.106**, not a
  new filing and not a proof — the file was never identified, and saying otherwise would be
  inventing a result.
- **No UI, deliberately.** This task is documentation. Lazy-loading Plotly — still **4.84 MB**
  in this run's build output — remains a backlog item to be claimed, not smuggled in here.

## 2026-08-19 (39th run) — P5.28 done: five inverse problems, and an answer key that can be recomputed rather than trusted

- **P5.28 was taken because it is the first open task by `seq` (221)**, with nothing `in-progress`
  and nothing in `review` ahead of it. That is `ROADMAP.json`'s `taskSelection` applied as written;
  P0.106 remains the short task for whoever wants one, at `seq` 304.
- **VALIDATION MET.** The criterion is "checker validates against stored solutions", and
  `packages/runtime/src/inverse-exercises.test.ts` meets it in **42 tests**. But the criterion was
  read as **three** claims, because the literal one is nearly vacuous on its own:
  `checkAnswer(ex, ex.answer.solution)` compares a number with itself and **would pass against a
  key of five zeros**. So: (1) it accepts the stored solutions; (2) it **rejects** — the tolerance
  is probed either side, exactly at the boundary, on non-finite input, and against the specific
  wrong answer each exercise exists to catch; and (3) the stored key is **right**, not merely
  stored.
- **Claim 3 is the one that carries the weight, and four of the five keys are anchored to
  references this codebase did not produce.** Low arc **18.90031076438649°** against the closed
  form `½·asin(gR/v₀²)`, agreeing to **13 significant figures**; high arc **71.09968923561345°** as
  its complement to 90°; their midpoint at exactly **45°**, the drag-free peak; minimum launch
  speed **54.24016039799292 m/s**, which is `√(g·300)` to every digit shown. Each exercise also
  carries a `recompute()` that re-derives its key from `@ballista/analysis`, asserted to agree
  within **1e-9** — which doubles as a drift guard: if a solver moves, `recompute()` moves and the
  key does not, and the file goes red instead of the exercise quietly teaching a stale number.
- **The rejection tests are the ones that would catch a useless checker.** A grader returning
  `correct: true` unconditionally passes claim 1 perfectly. So: the two arcs must not accept each
  other (same target, same launch energy); the drag optimum must not accept the **45° folklore**;
  and the envelope exercise must not accept the **drag-free parabola of safety**, which puts the
  ceiling at 70.5 m where the real one is 28.277 m.
- **The projectile was chosen by measurement, not assumed.** Exercises 3 and 5 exist to show how
  far drag moves an answer, so the ball matters. Measured both: a **regulation baseball** (145 g,
  36.6 mm) at 40 m/s puts the maximum-range elevation **4.94° below 45°**, while a 1 kg 5 cm sphere
  in the same air moves it only **1.86°** — enough to make the lesson look like rounding. The
  baseball is used and the dense sphere is recorded here as rejected.
- **One finding, and the test was right.** The module documents its tolerance as _inclusive at the
  boundary_, and it was not delivering that. `solution + tolerance` is a rounded double whose
  distance back from `solution` is **not** `tolerance` — for exercise 1 it lands **7.1e-16 too
  large** — so a naive `error <= tolerance` graded the exact stated boundary **wrong**. The test
  encoded the correct belief, so **the checker was fixed and the test was not relaxed**: it allows
  4 ulps of the operands back, which is the representation error and nothing more. A further test
  pins that the slack stays at ulp scale by rejecting an answer outside by one part in a billion.
- **Five different inverse problems, not one five times** — low root, high root, maximization
  (`maximizeRange`), nested minimization (`minimumSpeedToHit`), reachability
  (`assessReachability`) — and a test asserts the five `method` strings are distinct so the set
  cannot silently collapse into one crank turned five times.
- **No UI, deliberately, and filed rather than smuggled in.** The blueprint's L5 table (line 123)
  assigns "exercise content" to `@ballista/app`, but every exercise already in the repo splits it:
  P4.20's `computeNeglectedEffects` and P4.29's `computeDensityAltitudeComparison` live in
  `@ballista/runtime` and `app` holds only the route. This followed that precedent, so the content
  and checker are exported from `@ballista/runtime` and nothing renders them yet. The route is
  **P0.108** — phase 0 not phase 5 because `roadmap-ids.test.ts` requires every task at `seq >= 288`
  to sit in phase 0, which it rejected this filing for on the first attempt. The test is right and
  was left alone.
- **Gate, all run locally at `43f641f`:** `pnpm typecheck` clean, `pnpm lint` clean, `pnpm lint:deps`
  clean (1438 modules, 4098 dependencies), `pnpm format:check` clean, `pnpm test` **248 files /
  2382 tests green** (up 42 from the 38th run's 2340), `pnpm build` clean in 23.3s. **P0.106 did not
  reproduce** in either full-suite run this session — both completed with no timeout, at 104.3s and
  105.7s — which is one more data point for its "close to the limit, not over it" reading and not
  evidence it is fixed.
- **Next run:** P5.29 (`seq` 222, analysis API docs + the Newton/NM/LM decision table) is the first
  open task and is a natural continuation — the five `method` strings this run wrote are the
  decision table's rows in miniature. P0.108 renders what this run built. P0.106 remains the short
  one.

---

## 2026-08-19 (38th run) — P5.27 done: multi-start finds both arcs with no peak and no bracket, once the right problem is being multi-started

- **P5.27 was taken because it is the first open task by `seq` (220)**, immediately after the
  previous run's P5.26, and it needed no design question settled by a human. `ROADMAP.json`'s
  `taskSelection` is the rule; the previous run's handoff again named P0.106, which sits at
  `seq` 304 and is still the right pick for whoever wants a short task.
- **VALIDATION MET.** The criterion is "finds both arcs without user hint". 16 starts spread over
  `θ ∈ [0.05, 1.5]` at a fixed 55 m/s, against a 140 m target, collapse onto exactly **two**
  solutions — `θ = 0.303042401650` (low, `∂R/∂θ = +322.1`, 7 starts) and `1.185648587950` (high,
  `−282.3`, 8 starts) — agreeing with `solveArcs` to **6 decimal places**. `solveArcs` found the
  same two the _other_ way, by locating the maximum-range elevation with a 24-sample sweep and
  bracketing one root either side of it. That peak is the hint; this has none of it.
- **The substantive half was deciding which problem to multi-start ON, and it was settled by
  measurement before a line was written.** Deduplication presupposes _isolated_ solutions, and the
  obvious reading of this task does not have any. A multi-start over `(θ, v₀)` is searching a
  problem whose solution set is a **curve** — P5.05's zero vertical Jacobian row makes `F` one
  scalar equation in two unknowns, and P5.06's minimum-norm step lands on whichever point of that
  curve is nearest the start. Measured: **21 starts, 21 distinct converged aims**, every one a
  genuine hit under `3e-10` m, speeds spanning over 20 m/s. Any deduplication rule that respects
  those answers returns 21, and it is _right_ to — "low" and "high" are not defined on a curve.
  That run is kept in the test file as a negative control rather than described in a comment.
- **Fixing the speed is what makes the two arcs exist**, which is how P5.08 states the problem in
  the first place. So the starts vary elevation only and the local solve is P5.16's
  `constrainedShooting` under a **degenerate speed box `[v₀, v₀]`** — `validateAimBounds` permits
  `min == max` and rejects only `min > max`. Labels come from the **sign of `∂R/∂θ` at each
  solution** (P5.20's `rangeSlopeAt`), not from ordering the pair, because ordering breaks the
  moment a bound clips one arc away — which the test checks by clipping one away.
- **15 of 16 starts are accepted, not 16, and the one lost is the finding.** It lands at
  `θ = 0.7346`, **3.3 mrad** from the measured peak at `0.7313`, where `∂R/∂θ` passes through
  zero; the projected step is near zero there too, so the iteration stops on its step tolerance
  after **one** iteration with 66 m of miss outstanding. That is P5.20's basin boundary, sampled.
  The peak belongs to neither arc and rejecting it is correct. The test asserts _exactly_ that one
  start is lost and no other.
- **Three of the first-draft assertions were wrong, and each was corrected against measurement
  rather than loosened.** (1) The accepted count, above. (2) Cluster spread is `6.1e-9` rad, set by
  where the projected solve stops rather than by the residual tolerance — so the `1e-6` merge
  tolerance has **two** orders of room below it, not the five first claimed, and both the
  assertion and the docstring now say two. (3) The golden-ratio start sequence **does not** beat a
  uniform grid on largest gap at a fixed count — `0.0902` against `0.0625` at `n = 16` — and that
  was the reason the docstring originally gave for choosing it. The real reasons are the
  three-distance theorem (exactly three gap lengths, measured) and prefix extension (the first `n`
  of `n + k` points are the first `n`, so raising `startCount` keeps every solve already paid for).
  The false claim is now pinned **as false** in the test file so it cannot quietly return.
- **Gate, all clean:** `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm format:check`,
  `pnpm test` **2340/2340 across 247 files** (up from 2319/246), `pnpm build` in 21.9 s.
- **Branch hygiene, and a limit worth recording against P0.107.** This run worked on
  `claude/upbeat-ride-6bupp2`, fast-forwarded `main` onto it and pushed `main`, per `CLAUDE.md`'s
  commit-to-main policy. Deleting the branch afterwards — which the same policy asks for —
  **failed**: both `git push origin --delete` and `git push origin :branch` die with
  `send-pack: unexpected disconnect while reading sideband packet`, while an ordinary push over
  the identical remote and credentials succeeds. So a delete-ref push does not get through this
  environment, and the GitHub App exposed here has no delete-branch call either. The local branch
  is deleted and the remote one is left at `2469a3f`, identical to `main` and fully merged. **That
  is a mechanism for P0.107's 84 stale branches, not just a count**: a run cannot clean up after
  itself from here even when it tries, so the pile grows by one per run regardless of intent.
  Whoever acts on P0.107 should do it with a tool that can delete refs, not from a session like
  this one.
- **Environment note for the next run, because it costs a confusing ten minutes otherwise.**
  `pnpm test` on a fresh clone fails 4 tests in 2 files —
  `cross-engine-drift-record.test.ts` and its neighbour — with `ERR_MODULE_NOT_FOUND` on
  `packages/engine/dist/index.js`. Nothing is broken: those tests spawn a script that imports the
  _built_ output, and `dist/` is produced by `pnpm typecheck` (`tsc -b`), which CI happens to run
  first. **Run `pnpm typecheck` before `pnpm test`**, or use `pnpm verify`, which orders them
  correctly. This is not filed as a bug: CI's ordering is correct and the suite is green there.

---

## 2026-08-18 (37th run) — P5.26 done: the Levenberg–Marquardt fallback, converging at 1 cm inside the envelope where pure Newton crawls to a stop

- **P5.26 was taken because it is the first open task by `seq` (219), and its shape was fixed
  before it was claimed.** `newton-shooting.ts` names it in its own doc comment — "Levenberg–Marquardt
  — regularizing rather than truncating — is P5.26 and deliberately not this task" — so there was no
  design question to settle, only a construction to get right. Note this again diverges from the
  previous run's handoff, which named P0.106; `seq` order is `ROADMAP.json`'s stated selection rule
  and P0.106 sits at `seq` 304, 85 later. It stays the right pick for whoever wants a short task.
- **VALIDATION MET.** The criterion is "converges on case where pure Newton fails (constructed
  near-envelope)". From `(0.7 rad, 50 m/s)` at a 60 m/s speed cap, against a point target **1 cm**
  inside the **232.615806763 m** envelope that cap allows: pure `newtonShooting` reaches
  `max-iterations` at **‖F‖ = 3.6e-3** after 40 iterations, and `levenbergMarquardt` **converges
  below 1e-6 in 14 iterations** on the same tolerance and the same budget.
- **The construction is the substantive half, because a case where Newton fails is easy to produce
  by accident and proves nothing about why.** An **unconstrained** aim problem **has no fold at
  all**: the solution set of a ground-impact shot is a _curve_ in `(θ, v₀)`, and a target past the
  envelope at one speed is simply reached at a higher one. The degeneracy the blueprint pairs LM
  with — _"the envelope is a fold: the two solution arcs merge and det J → 0"_ — therefore only
  exists once the launch speed is **bounded**, which is what a real machine is. So the case is a
  quadratic-drag shot with the speed capped through P5.16's projection, and the cap is not set
  dressing: it is the thing that creates the fold.
- **Newton's failure is a crawl, not a divergence, and the test asserts both halves.** It gets three
  orders of magnitude closer than it started and stops two orders short of tolerance with the cap
  active. Asserting only "did not converge" would pass just as well against a solver that blew up,
  and would not be evidence about the fold.
- **Mechanism, measured rather than argued.** On the rank-1 Jacobian every ground-impact shot
  carries, with surviving scaled row `(a, b)`, the minimum-norm step is _parallel to_ `(a, b)`: the
  correction is allocated in proportion to sensitivity, so it goes almost entirely into speed —
  which the cap then clips away. The tests measure each link: `b/a > 3` at the start aim, the
  vertical row zero to `<1e-8`, `∂R/∂θ` at the peak more than **100×** smaller than at `θ = 0.5`,
  and the two arcs closed to under **2.3°** at that shortfall. Marquardt's `diag(JᵀJ)` damping (not
  Levenberg's `I`) is invariant to column scaling and collapses on a rank-1 system to a step along
  **`(b, a)`** — the reciprocal direction, giving the largest correction to the variable the
  residual is least sensitive to, which near the envelope is `θ`. That is the whole fix.
- **Two smaller choices worth naming.** `λ` moves by Nielsen's gain-ratio rule rather than the
  older multiply-by-10 schedule, which is discontinuous in `ρ` and oscillates exactly where the
  truth is in between — approaching a fold, that is most iterates. And the gain ratio is stated in
  `‖F‖²`, since that is the quantity the least-squares model predicts; `newtonShooting`'s Armijo
  test is stated in `‖F‖` and the two are **deliberately not shared**.
- **LM is a fallback, not a replacement, and that is asserted, not conceded in prose.** Where both
  solvers work Newton takes **3–4** iterations and LM **14**, because an undamped Gauss–Newton step
  near a solution is quadratically convergent and a damped one is not. That measurement is what
  fixes `shootingWithFallback`'s order: Newton first, LM only on non-convergence, warm started from
  Newton's best aim.
- **An honest limit, recorded rather than papered over.** Neither solver reaches the target from a
  start on the far side of the peak. That is a **basin** problem and belongs to P5.27, not here.
  Warm starting does not rescue it; what it buys there is measured instead — `‖F‖` **8.6e-6**
  chained against **3.8e-1** cold, four to five orders, with both still reporting `max-iterations`.
  The test asserts that comparison, because asserting convergence would have been false.
- **Gate green before push**: `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `prettier --check .`
  all clean; `pnpm test` **2319 tests across 246 files** in **133.3 s**, measured after the last
  two assertions were added (2317 before them). No golden trajectories moved — nothing here changes an
  existing numeric path, it adds a solver beside one.
- **Filed P0.107 while confirming this run left no branch behind: 84 `claude/*` refs on the remote, 79 of them not ancestors of `main`.** CLAUDE.md says not to leave them, and no run has recorded that they are there. **This is not a claim that work was lost, and the filing says so** — four of the largest were spot-checked and all end at tasks that are `done` on `main` (`nice-keller-vp78r0` at P0.97, `keen-bohr-fkdyhu` and `upbeat-ride-uhifsa` at P5.16, `clever-pasteur-gox9dy` at P4.13), and `git diff origin/main origin/claude/nice-keller-vp78r0` is 5594 deletions, i.e. `main` far ahead rather than the branch holding something. Filed rather than done because deleting 79 remote branches is irreversible and four spot checks are not 79. This run created no branch of its own; it committed to `main`, as CLAUDE.md prescribes.
- **Next: P5.27**, multi-start with deduplication, now the first open task by `seq` (220) and the
  task the limit above hands work to directly. P5.29's method-selection decision table also has its
  numbers now: Newton comfortably inside the envelope, LM near it, multi-start when the initial aim
  may be on the wrong side of the peak. P0.105 and P0.106 remain open at `seq` 303/304.

---

## 2026-08-18 (36th run) — P5.24 done: the adjoint range gradient, agreeing with the tangent-linear one to 4e-13, and the note that says why it is the continuous adjoint

- **P5.24 was taken because it is the first open task by `seq`, and the two runs that skipped it
  skipped it on the strength of one word.** Its title ends "(optional, documents scaling to many
  params)", and both the 34th and 35th runs read that as permission to move past it. Blueprint §9.2
  says what the option is: the prototype "documents the many-parameter scaling story … **without
  committing the platform to full adjoint infrastructure**". The _infrastructure_ is optional; the
  note is the task. A third deferral would have left it wedged at the head of the queue forever.
  Note this diverges from the 35th run's own handoff, which said to take P0.106 next — `seq` order
  is `ROADMAP.json`'s stated selection rule and P5.24 sits 87 `seq` earlier, so the rule won.
  P0.106 is still the right next pick and is named again below.
- **VALIDATION MET BY FOUR ORDERS.** The criterion is "adjoint gradient matches tangent-linear to
  1e-8 on 3-param case". On `(θ, v₀, C_d)` with drag at `rtol = 1e-12`, the worst **relative**
  disagreement against `createTangentLinearFlight`/`rangeSensitivity` is **4.265e-13** on the flat
  shot — adjoint `24.1873987362973 / 5.12531951694258 / −53.4687545700258` against tangent
  `24.1873987363076 / 5.12531951694283 / −53.4687545700752` — and **1.808e-12** from a 12 m launch
  point where no closed form applies. It holds across a sweep of six elevations from 0.25 to 1.1 rad.
- **The identity, which is the whole content.** Fold the event-time correction into a terminal
  covector `λ(T) = e_R − (e_R·f / ∇g·f)∇g` and run `λ' = −Aᵀλ` backwards; then
  `d/dt(λᵀS_k) = λᵀb_k`, so `dR/dμ_k = λ(0)ᵀS_k(0) + ∫₀ᵀ λᵀb_k dt` **with `S_k` never formed**.
  Those two terms are exactly `TangentParameter`'s two ways into the problem, and the tests assert
  the split rather than describing it: a launch-state parameter's quadrature is `toEqual([0, 0])`
  — not small, never accumulated — and a dynamics parameter's gradient is `toBe` its quadrature.
- **It is the CONTINUOUS adjoint and the module says so in its first paragraph.** The task title
  says "discrete-adjoint"; this differentiates the ODE and _then_ discretises. A true discrete
  adjoint transposes the Runge–Kutta scheme and needs stage values, a transposed tableau and
  checkpointing — which is precisely the "full adjoint infrastructure" §9.2 forbids here. **The cost
  of the choice is measured, not waved at**: agreement is set by integration tolerance, which is why
  it is 4e-13 and not 1e-15, and why loosening `rtol` would move it where a discrete adjoint's
  number would not. `docs/notes/adjoint-sensitivity.md` §5 carries the comparison table.
- **The one shortcut is instrumented rather than hidden.** `A(t)` is needed along the base
  trajectory, and this replays it by integrating `ẏ = f` _backwards_ from impact instead of
  checkpointing. Reversing a dissipative system is anti-dissipative and it does drift, so the result
  reports `stateRoundTripError`: measured **1.105e-11** flat and **8.413e-12** raised. The field
  exists so that a longer or stiffer problem fails visibly instead of returning a quietly wrong
  gradient.
- **The scaling claim is checked including the row where it loses.** `forwardDimension` `n(1+m)` and
  `backwardDimension` `2n+m` are both reported and asserted at `m = 1, 3, 30`: **8 vs 9, 16 vs 11,
  124 vs 38**. The `m = 1` row, where the forward method is the smaller one, is asserted too —
  leaving it out would make the exhibit an advertisement. Measured solver cost on the flat
  3-parameter case: forward base **83 steps / 541 RHS**, backward **117 / 801**. The note also
  records where this direction does _not_ pay: Phase 5's shooting solves want a 2×2 Jacobian, which
  is the shape adjoints lose on (one backward solve per output row); Phase 6's §9.4 sensitivity work
  is the shape they win.
- **Mutation-checked with four perturbations, all applied, run and reverted.** Dropping the `Aᵀ`
  transpose (using `A`) turns **8** tests red; seeding `λ(T) = e_R`, i.e. no event-time correction,
  turns **6** red — including the 45° drag-free case where the true `∂R/∂θ` is zero and the
  uncorrected answer is the −163 m/rad `tangent-linear.ts` already records; forgetting the sign flip
  on `dy/ds` turns **6** red; contracting the quadrature against `y` instead of `λ` turns **3** red.
  The third and fourth are the ones a reviewer would not have caught by reading.
- **Two references, because two implementations agreeing is not the same as two being right.** The
  criterion names the tangent-linear module, and that comparison is genuinely of two formulations —
  `n(1+m)` forward against `2n+m` backward with a transposed Jacobian. But both apply the _same_
  event-time correction, so a shared misunderstanding of it would agree perfectly. The drag-free
  cases are therefore checked against `R = v₀²sin2θ/g` and its derivatives, which neither module
  evaluates anywhere.
- **Full gate green** (Node **22.22.2**, pnpm **11.9.0**): `typecheck` clean · `lint` clean ·
  `format:check` clean · `lint:deps` **no violations, 1420 modules / 4023 dependencies** ·
  `pnpm test` **2305 passed across 245 files** (2286/244 → +19 cases in one new file) · `pnpm build`
  exit 0 · `check-bundle-size` **71.7 kB gzipped** against the 300 kB budget, **unchanged** from the
  34th and 35th runs, as it must be for a change nothing in the app imports. `bench:solverkit` and
  `check:cross-engine-drift` were **not** run locally. Both full-suite runs of this tree were green
  first time; none of the P0.96/P0.106 flakes appeared in either.
- **`docs/notes/` is new, and `docs/physics/` was deliberately not used.** That directory is
  generated from blueprint §3 and `physics-docs.test.ts` asserts it holds _exactly_ the generated
  set, so a hand-written page there would have turned the suite red. ADR-017 was also not used: it
  is reserved by P5.31.
- **No new findings filed.** Nothing surfaced that was not already an open item, and the run created
  no `claude/*` branch (P0.95's count is untouched at 82 — the 35th run's rule, "do not create the
  branch until there is a commit for it", was followed by not creating one at all).
- **Next run: P0.106**, still the cheapest genuinely unblocked item on the board (20 min, needs no
  decision, and it is what makes every future run's gate trustworthy). After that, by `seq`, P5.26
  (Levenberg–Marquardt fallback) and P5.27 (multi-start with deduplication) — and P5.27 is the one
  that would make the Newton/Nelder–Mead solution-curve disagreement the 35th run measured tractable
  to reason about. **P0.105 needs a human** to choose between three named options before any code.
  P0.95, P0.96, P0.99, P0.101 and P0.103 each still need a human, unchanged. A thing worth knowing
  for Phase 6: P5.24's note and prototype exist precisely so that P6.16–P6.20's sensitivity work
  starts with the adjoint identity, the event-time subtlety and the checkpointing question already
  written down and tested.

## 2026-08-18 (35th run) — P5.25 done: the inverse solvers' answers and iteration counts are pinned, and two of them are checked against closed forms

- **P5.25 was taken as the first open blueprint task by `seq` that is neither optional nor
  human-gated.** P5.24 sits one `seq` earlier and is still marked optional in its own title, and
  all five open P0 correctness items (P0.95, P0.96, P0.99, P0.101, P0.103) are each waiting on a
  decision this session must not make unattended — unchanged from the 34th run, re-read in
  `ROADMAP.json` rather than inherited. A regression pin over existing optimizer code also ranks
  above new functionality in this repo's own order.
- **What it pins, and why the two halves are compared differently.** Nine cases across four solver
  families: `newtonShooting` on point, ring and platform targets with and without drag and a
  headwind, `nelderMead` on the same drag problem, `maximizeRange` with and without drag, and
  `minimumSpeedToHit`. `status`, `converged`, `iterations` and `evaluations` are pinned **exactly**
  — integers off deterministic arithmetic have no tolerance to apply, and a move in one is the
  whole signal, the same way `golden-trajectories.test.ts` pins `nSteps`. Solutions and objectives
  get a per-case tolerance taken from **the solver's own documented resolution**: `optimal-angle.ts`
  says θ at a smooth maximum cannot resolve below ~`1e-4` rad, so that case gets `1e-4` and not a
  number chosen to fit. Those tolerances live in the **store**, not the fixture, so widening one is
  a source change sitting next to its justification.
- **Four assertions never touch the fixture, which is what stops the store being self-referential.**
  A recorded fixture can only prove today equals record day; a wrong answer baked in at record time
  would match its own hash forever. So: drag-free maximum range at **π/4** with `R = v₀²/g`
  (recorded 367.0978366720539 against 60²/9.80665), the drag-induced shift **below** π/4 (0.7239 rad),
  the minimum launch speed **√(gR)** at the tangency aim (38.353585230066834 against
  √(9.80665·150)), and the claim that every case reporting `converged` really is inside
  `newtonShooting`'s 1e-6 m residual test while every case not reporting it is outside.
- **Mutation-checked in two different modules, because one mutation only proves one path.**
  `residualTolerance` 1e-6 → 1e-8 in `newton-shooting.ts` turns 2 entries red; `sweepSamples`
  25 → 21 in `optimal-angle.ts` turns 3 entries **plus an analytic check** red. Both reverted. An
  earlier third attempt — `backtrackFactor` 0.5 → 0.4 — changed **nothing**, and that is also worth
  recording: these cases converge in 3 iterations on full steps, so the line search never
  backtracks and the store does not cover it. It is honest coverage, not total coverage.
- **Newton and Nelder–Mead converge to different aims on the same problem, and that is correct.**
  Measured: (0.549 rad, 46.25 m/s) against (0.655 rad, 44.63 m/s), both with a miss under
  **3e-14 m**. The ground event pins the impact height, leaving one constraint over two unknowns,
  so the aims that hit 150 m form a **curve** — this is P5.05's rank-1 Jacobian seen from the other
  side. The store's `nelder-mead` entry says so at length, specifically so a later session does not
  "fix" the disagreement by changing a solver. It also pins the cost gap: **16** residual
  evaluations against **1602**.
- **P0.105 filed, and pinned rather than fixed.** A raised `PlatformTarget` can never be hit:
  `createShootingResidual` reads the miss at `impactPoint`, and `createFlight` requires a _terminal_
  event, which for `createPlanarProjectileModel` is ground impact — so a target 15 m up leaves the
  vertical miss at `-15` for **every** aim. Measured: `stalled`, `converged: false`, merit
  `14.999999999999991`. **This is not the P0.97/P0.99/P0.101 shape** — `converged` is false and the
  merit is honest, so a caller who checks is not misled; what is wrong is that `targets.ts`
  documents `PlatformTarget` as modelling a landing on top of a platform and this entry point
  cannot do it, while "stalled" names the line search rather than the cause. Kept as the store's
  deliberate non-convergence case; **rewrite that entry when P0.105 lands, do not delete it.**
- **P0.106 filed for the build-heavy test timeouts, which the P4.38 entry left "for a task that
  claims it" and nobody ever filed.** New sighting: `app-shell.responsive.test.ts` failed with
  `Hook timed out in 60000ms` in one full-suite run and **passed standalone in 34.4 s** in the same
  container minutes later — the same margin story P4.38 measured on `canvas-viewport.test.ts`
  (48.6 s against 60 s) and `lazy-plotly-pane.bundle.test.ts` (22.1 s against 30 s). **This run
  first blamed its own change and was wrong**: the addition is ~1.75 s of test CPU against a suite
  total that varied between **224.9 s and 296.3 s across runs of the same tree**, and one run _with_
  the change finished faster than the pre-change baseline and still timed out. Under 1%, inside the
  container's own variance. Unlike P0.96 these are timeouts rather than assertions, so raising them
  weakens nothing and needs no human. The 34th run's P0.96 flake was also seen once here
  (`maxSliceMs` 15.018633 against 10) and was **not** touched.
- **Full gate green** (Node **22.22.2**, pnpm **11.9.0**): `typecheck` clean · `lint` clean ·
  `lint:deps` **no violations, 1414 modules / 3994 dependencies** · `pnpm test` **2286 passed across
  244 files** (2261/243 → +25 cases in one new file) · `pnpm --filter @ballista/app build` exit 0 ·
  `check-bundle-size` **71.7 kB gzipped** against the 300 kB budget, unchanged from the 34th run,
  as it should be for a change that adds nothing the app imports. `bench:solverkit` and
  `check:cross-engine-drift` were **not** run locally. The 2286 figure is from the final run; two
  earlier full runs were red on the load-sensitive tests above and are described there rather than
  averaged away.
- **`update-goldens` now records both fixtures and runs prettier over them.** `JSON.stringify`
  output with short arrays does not satisfy `format:check` — prettier collapses a two-element array
  onto one line and the recorder does not — so the command previously left a tree its own CI would
  reject. Re-recording `golden-trajectories.json` through the new command reproduced it **byte for
  byte**, which is a free determinism check on the older store.
- **P0.95 re-tested, and this run made it slightly worse — recorded rather than glossed.** The
  stale-`claude/*` count is now **82**, up from the 76 the task was filed with, and **one of the new
  ones is this run's**: it created `claude/upbeat-ride-ywti18` through the API as a write-access
  probe _before it had any commit to put there_, then could not delete it. Deletion failed exactly
  as the 18th and 30th runs recorded (`send-pack: unexpected disconnect` / `the remote end hung up
unexpectedly`), and the MCP server still offers `create_branch` with no delete counterpart —
  re-checked here, not assumed. **A detail worth having: the failing delete exits `0` and prints
  `Everything up-to-date`**, so a cleanup script that checks only `$?` will believe it worked. The
  run's commits reached `main` by fast-forward, so the branch holds nothing. The rule that would
  have prevented it: **do not create the branch until there is a commit for it.**
- **Next run:** nothing new became startable, so the shortlist is unchanged apart from the two
  filings. **P0.106 is the cheapest genuinely unblocked item on the board** (20 min, needs no
  decision, and it is what makes every future run's gate trustworthy) — take it. After that P5.26
  (Levenberg–Marquardt fallback) and P5.27 (multi-start) are the next non-optional blueprint tasks
  by `seq`, and P5.27 is the one that would make the Newton/Nelder–Mead curve above tractable to
  reason about. **P0.105 needs a human** to choose between three named options before any code.
  P0.95, P0.96, P0.99, P0.101 and P0.103 each still need a human, unchanged.

## 2026-08-18 (34th run) — P0.100 done: the roadmap's task ids are unique now, and a test says so

- **P0.100 was taken because the 33rd run named it** and it was the only fully-specified open
  item. Everything else open at low `seq` still needs a human: P0.95 (ref-deletion permissions,
  which this environment does not have), P0.96 (a two-option choice), and the correctness bugs
  P0.99 / P0.103 / P0.101, each measured and each waiting on a decision. P5.24 remains first by
  `seq` overall and is still marked optional in its own title. The criterion — every task id in
  `ROADMAP.json` unique, and a test or script asserting it — is met.
- **ID RENAMES, and the mapping matters because past entries in this file still use the old
  names.** Two phase-0 bug filings wore phase-1 ids:

  | seq | old id  | new id       | title                                                            |
  | --- | ------- | ------------ | ---------------------------------------------------------------- |
  | 298 | `P1.00` | **`P0.103`** | ball tunnels through the ground after the last resolvable bounce |
  | 299 | `P1.01` | **`P0.104`** | root `pnpm build` script broken under pnpm 11                    |

  `P1.01` was the actual collision — it also names the real phase-1 blueprint task at seq 12,
  "Define `ChannelMeta`, `Params`, `Schema` types". `P1.00` was free only by luck. The
  blueprint-derived phase-1 ids at seq 12 and 13 were **not** touched, per the filing. Earlier
  entries in this file are not rewritten (this file's own rule), so a reader who finds `P1.00` or
  `P1.01` in a phase-0 context below should read this table.

- **The new ids sit at a lower `seq` than `P0.100` and `P0.101`, on purpose.** Renumbering 300 and
  301 into `seq` order would have been tidier to look at and would have invalidated every
  reference to them in this file and in the roadmap's own notes — including the id of the task
  doing the renaming. Ids are labels, not an ordering, and 103/104 were simply the next free
  minors after the existing `P0.102`.
- **The guard is `packages/validation/src/roadmap-ids.test.ts`, 8 tests, and it was verified red
  before it was verified green.** Restoring the pre-fix ids fails three of them independently:
  duplicate id, phase disagreement, and a reused minor within phase 0. That check was run and
  reverted, not asserted from reading the code. **Phase agreement is the assertion that matters** —
  the `<phase>` component of `P<phase>.<n>` must equal the task's own `phase` field. Both strays
  declared `"phase": 0` while wearing a phase-1 id, so phase agreement would have failed the
  moment either was **filed**; plain uniqueness only failed later, once the second one happened to
  land on a blueprint task. As it was, the collision was found by hand, twice, while someone was
  doing something else. The blueprint/filing split is asserted two-sided as well: blueprint tasks
  (seq 0..287) keep minors below 90, and everything appended after sits in phase 0 — so if a
  blueprint phase ever grows into the reserved range it fails **before** the next filing collides.
- **The convention is now written down rather than inferred**, as `policy.taskIds` in
  `ROADMAP.json`, and one of the tests asserts it is still there. A guard that encodes a rule
  nobody wrote down is a trap: it fails, and the fix is not discoverable from the failure.
- **`seq` is 0-based, which is worth knowing before writing anything that partitions on it.** The
  blueprint is 288 tasks at seq **0..287**, and filings start at seq **288** (`P0.90`). This run's
  first attempt used `seq <= 288` and failed on `P0.90`; the 28th run's note already said
  `seq >= 288` and was right.
- **Full gate green** (Node **22.22.2**, pnpm **11.9.0**): `typecheck` clean · `lint` clean ·
  `format:check` clean · `lint:deps` **no violations, 1408 modules / 3973 dependencies** ·
  `pnpm test` **2261/2261 across 243 files** (2253 before this run; the 8 new tests are the whole
  difference, which is what a guard-only task should produce) · `build` clean. `bench:solverkit`
  and `check:cross-engine-drift` were **not** run this run.
- **P0.96 did not fire locally this run** — `chunked-integration.test.ts` passed in the 2261. That
  is one more data point for load-sensitivity and not evidence it is fixed; it still wants a human
  to choose between its two named options.
- **Next run:** every remaining low-`seq` item needs a human, so the honest next pick is
  **P5.24** (first by `seq` at 217, phase 5, difficulty H) unless a human has by then answered one
  of the open decisions — in which case take that instead, because three correctness bugs
  (P0.99, P0.103, P0.101) outrank an optional adjoint prototype and all three are one decision
  away from being startable. The two with the clearest ask: P0.101 needs a Zeno cutoff chosen
  (its snap fix is implemented and measured, and is the right first half), and P0.99 needs one of
  ADR-016's three options picked. **P0.95 remains unmeetable by an agent session** — ref deletion
  is refused with HTTP 403, so the stale `claude/*` branches need a human or a credential change.: `format:check` is a CI step now, and the filing's diagnosis was wrong

- **P0.94 was taken because the 32nd run named it** and it is the first startable open item by
  `seq` (292): every earlier-`seq` open item needs a human — P0.95 is the branch-deletion
  permissions gap, P0.96 asks a human to choose between two options, P0.99/P1.00/P0.101 are each
  correctness bugs awaiting a decision. The criterion, `pnpm format:check` exits 0 on a clean
  checkout, is met.
- **The one-command fix was not the right fix.** `prettier --write CLAUDE.md` de-indents the
  third bullet's continuation line, because the inline code span `pnpm typecheck` straddled the
  line break and prettier pulls the wrapped span flush-left. Left like that the file is
  prettier-clean but visibly wrong — a flush-left line under an indented bullet. Moving the span
  onto a single line makes the file both prettier-clean and correctly indented. The prose is
  word-for-word identical; verified by diffing the before/after with whitespace collapsed, not by
  eye.
- **The filing's diagnosis needed correcting, and this is the honest record of it.** The filing
  and the 32nd run's handover both said the fix was to widen lint-staged's glob to `.mjs`. But the
  file that actually fails `format:check` is `CLAUDE.md`, which is `.md` — a type the **old** glob
  `*.{ts,tsx,js,json,md}` already covered. Widening the glob would not have touched it. The reason
  a covered file stays dirty is that **lint-staged only ever sees _staged_ files**: CLAUDE.md was
  already committed dirty before anyone cared, so the hook never re-examines it. Only a repo-wide
  check reaches it. So the change that actually closes P0.94 is **`format:check` added to
  `.github/workflows/ci.yml`** (between Lint and Import boundaries), not the glob.
- **The glob was widened anyway, because it is a real and separate gap.** It went from
  `*.{ts,tsx,js,json,md}` to `*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json,md,css,html,yml,yaml}`. The
  repo tracks 6 `.mjs`, 3 `.css`, 2 `.yaml`, 2 `.html`, 1 `.yml` and 1 `.cjs` file that the hook
  never formatted, all of which `format:check` now enforces. This run demonstrated the gap live:
  the `ci.yml` commit printed **`No staged files match any configured task`** — a `.yml` edit the
  hook ignored. Verified the fix by probe, not assertion: staging a deliberately mis-formatted
  `measure-cross-engine-drift.mjs` under the new glob makes the hook format it and the change
  never reaches the commit. The 31st run's `style(scripts): make measure-cross-engine-drift.mjs
prettier-clean` was this same gap having already bitten once.
- **Full gate green** (Node **22.22.2**, pnpm **11.9.0**): `typecheck` clean · `lint` clean ·
  `format:check` clean · `lint:deps` **no violations, 1405 modules / 3965 dependencies** ·
  `pnpm test` **2253 passed across 242 files** · `pnpm --filter @ballista/app build` exit 0 ·
  bundle **71.7 kB gzipped** against the 300 kB budget. Test count is identical to the 32nd run,
  which is what a config-only task should produce. `bench:solverkit` and `check:cross-engine-drift`
  were **not** run locally this run.
- **CI run 226 at `e632668` went red on the P0.96 flake, not on this change.** The single failure
  is `chunked-integration.test.ts:318` (P2.40), `expect(maxSliceMs).toBeLessThan(10)`, measuring
  **13.065580 ms** — the wall-clock assertion P0.96 was filed for. **2252 of 2253 passed.** Three
  things rule this change out as the cause, checked rather than assumed: the failing test is in
  `packages/solverkit`, which this run did not touch; the same suite was **2253/2253 locally**
  minutes earlier; and the new `format:check` step **passed**, since it sits before Test in the
  job and Test ran. This is the fourth recorded sighting (runs at `5bafdff`, `57eb22a`, 223, now 226) and it stays consistent with the 18th run's evidence that it is load-sensitive rather than
  code-sensitive. The failed job was re-run rather than the assertion touched — **P0.96 still
  wants a human to choose between its two named options**, and weakening the test to get green is
  forbidden here. **Attempt 2 of run 226 is `success` at the same `e632668`**, on the same code,
  which is the cleanest form the load-sensitivity evidence has taken yet: identical tree, identical
  commit, red then green with nothing changed in between. `main` is green.
- **One thing left undone on purpose, named so it is not mistaken for an oversight.** Nothing
  pins the new `format:check` CI step itself — a later edit could delete it silently, the same way
  the un-enforced formatting drifted in the first place. No CI step in this repo is guarded that
  way today, so pinning this one alone would be inconsistent; if that guard is wanted it is a task
  of its own covering every step, not a rider on this one.
- **Next run:** **P0.100** (task-id uniqueness assertion, ~15m) is the cheapest fully-specified
  item left — its filing says to rename the seq-299 task and `P1.00` out of the `P1` namespace
  rather than touch blueprint-derived phase-1 ids, and to put the assertion in `root-scripts.test.ts`
  or a sibling. Everything else open at low `seq` needs a human: P0.95 (branch-deletion
  permissions — this environment cannot delete remote refs), P0.96 (a two-option choice), and the
  correctness bugs P0.99/P1.00/P0.101, each measured and each awaiting a decision on the fix.
  P5.24 remains first by `seq` overall and is still marked optional in its own title.

---

## 2026-08-18 (32nd run) — P0.91 done: one `downrangeAxisOf`, and it was fourteen copies rather than four

- **P0.91 was taken because it is first by `seq` among the startable open items** (289, ahead of
  P0.94 at 292 and P0.100 at 300), and the 31st run's shortlist named it. `policy.taskSelection`
  says work in `seq` order; the earlier-`seq` items in the open set are the ones that need a human
  (P0.95 is a permissions gap, P0.96 asks a human to choose between two named options, P0.99/P1.00/
  P0.101 each need a decision). P5.24 is still first by `seq` overall and still marked optional in
  its own title.
- **The filing said four private copies. There were seven, and seven inline expressions besides.**
  `ill-conditioning.ts:256`, `basin-of-attraction.ts:182` and `trajectory-designer.ts:181` each
  grew a copy in the eight days since it was filed — which is precisely the quiet divergence the
  filing predicted, arriving on schedule and worth recording as such. The filing also missed the
  unnamed form: `layout.vertical === 0 ? 1 : 0` written inline at `shooting-residual.ts:203`,
  `tangent-linear.ts` (four sites), `targets.ts:228`, and `observables.ts:227` — inside the very
  file that now exports the helper. Fourteen sites in total; all fourteen now call one function.
- **They were not all identical, and the one difference decided the task.** Six copies were the
  ternary. `min-energy.ts`'s scanned for the first non-vertical axis and threw when there was
  none. On every layout with two or more position axes the two agree exactly — checked across
  every 2-to-4-axis layout, not argued — so the consolidation is a refactor. They part company on
  a one-dimensional layout: the ternary returns axis `1`, which does not exist and is read a few
  frames later as `undefined`-turned-`NaN`. **The scan-and-throw is what was kept**, for the same
  reason `requireLayout` in that file checks the whole layout up front rather than letting `at()`
  discover a missing channel later. Neither shipped layout can reach the throw.
- **Five tests, and the fifth is the one that matters.** Four cover the agreement, including a
  sweep asserting the helper matches the replaced ternary on every layout either can describe. The
  fifth covers the disagreement. **Mutation-checked**: restoring the ternary in `observables.ts`
  turns exactly the fifth red and leaves the other four green — the split the consolidation
  claimed, observed rather than asserted.
- **One test deliberately keeps its own copy of the rule.** `arcs.test.ts:518` restates
  `vertical === 0 ? 1 : 0` independently. That is not a fourteenth site to clean up: a test that
  restates a convention is a check on the helper, and rewriting it to call the helper would make
  it assert only that the helper equals itself.
- **Full gate green** (Node **22.22.2**, pnpm **11.9.0**): `typecheck` clean · `lint` clean ·
  `lint:deps` **no violations, 1405 modules / 3965 dependencies** · `pnpm test` **2253 passed
  across 242 files** (2248/242 → +5 cases, no new file) · `pnpm --filter @ballista/app build` exit
  0 · bundle **71.7 kB gzipped** against the 300 kB budget. The 2248 → 2253 delta is the five new
  cases and nothing else, which is what a pure consolidation should produce. `bench:solverkit` and
  `check:cross-engine-drift` were **not** run locally this run.
- **A lint detail worth naming, since it is the only way this refactor could have landed dirty.**
  Deleting the seven copies left `type TrajectoryLayout` imported and unused in five modules —
  five `@typescript-eslint/no-unused-vars` **warnings**, and `pnpm lint` is `eslint .` with no
  `--max-warnings`, so they would have passed CI silently. Cleaned in the same commit. Anyone
  adding `--max-warnings 0` later should expect that to be uneventful; it is today.
- **Next run:** **P0.94** is the cheapest remaining and is fully diagnosed — add `.mjs` (and
  `.mts`/`.cjs`) to lint-staged's `*.{ts,tsx,js,json,md}` glob, which currently excludes every
  script in `scripts/`, then add `format:check` to CI. **P0.100** (task-id uniqueness assertion,
  15m) is the other fully-specified one; note its own filing says to rename the seq-299 task and
  `P1.00` out of the `P1` namespace rather than touching blueprint-derived phase-1 ids, and to put
  the assertion in `root-scripts.test.ts` or a sibling. P0.96 still wants a human to choose
  between its two options; P0.95, P0.99, P1.00 and P0.101 still need a human each. No open
  correctness item beyond those is startable without a decision.

---

## 2026-08-17 (31st run) — P0.102 done: the pre-push gate can no longer overwrite its own committed evidence

- **P0.102 was taken because it is the one open correctness item an unattended run can finish, and
  because it attacks the gate itself.** The 30th run's shortlist was P0.102, P0.100 and P0.91;
  P0.96 names two options and says explicitly they are for a human to choose between, and P0.99,
  P1.00, P0.101 all still need a human. P0.95 remains unsatisfiable here — see below, and it is now
  confirmed as a permissions gap rather than an environment quirk.
- **The defect, restated because it is subtle.** `measure-cross-engine-drift.mjs` ended by
  unconditionally writing the **committed** `cross-engine-drift-results.json`. That script sits in
  the documented pre-push gate. Run anywhere without Playwright's exact browser revisions — every
  dev sandbox — it replaced a real chromium measurement (`maxRelativeDrift 0`, bit-identical over
  101 rows × 5 series) with two `status: unavailable` records carrying launcher stack traces, and
  **still printed "All measured engines are within the drift threshold" and exited 0**, because
  that sentence is vacuously true of zero engines. A soft-warn check downgraded checked-in evidence
  to a non-measurement and called it a pass.
- **Writing is now opt-in, and the flag buys less than it looks like.** `--record` is required to
  write at all; CI passes it (where browsers are real), a local gate run does not. But a `--record`
  run **still refuses when zero engines measured** — if CI's `playwright install` ever fails,
  replacing a good record with a stack trace is not the useful outcome. So the flag buys the right
  to write a _measurement_, never the right to erase one. The zero-measured case now warns "No
  engine could be measured … This is not a pass".
- **The tests force the failure rather than wait for it.** Five tests run the real script as a
  subprocess (~0.7s each) and assert the committed file is **byte-identical** afterwards in both
  flag modes. Where "nothing measurable" has to hold deterministically they point
  `PLAYWRIGHT_BROWSERS_PATH` at a path that does not exist — otherwise the `--record` test would
  behave differently on the CI runner, where the browsers _are_ real, and **would itself perform
  the write it exists to forbid**. A fifth test asserts CI still passes `--record`, so making
  writing opt-in cannot quietly freeze the committed measurement at whatever it last held.
- **Mutation-tested, and the defect obligingly reproduced.** Restoring the unconditional write
  fails 3 of the 5; restoring the vacuous all-clear fails 2; dropping `--record` from `ci.yml`
  fails 1. During that exercise the mutated script **did** overwrite the results file — the 30th
  run's exact experience, caught the same way, by reading `git status` rather than trusting the
  exit code. Reverted with `git checkout --`; the committed measurement is intact and verified
  present in the landed commit.
- **Full gate green at `af21b96`** (Node **22.22.2**, pnpm **11.9.0**, `--frozen-lockfile` clean in
  19.5s): `typecheck` clean · `lint` clean · `lint:deps` **no violations, 1405 modules / 3965
  dependencies** · `pnpm test` **2248 passed across 242 files** (2243/241 → +5 cases, +1 file) ·
  root `pnpm build` **exit 0** · bundle **71.7 kB gzipped** against the 300 kB budget. The suite now
  runs the drift script four times and leaves the results file unmodified — the fix, observed
  rather than asserted. `bench:solverkit` was **not** run locally this run.
- **CI is green at `1d12483`, and it is the first real test of the `--record` path.** Run **222**
  passed **every** step, including `Cross-engine drift check` — the one environment with actual
  Playwright browsers, so the write branch this task added has now executed against real engines
  rather than only against its own tests. Run 221 covers `deaa6d3`, one commit earlier.
  `bench:solverkit` also passed on that runner, which does **not** refute the 30th run's 16.8%
  `position-verlet` soft-warn — different machine, different moment — but is consistent with its
  reading of that as runner load rather than a regression. Recorded as a data point, not a verdict.
- **Run 223 went red, and it was GitHub, not this repo — one more entry in that pattern.** The
  changelog commit at `4cf8d3a` failed on **`Set up job`, step 1 of 33, before checkout**, so no
  repo code ran at all. The log is unambiguous: three attempts to download `pnpm/action-setup`
  from `codeload.github.com`, **429 Too Many Requests** twice and then **503 Service Unavailable**.
  The same rough patch showed up in this session's tooling, where `api.github.com/user` also
  returned 503. Re-run as attempt 2: **all 33 steps success**, so **CI is green at the current
  `main` HEAD `4cf8d3a`**. A re-run was the right response _only_ because the failure landed before
  any test body executed — that is the narrow case where "re-run it" is a diagnosis rather than an
  evasion. **Read the job log before suspecting the code**; a red CI here has meant a GitHub 5xx
  every time so far.
- **A second commit, `35cc2e7`, is formatting only.** One line of the P0.102 change wrapped where
  prettier would not; fixing it cleared the file entirely, since all 10 lines of pre-existing drift
  sat inside the region P0.102 rewrote. Worth noting for **P0.94**: lint-staged's glob is
  `*.{ts,tsx,js,json,md}`, which **excludes `.mjs`**, so the pre-commit hook never formats these
  scripts at all. That is a concrete mechanism for the invisible drift P0.94 describes.
- **P0.95 is worse than "cannot delete refs", and this run has a sharper diagnosis.** The 30th run
  recorded the delete failure as an HTTP 403. This run hit a 403 on `git push` in a _sibling_
  repository and probed all three: writes are refused on `paper-trader` and permitted here and on
  `telehealth`, so these are per-repository GitHub App permissions, not an environment-wide egress
  rule. P0.95's 76 stale branches therefore need a human with admin on the repo, or the App granted
  the scope — not a cleverer script. Recorded here; **not** filed as a new task, since P0.95
  already owns it.
- **Next run:** unchanged in shape — no open correctness item is startable without a human.
  **P0.100** (task-id uniqueness assertion, 15m) and **P0.91** (consolidate the four
  `downrangeAxisOf` copies, 10m) remain the two small, fully specified, independent ones, and
  either is a clean single-task run. **P0.94** is now better understood and cheap: add `.mjs`
  (and `.mts`/`.cjs`) to the lint-staged glob, then `format:check` to CI. P0.96 still wants a human
  to choose between its two options; P0.99, P1.00 and P0.101 still need a human decision each.

---

## 2026-08-17 (30th run) — P0.92 done: the difference stencil no longer steps outside an active bound; P0.102 filed

- **P0.92 is done, and it was taken because it is the only open correctness item an unattended run
  can finish.** P0.99 is parked on ADR-016's three options, P1.00 wants a resting-contact model
  blueprint §4.9 does not specify, and P0.101 wants a rebound-speed cutoff `restitution.ts` has
  none of — all three need a human. P5.24 remains the next task by `seq` and remains marked
  optional in its own title.
- **The fix is opt-in, and that is the whole design.** `JacobianOptions` gains
  `feasible?: (aim) => boolean`. Omitted, every number the module produces is unchanged — asserted
  bit-for-bit on the matrix, the steps and the evaluation count, not merely to a tolerance. Given,
  a column whose stencil would cross a face differences **inward** instead. The module comment has
  always said a one-sided fallback on a _failed evaluation_ would be exactly the invisible accuracy
  loss it exists to prevent, and that stays true: the swap happens only where the caller has
  declared the region, never as a rescue. `ShootingJacobian.stencils` reports per column which
  stencil actually ran.
- **Five rules, and rules 1 and 5 are the ones worth knowing.** The hook engages only at a
  **feasible base aim** — at an infeasible one "inward" has no single meaning, so behaviour is what
  it was before. And when _neither_ side is feasible the region is narrower than the step, there is
  no stencil to fall back to, and the requested scheme runs unchanged rather than inventing
  something. Rule 4: a column that goes one-sided re-derives its step for the order it now has
  (`ε^{1/2}`, not `ε^{1/3}`) unless the caller pinned it, because the plateau sweeps depend on
  pinned steps being honoured verbatim.
- **`constrainedShooting` now hands the hook over automatically** under the projection strategy,
  reusing `aimActiveSet(...).feasible` rather than re-deriving "inside the box" — so the predicate
  the stencil obeys and the one the answer is judged against are the same code with the same
  tolerance. An explicit hook from the caller wins, since a caller may know a tighter domain than
  the box: an elevation at which the terminal event cannot fire is not an `AimBounds` face.
- **The order drop is measured, which is what the filing asked for rather than an assertion.** Same
  problem, same pinned steps, both stencils, fitted log-log slope over `h = 1e-4 … 1e-1`: **central
  2.00** (6.6e-9 → 6.7e-3), **one-sided 1.00** (3.6e-4 → 3.5e-1). At the default first-order step
  `ε^{1/2} = 1.49e-8` the face measures **3.5e-6** relative against central's **~2e-9** on the same
  column. **Three orders, and that gap is the cost of the trade** — `O(h²)` → `O(h)`, in that
  column, at that face, nowhere else. Rule 4 is justified by measurement too: keeping the central
  step for the one-sided column gives **2.2e-5**, six times worse.
- **Both perturbations confirm the tests fail for the right reason, and the first one is the
  satisfying part.** Forcing the stencil to stay central turns **8 of 19** new cases red — and the
  `constrainedShooting` case then reports exactly **`count: 5, of: 56`**, reproducing P5.16's
  original measurement from the filing three months of runs ago. Skipping the step re-derivation
  turns exactly **2** red, the step assertion and the accuracy one.
- **One existing test was inverted on purpose, and it is not a weakened test.**
  `constraints.test.ts`'s "keeps every iterate feasible, while the difference stencil reaches just
  past the face" _asserted the defect_ — five excursions of `4.8444e-4` — as a characterization of
  P0.92. Its belief is what the task changed. It now asserts zero excursions, with a control beside
  it that disables the hook and reproduces all five exactly, so the historical measurement is kept
  rather than deleted.
- **P0.102 filed, and it nearly ate this run's clean tree.** `pnpm check:cross-engine-drift` is in
  the documented pre-push gate. Run here it **overwrote the committed
  `scripts/cross-engine-drift-results.json`**, replacing a real chromium measurement
  (`status: measured`, maxRelativeDrift 0, bit-identical over 101 rows × 5 series) with
  `status: unavailable` and a Playwright launcher stack trace — this sandbox has Chromium but not
  at revision `chromium_headless_shell-1228`, and no Firefox. **It still printed "All measured
  engines are within the drift threshold" and exited 0**, because zero measured engines satisfies
  that vacuously. So a soft-warn check silently downgrades committed evidence and reports success.
  Reverted with `git checkout --`; filed rather than fixed, since it was not this run's task.
- **Full gate green at `dc1dc11`** (Node **22.22.2**, pnpm **11.9.0**, `--frozen-lockfile` clean in
  10.4s): `typecheck` clean · `lint` clean · `lint:deps` **no violations, 1401 modules / 3955
  dependencies** · `pnpm test` **2243 passed across 241 files** (2223/240 → +20 cases, +1 file) ·
  root `pnpm build` **exit 0** · bundle **71.7 kB gzipped** against the 300 kB budget.
  `bench:solverkit` **soft-warns** on `position-verlet` at 16.8% against a 15% threshold — this run
  touched nothing under `packages/solverkit`, so it is runner load on a ratio benchmark, not a
  regression this change could have caused. Recorded rather than dismissed.
- **Untouched, and deliberately:** P0.99, P1.00 and P0.101, all three of which need a human
  decision before an unattended run should go near them; and P0.95, which this environment still
  cannot satisfy — `git push origin --delete` does not work here.
- **Next run:** no open correctness item is startable without a human. Of what remains, **P0.96**
  (the wall-clock assertion that flakes on CI) is the highest-value one, but read its notes first:
  it names two options and says explicitly they are _for a human to choose between_, so an
  unattended run should pick the conservative half — keep the deterministic assertions, report the
  milliseconds without asserting them — or leave it. Otherwise **P0.100** (task-id uniqueness
  assertion, 15m) and **P0.91** (consolidate the four `downrangeAxisOf` copies, 10m) are both small,
  fully specified and independent. **P0.102** is likewise small and would stop the gate from
  corrupting a committed artefact.

---

## 2026-08-16 (29th run) — P0.98 done with a fixed step; P0.101 filed: bounces silently missed, projectile falls through the ground

- **P0.98 is done, and the thing that unblocked it was a fixed step, not the Hermite wrapper alone.**
  The 26th run's block in `restitution-bounce-short-flights.test.ts` is explicitly groundwork: it measured
  `flight / step` at exactly 5.00 across every bounce and concluded the sub-quarter-step regime is
  unreachable from the adaptive driver, which truncates each step onto the localized event so the step
  shrinks in lockstep with the bounces. Pinning `h` breaks that coupling — the flights decay geometrically
  and the step does not. `HermiteDenseOutputStepper(ClassicalRK4Stepper)` is what makes a fixed step
  eligible for event detection at all, since `integrate`'s `hasEvents` guard needs `stepper.interpolant`
  (that guard's silence is **P0.99**, still open and untouched).
- **8 new cases, `describe.each` over h = 0.12 and h = 0.25.** At h = 0.12 the last two impacts arrive from
  flights of 0.135 h and 0.027 h; at h = 0.25 the last three from 0.065 h, 0.013 h and 0.003 h. Every impact
  time matches the closed form `t_n = t0 (1 + 2e(1-e^n)/(1-e))` to within **5e-16 relative** — RK4 is exact
  on a quadratic and the Hermite cubic reproduces it exactly, so the only error left is the root find's.
- **Two perturbations, applied and reverted; both caught by the same 2 cases.** Emptying `DEPARTURE_THETAS`,
  and forcing `activeAtStart = false` (removing P0.97's suppression). **Which cases go red is the useful
  part:** only the h = 0.12 pair, and only the closed-form-time and on-the-ground assertions. h = 0.25 pins
  the regime but is insensitive to the ladder, and **the impact counts stay green under both perturbations**
  — the solve still reports the same _number_ of impacts, just at wrong times. A count assertion would not
  have noticed either perturbation.
- **P0.101 filed, and it is the run's more important finding.** `scanStepForEvents` arms the ladder on
  `g0 === 0` **exactly**, but the state a bounce resumes from is Brent's localized root, whose `g_gnd` is
  zero only to within the root find's error — measured at up to ~1e-15 m **and of either sign**. A negative
  residual reads as "already below ground": the ladder is not armed, the scan falls back to
  `INTERIOR_THETAS = [0.25, 0.5, 0.75]`, and a flight shorter than a quarter step ends before the first of
  them. No sign change, no impact, and the ball accelerates downward forever. **Repro:** drag-free ball from
  y = 5, e = 0.2, tspan [0, 12] — at **h = 0.4 and h = 0.5 the sequence stops after 2 impacts and the solve
  returns `ok` with `yFinal = -5.45e+2`**, the ball 545 m underground. h = 0.12 gives 5 and h = 0.8 gives 6,
  so **it is not monotone in h**; it turns on the sign of a rounding residual, which is why it stayed hidden.
- **The adaptive path is not exempt, and the existing test walked past it.** `createDormandPrince54Stepper`
  on the same problem resolves 7 impacts and also ends at `yFinal = -5.39e+2` reporting `ok`. The 26th run's
  block pinned that 7 and never looked at `yFinal`. Same shape as P0.97 and P0.99: a silently wrong answer
  with `ok: true` at a configuration a caller reaches without doing anything unusual.
- **The candidate fix was implemented and measured this run, then deliberately reverted.** Snapping the
  post-bounce height onto the terrain in `createGroundImpactEvent` (`out[Y] = terrain.height(out[X])`) is
  exact rather than a tolerance — the impact is _on_ the surface by the event's definition — and it works:
  the fall-through is gone and `y` holds at exactly 0. **But it exposes the Zeno tail underneath**: ~20000
  bounces, step budget exhausted, `tFinal` converging on the accumulation point `t_inf = 1.5147`, and status
  **`failed`** on every bouncing solve. Trading a silent wrong answer for a loud failure is the trade
  `DEPARTURE_THETAS`' own comment endorses, but making the ordinary bouncing case fail is a product decision,
  not a bug fix — so this run did not take it, on the same reasoning the 27th run applied to P0.99.
  `restitution.ts` has no rebound-speed cutoff of any kind today; picking one is the open half.
- **Because of that, P0.98's counts are asserted as lower bounds and `report.status` is not asserted at all.**
  Both are what they are today only because the sequence dies early. A fix for P0.101 resolves _more_
  impacts and changes the status, and these cases stay green rather than turning red for the wrong reason.
  Tightening them into exact counts is written into P0.101 as part of that task.
- **Full gate green at `2790291`** (Node **22.22.2**, pnpm **11.9.0**, `--frozen-lockfile` clean in 8.1s):
  `typecheck` clean · `lint` clean · `lint:deps` **no violations, 1398 modules / 3940 dependencies** ·
  `pnpm test` **2223 passed across 240 files** (2215 → 2223, the 8 new cases).
- **Untouched, and deliberately:** P0.99 (still needs the human API decision ADR-016 sketches) and P0.100
  (the task-id collision; note this run's new task is **P0.101**, chosen to stay clear of the P1.xx namespace
  that collision is about, so it does not make P0.100 worse).

---

## 2026-08-16 (28th run) — P0.90 done, closing P0.93 and P1.01 as the same one-character defect; guard added; P0.100 filed

- **The root `pnpm build` script works now.** `--workspace-concurrency 1` → `--workspace-concurrency=1`.
  Under the pinned pnpm 11.9.0 the space-separated form folds the next token into the flag's value, so
  `run` became the script name and the command exited 1 with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. Measured
  both ways this run rather than inherited: space form exits 1, `=` form exits 0 and reports
  `Scope: 8 of 9 workspace projects`. Also checked what P0.90's notes asked — no other root script uses
  the space-separated form; `verify` and the rest are clean.
- **One defect, three task filings, eleven changelog entries.** P0.90 (15th run), P0.93 (17th run) and
  P1.01 (27th run) are all the same bug; P0.93 and P1.01 are marked done by this fix. **P0.93's diagnosis
  was wrong and is recorded as wrong in its notes:** it claims only `@ballista/app` defines a `build`
  script, but all eight packages define one — `tsc -b`, checked by reading every manifest. P0.90's and
  P1.01's diagnosis (flag parsing) is the correct one. The `=` form was already named as the fix in this
  file at line ~1478, several runs ago.
- **The guard is the real deliverable.** `packages/validation/src/root-scripts.test.ts`, 5 tests over the
  root scripts and the workspace manifests: no pnpm value-flag in space-separated form in any root script,
  `build` recurses and never names `run` as its script, all eight packages define `build`, and the package
  count is 8. **Verified it fails for the right reason** — putting the space back turns exactly 2 of the 5
  red. String assertions, not a real recursive build, which takes ~35 s and does not belong in the unit
  suite. **Why this bug survived so long is the part worth keeping:** nothing failed when it broke. CLAUDE.md
  names `build` in the pre-push gate every session runs, but `ci.yml` calls `pnpm --filter @ballista/app
build` and never the root script, so the breakage was visible only to whoever typed `pnpm build` — and
  each session that tripped over it filed a fresh task instead of spending the one character.
- **P0.100 filed: task ids in `ROADMAP.json` are not unique.** Hit while marking P1.01 done. The
  discovered-bug counter rolled `P0.99 → P1.00 → P1.01`, but `P1.01` and `P1.02` are already phase 1's
  blueprint tasks at seq 12 and 13. So **`P1.01` currently names two different tasks**, and this run's
  status edit had to disambiguate on `seq >= 288` rather than on id. Both collisions are on `done` tasks
  and nothing automated reads ids today, so it is filed, not fixed — fixing it was not this run's claimed
  task. It wants a uniqueness assertion so the next collision fails a test.
- **Full gate green at `c9a1a9e`** (Node **22.22.2**, pnpm **11.9.0**, `--frozen-lockfile` clean in 8.1s):
  `typecheck` clean · `lint` clean · `lint:deps` **no violations, 1332 modules / 3749 dependencies** ·
  `pnpm test` **2215 passed across 240 files** · `pnpm build` **exit 0, all 8 packages**. That build figure
  is a first for this changelog — every prior run recorded it as failing or skipped it.
- **Untouched, and deliberately:** P0.98 and P0.99. The 27th run left P0.98 unblocked via
  `HermiteDenseOutputStepper(ClassicalRK4Stepper)` and it is the natural next task. P0.99 still needs the
  API decision ADR-016 (Proposed) sketches and does not belong to an unattended run until a human picks one
  of its three options. Neither was started, so neither is left half-finished.

---

## 2026-08-16 (27th run) — P0.99 attempted, returned to todo; ADR-016 records why both proposed fixes fail; P1.01 filed

- **P0.99 is not done, and the finding is that the task's own two candidate fixes are both wrong.**
  It asked for event detection to be made non-silent when the stepper has no dense output, and
  suggested either failing loudly at init or falling back to a Hermite interpolant. Both were
  implemented far enough to measure. **Throwing takes 88 tests red across 31 files** — and not odd
  callers: `convergence-harness`, `euler-global-error`, `work-precision-harness`,
  `golden-trajectories`, `reference-solution`, `energy-drift-study`, `stability-boundary-sweep`,
  `phase-portrait`, every fixed-step stepper's own test, and the app routes over them. The reason is
  structural and is the run's main result: **a convergence-order or energy-drift study must hold `h`
  fixed, and `createPlanarProjectileModel` always attaches a ground-impact event**, so
  "event-bearing model + fixed-step stepper" is the normal case in this repo rather than a caller
  error. Throwing outlaws the platform's own pedagogy. **Auto-wrapping is worse:** those studies
  would keep running but with the terminal event _armed_, truncating them at ground impact and
  silently changing every convergence rate, energy-drift figure and golden trajectory they are
  pinned against — trading a silent correctness bug for a silent measurement change. Both fail for
  one reason: **the API cannot express whether a given caller wants events**, so the stepper choice
  decides it invisibly. The remedy is an API change, not a guard change. P0.99 goes back to `todo`
  with that recorded; marking it done on either fix would have been a false completion claim.
- **ADR-016 written, Status `Proposed` rather than `Accepted`** — it records the measurements, why
  each candidate fails, and three sketched remedies (tri-state `cfg.events`; an `eventsArmed`
  diagnostic on `SolveReport`; post-hoc terminal-guard evaluation), choosing none. It also states
  plainly that **P0.99's validation criterion is not reachable by a local edit to `integrate.ts`**,
  so the next run does not rediscover that the hard way.
- **Landed anyway, because it is real coverage:** `event-detection-requires-dense-output.test.ts`,
  7 tests pinning the measured wrong numbers (`ClassicalRK4` reports `ok` at `tFinal = 12`,
  **701 m underground**, zero events, against DOPRI5 stopping at `t = 1.009810` with `y = 1.0e-15`),
  the same failure on explicit Euler, Heun and midpoint, the working
  `HermiteDenseOutputStepper(ClassicalRK4Stepper)` workaround localizing the impact to the
  closed-form `sqrt(2h₀/g)`, and — in the same file — the legitimate fixed-step-plus-event-model
  pattern, so the cost of "just throw" is visible next to the bug that appears to justify it. **Its
  assertions are the defect, not the specification**; rewrite the file when fixing, do not delete
  it. `integrate.ts`'s comment now carries the trap and an explicit "do not throw, do not auto-wrap
  — read ADR-016 first". **No behaviour changed:** the guard is byte-identical to before this run.
- **P0.98 is unblocked without P0.99 landing.** The fixed step it needs is reachable today via
  `new HermiteDenseOutputStepper(new ClassicalRK4Stepper())`, now tested. The 26th run recorded
  P0.98 as blocked behind P0.99; that is no longer true — only the wrapper is needed.
- **P1.01 filed** — the root `pnpm build` script is broken under pnpm 11.9.0:
  `pnpm -r --workspace-concurrency 1 run build` exits 1 with
  `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT: None of the selected packages has a "run" script`, the `run`
  token being read as the script name. **Not a CI outage** — `ci.yml` calls
  `pnpm --filter @ballista/app build` and never the root script — but it does bite anyone following
  CLAUDE.md's "run the build locally before pushing".
- **Gate green:** suite **2210/2210 across 239 files** (was 2203/238); `typecheck`, `lint` and
  `lint:deps` clean; app build green with `check-bundle-size` at **71.7 kB gzipped** against the
  300 kB budget. Note on the `lint:deps` module count, since it has been quoted run-to-run as if
  stable: it read **1395 modules / 3928 dependencies** mid-run and **1329 / 3741** on the final
  clean pass. The difference is stale `packages/*/dist` output left by earlier `tsc -b` runs in the
  same session, not a dependency-graph change — `depcruise` cruises whatever is on disk. **1329 /
  3741 is the reproducible figure**; treat the count as an artefact of build state rather than a
  health signal, and do not read a small delta as a regression.
- **Next run:** **P1.00** (bouncing solves tunnel through the ground past the Zeno point) is the
  highest-priority open correctness item now that P0.99 is parked on a design decision — but note it
  too wants an ADR for a resting-contact model, so if the intent is to _land_ something, **P0.98 is
  now the one that is actually completable**: it is unblocked, its regime is reachable with the
  Hermite wrapper, and its closed form `t_n = t₀(1 + 2e(1 − eⁿ)/(1 − e))` needs no reference
  implementation. P0.99 should not be re-attempted until someone picks one of ADR-016's three
  options. P5.24 remains the next task by `seq` and remains marked optional in its own title.

---

## 2026-08-15 (26th run) — P0.98 attempted, returned to todo; P0.99 and P1.00 filed

- **P0.98 is not done, and that is the finding rather than a shortfall.** It asked for a test of
  restitution bounces whose whole flight is shorter than a quarter step. **The regime is not
  reachable from the adaptive driver**, which truncates each step to land on the localized event:
  across both an `e = 0.5` and an `e = 0.2` drop-from-rest sequence, `flight / step` measures
  **5.00 at every bounce** — about five steps per flight, never a fraction of one — even where the
  flight is `1.3e-4 s` against a nominal step of `0.12`. The decisive check: **emptying P0.97's
  `DEPARTURE_THETAS` ladder leaves the entire new test file green**, so the sub-interval path is
  demonstrably untouched. Marking the task done on that evidence would have been a false
  completion claim. It goes back to `todo` with the measurement recorded, blocked behind P0.99.
- **Landed anyway, because it is real coverage:** `restitution-bounce-short-flights.test.ts`, 5
  cases pinning impact **times** for a drag-free bouncing ball against the closed form
  `t_n = t0 (1 + 2 e (1 - e^n) / (1 - e))` to **1e-12 relative** (measured error 2.1e-15), plus the
  resolved impact count and the approach to the Zeno accumulation point. `restitution-bounce.test.ts`
  asserts energy conservation, re-arming and monotone decay but never checks an impact time against
  an analytical value, so this angle did not exist. Suite **2203/2203 across 238 files** (was
  2198/237); typecheck, `lint` and `lint:deps` (1392 modules) green; app build green with
  `check-bundle-size` at **71.7 kB gzipped** against the 300 kB budget.
- **P0.99 — a silent wrong answer of the same shape as P0.97, and arguably worse.** `integrate.ts`
  gates its entire event block on `hasEvents`, which requires `stepper.interpolant !== undefined`.
  Every fixed-step stepper in the package — `ClassicalRK4`, explicit and semi-implicit Euler, Heun,
  midpoint, SDIRK2, the symplectic ones — exposes no interpolant, so **event detection is switched
  off entirely and nothing warns.** Same model, same `h = 0.12`, terminal ground impact, `y0 = [0,
5, 3, 0]`: DOPRI5 stops correctly at `t = 1.009810` with `y = 1.0e-15`; `ClassicalRK4` runs the
  full span and finishes **701 m underground** reporting `status: "ok"`. P0.97 needed a near-zero
  elevation to trigger; this needs only a stepper choice. Filed with the repro and two candidate
  fixes (fail loudly at init, or build a Hermite interpolant from step endpoints), not fixed here —
  the guard is presumably deliberate and the right answer wants an ADR.
- **P1.00 — bouncing solves tunnel through the ground past the Zeno point.** Distinct from P0.99:
  this reproduces on the _adaptive_ path with dense output present and events firing normally. A
  drag-free bouncing ball accumulates infinitely many impacts at `t_inf`, so running out of
  resolution is expected; what is not is that the ball then passes **through** the ground and
  free-falls. At `H0 = 5, e = 0.2` over `[0, 12]`: 7 impacts resolved, the last at `t = 1.514683`
  against `t_inf = 1.514715`, then `yFinal = -5.391e+2` with `status: "ok"`. Every resolved impact
  time is right to 2.1e-15, so localization is not at fault — nothing catches the ball. Needs a
  resting-contact model, which blueprint §4.9 does not currently specify; filed for an ADR.
- **Next run:** take **P0.99** — it is a correctness bug producing silently wrong answers, it
  outranks everything else open by the repo's own priority order, and it is what unblocks P0.98
  (a fixed step is the only way to reach that regime). Then P1.00, then P0.98 becomes doable with
  `ClassicalRK4Stepper` at a fixed `h`. P5.24 remains the next task by `seq` and remains marked
  optional in its own title.

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
