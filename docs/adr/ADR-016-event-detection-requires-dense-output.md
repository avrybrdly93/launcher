# ADR-016: Event Detection Without Dense Output — Why the Two Obvious Fixes Are Both Wrong

**Status:** Accepted (114th run, 2026-09-20) — superseding the "Decision: none yet" this ADR carried from the 27th run. The rejections below stand as written and are the reason the accepted option looks the way it does.
**Date:** 2026-08-16

## Context

`integrate()` gates its whole event block on a single expression
(`packages/solverkit/src/integrate.ts`):

```ts
const hasEvents = events !== undefined && events.length > 0 && stepper.interpolant !== undefined;
```

The third conjunct is the problem. Root localization genuinely needs dense
output — `scanStepForEvents` samples $g$ inside the step and
`localizeEventRoot` brackets the sign change on the interpolant — so a
stepper without one cannot locate an event. But the consequence of that
conjunct is that a model _declaring_ events, integrated with a stepper
_without_ an interpolant, silently integrates as if it had declared none.
No warning, no failure, no diagnostic on the report.

Every fixed-step stepper in the package is in that category:
`ClassicalRK4Stepper`, explicit and semi-implicit Euler, Heun, midpoint,
SDIRK2, backward Euler, and the symplectic steppers. Only
`createDormandPrince54Stepper` (its own interpolant, P2.30) and anything
wrapped in `HermiteDenseOutputStepper` (P2.31) expose one.

Measured on the 27th run, both at `h = 0.12` over `tspan = [0, 12]`, same
drag-free planar model with a terminal ground impact and
`y0 = [0, 5, 3, 0]`:

| stepper                          | `tFinal`           | `yFinal[1]`   | events | `status` |
| -------------------------------- | ------------------ | ------------- | ------ | -------- |
| `createDormandPrince54Stepper()` | 1.0098099885512761 | 1.0e-15       | 1      | `ok`     |
| `new ClassicalRK4Stepper()`      | 12                 | **−701.0788** | **0**  | **`ok`** |

The projectile falls 701 m through the ground and the solve reports success.
This is the same shape of defect as P0.97 — a wrong answer with `ok: true`
and no error — and reaching it needs only a stepper choice, not an unusual
input. It reproduces identically on explicit Euler, Heun and midpoint.

## Decision

**`SolverConfig.events`: an explicit tri-state with no default.** Accepted on
the 114th run; P0.99 is closed.

```ts
readonly events?: "off" | "require";
```

Consulted only when the model declares at least one event — a model declaring
none is inert under all three states, which is asserted directly rather than
assumed.

| `cfg.events` | stepper has an interpolant | stepper has none                          |
| ------------ | -------------------------- | ----------------------------------------- |
| unset        | events armed (as before)   | **throws at init**, naming every way out  |
| `"off"`      | not armed                  | not armed — the old behaviour, on request |
| `"require"`  | armed, nothing wrapped     | armed via `HermiteDenseOutputStepper`     |

This is the first sketch under "What the real fix has to do", made total. The
reason it is not simply that sketch is the default: the sketch offered
`"require"` as the default with every study updated to say `"off"`, and that
is the 88-failure throw under another name. **Having no default is what makes
the throw narrow.** It fires only where the two intents are genuinely
indistinguishable from the signature — model declares events, stepper cannot
localize them, caller has said nothing — and that is exactly the
configuration whose silence was the bug. Everywhere else, behaviour is
unchanged.

`"require"` auto-wraps, which this ADR rejected two sections below. The
objection was that auto-wrapping **silently changes measurements the caller
never asked to change**; it does not apply to a wrap the caller asked for by
name. The 114th run additionally pinned the wrap as _bit-identical_ to the
hand-written `new HermiteDenseOutputStepper(new ClassicalRK4Stepper())`
workaround — same state, same `nRHS`, same `nSteps` — so `"require"` is that
documented workaround spelled in configuration, not a second implementation
of it.

### What it cost, measured

