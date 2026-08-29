# Analysis API

<!-- P5.29. Hand-written, unlike docs/physics/, which is generated from the blueprint.
     packages/validation/src/analysis-docs.test.ts asserts that every module
     `@ballista/analysis` re-exports has a section here, and that every symbol named
     below is a real named export of the file it is listed under. -->

`@ballista/analysis` is the optimization and inverse-problem layer: given the forward model
in `@ballista/engine` and the linear algebra and root-finders in `@ballista/solverkit`, it
answers questions of the form _what aim produces this outcome_.

**If you are choosing between solvers, start at [method selection](./method-selection.md).**
That page is the decision table. This page is the index.

The package has one entry point:

```ts
import { newtonShooting, nelderMead, maximizeRange } from "@ballista/analysis";
```

## The forward problem, stated once

Everything here is built on the same residual. `createShootingResidual`
(`shooting-residual.ts`) turns a `ShootingProblem` into a `ResidualFunction` `F(θ, v₀)` —
the vector from where the shot lands to where it was meant to land. Solving is driving `F`
to zero; optimizing is minimizing some functional of the flight.

Two facts about `F` shape every module below, and both are measured rather than assumed:

- Its Jacobian is **rank 1** for any ground-impact shot, because a terminal event at `y = 0`
  pins the vertical residual row to zero for every aim.
- Its solution set is therefore a **curve** in `(θ, v₀)`, not an isolated point. Two arcs —
  low and high — are the generic answer to "what hits this target at this speed".

## Modules

### Problem setup

| Symbol                   | File                   | What it is                                             |
| ------------------------ | ---------------------- | ------------------------------------------------------ |
| `createShootingResidual` | `shooting-residual.ts` | `ShootingProblem` → `F(θ, v₀)`                         |
| `createFlight`           | `shooting-residual.ts` | The flight function the residual wraps                 |
| `residualNorm`           | `shooting-residual.ts` | `‖F‖`, the merit the solvers descend                   |
| `validateTarget`         | `targets.ts`           | Point, ring and platform target validation             |
| `missVector`             | `targets.ts`           | Signed miss against any target type                    |
| `isHit`                  | `targets.ts`           | Hit predicate — not differentiable, hence `nelderMead` |
| `smartInitialAim`        | `smart-init.ts`        | Starting guess from the drag-free closed form          |
| `dragFreeAim`            | `smart-init.ts`        | The closed form itself                                 |

### Derivatives

| Symbol                       | File                        | What it is                                 |
| ---------------------------- | --------------------------- | ------------------------------------------ |
| `shootingJacobian`           | `shooting-jacobian.ts`      | Finite-difference `∂F/∂(θ, v₀)`            |
| `finiteDifferenceStep`       | `shooting-jacobian.ts`      | Step-size selection for the stencil        |
| `createTangentLinearModel`   | `tangent-linear.ts`         | Forward-mode sensitivities through the ODE |
| `rangeSensitivity`           | `tangent-linear.ts`         | `∂R/∂p` by tangent-linear propagation      |
| `createAdjointRangeGradient` | `adjoint-range-gradient.ts` | The same gradient, backward mode           |

Forward mode costs one extra ODE solve per parameter; adjoint costs one backward solve
regardless of parameter count. See [the adjoint notes](../notes/adjoint-sensitivity.md).

### Tolerances

| Symbol                   | File                    | What it is                                       |
| ------------------------ | ----------------------- | ------------------------------------------------ |
| `coupleTolerances`       | `tolerance-coupling.ts` | Inner-IVP tolerances from the outer solver's ask |
| `checkToleranceCoupling` | `tolerance-coupling.ts` | Audits tolerances a caller already has           |

Two nested methods, two sets of tolerances, and nothing in the type system relating
them. A loose inner solve does not make the outer one fail — it makes it converge, in
three iterations, to a residual five orders of magnitude smaller than its true miss.
The rule and that measurement are in
[ADR-017](../adr/ADR-017-inner-outer-tolerance-coupling.md).

### Solving for an aim

