<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ballista-technical-blueprint.md §3.2
     Regenerate: node scripts/generate-physics-docs.mjs
     The prose below is copied verbatim from the blueprint, which stays the
     source of truth for architecture. Edit the blueprint, then regenerate. -->

# §3.2 Gravity

> Regenerated from [`ballista-technical-blueprint.md`](../../ballista-technical-blueprint.md) §3.2.
> Physics reference index: [`docs/physics/README.md`](./README.md).

**Uniform model (default):** $\mathbf{F}_g = -mg\,\hat{\mathbf{e}}_y$ with $g = 9.80665\ \text{m s}^{-2}$ (standard gravity), user-adjustable for other bodies (Moon $1.62$, Mars $3.71$).

**Altitude-dependent model (optional, Phase 4):**

$$g(y) = g_0 \left( \frac{R_E}{R_E + y} \right)^2, \qquad R_E = 6.371\times10^6\ \text{m}
\tag{3.3}$$

The correction is $\sim 3\times10^{-5}$ relative per 100 m of altitude — negligible for sports projectiles, pedagogically useful for long-range ballistics and for demonstrating that force models are swappable.

## Implementation

Where this section's model lives in the codebase. Every row is checked by
[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts):
the file must exist and the symbol must be a named export of it.

| Symbol | Source | Role |
| --- | --- | --- |
| `GravityForce` | [`packages/engine/src/forces.ts`](../../packages/engine/src/forces.ts) | Eq. (3.2) gravity term; delegates the field strength to a GravityModel. |
| `UniformGravity` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Uniform g default (9.80665 m/s^2), user-adjustable per body. |
| `GravityModel` | [`packages/engine/src/environment.ts`](../../packages/engine/src/environment.ts) | Seam the altitude-dependent model of Eq. (3.3) plugs into. |

---

← [§3.1 Newtonian Formulation](./newtonian-formulation.md) · [Index](./README.md) · [§3.3 Drag: Linear and Quadratic Regimes](./drag.md) →
