# Explicit (Forward) Euler — Derivation

Implemented by {@link ExplicitEulerStepper}. Blueprint §4.2.

## Scheme

$$\mathbf y_{k+1} = \mathbf y_k + h\, \mathbf f(t_k, \mathbf y_k) \tag{4.2}$$

## Derivation

Taylor-expand the exact solution about $t_k$:

$$\mathbf y(t_{k+1}) = \mathbf y(t_k) + h\dot{\mathbf y}(t_k) + \tfrac{h^2}{2}\ddot{\mathbf y}(\xi), \qquad \xi \in (t_k, t_{k+1}).$$

Dropping the $\mathcal O(h^2)$ remainder gives (4.2) directly, with local truncation error
$\boldsymbol\tau_{k+1} = \tfrac{h^2}{2}\ddot{\mathbf y}(\xi) = \mathcal O(h^2)$ — order 1.

## Pitfalls (each demonstrable in-platform)

1. **Energy growth on oscillatory dynamics.** For the Dahlquist test equation restricted to
   the imaginary axis, $\dot y = i\lambda y$ (undamped rotation), $|y_{k+1}| =
   |1+ih\lambda|\,|y_k| = \sqrt{1+h^2\lambda^2}\,|y_k| > |y_k|$ for _any_ $h>0$: explicit
   Euler always spirals outward on pure oscillation, regardless of step size. On the
   projectile this appears as systematic range/apex bias.
2. **Conditional stability on dissipative dynamics.** Stability requires $h < 2\tau_{\text{drag}}$
   for the linearized drag mode (§4.6, eq. 4.12).
3. **First-order error is expensive.** Reaching global error $10^{-6}$ takes RK4 ($p=4$)
   roughly $10^2$ steps but Euler ($p=1$) roughly $10^6$ — the platform's work–precision
   diagram (§4.5) makes this cost difference visceral.

## Kahan-compensated variant

This stepper is also the platform's compensated-summation exhibit (§4.7): when `integrate`
passes a `compensation` buffer, the state update `y + h*f` runs through {@link kahanAdd}
instead of a plain `+`, flattening the rounding-dominated branch of the V-shaped total-error
curve $E(h) \approx C_1 h^p + C_2\,\epsilon_{\text{mach}}/h$.

## See also

- {@link SemiImplicitEulerStepper} — the nearly-free symplectic variant that fixes pitfall 1
  on separable Hamiltonian problems (§4.2, eq. 4.3).
- §4.6 for the full stability-region derivation ($R_{\text{Euler}}(z) = 1+z$).
