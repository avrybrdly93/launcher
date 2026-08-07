<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ballista-technical-blueprint.md §3
     Regenerate: node scripts/generate-physics-docs.mjs -->

# Physics reference

The platform's physics model, regenerated from [`ballista-technical-blueprint.md`](../../ballista-technical-blueprint.md) §3.
The blueprint is the source of truth: **edit it, then regenerate these pages** with
`node scripts/generate-physics-docs.mjs`. Editing a page directly will be overwritten,
and the drift is caught by
[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts).

Each page carries an **Implementation** table mapping the section's equations to the
engine symbols that realize them; those links are machine-checked too.

| Section | Page |
| --- | --- |
| §3.1 | [Newtonian Formulation](./newtonian-formulation.md) |
| §3.2 | [Gravity](./gravity.md) |
| §3.3 | [Drag: Linear and Quadratic Regimes](./drag.md) |
| §3.4 | [Atmosphere Model](./atmosphere.md) |
| §3.5 | [Wind Interaction Model](./wind.md) |
| §3.6 | [Magnus Force and Spin](./magnus-and-spin.md) |
| §3.7 | [State Vector Formulation](./state-vector.md) |
| §3.8 | [Continuous-Time System Properties](./system-properties.md) |
| §3.9 | [Projectile and Scenario Database](./projectile-and-scenario-database.md) |

## Related

- [Architecture Decision Records](../adr) — including
  [ADR-015](../adr/ADR-015-rotational-dynamics-scope.md), which scopes rigid-body attitude
  out of the projectile models described here.
- The numerical methods that consume these models live in blueprint §4.
