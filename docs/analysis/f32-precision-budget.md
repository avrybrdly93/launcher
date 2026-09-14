# The f32 GPU path: error budget per scenario class

<!-- P7.17. Every number on this page is produced by
     packages/runtime/src/planar-precision-results.test.ts and recorded in
     planar-precision-results.json beside it. That test re-derives each verdict
     from the recorded numbers rather than reading the verdict column, so a row
     edited here or there to say something friendlier fails the suite.
     Re-record with `pnpm update:precision-study`. -->

The ensemble path runs the planar RK4 march and its observable reduction on the GPU in
**binary32**. The rest of the engine is binary64 (ADR-014). This page is the decision
procedure for when that swap is safe, and it is built on measurement rather than on the
usual intuition about float widths — which, as the first table shows, gets this wrong.

**The short version.** f32 adequacy here is a property of the **march**, not of the
physics. The error accumulates with step count, so the scenarios at risk are the ones
that take many steps: long flights, over-refined steps, and stiff dynamics — in that
order of surprise. Stiffness matters only because it is the one case where the caller
**cannot** choose a coarser march.

## What is being compared, and why it is only one variable

Both arms are **the same reduction over the same fixed-step march**, differing only in the
rounding function. So a disagreement is attributable to arithmetic width and to nothing
else. Comparing instead against `@ballista/analysis`'s adaptive, event-localised f64
observables would move width, step policy and event handling at once, and a gap would be a
statement about how three errors combined rather than a budget.

The f32 arm is the **CPU** f32 reduction. It stands in for the device on P7.16's measured
result — the WGSL reduction reproduced it at **0 ULP across 50 000 values and 10 000
trajectories** on a real adapter — not on an assumption. The limit of that licence is
carried in the data: rows flagged `withinP716Family: false` extend it past the ensemble it
was measured over, and the f32-vs-f64 half of those rows still stands while the "and the
GPU does exactly this" half weakens.

The budget is **1e-5 relative**. Apex height and range feed range tables, aim solves and
envelope plots; 1e-5 is a centimetre on a kilometre, well inside the modelling error of a
constant-Cd, constant-density model, and about two orders of magnitude above the ~1e-7
floor a short march actually reaches. A budget at the floor would restate the machine
epsilon; one far above it would certify visibly wrong answers.

## The classes, and where "stiff" comes from

Classes are `@ballista/engine`'s own `RegimeTag` vocabulary, not a fresh taxonomy. For
quadratic drag its two classifiers are the same number twice: the advisor's stiffness ratio
is `v0 / (g·τ)` with `τ = v0 / (2·g·Π)`, so

```
ratio = v0 / (g · v0/(2·g·Π)) = 2·Π
```

and `recommendSolver`'s threshold of `ratio > 50` is exactly **Π > 25**. The stiff row is
built on that identity and a test asserts the collapse, so "stiff" here means what the
advisor means by it.

## Table 1 — the classes at a common step, h = 1e-3

| Scenario              | Class     | Π      | ratio  | steps | worst rel. | channel | Verdict      |
| --------------------- | --------- | ------ | ------ | ----- | ---------- | ------- | ------------ |
| `vacuum-45deg`        | low-Π     | 0      | 0      | 6000  | **6.3e-5** | range   | **cpu-only** |
| `shot-put`            | low-Π     | 9.7e-3 | 1.9e-2 | 4000  | 3.4e-6     | apexT   | f32-ok       |
| `table-tennis`        | high-Π    | 8.5    | 1.7e1  | 6000  | 2.4e-6     | apexT   | f32-ok       |
| `table-tennis-cannon` | **stiff** | 2.7e2  | 5.4e2  | 6000  | **2.8e-5** | apexT   | **cpu-only** |

**Read the first row before the last one.** The worst scenario in the study is the
**drag-free** one. It has no stiffness, no drag and the simplest dynamics available, and it
misses the budget by more than twice what the stiff row does — because it has the longest
flight (4.33 s, ~4300 steps to impact) and therefore the most steps over which to
accumulate rounding. Anyone reaching for f64 because a scenario "looks hard" is reading the
wrong signal.

## What actually governs the error

Not the regime. The error is set by how many steps the march takes, and by whether the
binary32 clock can still resolve a step at the time the march has reached — `ulp32(t)/h`.