| Symbol                 | File                     | What it is                                             |
| ---------------------- | ------------------------ | ------------------------------------------------------ |
| `newtonShooting`       | `newton-shooting.ts`     | Newton with a truncated-SVD minimum-norm step          |
| `minimumNormStep`      | `newton-shooting.ts`     | That step, exposed for inspection                      |
| `levenbergMarquardt`   | `levenberg-marquardt.ts` | Regularized alternative, for near-envelope aims        |
| `shootingWithFallback` | `levenberg-marquardt.ts` | Newton, falling back to LM                             |
| `constrainedShooting`  | `constraints.ts`         | Box bounds by projection or penalty                    |
| `projectAim`           | `constraints.ts`         | Clamp an aim onto the box                              |
| `multiStart`           | `multi-start.ts`         | Scattered starts, deduplicated into distinct solutions |

### Optimization

| Symbol                  | File                | What it is                                       |
| ----------------------- | ------------------- | ------------------------------------------------ |
| `nelderMead`            | `nelder-mead.ts`    | Derivative-free simplex over `n` parameters      |
| `brentMinimize`         | `brent-minimize.ts` | Brent's `localmin` on a bracketed interval       |
| `goldenSectionMinimize` | `brent-minimize.ts` | Golden-section search, same interface            |
| `maximizeRange`         | `optimal-angle.ts`  | `argmax_θ R(θ)` — the answer to the 45° folklore |
| `minimumSpeedToHit`     | `min-energy.ts`     | The slowest aim that still hits                  |
| `robustAim`             | `robust-aim.ts`     | Minimize a risk measure over a wind ensemble     |

### Structure of the solution set

| Symbol                 | File                     | What it is                                                |
| ---------------------- | ------------------------ | --------------------------------------------------------- |
| `solveArcs`            | `arcs.ts`                | Low and high arc, via a located peak and two Brent solves |
| `locatePeakAngle`      | `arcs.ts`                | The peak those brackets are placed around                 |
| `solveRangeRoot`       | `range-root.ts`          | One root of `R(θ) = R*`                                   |
| `solveRangeRoots`      | `range-root.ts`          | Both roots                                                |
| `dragFreeRange`        | `range-root.ts`          | `v₀² sin(2θ)/g`, the reference                            |
| `computeEnvelope`      | `envelope.ts`            | The reachable set's boundary                              |
| `assessReachability`   | `envelope.ts`            | Is this target reachable, and by how much                 |
| `maxHeightAtDownrange` | `envelope.ts`            | Ceiling of the reachable set at a station                 |
| `designTrajectory`     | `trajectory-designer.ts` | Lock two of `(θ, v₀, R)`, solve the third                 |

### Diagnostics

| Symbol                      | File                          | What it is                                    |
| --------------------------- | ----------------------------- | --------------------------------------------- |
| `sweepBasins`               | `basin-of-attraction.ts`      | Which start converges to which arc            |
| `censusOf`                  | `basin-of-attraction.ts`      | Outcome tally over a basin grid               |
| `boundaryFraction`          | `basin-of-attraction.ts`      | How fractal the basin boundary is             |
| `conditioningLevel`         | `ill-conditioning.ts`         | Condition-number banding                      |
| `sweepEnvelopeConditioning` | `ill-conditioning.ts`         | How conditioning degrades toward the envelope |
| `meritLogSlopes`            | `newton-convergence-order.ts` | Observed convergence order of a Newton trace  |
| `finalMeritSlopeRatio`      | `newton-convergence-order.ts` | Quadratic-convergence check                   |

### Reading a trajectory

`observables.ts` holds the pure readouts — `range`, `timeOfFlight`, `impactPoint`,
`impactSpeed`, `apex`, `apexHeight`, `apexTime`, `heightAtDownrange`, `missDistance`. They
take a solved trajectory and a layout (`PLANAR_LAYOUT` or `SPATIAL_LAYOUT`) and do no
solving of their own.

### Reading a trajectory you cannot afford to keep

