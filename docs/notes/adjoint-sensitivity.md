# Adjoint sensitivity for the range gradient

Companion note to `packages/analysis/src/adjoint-range-gradient.ts` (P5.24).
Hand-written; unlike [`docs/physics/`](../physics/README.md) nothing regenerates
this page.

Blueprint §9.2 states the task in one sentence:

> A short adjoint prototype (P5.24) documents the many-parameter scaling story
> ($\mathcal O(1)$ backward solves vs $\mathcal O(n_\mu)$ tangent solves)
> without committing the platform to full adjoint infrastructure.

So the deliverable is an argument backed by a working prototype, not a
production gradient engine. This note is the argument; the module is the
prototype; `adjoint-range-gradient.test.ts` is the evidence.

## 1. The problem being differentiated

Launch a projectile, integrate until the terminal ground event fires, and read
the downrange coordinate there:

$$ R(\mu) = e_R \cdot y\bigl(T(\mu)\bigr), \qquad
\dot y = f(t, y;\mu), \qquad g\bigl(y(T)\bigr) = 0 .$$

$\mu$ is any vector of parameters that enters through the launch state (θ, v₀,
launch height) or through the dynamics (C_d, ρ, g, wind). The impact time $T$
is *not* a constant — it moves with $\mu$, and every difficulty in this note
comes from that.

## 2. Forward: what `tangent-linear.ts` already does

Differentiating the ODE with respect to $\mu_k$ gives the variational equation

$$\dot S_k = A(t)\,S_k + b_k(t), \qquad
A = \frac{\partial f}{\partial y}, \qquad
b_k = \frac{\partial f}{\partial \mu_k}, \qquad
S_k(0) = \frac{\partial y_0}{\partial \mu_k},$$

one $n$-vector per parameter, integrated alongside the state. The event-time
correction turns the fixed-time sensitivity into the impact one:

$$\frac{\mathrm dR}{\mathrm d\mu_k}
 = e_R\cdot\Bigl(S_k(T) + f\,\frac{\mathrm dT}{\mathrm d\mu_k}\Bigr),
\qquad
\frac{\mathrm dT}{\mathrm d\mu_k} = -\frac{\nabla g\cdot S_k(T)}{\nabla g\cdot f}.$$

Cost: one solve of dimension $n(1+m)$.

## 3. Backward: the adjoint identity

Collect the correction into a single covector, which is the whole trick:

$$\frac{\mathrm dR}{\mathrm d\mu_k}
 = \underbrace{\Bigl[e_R - \frac{e_R\cdot f}{\nabla g\cdot f}\,\nabla g\Bigr]}_{\textstyle \lambda(T)}
   \cdot\, S_k(T).$$

Everything parameter-specific is now on the right of the dot product, and
everything problem-specific on the left. Let $\lambda$ satisfy the **adjoint
equation** running backwards from that terminal value:

$$\dot\lambda = -A(t)^{\mathsf T}\lambda .$$

Then

$$\frac{\mathrm d}{\mathrm dt}\bigl(\lambda^{\mathsf T}S_k\bigr)
 = \dot\lambda^{\mathsf T}S_k + \lambda^{\mathsf T}\dot S_k
 = -\lambda^{\mathsf T}A S_k + \lambda^{\mathsf T}\bigl(A S_k + b_k\bigr)
 = \lambda^{\mathsf T} b_k,$$

and integrating over $[0, T]$:

$$\lambda(T)^{\mathsf T}S_k(T) - \lambda(0)^{\mathsf T}S_k(0)
 = \int_0^T \lambda^{\mathsf T} b_k \,\mathrm dt,$$

which rearranges to the gradient the module returns:

$$\frac{\mathrm dR}{\mathrm d\mu_k}
 = \lambda(0)^{\mathsf T} S_k(0) \;+\; \int_0^T \lambda(t)^{\mathsf T} b_k(t)\,\mathrm dt .$$

**$S_k$ never appears.** The two surviving terms are exactly the two ways
`TangentParameter` lets a parameter enter: `seedInitialState` supplies
$S_k(0)$, `displaceContext` supplies $b_k$. A parameter that provides neither
has both terms vanish identically, which is why both modules reject it at
construction rather than returning zeros.

### Reading $\lambda$

$\lambda(t)$ answers: *if the state were nudged at time $t$, how much would the
impact range move?* Two entries are worth knowing by sight:

- $\lambda(0)$'s downrange-position entry is **exactly 1**, for any dynamics:
  translating the launch downrange translates the impact by the same amount.
  Asserted in the tests, and it is a statement about the backward solve rather
  than about the seeds.
- $\lambda(T)$'s vertical-position entry is $-(e_R\cdot f)/(\nabla g\cdot f) =
  -v_x/v_y$ at impact. This *is* the event-time correction. Seeding
  $\lambda(T) = e_R$ instead — the obvious-looking thing — reproduces
  `tangent-linear.ts`'s recorded −163 m/rad at the drag-free 45° shot, where
  the true answer is zero. Six tests fail under that perturbation.

## 4. Implementation: reversed time, and one shortcut

`solverkit`'s driver, controller and steppers all assume an increasing
independent variable, so rather than hand them a decreasing one the module
substitutes $s = T - t$ and integrates forward in $s$ over $[0, T]$:

```
dy/ds   = −f(T−s, y)          the base trajectory, replayed
dλ/ds   = +A(T−s, y)ᵀ λ       the adjoint
dI_k/ds = λ · b_k(T−s, y)     the quadrature, so I_k(T) = ∫₀ᵀ λᵀb_k dt
```