This is measurable directly, because the dynamics are **autonomous**: nothing in the planar
model reads `t`, so shifting the time origin changes the representation of time and nothing
physical. Shifting `t0` to 65536, where `ulp32(t)` is about 7.8 steps wide:

- the f64 arm is unchanged, which is what makes this a control rather than a second measurement;
- the f32 arm **stops detecting the ground crossing altogether** — `impacted: false`, `range: 0`;
- it does not throw and it does not return `NaN`. A caller reading `range` gets a plausible zero.

Two operational consequences, and the second is counter-intuitive:

- **Keep flight clocks near zero.** A march that starts at a large `t` spends its budget on
  representing the clock. This is the one failure mode here that is silent.
- **Do not over-refine.** Quartering the step and quadrupling the count makes the f32 answer
  **worse**, because the rounding accumulated over the extra steps outgrows the truncation
  error the smaller step removes. Refining is the instinctive response to a result that
  looks wrong, and in f32 it is the wrong move.

## Table 2 — where f32 runs out, marched at the stability limit

Stiffness earns its own table because it is the one class whose march the caller does not
control. An explicit method is unstable above roughly `2.78·τ`, so that is the **coarsest**
step available, hence the fewest steps, hence the **best f32 accuracy obtainable for that
scenario**. A ratio that misses the budget here misses it unconditionally — there is no
other step the caller could have chosen.

Launch speed is swept so Π (and therefore the ratio) moves over six decades without a single
property of the projectile changing, which isolates the regime from everything else.

| v₀ (m/s) | ratio | τ (s)  | h = 2.78τ | steps | worst rel. | Meets budget |
| -------- | ----- | ------ | --------- | ----- | ---------- | ------------ |
| 25       | 1.7e1 | 1.5e-1 | 4.2e-1    | 256   | 1.4e-7     | yes          |
| 100      | 2.7e2 | 3.7e-2 | 1.0e-1    | 256   | 2.9e-7     | yes          |
| 400      | 4.4e3 | 9.3e-3 | 2.6e-2    | 256   | 6.1e-7     | yes          |
| 1600     | 7.0e4 | 2.3e-3 | 6.5e-3    | 1024  | 1.2e-5     | **no**       |
| 6400     | 1.1e6 | 5.8e-4 | 1.6e-3    | 4096  | 3.2e-5     | **no**       |
| 25600    | 1.8e7 | 1.5e-4 | 4.1e-4    | 16384 | 2.7e-4     | **no**       |

**The boundary is between ratio 4.4e3 and 7.0e4.** Below it f32 meets the budget at the
stability limit; above it, no step choice will.

So `stiff` on its own does **not** mean CPU-only — the advisor's threshold is 50, and the
boundary measured here is three decades higher. `table-tennis-cannon` (ratio 5.4e2) misses
the budget at h = 1e-3 in Table 1 and **passes** at its stability limit. The honest rule:

> **Use the CPU for a stiff scenario whose ratio exceeds ~1e4, and for any scenario whose
> required step count exceeds a few thousand. Everything else may use the f32 GPU path.**

## Model coverage: two classes that do not run here at all

Distinct from a precision verdict, and kept distinct, because "f32 is not accurate enough"
and "this cannot be run in any precision" are different statements and only the first is a
budget.

| Regime tag     | Why the kernel cannot express it                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `magnus`       | `PlanarDragParams` carries mass, area, cd, rho, g, windX, windY — and no spin channel. Outside the kernel's **model**, not outside f32's reach. |
| `stiff/stokes` | The library's canonical stiff preset, `dust-grain`, is **linear Stokes** drag. The kernel's drag is quadratic with a constant Cd.               |

The second is the more consequential, and it is why "stiff" cannot be certified for the GPU
path as a class: the one stiff scenario the library actually ships cannot run on it at all.
The stiff row in Table 1 is a quadratic-drag scenario placed past the advisor's threshold —
a real stiff scenario by the repo's own definition, but not that preset.

## What this page does not say

No timing, throughput or bandwidth figure appears anywhere above, and the recorded results
are checked for their absence. P7.17 is about error. Whether the f32 path is _worth_ taking
where it is _allowed_ is a cost question, it needs hardware this container does not have,
and it belongs to P7.20.
