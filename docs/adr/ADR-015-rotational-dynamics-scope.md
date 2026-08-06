# ADR-015: Rotational Dynamics Stay Kinematic; Euler Rigid-Body Attitude Is Future Work

**Status:** Accepted
**Date:** 2026-08-06

## Context

Equation (3.1) introduces the projectile as "a rigid body of mass $m$", and
the force inventory already reads spin: the Magnus force (3.15) depends on
$\hat{\boldsymbol\omega} \times \mathbf v_{\text{rel}}$, and its lift
coefficient (3.16) on the spin ratio $S = \omega R / \lVert \mathbf
v_{\text{rel}} \rVert$. Calling something a rigid body and then integrating
only its centre of mass is the kind of gap that quietly becomes a
correctness claim nobody wrote down, so the boundary needs to be explicit.

What the platform actually integrates today is **translational dynamics with
kinematic spin**. Two spin treatments ship:

- **$\omega$ constant** — a `ProjectileParams.spin` parameter read by
  `MagnusForce` in `packages/engine/src/forces.ts`. State stays
  $\mathbf y = (x, y, v_x, v_y)^{\mathsf T} \in \mathbb R^4$ (§3.7).
- **First-order exponential spin decay** — $\dot\omega = -\omega/\tau_\omega$
  with sport-typical $\tau_\omega \sim 20$–$30\ \mathrm s$ (§3.6), shipped in
  P4.07 as `createPlanarProjectileSpinModel` with
  `PLANAR_SPIN_CHANNELS = [x, y, v_x, v_y, \omega]`, $\dim = 5$, and a
  companion `StatefulSpinMagnusForce` that reads $\omega$ from state rather
  than from params.

The 3D path adds a spin _axis_ but not a spin _state_:
`ProjectileParams.spinAxis` is an optional constant $\hat{\boldsymbol\omega}$
read only by the dim-6 spatial model's full 3D Magnus term (P4.24), defaulting
to $\hat{\mathbf e}_z$, which reduces (3.15) exactly to the 2D formula. It is
a fixed input direction, not an orientation that evolves.

All three are **kinematic**: $\omega$ evolves by a prescribed scalar law and
$\hat{\boldsymbol\omega}$ does not evolve at all — never by a torque balance. There is no inertia tensor, no attitude representation, no
aerodynamic moment, and no coupling from orientation back into the force
model. Nothing in the roadmap through Phase 7 changes that — §3.1 already
flags full Euler rigid-body equations as an extension, and §11's "Beyond
Phase 4" note places full attitude ($\mathbf q$ quaternion + $\mathbf I
\dot{\boldsymbol\omega} + \boldsymbol\omega \times \mathbf I
\boldsymbol\omega = \mathbf M_{\text{aero}}$) alongside the Three.js
perspective scene as post-roadmap work.

The decision is therefore not _whether_ to build rigid-body attitude now —
no roadmap task funds it — but whether the omission is a deliberate scope
boundary with a stated re-entry condition, or an accident. This ADR makes it
the former.

## Decision

**Rotational dynamics remain kinematic for the entire roadmap (Phases 0–7).**
$\boldsymbol\omega$ is either a constant parameter or a state component
obeying $\dot\omega = -\omega/\tau_\omega$. No model, force, stepper, or
observable in `engine`/`solverkit` may assume an attitude representation
exists.

**Full Euler rigid-body attitude is scoped out as future work**, not
rejected. Specifically out of scope: quaternion (or DCM) attitude state,
inertia tensor $\mathbf I$ and its body/inertial transforms, the moment
balance $\mathbf I \dot{\boldsymbol\omega} + \boldsymbol\omega \times
\mathbf I \boldsymbol\omega = \mathbf M_{\text{aero}}$, angle-of-attack
dependent aerodynamics, and the exterior-ballistics phenomena that need
them — fin stabilization, yaw of repose, and the resulting spin drift.

**Three constraints on the interim design**, so the omission stays honest and
the future path stays open:

1. **No implicit attitude.** The 2D convention $\hat{\boldsymbol\omega} =
   \hat{\mathbf e}_z$ (§3.6) and the 3D `spinAxis` parameter are _inputs_, not
   orientation state. Code must not infer a body frame from velocity
   direction, nor integrate `spinAxis` — an
   angle-of-attack-shaped quantity computed from $\mathbf v$ alone would be a
   rigid-body claim smuggled in without the equations that justify it.
2. **The spin channel keeps its own name.** `omega` is a spin _rate_, and
   the dim-5 model exists precisely because state dimension is
   model-dependent (§3.7). A future attitude model registers as a new model
   kind with its own dimension, exactly as P4.07's dim-5 model was added
   without touching the dim-4 workhorse; it does not widen an existing one.
3. **Claims are scoped to what is integrated.** Magnus lift is asserted, and
   the ideal-Magnus zero-work identity (§3.7's runtime check ii) holds,
   because $\mathbf F_M \perp \mathbf v_{\text{rel}}$ — none of which depends
   on attitude. Nothing in the docs, exhibits, or scenario teaching notes may
   claim spin drift, yaw of repose, or angle-of-attack effects, all of which
   require the moment balance this ADR defers.

## Revisit trigger

Reopen this ADR when **any one** of the following becomes true:

- **A funded task requires a torque.** Any roadmap or backlog item whose
  validation criterion cannot be met without $\mathbf M_{\text{aero}}$ —
  fin-stabilized projectiles, yaw of repose, spin drift, or
  angle-of-attack-dependent $C_d$/$C_L$ — is by definition out of scope under
  this ADR and must reopen it rather than approximate around it.
- **Phase 7 closes and the Three.js perspective scene is taken up.** §11 pairs
  the spin-axis widget and attitude visualization with rigid-body attitude;
  the moment a spin _axis_ needs to be drawn as an orientation rather than
  inferred from the 2D convention, the state it is drawn from must exist.
- **A validation case fails for an attitude reason.** If a T-VAL trajectory
  or golden-trajectory comparison diverges from a reference in a way traced
  to an unmodelled moment — not to $C_d(M)$, wind, or step control — that is
  evidence the kinematic-spin approximation has left its regime, and the
  measurement should be recorded here.

Absent one of those, the deliberate answer is no: the platform's subject is
ODE numerics taught through projectile motion, and a six-degree-of-freedom
attitude solver adds state, stiffness, and a second validation burden
(quaternion normalization drift, body/inertial frame conventions) without
adding a numerical-methods lesson the translational problem does not already
teach better.

## Consequences

- **The "rigid body" wording in §3.1 is now bounded.** It licenses treating
  the projectile as non-deformable with a single centre of mass; it does not
  license attitude claims. This ADR is the reference for that boundary.
- **The dim-4/dim-5 split is a feature, not a stopgap.** P4.07's extensibility
  result — a new state dimension registered with zero engine/UI edits — is
  the same mechanism a future attitude model would use, so deferring costs
  nothing structurally. Nothing needs to be un-built later.
- **Symplectic integration is unaffected.** Spin decay is dissipative and,
  like drag, lives on the standard-RK path; adding attitude later would not
  change that boundary, since $\boldsymbol\omega \times \mathbf I
  \boldsymbol\omega$ is a conservative term but $\mathbf M_{\text{aero}}$ is
  not. The existing rule — symplectic methods for conservative dynamics only
  — already covers the future case.
- **A known gap is stated once, in one place**, instead of being rediscovered
  each time a session notices that a "rigid body" has no orientation.
