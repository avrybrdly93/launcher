# ADR-019: An Estimator Glossary, and Why the When-to-Use Table Is Code Rather Than Prose

**Status:** Accepted — the table is `packages/analysis/src/estimator-glossary.ts`,
checked against the repository by `estimator-glossary.test.ts` and rendered in
the Monte Carlo dashboard's help section
**Date:** 2026-09-05
**Task:** P6.30

## Context

Phase 6 built five ways to answer a question about an uncertain shot:

| task  | what it built                                    |
| ----- | ------------------------------------------------ |
| P6.03 | the plain Monte Carlo replicate generator        |
| P6.13 | control variates                                 |
| P6.14 | Latin hypercube sampling                         |
| P6.15 | quasi-Monte Carlo, a scrambled Sobol' sequence   |
| P6.23 | importance sampling for rare-event probabilities |

Every one of them carries a long, careful module header explaining what it does
and why it is built the way it is. Those headers are good, and **none of them
answers the question a reader at the dashboard actually has.** That question —
_which of these do I want for the thing I am asking?_ — is comparative. It
cannot be answered from inside any single module, because each module's header
is written by someone who has already decided to use it.

The gap has a visible consequence. The Monte Carlo dashboard
(`packages/ui/src/monte-carlo-page.tsx`, P6.24) runs **plain MC only**. The
other four exist, are tested, are exported, and are wired into nothing. A user
cannot tell whether that is because they are unfinished, because they are
inappropriate here, or because nobody got to it — and the honest answer differs
per method, which is exactly what a glossary is for.

### Why the obvious form of this document is the wrong one

The obvious artefact is a Markdown table in this file, with the dashboard
linking to it. That is one source of truth for exactly as long as nobody
changes anything. Rename `sobolReplicates`, move `control-variate.ts`, or
re-record a measurement, and the table keeps rendering, keeps looking
authoritative, and is wrong. Nothing fails. The next reader is then worse off
than with no table at all, because a stale table is indistinguishable from a
current one.

This is the same failure ADR-016 and ADR-017 both describe in a different
setting: **a wrong answer that arrives with every outward sign of a right
one.** The repository's existing answer to that shape of problem is to make the
claim executable, and that is what is done here.

## Decision

**The when-to-use table is a data module, not prose.** The rows live in
`packages/analysis/src/estimator-glossary.ts` as `ESTIMATOR_GLOSSARY`. This ADR
and the dashboard's help section both derive from it. `analysis` is the lowest
layer that can see both the samplers (in `engine`) and the estimators (in
`analysis`), so the table sits there rather than widening a layering rule to
accommodate a document (§2.1, `.dependency-cruiser.cjs`).

**Each row is checked against the repository, not against itself.**
`estimator-glossary.test.ts` asserts that every row's module exists, that its
named entry point is genuinely exported by that module (matched as an `export`
declaration, not as a mention in a comment), that the test it credits exists,
and that **every measured figure it quotes appears verbatim in that test**. A
second assertion requires the same figures to appear in the row's own prose, so
the figure list cannot quietly drift away from the sentence it is supposed to
be guarding.

**Each row must state a precondition and a failure mode, not only a
recommendation.** A row that says when to reach for a method and never when not
to is an advertisement, and three of the five methods here are wrong for the
dashboard's own headline observable. The test enforces that both halves are
present and that no two rows carry identical guidance — the table's content
_is_ the contrast between rows.

### The glossary

**Plain Monte Carlo (MC)** — `packages/engine/src/replicate-generator.ts`,
entry point `generateReplicate`. Draw each replicate's parameters independently from
the input distribution and average. Estimates anything: a mean, a quantile, a
probability. Its standard error falls as `N^(-1/2)` regardless of the
observable's smoothness or the number of uncertain parameters, which is
simultaneously its weakness and the reason it is the baseline.

**Latin hypercube sampling (LHS)** — `packages/engine/src/latin-hypercube.ts`,
entry point `latinHypercubeReplicates`. Split `(0, 1)` into `N` equal strata, take
exactly one sample from each, and permute the stratum assignment independently
per dimension. Every one-dimensional projection is then perfectly stratified
while the dimensions stay uncorrelated. It changes only _how the uniforms are
drawn_, so every downstream statistic keeps its meaning.

