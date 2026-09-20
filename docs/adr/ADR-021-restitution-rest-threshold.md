# ADR-021: A Bouncing Trajectory Ends in a Resting Contact, and the Caller States the Threshold

**Status:** Accepted (116th run, 2026-09-20)
**Date:** 2026-09-20

## Context

`createPlanarProjectileModel(forces, terrain, restitution)` turns ground
impact from a stopping condition into a bouncing one: each impact reflects
$v_y \leftarrow -e\,v_y$ and $v_x \leftarrow \mu_f v_x$, and the driver
resumes integrating from the reflected state (§4.9's "stop or reflect",
P4.11).

For $e < 1$ that sequence is **Zeno**. A drag-free ball released from $h_0$
with coefficient of restitution $e$ impacts at

$$ t_n = t_0\left(1 + 2e\frac{1 - e^{,n}}{1 - e}\right),
\qquad t_0 = \sqrt{2h_0/g},$$

which accumulates at

$$t_\infty = t_0\left(1 + \frac{2e}{1-e}\right)$$

after **infinitely many impacts in finite time**. No integrator resolves all
of them, and that part is not a defect — it is what the model says.

What happens *after* the last resolvable impact is the defect (P0.103, filed
by the 26th run, reproduced to the digit by the 116th):

| $e$ | stepper       | $h$  | impacts | last impact  | $t_\infty$ | `status` | $y$ at $t_f = 12$ |
| --- | ------------- | ---- | ------- | ------------ | ---------- | -------- | ----------------- |
| 0.2 | DOPRI5        | 0.12 | 7       | 1.514683     | 1.514715   | `ok`     | **−539.08**       |
| 0.2 | RK4 + Hermite | 0.12 | 5       | 1.513907     | 1.514715   | `ok`     | **−539.13**       |
| 0.5 | DOPRI5        | 0.12 | 7       | 2.997873     | 3.029430   | `ok`     | **−396.66**       |

Every resolved impact time is correct — the 26th run measured 2.1e-15
relative — so localization is not at fault. The sequence simply runs out of
resolution, the last impact leaves the ball with a rebound speed too small
for the next flight to be bracketed inside a step, and from there **nothing
catches the ball**: it passes through the ground and free-falls for the rest
of the span, with `status: "ok"`. That is the silent-wrong-answer shape of
P0.97, P0.99 and P0.101.

The fix cannot be "detect the accumulation point", because the accumulation
point is a property of the *drag-free* closed form and does not survive drag,
wind, a sloped terrain or a non-constant $g$. It has to be a statement about
the **impact**, made from the impact state alone.

## Decision

**A restitution model must declare the normal speed below which an impact is
a resting contact rather than a bounce.** `RestitutionParams` gains a
required third member:

```ts
interface RestitutionParams {
  readonly e: number;
  readonly muF: number;
  readonly vRest: number; // m/s, normal rebound speed at or below which the ball rests
}
```

An impact whose **rebound** speed $e\,|v_y^-|$ is at or below `vRest` is a
resting contact: the normal impulse is fully inelastic ($v_y^+ = 0$), the
tangential impulse still applies ($v_x^+ = \mu_f v_x^-$), and **the solve
ends there**, at the ground, with `status: "ok"` and `tFinal` equal to the
impact time.

To let an event express that, `EventSpec.action` may now return `"stop"`.
Returning nothing (or `"continue"`) is exactly today's behaviour — reflect
and keep integrating — so every action written before this ADR is unchanged
by it.

### Three things this decision is deliberately *not*

**Not a default.** P0.103's own notes ask for "an ADR rather than an ad-hoc
epsilon", and a default `vRest` is precisely that epsilon, hidden one layer
down where nobody argues with it. A required field puts the modelling
decision at the call site, where the person who knows the ball, the surface
and the question is. This follows ADR-016's accepted shape for the same
reason: _having no default is what makes the rule narrow._

