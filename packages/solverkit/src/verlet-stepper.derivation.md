# Störmer–Verlet — Derivation

Implemented by {@link VerletStepper} (both `"velocity"` and `"position"` variants). Blueprint
§4.8.

## The conservative sub-problem

For the *conservative* sub-problem (drag off), the system is Hamiltonian with $H(\mathbf r,
\mathbf v) = \tfrac12 m\lVert\mathbf v\rVert^2 + mgy$. Non-symplectic methods (explicit
Euler, RK4) exhibit secular energy drift $\Delta E \propto t$; symplectic integrators of
order $p$ instead conserve a *modified* Hamiltonian $\tilde H = H + \mathcal O(h^p)$,
yielding bounded oscillatory energy error over exponentially long times (backward error
analysis) rather than unbounded drift.

## Velocity Verlet (kick–drift–half-kick–half)

$$\mathbf v_{k+1/2} = \mathbf v_k + \tfrac h2 \mathbf a(\mathbf q_k), \quad
\mathbf q_{k+1} = \mathbf q_k + h\, \mathbf v_{k+1/2}, \quad
\mathbf v_{k+1} = \mathbf v_{k+1/2} + \tfrac h2 \mathbf a(\mathbf q_{k+1}) \tag{4.13}$$

Order 2, symplectic, symmetric (time-reversible: integrating forward then backward with
negated $h$ returns exactly the starting state up to floating-point rounding — the
platform's dedicated reversibility property test). Equivalent to the position-space
recurrence $\mathbf q_{k+1} - 2\mathbf q_k + \mathbf q_{k-1} = h^2 \mathbf a(\mathbf q_k)$
for velocity-independent forces.

## Velocity-dependent forces break exact symplecticity

Drag and Magnus depend on $\mathbf v$, not just $\mathbf q$, so $\mathbf a(\mathbf q_{k+1})$
in (4.13) needs a not-yet-known $\mathbf v_{k+1}$. The stepper's `"velocity"` variant ships
the standard practical compromise: an explicit-Euler *extrapolated* velocity pass, $\tilde{\mathbf
v}_{k+1} = \mathbf v_k + h\mathbf a(\mathbf q_k, \mathbf v_k)$, fed into $\mathbf a(\mathbf
q_{k+1}, \tilde{\mathbf v}_{k+1})$ instead of the true stale $\mathbf v_k$. Using the stale
value there (as a naive port of the velocity-independent recurrence would) degrades the
trapezoidal velocity update to first order whenever $\mathbf a$ genuinely depends on
$\mathbf v$; the extrapolated pass is a no-op (and the order-2 recurrence exact) whenever it
doesn't. The platform *labels this honestly*: the drag projectile is dissipative anyway, so
"energy conservation" is replaced by the work–energy residual $\mathcal R_E$ (eq. 3.19) as
the universal correctness diagnostic, and the gravity-only mode remains the clean stage for
the symplectic story.

## Position Verlet (drift–kick–drift)

$$\mathbf q_{k+1/2} = \mathbf q_k + \tfrac h2 \mathbf v_k, \quad
\mathbf v_{k+1} = \mathbf v_k + h\, \mathbf a(\mathbf q_{k+1/2}, \mathbf v_k), \quad
\mathbf q_{k+1} = \mathbf q_{k+1/2} + \tfrac h2 \mathbf v_{k+1}$$

One `rhs` evaluation/step instead of velocity-Verlet's two, at the cost of always using the
stale $\mathbf v_k$ at the midpoint force evaluation — the extrapolated-velocity correction
above is scoped to the velocity-Verlet variant only, per §4.8's phrasing, so this variant's
velocity-dependent-force order is not separately corrected.

## The flagship comparison exhibit (task P4.12)

Gravity-only lofted shot, fixed cost budget (equal `rhs` evaluations), four traces of
$E(t)/E(0) - 1$: explicit Euler (linear growth), RK4 (tiny but *secular* drift), symplectic
Euler (bounded sawtooth), Verlet (smaller bounded sawtooth) — see
`semi-implicit-euler-stepper.derivation.md` for the order-1 symplectic sibling this method
generalizes.