Twenty call sites, every one of them a fixed-step study over a fixed span,
every one annotated `"off"`. **None took `"require"`**: nothing in the
repository was silently missing an event it wanted. That is worth stating
plainly, because it means the defect's cost to date was _risk_ rather than a
wrong number sitting in the tree — and it is also why the old guard survived
28 runs without anyone tripping over it.

### The honest limit on P0.99's validation criterion

P0.99 asks that "no configuration returns ok with the projectile below
ground". **That is not satisfiable as literally written** while fixed-step
convergence and energy-drift studies remain legitimate, because those
integrate a fixed span and legitimately end below ground. It is met here
under a stated reading:

> no configuration returns `ok` with events **declared and silently dropped**
> while below ground.

`events: "off"` is not that case. It is a caller who has said out loud that
the ground is not a boundary for this solve, which is a different claim from
one who never knew the question was being asked on their behalf. The
criterion's first clause — "a terminal ground impact is detected, **or the
solve fails loudly**" — is met without qualification.

### Two asymmetries this made visible (P0.142, not fixed here)

Neither is caused by this change; both were revealed by having to annotate
every call site, and both are filed rather than fixed, because changing
either rewrites recorded goldens.

- **The golden store disagrees with itself about the ground.** The same
  preset recorded under `classical-rk4` has always integrated _through_ the
  declared ground impact (no interpolant); recorded under `dopri5` it has
  always stopped _at_ it. Whether the ground is a boundary was decided by
  which stepper a golden happens to use.
- **`runEnergyDriftStudy` has the same split internally.** Its reference
  solve is adaptive, so it runs on DOPRI5 with the event armed — `tFinal`
  _is_ the impact time — while the fixed-step traces it then compares ran
  with events off.

### What was rejected, and still is

The two remedies P0.99's own notes proposed were both implemented far enough
to measure on the 27th run, and both are wrong. That is worth keeping,
because both look obviously correct until you run the suite.

### Rejected: throw at init when the stepper has no interpolant

The natural fix, mirroring the check immediately above it that has thrown
since P2.28 when `cfg.rtol` is set on a stepper with no `embeddedOrder`.

Implemented and run: **88 tests fail across 31 files.** Not a handful of
callers doing something odd — the failures are `convergence-harness`,
`euler-global-error`, `work-precision-harness`, `golden-trajectories`,
`reference-solution`, `energy-drift-study`, `stability-boundary-sweep`,
`phase-portrait`, every individual fixed-step stepper's own test, and the app
routes built on them.

The reason is structural, and it is the thing this ADR most wants to record:
**a convergence-order or energy-drift study must hold $h$ fixed, and every
standard projectile model attaches a ground-impact event.**
`createPlanarProjectileModel` always calls `createGroundImpactEvent`. So
"event-bearing model + fixed-step stepper" is not a caller error to be
rejected; it is how the majority of the numerical-methods content in this
repository is measured. Throwing outlaws the platform's own pedagogy.

### Rejected: auto-wrap in `HermiteDenseOutputStepper`

The other option in P0.99's notes, and superficially the kinder one — the
wrapper already exists, so the fallback looks nearly free.

It is worse than throwing. Those same convergence and energy studies would
keep running, but with the terminal ground-impact event now **armed**: a
study integrating a projectile over a fixed span would be truncated at
impact, silently changing every convergence rate and energy-drift figure it
reports, including the golden trajectories other tests are pinned against. It
also contradicts the wrapper's stated design — its own doc comment ties
opt-in to §5.1(c)'s interactive-vs-batch split, since it costs up to 2 extra
`model.rhs` calls per step and "the batch/Monte-Carlo path composes the bare
inner stepper and pays nothing extra". And cubic Hermite is 3rd order, one
below RK4, so localized event times would carry an interpolation error the
caller never opted into.

Trading a silent correctness bug for a silent measurement change is not a
fix. It just moves which invariant breaks quietly.

### What the real fix has to do

Both rejected options fail for the same underlying reason: **the API has no
way to express whether this particular caller wants events.** Today the
stepper choice decides it, implicitly and invisibly. The distinguishing fact
is caller intent, and intent is exactly what is missing from the signature.

