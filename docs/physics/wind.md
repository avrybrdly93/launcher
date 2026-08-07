<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ballista-technical-blueprint.md §3.5
     Regenerate: node scripts/generate-physics-docs.mjs
     The prose below is copied verbatim from the blueprint, which stays the
     source of truth for architecture. Edit the blueprint, then regenerate. -->

# §3.5 Wind Interaction Model

> Regenerated from [`ballista-technical-blueprint.md`](../../ballista-technical-blueprint.md) §3.5.
> Physics reference index: [`docs/physics/README.md`](./README.md).

Wind enters exclusively through Eq. (3.4). The `WindField` interface is $\mathbf{w}(t, \mathbf{r}) \to \mathbb{R}^d$ with implementations layered by complexity:

1. **Uniform steady:** $\mathbf{w} = (w_x, w_y)$, slider-controlled.
2. **Logarithmic boundary-layer profile** (horizontal wind sheared by height):

$$w_x(y) = \frac{u_*}{\kappa} \ln\!\left( \frac{y + y_r}{y_r} \right)
\tag{3.13}$$

with friction velocity $u_*$, von Kármán constant $\kappa = 0.41$, roughness length $y_r$ (grass $\approx 0.01$ m). A power-law alternative $w_x(y) = w_{\text{ref}}(y/y_{\text{ref}})^{\alpha}$, $\alpha \approx 0.14$, is also provided.
3. **Analytic gust structures:** Gaussian vortex, shear layer, and sinusoidal gusts $w_x(t) = \bar{w} + A\sin(\Omega t + \phi)$ — smooth by construction so that solver convergence studies remain clean.
4. **Stochastic gusts (Phase 6):** discrete-gust "1-cosine" events and an Ornstein–Uhlenbeck fluctuation model,

$$dw' = -\frac{w'}{\tau_g}\,dt + \sigma_g \sqrt{\frac{2}{\tau_g}}\, dW_t
\tag{3.14}$$

Important architectural note: (3.14) makes the system a *stochastic* ODE. Rather than contaminating the deterministic solver kit, stochastic wind is realized as a **precomputed sample path** $w'(t)$ (seeded, piecewise-cubic interpolated) fed to the deterministic integrator — each Monte Carlo replicate gets one frozen realization. This keeps SolverKit deterministic and reproducible, and is an explicit ADR (ADR-011).
5. **Gridded fields:** $\mathbf{w}$ sampled on a rectilinear grid with bilinear (later bicubic) interpolation — the seam for future imported/CFD-derived fields, and the data source for the vector-field visualization layer (Section 6.2).

## Implementation

Where this section's model lives in the codebase. Every row is checked by
[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts):
the file must exist and the symbol must be a named export of it.

| Symbol | Source | Role |
| --- | --- | --- |
| `WindModel` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | w(t, r) -> R^d; wind enters only through Eq. (3.4). |
| `ZeroWind` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Still air. |
| `UniformWind` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Uniform steady wind. |
| `LogProfileWind` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Eq. (3.13) logarithmic boundary layer. |
| `SinusoidalGustWind` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Smooth analytic gust, safe for convergence studies. |
| `GaussianVortexWind` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Analytic vortex structure. |
| `GriddedWindField` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Rectilinear grid + interpolation; seam for imported/CFD fields. |
| `FrozenOuGustWind` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Eq. (3.14) realized as a precomputed frozen sample path — ADR-011, keeps SolverKit deterministic. |
| `OneCosineGustWind` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Discrete '1-cosine' gust event. |
| `generateOuGustPath` | [`packages/engine/src/ou-gust.ts`](../../packages/engine/src/ou-gust.ts) | Seeded Ornstein-Uhlenbeck path generation feeding FrozenOuGustWind. |
| `ouGustStep` | [`packages/engine/src/ou-gust.ts`](../../packages/engine/src/ou-gust.ts) | One exact OU update step. |

---

← [§3.4 Atmosphere Model](./atmosphere.md) · [Index](./README.md) · [§3.6 Magnus Force and Spin](./magnus-and-spin.md) →
