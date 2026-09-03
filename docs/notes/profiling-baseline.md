# Profiling baseline (P7.01)

CPU profiles of the two workloads §2.6 budgets: an interactive solve and the
Monte Carlo batch. Regenerate with:

```bash
pnpm bench:profile            # measure and print
pnpm bench:profile --record   # ...and update scripts/profiles/
```

Artifacts, all under `scripts/profiles/`:

| File                           | What it is                                                                |
| ------------------------------ | ------------------------------------------------------------------------- |
| `hotspots.json`                | The report: per workload, self-time ranking and inclusive candidate costs |
| `interactive-solve.cpuprofile` | V8 CPU profile of the interactive workload                                |
| `mc-batch.cpuprofile`          | V8 CPU profile of the batch workload                                      |

The `.cpuprofile` files **are** the flamegraphs. Load either into Chrome
DevTools (Performance → Load profile) or [speedscope](https://speedscope.app);
both render a flame graph from exactly this format. No SVG is committed,
because a generated bitmap that no test can check is a weaker artifact than
the data it was drawn from.

## Why this exists

P6.26 measured the batch at **8370 traj/s** in the development container and
**7917 traj/s** on a GitHub-hosted runner, against §2.6's **1e4**. It also
established that the shortfall is per-trajectory cost rather than scheduling:
one thread does ~2324 traj/s, four ideal threads would be ~9300, and 8370 is
90% of that, so parallel efficiency is fine and adding workers cannot find the
missing 20%.

P0.120 owns closing that gap, and names two **candidate** hotspots — explicitly
as candidates, with an instruction that profiling should come before
optimizing. This is that profiling. **It measures and names. It does not
optimize**; any speed-up is P0.120's, and a profiling run that started changing
the solver would destroy the baseline it exists to establish.

## Environment

Node v22.22.2, linux x64, **4 CPUs**. Sampling interval 200 µs. Batch profiled
at **h = 0.05**, the throughput benchmark's own verdict rung — profiling a step
the budget is not read at would name hotspots of a workload nobody is judged
on.

**Absolute times below include profiler overhead and are not comparable to
`scripts/batch-throughput-results.json`.** The ranking is what this artifact is
for.

## The batch workload — top hotspots

`runMcRange` over the P6.26 benchmark study, single-threaded, observables only.
4000 replicates in 1.80 s of sampled time, 0.45 ms per replicate, 100 distinct
functions.

| Rank | Self % | Function              | What it is                                   |
| ---: | -----: | --------------------- | -------------------------------------------- |
|    1 |  21.5% | `stepExplicitRK`      | The fixed-step RK4 stage loop                |
|    2 |   8.6% | `runIntegrationSteps` | The integrator's outer accept/advance loop   |
|    3 |   8.6% | `norm`                | `vec2.norm`, inside drag force evaluation    |
|    4 |   8.4% | `interpolant`         | Hermite dense output, P0.120's candidate (b) |
|    5 |   6.1% | `step`                | Stepper dispatch                             |
|    6 |   5.7% | `scanStepForEvents`   | Ground-impact event scanning                 |

Top three, as the task's criterion asks: **`stepExplicitRK` (21.5%),
`runIntegrationSteps` (8.6%), `norm` (8.6%)**.

`norm` being hot is not an anomaly worth chasing: it is `vec2.norm` computing
|v| for the drag force, which every RHS evaluation needs, and RK4 evaluates the
RHS four times per step.

> **Correction, 2026-09-03 (P0.120).** The paragraph above is wrong in its
> conclusion, and it is left standing rather than edited away because the way
> it is wrong is the most useful thing in this report.
>
> The call count is right: `vec2.norm` really is reached four times per step,
> and no change to the physics removes that. What the paragraph does not ask is
> whether `vec2.norm` was any good at its job. It was `Math.hypot`, and V8's
> `Math.hypot` scales its arguments by a power of two so that intermediates
> cannot overflow or underflow — protection this model's magnitudes never need,
> at a measured **30.4x** (2e7 evaluations: 1113.6 ms against 36.6 ms for
> `sqrt(x*x + y*y)`). Replacing it took the batch from 9176.95 to 10704.27
> traj/s on this container and met §2.6's budget, which neither of P0.120's own
> two candidates could have done.
>
> **A profile names the function, not the reason it is slow.** "This function
> is called a lot and is intrinsic to the model" and "this function is
> implemented badly" produce the same row in the same ranking, and the first
> reading forecloses the second. `norm` was ranked third by self time in this
> very report and still got written off in a sentence. Rank a hot leaf, then
> read it before concluding it is irreducible.

## The finding that matters: P0.120's candidate (a) is worth ~3%

Self time alone cannot answer P0.120's question, which is why the report also
carries **inclusive (subtree)** time. Candidate (a) is "`runMcReplicate` builds
a model and a context per replicate, so a 40 000-replicate batch builds 40 000
of them" — and almost none of that cost is _in_ `resolveModel`, it is beneath
it. In a self-time ranking it would appear as a dozen small unrelated rows and
rank nowhere. That is exactly how a real hotspot hides, and also how a
suspected one turns out not to be there.

Inclusive time, batch workload:

| Function              | Inclusive % |
| --------------------- | ----------: |
| `integrate`           |       81.1% |
| `generateReplicate`   |       10.5% |
| `resolveModel`        |        2.3% |
| `resolveStepper`      |        0.2% |
| `resolveSolverConfig` |        0.0% |

So:

1. **Candidate (a) is small.** The whole per-replicate resolve path —
   `resolveModel` + `resolveStepper` + `resolveSolverConfig` — is **2.5%**.
   Hoisting it out of the loop entirely, which is the most that optimization
   can win, cannot close a 20% gap. It is worth doing eventually; it is not
   the answer to §2.6.
2. **Candidate (b) is real but bounded.** The Hermite dense output shows up as
   `interpolant` at **8.4%** self time. That is the largest single lever P0.120
   named, and it is still not 20% on its own.
3. **There is a third cost neither candidate anticipated.**
   `generateReplicate` — drawing the replicate's parameter vector from the
   uncertain spec, including schema parsing — is **10.5%** inclusive, over four
   times `resolveModel`. It is the largest non-`integrate` cost in the batch
   and P0.120 does not mention it.
4. **The rest is the integrator itself.** `integrate` is 81.1% inclusive and
   its own stage loop is 21.5% self. Any change that gets the batch from ~8.4e3
   to 1e4 has to come substantially from stepping, not from setup.

## The interactive workload — and why its ranking reads differently

One committed scenario solve as `SimulationSession` runs it, with a
`TrajectoryRecorder`, `StatsCollector` and `EventCollector` attached. 400
iterations, 0.159 ms each, 39 distinct functions.

| Rank | Self % | Function                        |
| ---: | -----: | ------------------------------- |
|    1 |  14.9% | `EmbeddedRKStepper.interpolant` |
|    2 |  11.8% | `(garbage collector)`           |
|    3 |   9.4% | `runIntegrationSteps`           |
|    4 |   6.6% | `brentRoot`                     |

**Do not read these as "where the integrator spends its time."** The default
preset solves with adaptive `rk45` at rtol 1e-6 / atol 1e-9, and a smooth
projectile arc converges to that in about **four accepted steps** — asserted
in `profile-harness-entry.test.ts`. With so few steps, the profile is dominated
by per-solve fixed costs: building the interpolant, localizing the ground
impact through `brentRoot`, and the garbage from a handful of short-lived
buffers. `resolveModel` is **8.1%** inclusive here, against 2.3% in the batch,
for the same reason — the same fixed cost over a much shorter solve.

The interactive path is not where §2.6's CPU budget is at risk. At 0.159 ms a
solve it is far inside a 60 Hz frame, and its profile is recorded as a baseline
to compare against later rather than as a problem.

## What this does and does not establish

- It **does** establish, by measurement, that P0.120's candidate (a) is worth
  about 3% and cannot close the gap on its own; that candidate (b) is worth
  about 8%; and that `generateReplicate` at 10.5% is a third cost neither
  candidate named.
- It **does not** establish what any optimization would actually win. A
  hotspot's share is an upper bound on what removing it saves, and removing it
  is rarely free.
- It **does not** measure a GitHub runner. Both profiles are from the
  development container, which P6.26 measured as the _faster_ of the two
  machines.
- Sampled profiles attribute time statistically. The 1-2% tail of this ranking
  should not be read as precise, and the report keeps 15 rows per workload so
  the tail is visible rather than implied.
