# Semi-Implicit (Symplectic) Euler — Derivation

Implemented by {@link SemiImplicitEulerStepper}. Blueprint §4.2.

## Scheme

For a separable mechanical system split into position channels $\mathbf q$ and velocity/momentum
channels $\mathbf p$ (declared via `model.partitions`):

$$ \mathbf v_{k+1} = \mathbf v_k + h, \mathbf a(t_k, \mathbf r_k, \mathbf v_k), \qquad
\mathbf r_{k+1} = \mathbf r_k + h\, \mathbf v_{k+1} \tag{4.3}$$

The only change from explicit Euler is *which* velocity feeds the position update: the
**new** one, not the old one.

## Derivation and order

Each half of (4.3) is individually a first-order Euler step, so the method is order 1 —
same asymptotic cost as {@link ExplicitEulerStepper}, same one-`rhs`-evaluation-per-step
budget. The entire benefit comes from *symplecticity*, not from a higher truncation order.

## Why it's symplectic (and Euler isn't)

Viewed as a map $(\mathbf q_k, \mathbf p_k) \mapsto (\mathbf q_{k+1}, \mathbf p_{k+1})$,
(4.3) is a composition of two shears (one in $p$ holding $q$ fixed, one in $q$ holding the
*updated* $p$ fixed), each of which exactly preserves phase-space area/volume. Backward
error analysis then shows the map exactly conserves a nearby *modified* Hamiltonian
$\tilde H = H + \mathcal O(h)$ (§4.8), so the true energy error oscillates in a bounded band
rather than drifting secularly — unlike plain forward Euler, whose map is not
volume-preserving and spirals outward on any oscillatory mode
($|y_{k+1}| = \sqrt{1+h^2\lambda^2}\,|y_k|$, §4.2 pitfall 1).

The boundedness guarantee is specific to bounded/periodic orbits: a linear potential like
pure uniform gravity has no periodic recurrence for the shadow-Hamiltonian argument to
exploit, which is why this platform demonstrates the bounded-sawtooth energy behavior on an
oscillator fixture rather than a single unbounded ballistic arc (see the stepper's test
file).

## Cost vs. benefit

"Nearly free to implement and dramatically better on mechanical systems" (§4.2) — the
platform's cheapest profound lesson in geometric integration, and the natural on-ramp to
{@link VerletStepper}'s order-2 generalization (§4.8).
$$