`observable-sink.ts` computes the same quantities without the trajectory. `ObservableSink`
is a solver `Sink`: attach it in place of a `TrajectoryRecorder` and read `.observables`
once the solve concludes. Its footprint is `O(model.dim)` for the whole solve rather than
`O(steps × channels)`, which is what makes a 1e4-replicate Monte Carlo batch (P6.04,
`runtime`'s `mc-job.ts`) fit in a memory budget. One instance can be reused across solves;
`start` resets it.

It is the same arithmetic as `observables.ts`, not an approximation of it, and the tests
assert agreement with `Object.is` rather than a tolerance. Two caveats carry over
unchanged: the impact observables read the final row, and `status` is `"ok"` for a solve
that merely runs out of `tspan` — so `"ok"` is not a claim that anything landed. `mc-job.ts`
reports a separate per-replicate `landed` flag for that reason.

### Reducing a Monte Carlo batch in a deterministic order

`mc-stats.ts` folds a Monte Carlo batch's per-replicate observables — the `McColumns` a
worker pool produces via `runtime/mc-job.ts` — into per-observable summary statistics, and
does it in **canonical replicate-index order**. IEEE-754 addition is not associative, so
without that discipline the same batch would produce different LSBs depending on which
worker finished first, and any reproducibility check that hashed the numbers
(P6.27) would show drift that was only scheduling jitter (P6.05).

The pipeline is two steps and a hash:

| Symbol              | File          | Meaning                                                                       |
| ------------------- | ------------- | ----------------------------------------------------------------------------- |
| `assembleMcColumns` | `mc-stats.ts` | Copy each worker chunk into its global slice; reject overlaps and gaps        |
| `mcStats`           | `mc-stats.ts` | Walk the assembled buffer index 0 → N-1, sum landed replicates per observable |
| `hashMcStats`       | `mc-stats.ts` | 64-bit splitmix64 fold of the full stats, so equality is checkable            |

Non-landing replicates (`landed === 0`) count toward `count` and `landedCount` but
contribute to no observable sum — a truncated flight's "impact" is wherever it happened
to be at the horizon, and averaging that in silently biases every estimator.

### Streaming moments and quantiles

`streaming-moments.ts` supplies the single-pass, O(1)-storage estimators `mcStats` uses for
its `mean` and `variance` fields, and that P6.10's per-time-grid quantile bands will use over
a batch that is not retained (P6.06).

| Symbol                | File                   | Meaning                                                                                                  |
| --------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `WelfordAccumulator`  | `streaming-moments.ts` | Running mean and variance by Welford's recurrence, with a Chan/Golub/LeVeque `merge` for parallel chunks |
| `welfordMoments`      | `streaming-moments.ts` | One-pass mean and variance of an array, the convenience wrapper                                          |
| `P2QuantileEstimator` | `streaming-moments.ts` | Jain & Chlamtac P² estimator of one quantile from five markers, no sample kept                           |
| `p2Quantiles`         | `streaming-moments.ts` | Several quantiles of a stream in one pass                                                                |
| `exactQuantile`       | `streaming-moments.ts` | The sorted answer (numpy's `linear` convention), for grading the estimators                              |

Welford is used over the one-line `(sumSquares − sum²/n)/(n−1)` because that derivation
cancels catastrophically when the mean dwarfs the spread — an impact-speed column near
30 m/s with a 0.05 m/s spread loses five leading digits before the subtraction begins. The
estimators are order-dependent by construction; `mc-stats.ts` feeds them canonical index
order, and `merge` is deliberately not bit-identical to sequential pushing, so chunks must be
merged in a fixed order for reproducibility. The P6.06 criterion — mean/variance to `1e-10`
and quantiles to ±0.5% against offline numpy — is checked in
`packages/validation/src/mc-moments-numpy.test.ts` against a committed fixture.

### Measuring the Monte Carlo convergence rate

`mc-convergence.ts` answers whether an estimated mean's standard error really falls as
`N^{−1/2}` (P6.07). For iid samples of finite variance `Var(mean of N) = σ²/N` _exactly_ —
no CLT argument and no large-`N` limit — so the law is testable at batch sizes as small as 16. What is actually under test is the premise rather than the algebra: correlated
replicates (a reused substream, a seeding scheme that aligns) still produce a mean and a
plausible spread, but that spread stops shrinking at the Monte Carlo rate.

| Symbol                | File                | Meaning                                                                     |
| --------------------- | ------------------- | --------------------------------------------------------------------------- |
| `mcConvergenceStudy`  | `mc-convergence.ts` | Re-partition a pool into disjoint batches at each size; fit log SE vs log N |
| `sampleStdDev`        | `mc-convergence.ts` | Two-pass Bessel-corrected sample standard deviation                         |
| `standardErrorOfMean` | `mc-convergence.ts` | The derived `s/√n`, for callers reporting one batch's estimate              |

**The standard error is measured across batches, not derived within one.** Reporting
`s/√N` from a single batch cannot detect a violation, because it assumes the `1/√N` law in
the act of applying it — on perfectly correlated draws it returns a flawless −0.5. So the
pool is split into disjoint batches of size `N` and the sample standard deviation _across
the batch means_ is what the slope is fitted to. Each point still carries the derived value
as `predictedStandardError` for comparison; the two agree on iid input and part company
when independence fails, which is asserted both ways.

Batch sizes re-partition one pool rather than each drawing fresh replicates: that costs `M`
integrations instead of `Σ Kᵢ·Nᵢ` for the same precision, and correlates the standard-error
estimates across sizes — which moves the fitted line up or down but not its slope — while
batches within any one size stay disjoint and independent.

The P6.07 criterion — log–log slope of −0.50 ± 0.05 — is measured on the real range
observable in `packages/runtime/src/mc-convergence-range.test.ts`, since `analysis` may not
import `runtime`. That test excludes replicates that never landed (their "impact" is
wherever the horizon caught them) and asserts none were lost, so a batch of `N` holds `N`
samples. Nothing in it is random: replicate `i` is a pure function of seed and index
(P6.03), so the slope is a fixed number rather than a draw and the test cannot flake.

### Confidence bands on an estimate

`confidence-interval.ts` turns a Monte Carlo sample into `mean ± t·SE` and carries the `n`
that produced it (P6.08).

| Symbol                         | File                     | Meaning                                                 |
| ------------------------------ | ------------------------ | ------------------------------------------------------- |
| `meanConfidenceInterval`       | `confidence-interval.ts` | Two-sided `t` interval for a mean, with `n` and `df`    |
| `formatMeanConfidenceInterval` | `confidence-interval.ts` | Renders `91.78 ± 3.06 m (95% CI, n = 64)`               |
| `coverageOfMean`               | `confidence-interval.ts` | How often an interval contains a known truth            |
| `studentTQuantile`             | `confidence-interval.ts` | Inverse Student-t, by guarded Newton in the upper tail  |
| `studentTCdf`                  | `confidence-interval.ts` | Student-t cumulative distribution function              |
| `studentTUpperTail`            | `confidence-interval.ts` | `P(T > t)`, computed as itself rather than as `1 − cdf` |

**Why `t` and not `z`.** The multiplier has to account for `SE` being estimated from the
same sample it describes. Using `z = 1.96` pretends the per-replicate `σ` was known in
advance. At the sample sizes an interactive run actually uses the difference is not
academic: at `n = 5` the 95% multiplier is `2.776`, so a `z` band is 29% too narrow and
covers about 88% of the time instead of 95%.

**"Displayed honestly with `N`" is a property of the value, not of the chart.** `± 3.1 m`
means something different from 8 replicates than from 8000, and a reader cannot tell which
without being told. So the interval carries `sampleSize`, `degreesOfFreedom` and `level`
alongside the bounds, and there is no formatting option that omits `n`.

`meanConfidenceInterval` returns `null` below two samples rather than a zero-width
interval, which would read as infinite precision. A genuinely degenerate sample — every
value identical — does give a zero-width interval, because the estimated variance really
is zero.

The P6.08 criterion — a 95% interval covering the truth about 95% of the time over 200
repeats — is measured in `packages/runtime/src/mc-confidence-coverage.test.ts`. The truth
it covers is exact rather than estimated: drag-free ground-launch range is `2·vx₀·vy₀/g`,
which is _bilinear_, so under independent jitter on the two components
`E[range] = 2·E[vx₀]·E[vy₀]/g` holds with no linearisation and no CLT appeal. The
independence is what P6.03's substream-per-pair generator supplies.

Coverage is a proportion, so any assertion on it has to be written against the binomial
spread rather than against `0.95` directly — `CoverageResult.standardError` reports that
scale (`0.0154` at 200 repeats), and a run landing on `0.94` is a third of a sigma away and
evidence of nothing.

### Quantile envelope bands over time

`ensemble-fan.ts` puts an ensemble of adaptively-integrated trajectories onto one time grid
and reduces each grid point to its quantiles (P6.10). Nothing here draws; P6.20 and P6.24
render the arrays.

| Symbol               | File              | Meaning                                                        |
| -------------------- | ----------------- | -------------------------------------------------------------- |
| `buildEnsembleFan`   | `ensemble-fan.ts` | Per-grid-point quantile bands, with the count behind each      |
| `resampleOnGrid`     | `ensemble-fan.ts` | One trajectory onto a common grid, by cubic Hermite            |
| `buildCommonGrid`    | `ensemble-fan.ts` | Uniform grid spanning the union of the ensemble's flights      |
| `quantileOfSorted`   | `ensemble-fan.ts` | Type-7 quantile of a sorted sample, linear between order stats |
| `DEFAULT_FAN_LEVELS` | `ensemble-fan.ts` | The 5/25/50/75/95% levels the fan chart is named for           |

**The resampling really is dense output.** A `Trajectory` holds accepted steps only, so
reading a value between two of them means interpolating, and linear interpolation is
second-order — it would throw away three orders of the accuracy a DOPRI5 solve was paid
for, invisibly, since the result still looks like a trajectory. Instead the caller names a
**derivative channel** and gets cubic Hermite from the two endpoint values and the two
endpoint slopes, the same interpolant `HermiteDenseOutputStepper` builds inside the solver.
For a ballistic state that channel is already recorded: `dx/dt` is `vx` and `dy/dt` is `vy`.
That is a property of this model family rather than a general fact, which is why the
channel is an argument and not a guess — a wrong one produces a smooth, plausible curve
that is not the solution, and the honest linear fallback is better than that.

**Nesting is structural.** Every level is read from the same sorted column through a
level-to-index map that is non-decreasing in `p`, so `q05 ≤ q25 ≤ q50 ≤ q75 ≤ q95` holds by
construction and nothing clamps or repairs the output — a repair would hide the only kind
of bug that could produce a crossing. The tests assert it on real ensembles anyway, over
twenty-one levels rather than only the five the task names.

**A band past the first impact means something different.** Replicates end at different
times, so the ensemble thins and a late quantile is conditional on the replicate still
being airborne. `EnsembleFan` therefore carries `sampleCount` per grid point and
`commonSupportEnd`, the last time every replicate still contributed — the same commitment
P6.08 made for confidence intervals. A grid time outside a replicate's own span resamples
to `NaN` rather than to a clamped endpoint, because repeating an impact point across the
rest of the grid would draw a projectile resting on the ground and drag the quantiles
towards it.

### Hit probability against a target

`hit-probability.ts` reduces an ensemble of impact points to "how often did we hit, and
how sure are we?" (P6.11). Each point is scored through `targets.ts`'s `isHit`, so the hit
criterion is the target's own geometry and tolerance and there is no second definition of
a hit anywhere in the package.

| Symbol                          | File                 | Meaning                                                    |
| ------------------------------- | -------------------- | ---------------------------------------------------------- |
| `hitProbability`                | `hit-probability.ts` | Score an ensemble against a `Target`; counts plus interval |
| `wilsonInterval`                | `hit-probability.ts` | Wilson score interval for a binomial proportion            |
| `formatHitProbability`          | `hit-probability.ts` | Renders `35.0% [18.1%, 56.7%] at 95% (7/20)`               |
| `DEFAULT_HIT_PROBABILITY_LEVEL` | `hit-probability.ts` | 95%, matching `confidence-interval.ts`'s default           |

**Wilson, not Wald, and the reason is the endpoints.** The textbook interval
`p̂ ± z·√(p̂(1−p̂)/n)` has width proportional to `√(p̂(1−p̂))`, so at `p̂ = 0` or `p̂ = 1` it
collapses to _exactly zero_ — 0 hits in 20 shots reports "0, ± 0", claiming certainty from
twenty observations, and it routinely puts bounds outside `[0, 1]` besides. A hit
probability is a quantity that lives near its endpoints: a tight ring at long range is
missed every time until it isn't, and an over-wide tolerance is hit every time. The two
configurations a user is most likely to try are precisely the two Wald cannot report on.
Wilson inverts the score test instead of evaluating the standard error at `p̂`, so it keeps
non-zero width there, stays inside `[0, 1]` by construction rather than by clamping, and
holds its coverage at small `n`. That last claim is measured against a seeded binomial
simulation, not asserted — including a direct comparison in which Wald under-covers at
`p = 0.05, n = 40`.

**The interval is not centred on `p̂`.** Wilson's centre is `(k + z²/2)/(n + z²)`, the count
shrunk toward `1/2` by `z²/2` pseudo-counts a side, so the interval is asymmetric about the
point estimate — most visibly near the endpoints, which is where it should be. `pHat` and
`center` are therefore separate fields, and a plotting layer that draws a symmetric error
bar around `p̂` from these numbers is drawing something the module did not say.

**Endpoints are exact.** At `k = n` the analytic upper bound is `denom/denom = 1`, but the
rounded sum lands one ulp low at `0.9999999999999999`. One ulp is numerically irrelevant
and semantically not — "every shot hit, so the bound is 1" is a thing a caller may test
for — so `0` and `1` are returned exactly, and a test asserts the far bound is still
strictly interior so that exactness cannot have been bought by collapsing the interval.

**Two things the arithmetic cannot check, so the caller carries them.** A `NaN` impact
_throws_ rather than scoring as a miss: a diverged solve is not evidence about where the
shot landed, and counting it would bias `p̂` downward by exactly the failure rate,
invisibly. And every interval assumes independent Bernoulli trials with a common `p` —
true for replicates on ADR-011's independent substreams, false for an ensemble sharing one
frozen wind path or sweeping a parameter grid. Nothing in the formula can detect the
difference, and the error is toward an interval that is too narrow.

### Estimating a mean with a control variate

`control-variate.ts` estimates `E[Y]` using a cheap, correlated quantity whose mean is
known exactly (P6.13). The estimator is `Ŷ_cv = ȳ − c(x̄ − E[X])`, and the control the
blueprint names is the drag-free analytic range — cheap, correlated, exact mean.

| Symbol                         | File                 | Meaning                                                                  |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------ |
| `controlVariateMean`           | `control-variate.ts` | Estimate with a control; reports the reduction factor and both SEs       |
| `dragFreeRangeControlMean`     | `control-variate.ts` | `E[dragFreeRange]` for a normal `v₀` — the exact control mean            |
| `formatControlVariateEstimate` | `control-variate.ts` | Renders `138.9 ± 0.2 (plain 142.8 ± 4.9), factor 0.001, rho 0.999, n=64` |

**The reduction factor is an output, not a decoration.** `1 − ρ²` is the entire story of
whether a control was worth using: at `ρ = 0.9` it removes 81% of the estimator variance,
at `ρ = 0.3` it removes 9% and is not worth the plumbing. An estimate that arrives without
its factor and its plain counterpart cannot be checked, only believed — so
`ControlVariateEstimate` carries the plain mean and both standard errors beside its own.
The factor is computed from the general `Var(ȳ) − 2c·Cov + c²Var` form rather than the
`c*` one, so a caller-supplied `c` that is hurting reports a factor **above 1** rather
than being clamped to look harmless.

**`c` decides precision, never correctness.** `E[x̄ − E[X]] = 0`, so the estimator is
unbiased for _any_ fixed `c`. The default `ĉ = Cov/Var` is estimated from the same sample
and is therefore correlated with `x̄`, which biases the result at `O(1/N)`. That bias is
measured, not asserted: it resolves at more than five standard errors once a few thousand
studies are pooled, and `N × bias` holds constant across an 8× span of `N`. It stays the
default because at `N = 64` it is ~17% of a _single study's_ standard deviation — invisible
in any real run — and shrinks faster than the `O(N^{−1/2})` standard error, so it never
becomes the binding error term. Pass `coefficient` (from a pilot run) for an estimator
whose unbiasedness is exact.

**The dangerous input is a wrong control mean, and it fails silently.** A mean wrong by `d`
shifts the estimate by exactly `c·d` and leaves the standard error bit-identical — nothing
in the output says the answer moved. This is why `dragFreeRangeControlMean` carries
`E[v₀²] = μ² + σ²` and not `μ²`: dropping the `σ²` term understates the control mean by
2.2% of the range at `μ = 40, σ = 6`, many standard errors' worth of shift hidden inside an
interval that never widens. Both the shift and its invisibility are asserted in
`control-variate-variance-reduction.test.ts`.

### Latin hypercube sampling

`latin-hypercube.ts` (in `@ballista/engine`) is an alternative way to draw a study's
replicates (P6.14). Plain Monte Carlo leaves random gaps and clumps in its coverage of
`(0, 1)`; a Latin hypercube splits each dimension into `N` equal-probability strata, takes
exactly one sample from each, and permutes the stratum-to-replicate assignment
independently per dimension.

These live in `@ballista/engine`, not in this package, so they are listed rather than
tabulated — a table on this page means an `@ballista/analysis` module, and
`analysis-docs.test.ts` reads the second column of every one as a filename.

- `latinHypercubeReplicates` — generator over the whole study; the drop-in for `replicates`
- `generateLatinHypercubeReplicate` — one replicate by index
- `latinHypercubeStratum` — which stratum a `(replicate, dimension)` pair occupies
- `latinHypercubeUniform` — that stratum's jittered uniform, before the quantile map
- `distributionQuantile` — the inverse CDF the stratified uniform is pushed through

**It is an option, and the choice is about structure, not smoothness.** LHS stratifies
one-dimensional projections, so it removes the variance carried by an observable's main
effects and leaves its interaction variance alone. Measured on the drag-free range at
`N = 64` over 400 studies: standard error **6.037 m → 0.410 m**, a ratio of **0.068**
(216× in variance), because range is `v₀²` and so almost perfectly additive in the one
drawn dimension. On a pure interaction `(a − E a)(b − E b)` over two independent draws the
ratio is **1.10** — no gain and a slight cost. Both are measured in
`latin-hypercube-variance-reduction.test.ts`.

**Changing `replicates` changes every replicate.** The strata are `1/N` wide, so an LHS
study cannot be refined incrementally the way an MC one can — there is no Latin hypercube
that is also a prefix of a larger one. A convergence study that sweeps `N` is measuring a
sequence of unrelated designs. This is inherent to the method, and it is the main reason
LHS is not the default.

**The permutation is never materialised.** P6.03 makes replicate `i` a pure function of the
seed and the index, which is what gives batch-partition independence; a Fisher–Yates
permutation would cost `O(N)` to answer for one replicate and would be unavailable to a
worker that knows only its own range. A keyed Feistel network plus cycle walking gives the
same permutation pointwise in `O(1)`. A Feistel network is a bijection whatever its round
function does, which is the guarantee that matters — "exactly one replicate per stratum" is
the whole content of _Latin_, and a hash reduced mod `N` would collide and quietly degrade
to stratified sampling with replacement.

**The jitter inside each stratum is not decoration.** Placing samples at stratum midpoints
would give lower variance and a biased estimator: a quadrature rule wearing a Monte Carlo
costume, whose sample spread no longer estimates anything.

### Quasi-Monte Carlo: a scrambled Sobol' sequence

`sobol.ts` (in `@ballista/engine`) is the fourth way to draw a study's replicates (P6.15),
and the one that changes the _rate_ rather than the constant. Plain Monte Carlo's standard
error falls as `N^(-1/2)` whatever the integrand; a low-discrepancy sequence gives that up
in exchange for points constructed to fill the unit cube evenly at every scale, and for an
integrand of bounded variation the Koksma–Hlawka inequality turns that into an error
bounded by the sequence's discrepancy.

These live in `@ballista/engine`, so they are listed rather than tabulated, for the same
reason as the Latin hypercube entries above.

- `sobolReplicates` — generator over the whole study; the drop-in for `replicates`
- `generateSobolReplicate` — one replicate by index
- `sobolUniform` — the scrambled coordinate for a `(replicate, dimension)` pair, before the
  quantile map
- `sobolInteger` — the raw, unscrambled Sobol' coordinate as a 32-bit integer
- `nestedUniformScramble` — the Owen-style digit scramble, exposed because it is the part
  worth testing directly

**Measured, on a smooth two-parameter problem with a closed-form mean** (drag-free range
over a uniform speed and a uniform angle, `N = 64 … 8192`, RMSE over 24 independent
scramble seeds): slope **−1.4598** against plain MC's **−0.4522**, and at `N = 8192` an
RMSE of **9.557e-5** against MC's **4.994e-1** — better by a factor of **5200**. See
`sobol-convergence.test.ts`.

**The slope is steeper than `N^(-1)` because the scramble is nested, and that is
checkable.** Owen (1997) gives `O(N^(-3/2))` RMSE for a smooth integrand under nested
uniform scrambling against `O(N^(-1))` for a plain digital shift. Five independent seed
families measure −1.4598, −1.3749, −1.3648, −1.4044, −1.3888; the same points under an XOR
shift measure −1.0297. The test asserts −1.2 for exactly that reason: replacing the nested
scramble with a shift is the obvious simplification, and it would leave every structural
test passing.

**Scrambling is not optional.** An unscrambled Sobol' sequence is a quadrature rule, not a
Monte Carlo estimator: its error is a fixed number with no distribution, so the standard
errors of P6.07 and the confidence bands of P6.09 would be reporting a quantity that does
not exist. A nested uniform scramble restores unbiasedness while preserving the
stratification, because a permutation of digit `k` that depends only on digits `1..k-1`
maps every elementary interval onto another of the same size.

**Unlike a Latin hypercube, a Sobol' study is extensible in `N`.** Point `i` depends on `i`
and the scramble key, not on the replicate count, so the first `N` points of a longer study
are the same points and an estimator can be refined by appending replicates. That makes
this the sampler to reach for under a convergence sweep or a progressive display (P6.25),
where LHS is comparing unrelated designs.

**The advantage decays with dimension, and dies on a discontinuity.** Measured on an
indicator observable — unbounded variation in the Hardy–Krause sense — the slope is
**−0.7834**: still better than plain MC, nowhere near the smooth case. The direction-number
table covers 21 dimensions, which is far more than the QMC advantage survives.

### Stochastic wind: shared or per-replicate

The four entries above are about how a study draws its _parameters_. A study whose base
scenario carries a frozen-OU gust field has a second source of randomness, and
`UncertainScenarioSpec.windReplication` says what to do with it (P6.16, [ADR-011](../adr/ADR-011-frozen-stochastic-realizations.md)).

- **`"shared"`** (the default) — every replicate integrates the base scenario's one frozen
  path. For a study whose uncertainty is in the parameters.
- **`"per-replicate"`** — replicate `i` gets its own path, seeded by
  `replicateWindSeed(studySeed, i)`. For a study in which the turbulence realization is
  itself one of the uncertain inputs.

**`"shared"` is the default, and it is not a limitation.** It is common random numbers:
holding the gust field fixed while the parameters vary is what makes a difference between
two replicates attributable to the parameters, which is what a finite-difference
sensitivity (P6.17) needs. Under `"per-replicate"` the same two replicates differ in their
parameters _and_ their weather, and the difference no longer isolates anything.

**Why a seed is the whole mechanism.** ADR-011 resolves stochastic wind into a frozen,
PCHIP-interpolated path _before_ integration, so the scenario's `seed` is the only input
the wind depends on. Giving a replicate its own realization is therefore giving it its own
`seed` — no SDE solver, no second RNG discipline, and the determinism contract carries over
unchanged.

**The seed comes from a reserved substream slot**, `WIND_OVERLAY_INDEX`, which no overlay
can be assigned. So switching the option on changes the wind and nothing else: the drawn
parameter vectors are identical either way. It is the top slot rather than slot 0 so that
overlay `j` keeps the stream it had before P6.16, and every study written earlier
reproduces value-for-value.

**A study that asks for a realization it cannot get is refused at parse time.** On any
non-stochastic wind kind the per-replicate seed would change nothing, and the study would
still run, still report `N` replicates, and hand back parameter scatter looking exactly like
turbulence spread. The schema also refuses a study that varies `seed` through an overlay
_and_ sets `"per-replicate"`, since both write the same field.

**Antithetic pairs share one wind.** A seed has no distribution to reflect about, so
"the opposite gust field" is not a thing; sharing it also keeps a pair's variance reduction
attributable to the mirrored parameters. See `stochastic-wind-replicates.test.ts`.

## Conventions

- **Angles are radians** throughout the API. Degrees appear only in UI and docs.
- **Every solver returns a status**, and none of them throw on non-convergence. A result
  whose status is not `converged` still carries the best point found; it is simply not
  certified. Check the status.
- **Symplectic integrators are for conservative dynamics only.** Every path here that
  includes drag uses a standard RK scheme. See
  [method selection](./method-selection.md#two-rules-that-are-not-negotiable).

## See also

- [Method selection](./method-selection.md) — Newton vs Nelder–Mead vs Levenberg–Marquardt
- [Adjoint sensitivity notes](../notes/adjoint-sensitivity.md)
- [Physics reference](../physics/README.md) — the forward model being inverted
