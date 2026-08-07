<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ballista-technical-blueprint.md §3.7
     Regenerate: node scripts/generate-physics-docs.mjs
     The prose below is copied verbatim from the blueprint, which stays the
     source of truth for architecture. Edit the blueprint, then regenerate. -->

# §3.7 State Vector Formulation

> Regenerated from [`ballista-technical-blueprint.md`](../../ballista-technical-blueprint.md) §3.7.
> Physics reference index: [`docs/physics/README.md`](./README.md).

Equation (3.1) is second order; all solvers consume first-order systems. Define the state

$$\mathbf{y} = \begin{pmatrix} \mathbf{r} \\ \mathbf{v} \end{pmatrix} \in \mathbb{R}^{2d}, \qquad
\frac{d\mathbf{y}}{dt} = \mathbf{f}(t, \mathbf{y}; \boldsymbol{\mu}) = \begin{pmatrix} \mathbf{v} \\ \tfrac{1}{m} \sum_i \mathbf{F}_i(t, \mathbf{r}, \mathbf{v}) \end{pmatrix}
\tag{3.17}$$

For the planar projectile, $\mathbf{y} = (x, y, v_x, v_y)^{\mathsf T} \in \mathbb{R}^4$; with spin decay, $\mathbb{R}^5$; in 3D with spin, $\mathbb{R}^7$ (or $\mathbb{R}^9$ with vector spin). The `Model` interface therefore declares:

```ts
interface Model {
  readonly dim: number;                       // state dimension n
  readonly channels: ChannelMeta[];           // names/units/kinds of y-components
  rhs(t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void;
  invariants?: InvariantSpec[];               // e.g. energy, when defined
  events?: EventSpec[];                       // g(t,y)=0 crossings: ground, apex
  jacobian?(t, y, out): void;                 // optional analytic J = ∂f/∂y
  partitions?: { q: number[]; p: number[] };  // index sets for symplectic methods
}
```

The explicit **partition declaration** $(q, p) = (\mathbf{r}, \mathbf{v})$ is what allows symplectic/Verlet steppers — which require the second-order mechanical structure $\ddot{\mathbf q} = \mathbf a(t,\mathbf q,\dot{\mathbf q})$ — to be applied generically without the stepper knowing it is integrating a projectile.

**Fully expanded planar RHS** (quadratic drag + Magnus + uniform gravity), the workhorse of the platform: with $\mathbf{u} = \mathbf{v} - \mathbf{w}(t,\mathbf r)$, $u = \lVert\mathbf u\rVert$, $k_d = \tfrac{\rho C_d A}{2m}$, $k_m = \tfrac{\rho C_L A}{2m}$:

$$\dot x = v_x,\quad \dot y = v_y,\quad
\dot v_x = -k_d\, u\, u_x \; - \; k_m\, u\, u_y \cdot \operatorname{sgn}(\omega),\quad
\dot v_y = -g - k_d\, u\, u_y \; + \; k_m\, u\, u_x \cdot \operatorname{sgn}(\omega)
\tag{3.18}$$

(with $C_L = C_L(S)$ evaluated per (3.16); signs shown for $\hat{\boldsymbol\omega}=\pm\hat{\mathbf e}_z$).

## Implementation

Where this section's model lives in the codebase. Every row is checked by
[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts):
the file must exist and the symbol must be a named export of it.

| Symbol | Source | Role |
| --- | --- | --- |
| `Model` | [`packages/engine/src/model.ts`](../../packages/engine/src/model.ts) | The interface quoted in this section: dim, channels, rhs, invariants, events, jacobian, partitions. |
| `EventSpec` | [`packages/engine/src/model.ts`](../../packages/engine/src/model.ts) | g(t,y)=0 crossings — ground, apex. |
| `InvariantSpec` | [`packages/engine/src/model.ts`](../../packages/engine/src/model.ts) | Conserved quantities where defined. |
| `createPlanarProjectileModel` | [`packages/engine/src/planar-projectile-model.ts`](../../packages/engine/src/planar-projectile-model.ts) | Eq. (3.18) planar RHS, dim 4. |
| `PLANAR_CHANNELS` | [`packages/engine/src/planar-projectile-model.ts`](../../packages/engine/src/planar-projectile-model.ts) | (x, y, v_x, v_y) channel metadata. |
| `createPlanarProjectileSpinModel` | [`packages/engine/src/planar-projectile-spin-model.ts`](../../packages/engine/src/planar-projectile-spin-model.ts) | dim 5 — the first model-dependent state dimension. |
| `createSpatialProjectileModel` | [`packages/engine/src/spatial-projectile-model.ts`](../../packages/engine/src/spatial-projectile-model.ts) | 3D model, dim 6. |
| `SPATIAL_CHANNELS` | [`packages/engine/src/spatial-projectile-model.ts`](../../packages/engine/src/spatial-projectile-model.ts) | 3D channel metadata. |

---

← [§3.6 Magnus Force and Spin](./magnus-and-spin.md) · [Index](./README.md) · [§3.8 Continuous-Time System Properties](./system-properties.md) →
