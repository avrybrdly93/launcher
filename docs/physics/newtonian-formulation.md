<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ballista-technical-blueprint.md §3.1
     Regenerate: node scripts/generate-physics-docs.mjs
     The prose below is copied verbatim from the blueprint, which stays the
     source of truth for architecture. Edit the blueprint, then regenerate. -->

# §3.1 Newtonian Formulation

> Regenerated from [`ballista-technical-blueprint.md`](../../ballista-technical-blueprint.md) §3.1.
> Physics reference index: [`docs/physics/README.md`](./README.md).

The projectile is modeled as a rigid body of mass $m$ whose translational dynamics are governed by Newton's second law:

$$m \frac{d^2\mathbf{r}}{dt^2} = \sum_i \mathbf{F}_i(t, \mathbf{r}, \mathbf{v}, \boldsymbol{\omega}; \boldsymbol{\mu}, \mathcal{E})
\tag{3.1}$$

where $\mathbf{r}$ is position, $\mathbf{v} = \dot{\mathbf{r}}$ velocity, $\boldsymbol{\omega}$ spin angular velocity, $\boldsymbol{\mu}$ the parameter vector (mass, geometry, aerodynamic coefficients), and $\mathcal{E}$ the environment (gravity model, atmosphere, wind field). For the core roadmap, rotational dynamics are simplified: $\boldsymbol{\omega}$ is either constant or subject to first-order exponential spin decay (Section 3.6); full Euler rigid-body equations are a Phase-4+ extension.

The planar (2D) case, with $\mathbf{r} = (x, y)$, $y$ vertical, is the primary configuration through Phase 6; the formulation below is written to generalize to 3D with no structural change (all force laws are stated vectorially).

**Force inventory.** The total force is a *composition* of independent, individually-toggleable terms:

$$\mathbf{F} = \mathbf{F}_g + \mathbf{F}_{d,\text{lin}} + \mathbf{F}_{d,\text{quad}} + \mathbf{F}_M + \mathbf{F}_b + \mathbf{F}_{\text{ext}}
\tag{3.2}$$

(gravity, linear drag, quadratic drag, Magnus, buoyancy, user-defined). Composability is an architectural requirement (Section 5.2): each force is a pure function conforming to a common interface, and the engine sums contributions into a preallocated accumulator.

## Implementation

Where this section's model lives in the codebase. Every row is checked by
[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts):
the file must exist and the symbol must be a named export of it.

| Symbol | Source | Role |
| --- | --- | --- |
| `ForceModel` | [`packages/engine/src/forces.ts`](../../packages/engine/src/forces.ts) | Common interface every force term conforms to — Eq. (3.2) composability. |
| `composeForces` | [`packages/engine/src/forces.ts`](../../packages/engine/src/forces.ts) | Sums contributions into a preallocated accumulator (no allocation in the hot path, ADR-004). |
| `createForceRegistry` | [`packages/engine/src/forces.ts`](../../packages/engine/src/forces.ts) | Builds the toggleable force inventory of Eq. (3.2). |
| `Model` | [`packages/engine/src/model.ts`](../../packages/engine/src/model.ts) | Carries the RHS that Eq. (3.1) becomes once reduced to first order. |

---

[Index](./README.md) · [§3.2 Gravity](./gravity.md) →