**Quasi-Monte Carlo (scrambled Sobol' sequence)**, abbreviated **QMC** —
`packages/engine/src/sobol.ts`, entry point
`sobolReplicates`. Replace independence with a low-discrepancy
sequence — here a scrambled Sobol' sequence — whose points fill the unit cube
evenly at every scale. The Koksma–Hlawka inequality then bounds the error by
the sequence's discrepancy, which buys a rate rather than a constant. The
scramble is not decoration: an unscrambled sequence is a quadrature rule with a
fixed error and no distribution, from which no confidence interval can be
formed.

**Control variates (CV)** — `packages/analysis/src/control-variate.ts`, entry
point `controlVariateMean`. Post-processing, not sampling. If a cheap quantity
is correlated with the expensive one _and_ its exact mean is known, subtract off
how lucky each draw was: `Ŷ_cv = ȳ − c(x̄ − E[X])`. Unbiased for any `c`;
choosing `c` well is what shrinks the variance and choosing it badly costs
accuracy but never correctness.

**Importance sampling (IS)** — `packages/analysis/src/importance-sampling.ts`,
entry point `importanceSamplingProbability`. Draw from a tilted proposal that puts mass where
the rare event actually is, then undo the lie with a likelihood ratio
`w = f(x)/g(x)`. Unbiased for any admissible proposal — the proposal affects
variance and nothing else.

### The when-to-use table

<!-- when-to-use:start -->

| method  | estimates                               | error behaviour                                                         | reach for it when                                                                                                 | do not, when                                                                                                                                              |
| ------- | --------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MC**  | anything                                | `N^(-1/2)`, unconditionally                                             | always, first — it is the baseline, and the only row with no precondition                                         | never avoid it; replace it only when a row below states a precondition your problem meets                                                                 |
| **LHS** | as MC; changes only the draw            | `N^(-1/2)` with a smaller constant                                      | the observable is smooth and mostly additive in the drawn parameters, and `N` is fixed in advance                 | the variance is carried by interactions, or `N` is not known up front — the design is a joint construction over all `N` replicates                        |
| **QMC** | as MC; changes only the draw            | ≈ `N^(-1)` on an integrand of bounded variation                         | the observable is smooth and the dimension is modest — the largest win available on a well-behaved integrand      | the observable is discontinuous; a thresholded quantity has unbounded Hardy–Krause variation and gives the rate straight back                             |
| **CV**  | a mean, and only a mean                 | variance × `(1 − ρ²)`; the rate is unchanged                            | a cheap quantity is strongly correlated with the expensive one **and** its exact mean is known in closed form     | correlation is weak (at `ρ = 0.3` it removes 9%), or the control's mean is only estimated rather than exact                                               |
| **IS**  | a probability, specifically a small one | unbiased for any admissible proposal; the proposal moves variance alone | the event is rare enough that counting hits is hopeless — brute force needs `N ∝ 1/p` for fixed relative accuracy | the event is common, or no defensible proposal exists — a bad proposal fails silently, returning a plausible number with a small, equally wrong error bar |

<!-- when-to-use:end -->

### What was measured, and by whom

These are quotations with attribution, not fresh measurements, and not
promises about a different observable. Each is the value on the specific
problem its own validation test constructs.

- **MC / QMC**, `packages/analysis/src/sobol-convergence.test.ts` — Sobol'
  achieves a log-log slope steeper than `-0.85` where MC measures between
  `-0.65` and `-0.35`, and its error is below `MC/8` at the largest size
  measured. The same suite asserts, deliberately, that QMC **gives up that
  rate on a discontinuous observable**.
- **LHS**, `packages/analysis/src/latin-hypercube-variance-reduction.test.ts` —
  SE `6.037` m plain against `0.410` m stratified on mean range at `N = 64`, a
  ratio of `0.068`. On a purely interactive observable the same comparison
  gives `1.10`: no improvement at all, and in fact a slight cost.
- **CV**, `packages/analysis/src/control-variate-variance-reduction.test.ts` —
  variance ratio `0.00115` from a mean `ρ` of `0.99952` on the drag-free-range
  control. On a deliberately poor control the same study measures `0.994` — no
  win, and no loss either, because the estimated coefficient falls back to the
  plain mean.
- **IS**, `packages/analysis/src/importance-sampling-variance-reduction.test.ts` —
  at `p = 1.59109e-4`, brute force needs `6.28e5` draws for 10% relative error,
  31× that test's entire brute-force budget, at a merely `3.6-sigma` event.

## Consequences

**The dashboard's own headline observable is the table's worked example of
choosing wrongly.** The hit probability is an indicator function — a
discontinuity — so QMC, the row with the best rate, is the wrong tool for it,
while the range mean in the section directly above is exactly the smooth,
near-additive observable LHS integrates almost exactly. Two adjacent numbers on
one page want different estimators. That is the case for putting the table in
front of the reader rather than in a document they will not open.

**The table stays honest or it fails.** Renaming an exported entry point,
moving a module, or re-recording a measurement now breaks
`estimator-glossary.test.ts` rather than leaving a plausible paragraph behind.
The cost is that re-recording a golden measurement requires updating the quoted
figure here in the same commit — which is the intended cost, and the same one
§8.4 imposes on golden trajectories.

**This ADR does not wire any sampler into the dashboard, and that is
deliberate.** P6.30 is a documentation task; a sampler selector is a feature
with its own reproducibility questions (LHS needs `N` before it can draw at
all, which the dashboard's cancel-and-resize flow does not currently
guarantee). Filing that is better than smuggling it in here. What ships is the
guidance and the link to it.

**Antithetic variates are not a row.** `generateAntitheticReplicate` (P6.03)
exists and reduces variance, but it is not one of the five the task names and
it is not an alternative to them — it pairs draws within whichever scheme is
already in use. Mentioning it here in prose, rather than adding a sixth row,
keeps the table to methods a reader chooses _between_. The test asserts the
table has exactly the five.

## Alternatives considered

**A prose table in this file alone.** Rejected above: it cannot fail, so it
cannot stay true.

**Generating this ADR from the data module.** Tempting, and it would make drift
impossible rather than merely detectable. Rejected because the ADR carries
argument — the reasoning about why the dashboard's two adjacent numbers want
different estimators is not a table cell — and a generator would either drop
that or need a templating layer larger than the thing it generates. The test
that checks every row appears here gets most of the benefit at none of that
cost.

**Putting the glossary in `runtime` beside P6.29's uncertainty lab.** The lab
is exercise content with a grading path; this is reference data with no
runtime behaviour, and `analysis` is the lowest layer that can see both the
samplers in `engine` and the estimators in `analysis`. Placing it lower keeps
`viz`, `ui` and `app` able to read it without any of them reaching past their
layer.
