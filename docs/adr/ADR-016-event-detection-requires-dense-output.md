# ADR-016: Event Detection Requires Dense Output, and `integrate` Says So Loudly

**Status:** Accepted
**Date:** 2026-08-16

## Context

`integrate()` gated its whole event block on a single expression
(`packages/solverkit/src/integrate.ts`):

```ts
const hasEvents = events !== undefined && events.length > 0 && stepper.interpolant !== undefined;
```

The third conjunct is the problem. Root localization genuinely needs dense
output — `scanStepForEvents` samples $g$ inside the step and
`localizeEventRoot` brackets the sign change on the interpolant — so a
stepper without one cannot locate an event. But the consequence of that
conjunct was that a model _declaring_ events, integrated with a stepper
_without_ an interpolant, silently integrated as if it had declared none.
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
input.

## Decision

**`integrate()` throws at init when a model declares events and the supplied
stepper has no interpolant.** The guard is not widened and the events are not
silently dropped:

```ts
if (events !== undefined && events.length > 0 && stepper.interpolant === undefined) {
  throw new Error(
    `integrate: event detection requires a stepper with dense output; "${stepper.info.id}" ` +
      `has no interpolant. Wrap it: new HermiteDenseOutputStepper(new ${...}()).`,
  );
}
```

This mirrors the check sitting immediately above it, which has thrown since
P2.28 when `cfg.rtol` is set on a stepper with no `embeddedOrder`. Both say
the same thing: a solver configuration that cannot deliver what the caller
asked for is a programming error, not a silent downgrade.

### Why not auto-wrap in `HermiteDenseOutputStepper`?

It was the more tempting option — the wrapper already exists, so the fallback
looked nearly free, and it would have made the bad configuration simply work.
It was rejected because the wrapper is **opt-in by construction and by
design**. Its own doc comment ties that to §5.1(c)'s interactive-vs-batch
split: it costs up to 2 extra `model.rhs` calls per step (1 in steady state,
via the FSAL-style reuse), and "the batch/Monte-Carlo path composes the bare
inner stepper and pays nothing extra; only a caller that actually wants dense
output reaches for this."

Auto-wrapping would delete that split. Every batch run over a model with a
ground-impact event — which is every standard projectile model, since
`createPlanarProjectileModel` always attaches one — would quietly acquire a
per-step RHS call it did not ask for, and a Monte-Carlo sweep would pay it
across every replicate. Trading a silent correctness bug for a silent
performance regression is not an improvement; it just moves which invariant
is broken quietly. It would also change the _numbers_: cubic Hermite is 3rd
order, one below RK4, so localized event times would carry an interpolation
error that the caller never opted into and could not see in the report.

Throwing keeps both properties visible. A caller who wants events on a fixed
step writes one wrapper and pays the documented cost knowingly; a caller who
wants a cheap batch run keeps the bare stepper and gets told, immediately and
at the call site, if the model they passed needs more.

### Why throw rather than report `status: "failed"`?

`SolveFailure` describes things discovered _during_ integration — a step-size
collapse, a non-finite state, a Newton divergence. This is knowable before the
first step from `(model, stepper)` alone, and the existing `embeddedOrder`
check already establishes throwing as the idiom for that class. Returning a
failed report would also mean every caller has to check a report they could
not have produced usefully in the first place.

## Consequences

- **Breaking, deliberately.** A caller combining an event-bearing model with
  a fixed-step stepper now throws where it previously returned a wrong
  answer. That combination had no correct behaviour to preserve — it is
  precisely the bug — so there is no migration path to offer beyond the
  wrapper the message names. No caller in this repository was doing it: the
  full suite passes unchanged apart from the tests added for this ADR.
- **P0.98 is unblocked.** Its regime — a restitution bounce whose whole
  flight is shorter than a quarter step — is unreachable from the adaptive
  driver, which truncates each step onto the localized event (the 26th run
  measured `flight / step = 5.00` at every bounce). It needs a _fixed_ step
  with events live, i.e. `new HermiteDenseOutputStepper(new
ClassicalRK4Stepper())`, which is now both possible and the documented way
  to ask for it.
- The `hasEvents` local survives, but its third conjunct is now redundant by
  construction; it is kept as a type narrowing for `stepper.interpolant!`.
- Nothing changes for a model with no events, or for the adaptive path.

## References

- P0.99 (this ADR), P0.97 (same defect shape), P0.98 (unblocked by it)
- `packages/solverkit/src/integrate.ts`, `hermite-dense-output.ts`
- Blueprint §4.9 (event detection), §5.1(c) (interactive vs batch)
