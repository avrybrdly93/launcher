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