The augmented backward state is $[y,\ \lambda,\ I]$, of dimension $2n + m$.
The backward model declares **no events**: the forward terminal event is
satisfied at $s = 0$ by construction, so carrying it over would fire
immediately.

**The shortcut, stated rather than hidden.** $A(t)$ has to be evaluated along
the base trajectory, and this module recovers that trajectory by re-integrating
$\dot y = f$ backwards from the impact state. A production adjoint checkpoints
the forward solve and interpolates. Re-integration is simpler and needs no
interpolant, but reversing a dissipative system makes it anti-dissipative, so
the recovered $y(0)$ drifts from the true launch state. The module **measures**
that drift and returns it as `stateRoundTripError`; on a projectile flight at
`rtol = 1e-12` it is around `1e-11`, and a caller who tries this on a longer or
stiffer problem sees the shortcut fail loudly instead of receiving a quietly
wrong gradient.

## 5. Continuous, not discrete — and why

The task is titled "discrete-adjoint". **The prototype implements the
continuous adjoint.** The two are genuinely different objects:

| | continuous ("differentiate then discretise") | discrete ("discretise then differentiate") |
|---|---|---|
| what is differentiated | the ODE | the Runge–Kutta scheme |
| needs | $A^{\mathsf T}$, an ODE solver | stage values, transposed tableau, the accepted step sequence, checkpointing |
| agrees with tangent-linear to | integration tolerance | machine precision |
| gradient is exact for | the true solution | the *discrete* solution the code actually computes |

The discrete adjoint is what an optimiser strictly wants — its gradient is
consistent with the discrete objective the optimiser is minimising, so a line
search cannot be defeated by an inconsistency between value and slope. It is
also exactly the "full adjoint infrastructure" §9.2 says this task must not
commit the platform to: it reaches inside the stepper, and it would have to be
re-derived for every stepper in `solverkit` rather than written once.

The cost of the choice is a *measured* one, not a hand-wave. Against the
tangent-linear module on the three-parameter case at `rtol = 1e-12`, the worst
relative disagreement is **4.3e-13** on the flat shot and **1.8e-12** from a
raised launch point — four orders inside the task's 1e-8 criterion, and set by
integration tolerance rather than by either formulation. Loosening `rtol` moves
that number; a discrete adjoint's would not.

## 6. The scaling story, and where it does *not* pay

| | forward (tangent-linear) | backward (this module) |
|---|---|---|
| augmented dimension | $n(1+m)$ | $2n + m$ |
| solves | 1 | 2 (one forward base, one backward) |
| growth per extra parameter | $n$ | **1** |
| growth per extra *output* | 0 | $n$ (one backward solve each) |

For the planar projectile, $n = 4$:

| $m$ | forward dim | backward dim |
|---|---|---|
| 1 | 8 | 9 |
| 3 | 16 | 11 |
| 30 | 124 | 38 |

The crossover sits at $m = 2$–3 and the gap widens linearly. All three rows are
asserted in the tests, including the $m = 1$ row where the forward method wins —
omitting it would make the exhibit an advertisement.

**Where this does not help, which is most of Phase 5.** The shooting solves in
`newton-shooting.ts` want $\partial(\text{2 residual components})/\partial(\text{2
aim components})$. That is a $2\times 2$ Jacobian: the forward method gets all
of it from one augmented solve, while an adjoint needs **one backward solve per
output row**. Adjoints win when parameters outnumber outputs, and Phase 5's
inverse problems are the other shape.

The direction that does pay is Phase 6's sensitivity work (§9.4): a tornado
chart over many uncertain inputs is one scalar observable against $n_\mu$
parameters — the adjoint's shape exactly. This note and its prototype exist so
that when P6.16–P6.20 arrive, the identity, the event-time subtlety and the
checkpointing question are already written down and tested rather than
rediscovered.

## 7. Out of scope

Each of these is *rejected at construction* rather than silently mishandled,
and each rejection matches one `tangent-linear.ts` makes, for the same reason:

- **Terminal events with an `action`** (P4.11's restitution bounce). The
  adjoint needs its own jump condition backwards across the reset map;
  carrying $\lambda$ straight through would be wrong from the first bounce and
  would look entirely ordinary.
- **More than one terminal event.** $\lambda(T)$ differentiates the condition
  that actually fired, and the solve report does not say which one that was.
- **No terminal event at all.** There is no impact time, so $\lambda(T)$ is
  undefined.
- **Grazing impacts**, where $\nabla g\cdot f \to 0$. The crossing time is not
  a differentiable function of the parameters there and $\lambda(T)$ is
  unbounded; the module reports the measured value of $\nabla g\cdot f$ against
  its scale, which tells a caller to move the target off the envelope.

Not rejected but not attempted either: observables other than range. The
identity is unchanged — only $e_R$ in $\lambda(T)$ becomes some other
$\partial\Phi/\partial y$ — but each observable needs its own terminal seed and
its own validation, and one is enough to make §9.2's point.

## References

- Cao, Li, Petzold & Serban, *Adjoint sensitivity analysis for
  differential-algebraic equations: the adjoint DAE system and its numerical
  solution*, SIAM J. Sci. Comput. 24(3), 2003 — the quadrature formulation used
  here.
- Hindmarsh & Serban, *CVODES*: the reference implementation of both the
  forward and adjoint modes, and of the checkpointing this prototype skips.
- Sanz-Serna, *Symplectic Runge–Kutta schemes for adjoint equations*, SIAM
  Review 58(1), 2016 — why the discrete adjoint of an RK method is itself an RK
  method, and what the transposed tableau looks like.
- `ballista-technical-blueprint.md` §9.1 (differentiability through events) and
  §9.2 (this task's framing).
$$