**Not a ban on Zeno.** `vRest: 0` stays legal and means "no rest condition".
It is the one configuration in which the accumulation survives and the ball
can still end up below the ground — and it is now reachable only by typing
it, which is the difference between a caller who has said out loud that this
model bounces forever and one who never knew the question was being asked on
their behalf. A Zeno exhibit is a legitimate thing for a teaching platform to
want; a Zeno exhibit nobody asked for is the bug.

**Not a height or a duration cutoff.** A rebound apex $v^2/2g$ or a remaining
tail $2v/(g(1-e))$ would read more physically, and for the drag-free case all
three are the same cutoff under a monotone map. Both alternatives need $g$ at
the impact, which is neither carried by the action's `(t, y, out)` signature
nor constant once §4.2's altitude-dependent gravity or a non-flat terrain is
in play. A normal-speed threshold is local to the impact state, which is the
only thing an event is given.

## Consequences

**The trajectory is truncated, by a bounded and computable amount.** Stopping
at rebound speed $v^+ \le v_{\text{rest}}$ discards a tail of duration
$2v^+/(g(1-e))$ and height $(v^+)^2/2g$. Both are monotone in $v^+$, so both
are bounded by their values at `vRest`, and the bound is the caller's to
choose rather than the platform's to assume. At $v_{\text{rest}} = 10^{-3}$
m/s the discarded height is $5.1\times10^{-8}$ m for any $e$, and the
discarded duration is 0.26 ms at $e = 0.2$, 2.0 ms at $e = 0.9$.
`packages/solverkit/src/restitution-rest-contact.test.ts` measures both
against the closed form rather than asserting them.

**A perfectly elastic ball never rests, and that is consistent rather than an
exception.** With $e = 1$ the rebound speed equals the approach speed and
neither decays, so a ball with any real drop energy never reaches the
threshold and the sequence is not Zeno in the first place. The rest condition
and the accumulation point appear and disappear together.

**Existing restitution callers must be edited.** `RestitutionParams` is
constructed in four test files and nowhere else in the repository — no
scenario in `scenario-library.ts` and no recorded golden uses restitution —
so this costs four annotations and changes no pinned number. That was
measured before the field was made required; if a golden had depended on it,
blueprint §8.4 would have put this behind a separately-argued change.

**What the ball does after it stops bouncing is not modelled, and the API
says so.** `vRest` ends the *flight*; it does not begin a contact phase.
$v_x$ is passed through with its $\mu_f$ factor and the solve stops, so a
final state with $\mu_f = 1$ still carries horizontal velocity. Rolling,
sliding and a normal contact force are a constraint problem the blueprint
does not have and this ADR does not invent — filed as its own task
(P0.143) rather than improvised here.

**One tunnelling configuration survives this ADR and is a different bug.**
Under the adaptive driver a drag-free bouncing ball resolves exactly *one*
impact and then free-falls, whatever `vRest` says, because the impact is
never detected: the localized root leaves $y = -2.2\times10^{-16}$, so
`scanStepForEvents`' `g0 === 0` test is false, the `DEPARTURE_THETAS` ladder
is not armed, and the whole 0.4 s rebound falls inside the first quarter of a
10.99 s step. That is P0.101's mechanism, measured here on the adaptive path
rather than the fixed one its own notes used. A rest threshold cannot help an
impact that was never seen.

## Alternatives rejected

**Detect the accumulation point analytically and stop there.** Requires the
drag-free closed form, so it is wrong the moment any other force is wired in
— which is most of the platform.

**Stop when the driver notices the state is below the terrain.** Turns a
modelling question into a numerical guard, gives the same answer for a genuine
tunnelling bug as for a finished bounce sequence, and would have masked the
P0.101 case above instead of leaving it visible.

**Freeze the ball in place (zero both velocity channels) and keep
integrating.** Produces a trajectory with a long tail of identical states,
and asserts a rolling/sliding answer ($v_x = 0$) that no force in the model
computed. Stopping reports exactly what was integrated and nothing more.
$$