So the remedy is an API change, not a guard change, and the shape of it is a
real decision rather than an obvious one. Sketches, none of them chosen:

- **Explicit tri-state on `SolverConfig`** — e.g. `events: "require" |
"off"`, no default, or defaulting to `"require"` with every convergence and
  energy study updated to say `"off"`. Honest and total; touches many call
  sites once.
- **Diagnostic on `SolveReport`** — an `eventsArmed: false` (or a `warnings`
  array) so the condition is discoverable and assertable. Non-breaking and
  small, but it does **not** satisfy P0.99's validation criterion as written,
  since a solve can still return `ok` below ground; it only stops the
  condition being invisible.
- **Post-hoc guard evaluation** — when events were not armed, evaluate the
  terminal events' $g$ at the final state and fail if one was crossed. Meets
  the criterion without an API change, but needs checking against whether the
  legitimate fixed-step studies themselves end below ground; if they do, this
  collapses into the throw.

**P0.99's validation criterion is not achievable without one of these.** It
asks that "no configuration returns ok with the projectile below ground",
which the diagnostic option cannot deliver and the other two can only deliver
by changing either the API or a large number of existing call sites. Whoever
takes it should expect to update call sites, and should not treat the
criterion as satisfiable by a local edit to `integrate.ts`.

## Consequences

- **P0.99 is closed and the behaviour changed** (114th run). One
  configuration behaves differently than before: a model declaring events,
  integrated with a stepper that has no interpolant, by a caller who set no
  `cfg.events`. It used to integrate silently without events; it now throws.
  Every other configuration is unchanged, including every recorded golden.
- **The resolution happens _before_ `stepper.init()`**, which is load-bearing
  rather than cosmetic: wrapping after init leaves the wrapper uninitialised
  and every `"require"` solve dies in `HermiteDenseOutputStepper.step`. The
  27th run's sketch did not reach this because it never got a wrap working.
- **`HermiteDenseOutputStepper.step` now forwards the driver's Kahan
  `compensation` buffer**, which it had been dropping. Only
  `ExplicitEulerStepper` reads it, so no test changed — but a wrapper the
  core can now apply on the caller's behalf must not quietly discard it, or
  the fix trades one silent-wrong-answer path for another.
- **`ScenarioSpec.solver.events`** carries the intent for a scenario, because
  it belongs to the scenario rather than to each of the seven runtime modules
  that resolve one. Twelve of the thirteen library scenarios need no
  annotation (they run on the adaptive `REFERENCE_SOLVER`, which has always
  had events armed); the one fixed-step entry, the energy-drift exhibit,
  takes `"off"`.
- `packages/solverkit/src/event-detection-requires-dense-output.test.ts` was
  **rewritten rather than deleted**, as this ADR required. It pinned the
  defect; it now pins the specification, and the measured wrong numbers
  survive inside it — `tFinal` 12, `yFinal[1]` −701.0788, `ok`, zero events —
  asserted under `events: "off"`, because that behaviour did not become
  wrong, it became opt-in.
- **The workaround needs no core change and is tested:**
  `new HermiteDenseOutputStepper(new ClassicalRK4Stepper())` arms events on a
  fixed step and localizes the impact to the closed-form time.
- **P0.98 is unblocked by that workaround**, without waiting for P0.99. Its
  regime — a restitution bounce whose whole flight is shorter than a quarter
  step — is unreachable from the adaptive driver, which truncates each step
  onto the localized event (the 26th run measured `flight / step = 5.00` at
  every bounce). It needs a fixed step with events live, which the wrapper
  provides today.

## References

- P0.99 (closed by this ADR), P0.142 (the two asymmetries above), P0.97
  (same defect shape), P0.98 (unblocked by the wrapper)
- `packages/solverkit/src/integrate.ts`, `hermite-dense-output.ts`
- Blueprint §4.9 (event detection), §5.1(c) (interactive vs batch)
