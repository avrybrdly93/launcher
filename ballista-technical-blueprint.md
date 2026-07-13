# Ballista: A Web-Based Computational Platform for Projectile Dynamics and Numerical Methods Education

**Technical Design Document and Multi-Year Development Blueprint**

Version 1.0 — Master Reference. Status: Foundational design; supersedes all prior sketches.

---

## Document Conventions

- Vectors are boldface: $\mathbf{v}$, $\mathbf{F}$. Scalars italic: $m$, $t$, $\rho$.
- The state vector of the continuous system is $\mathbf{y}(t) \in \mathbb{R}^n$; discrete approximations are $\mathbf{y}_k \approx \mathbf{y}(t_k)$.
- SI units throughout. Angles in radians internally; degrees only at the UI boundary.
- Code identifiers appear in `monospace`. Module names are capitalized: **Engine**, **SolverKit**, **Viz**.
- Task IDs use the scheme `P<phase>.<number>`, e.g., `P2.17`.
- Equation numbering is per-section: (3.4) denotes the fourth numbered equation of Section 3.

---

# 1. Introduction and Vision

## 1.1 Why This Project Exists

Projectile motion with air resistance occupies a privileged position in computational physics pedagogy. It is the simplest mechanical system that is (a) genuinely nonlinear, (b) analytically intractable in its full form, (c) physically intuitive to every user, and (d) rich enough to motivate essentially the entire undergraduate-to-early-graduate numerical methods curriculum: explicit and implicit time integration, adaptive step control, stiffness, stability regions, error propagation, root finding, optimization, and stochastic simulation.

The quadratic-drag projectile is the canonical counterexample to the closed-form worldview. With drag force $\mathbf{F}_d = -\tfrac{1}{2}\rho C_d A \lVert\mathbf{v}\rVert \mathbf{v}$, the horizontal and vertical equations of motion couple through the speed $\lVert\mathbf{v}\rVert = \sqrt{v_x^2 + v_y^2}$, and no elementary closed form exists for the general trajectory. The student who has only ever solved $y = x\tan\theta - \tfrac{g x^2}{2 v_0^2 \cos^2\theta}$ has never confronted the central fact of computational science: *most models of interest cannot be solved; they can only be approximated, and the approximation itself becomes an object of study.*

This project builds the vehicle for that confrontation. **Ballista** is a browser-native simulation platform in which the projectile problem is fully instrumented: every solver decision, every truncation error estimate, every energy drift curve is inspectable in real time. The platform begins as a launcher simulator and evolves, along a deliberate architectural gradient, into a general scientific computing educational system in which the projectile is merely the first registered model.

Three failures of existing tools motivate the effort:

1. **Black-box applets.** Most online projectile simulators hide the integrator entirely. The user cannot change $\Delta t$, cannot compare RK4 against Euler, cannot see energy drift. The numerics — the actual intellectual content — are invisible.
2. **Notebook fragility.** Jupyter-based numerical methods courses expose the numerics but sacrifice interactivity, deployment simplicity, and real-time visual feedback. A slider that re-runs a 10,000-step integration at 60 fps is qualitatively different from re-executing a cell.
3. **Toy architectures.** Educational codebases are almost universally throwaway scripts. Students never see how a *real* simulation code separates model from method from presentation, manages state, or validates itself against analytical benchmarks under CI. Ballista's architecture is itself a pedagogical artifact.

## 1.2 Scientific Computing Relevance

Although the physical system is elementary, the computational content is not. The platform is a complete miniature of a production scientific code:

- **A right-hand-side (RHS) abstraction** $\mathbf{f}(t, \mathbf{y}; \boldsymbol{\mu})$ with parameter vector $\boldsymbol{\mu}$, identical in shape to the RHS of any method-of-lines semi-discretized PDE. A student who internalizes Ballista's `ForceModel` composition understands the flux-assembly stage of a finite volume code.
- **A solver kit** spanning explicit one-step methods (Euler, RK2 variants, RK4), embedded adaptive pairs (RK45 Dormand–Prince, Bogacki–Shampine), and structure-preserving integrators (symplectic Euler, Störmer–Verlet, velocity Verlet), with a uniform stepper interface.
- **Event detection** (ground impact, apex, target-plane crossing) via dense output and root bracketing — the same machinery as shock detection or contact resolution in serious codes.
- **Inverse problems**: given a target, find $(\theta, v_0)$; a two-point boundary value problem solved by shooting, i.e., Newton iteration wrapped around the forward integrator, with Jacobians obtained by variational (tangent-linear) integration or finite differences.
- **Uncertainty quantification**: Monte Carlo propagation of input distributions, variance reduction, convergence at the canonical $\mathcal{O}(N^{-1/2})$ rate, and sensitivity indices.
- **Performance engineering**: SoA memory layout, batched integration of ensembles, WASM SIMD, and GPU compute (WebGPU) for $10^5$–$10^6$ simultaneous trajectories.

Every one of these transfers directly to CFD, molecular dynamics, orbital mechanics, and beyond. The projectile is the smallest system on which the *entire* stack can be exercised honestly.

## 1.3 Educational Goals

The platform targets four learner personas, in ascending order of sophistication:

1. **The physics student** who wants qualitative insight: how does drag flatten a trajectory? Why does a golf ball with backspin carry farther? Served by presets, sliders, and immediate visual feedback.
2. **The numerical methods student** who is learning why RK4 exists. Served by the *Solver Lab*: side-by-side integration of the same initial value problem (IVP) with different methods, error-versus-cost plots, stability-region visualizations, energy drift dashboards.
3. **The scientific software student** who studies the codebase itself: interfaces, testing, validation infrastructure, reproducibility. Served by documentation, architecture decision records (ADRs), and an intentionally readable core.
4. **The researcher/instructor** who extends the platform: new force models, new integrators, new exercises. Served by the plugin registry and extension API (Section 5.5).

Concrete learning outcomes the platform must be able to demonstrate empirically:

- Observe first-order versus fourth-order convergence directly: log–log plot of global error against $\Delta t$ with measured slopes $\approx 1$ and $\approx 4$.
- Watch explicit Euler spiral outward in phase space on an undamped oscillator while symplectic Euler traces a closed (slightly distorted) orbit — the geometric-integration epiphany.
- See adaptive step-size control concentrate steps near apex (for a lofted, high-drag shot) where curvature of the solution is largest.
- Quantify how a 1% uncertainty in $C_d$ maps to a range dispersion, and compare the Monte Carlo answer to a first-order sensitivity estimate.

## 1.4 Long-Term Evolution of the System

The roadmap (Section 7) spans seven phases over an estimated 12–36 months of part-time development. The architectural principle governing evolution is: **the projectile is a plugin, not the platform.** From Phase 1 onward, the engine consumes an abstract `Model` (state dimension, RHS, invariants, events); the projectile model merely happens to be the first one registered. This makes the later pivots — 3D dynamics, coupled oscillators, orbital mechanics, $N$-body, eventually 1D PDE semi-discretizations — additive rather than surgical.

Planned evolutionary stages beyond the core roadmap:

- **Stage A (post-Phase 3):** Solver Lab as a standalone educational mode; exercises with auto-checked numerical answers.
- **Stage B (post-Phase 5):** Model registry opened to non-projectile ODE systems (pendulum, Lorenz, two-body) reusing the entire solver/visualization stack.
- **Stage C (post-Phase 7):** GPU ensemble engine repurposed for interactive Monte Carlo and parameter-sweep "heatmap" exploration; WASM core extracted as an embeddable library.
- **Stage D (research horizon):** Method-of-lines PDE demos (advection, heat, shallow water) using the same stepper interface; publication of the platform as an educational-software paper (Section 10.6).

## 1.5 Non-Goals

To keep the design honest, the following are explicitly out of scope for the core roadmap: full CFD around the projectile (drag is parameterized, never resolved); multiplayer/collaborative features; server-side computation (the platform is client-only and deployable as static files); mobile-native apps (responsive web only); and photorealistic rendering (clarity over spectacle, always).

---

# 2. System Overview

## 2.1 High-Level Architecture

Ballista is a client-side single-page application organized as a strict layered architecture with unidirectional dependencies. Lower layers know nothing of upper layers.

```
┌─────────────────────────────────────────────────────────────┐
│  L5  APP SHELL         routing, layout, persistence, i18n   │
├─────────────────────────────────────────────────────────────┤
│  L4  UI / CONTROLS     sliders, presets, solver panel,      │
│                        scenario editor, exercise mode       │
├─────────────────────────────────────────────────────────────┤
│  L3  VISUALIZATION     trajectory renderer (Canvas/WebGL),  │
│      (Viz)             vector-field overlay, analysis plots │
├─────────────────────────────────────────────────────────────┤
│  L2  ORCHESTRATION     SimulationSession, playback clock,   │
│      (Runtime)         event bus, worker pool, recorder     │
├─────────────────────────────────────────────────────────────┤
│  L1  NUMERICS          steppers, adaptive controllers,      │
│      (SolverKit)       dense output, event detection,       │
│                        root finding, optimization, MC       │
├─────────────────────────────────────────────────────────────┤
│  L0  PHYSICS CORE      Model interface, ForceModel algebra, │
│      (Engine)          state types, units, environments,    │
│                        projectile database                  │
└─────────────────────────────────────────────────────────────┘
```

Dependency rule: layer $L_i$ may import only from $L_j$, $j < i$. L0 and L1 are pure TypeScript with **zero DOM dependencies** — they must run identically in the main thread, a Web Worker, Node (for CI testing), and eventually inside a WASM/GPU harness. This purity constraint is the single most important architectural invariant in the project; it is what makes headless regression testing (Section 8) and GPU offload (Section 10) possible without rewrites.

## 2.2 Module Breakdown

| Module | Layer | Responsibility | Key exports |
|---|---|---|---|
| `@ballista/engine` | L0 | Physical models, forces, environments, parameter schemas, unit handling | `Model`, `ForceModel`, `Environment`, `ProjectileSpec`, `composeForces` |
| `@ballista/solverkit` | L1 | Time integration, adaptivity, dense output, events, root finding | `Stepper`, `integrate`, `AdaptiveController`, `EventDetector`, `DenseOutput` |
| `@ballista/analysis` | L1 | Optimization (shooting, Nelder–Mead, gradient), Monte Carlo, sensitivity, statistics | `solveInverse`, `mcEnsemble`, `sobolIndices` |
| `@ballista/runtime` | L2 | Session lifecycle, deterministic playback clock, worker orchestration, result recording | `SimulationSession`, `WorkerPool`, `Recorder` |
| `@ballista/viz` | L3 | Scene graph, trajectory & field rendering, plot components, camera | `TrajectoryLayer`, `FieldLayer`, `PlotPane`, `Camera2D` |
| `@ballista/ui` | L4 | Control panels, preset browser, solver lab, scenario serialization UI | React/Preact components |
| `@ballista/app` | L5 | Shell, routing, storage, theming, exercise content | application entry |
| `@ballista/validation` | dev | Analytical reference solutions, convergence harness, golden-trajectory store | `references/*`, `convergence()` |

Packages live in a single monorepo (pnpm workspaces) with enforced import boundaries (ESLint rule or `dependency-cruiser` in CI).

## 2.3 Data Flow

The canonical data path for a single interactive run:

```
 user input (slider)                              60 fps render loop
        │                                                ▲
        ▼                                                │
 ┌──────────────┐  ScenarioSpec   ┌──────────────┐  Frame│(interp. state)
 │ UI layer     │───────────────▶ │ Runtime      │───────┘
 │ (controlled  │                 │ Simulation   │
 │  components) │ ◀───────────────│ Session      │
 └──────────────┘  status,        └──────┬───────┘
                   diagnostics           │ IVP = {Model, y₀, t-span,
                                         │        SolverConfig}
                                         ▼
                                  ┌──────────────┐
                                  │ SolverKit    │  f(t,y,μ) calls
                                  │ integrate()  │─────────────────┐
                                  └──────┬───────┘                 ▼
                                         │ Trajectory       ┌──────────────┐
                                         │ (t[], y[][],     │ Engine       │
                                         │  events, stats)  │ Model.rhs    │
                                         ▼                  └──────────────┘
                                  ┌──────────────┐
                                  │ Recorder     │  typed-array columnar store
                                  └──────┬───────┘
                                         │ views (zero-copy subarrays)
                                         ▼
                                  ┌──────────────┐
                                  │ Viz          │  draws trajectory, fields,
                                  └──────────────┘  analysis plots
```

Key decisions embedded in this flow:

1. **ScenarioSpec is the single source of truth.** A scenario is a plain serializable object: model id, parameter vector $\boldsymbol{\mu}$, initial conditions, environment spec, solver configuration, seed. Everything the UI does reduces to producing a new ScenarioSpec; everything the runtime does is a pure function of it. This gives reproducibility (Section 8.5), shareable URLs, and trivial regression testing for free.
2. **Simulation and rendering are decoupled clocks.** The integrator produces a `Trajectory` (or streams chunks of one); the render loop *samples* it via dense-output interpolation at display time $t_{\text{display}}$. Slow-motion, scrubbing, and pause are therefore playback concerns, never solver concerns.
3. **Columnar typed-array storage.** Trajectories are stored SoA: `Float64Array` per component (`t`, `x`, `y`, `vx`, `vy`, plus derived channels). Rendering consumes zero-copy views; the same layout is GPU-upload-ready (Phase 7).
4. **Workers for anything > 5 ms.** Single forward runs at interactive tolerances complete in well under a millisecond and run on the main thread for latency. Parameter sweeps, Monte Carlo, convergence studies, and optimization run in a worker pool with transferable buffers.

## 2.4 Separation of Concerns

Three orthogonal axes of separation govern the design:

**(a) Model / Method / Presentation.** The physical model (what $\mathbf{f}$ is) never knows how it is integrated; the integrator (how $\mathbf{y}_{k+1}$ is produced) never knows what the state components mean; the renderer never computes physics. Concretely: `Model.rhs(t, y, out)` writes derivatives into a preallocated buffer and is the *only* physics entry point SolverKit sees; Viz consumes only recorded channels plus declarative channel metadata (name, unit, suggested color) supplied by the model.

**(b) Specification / Execution / Result.** ScenarioSpec (declarative, serializable) → SimulationSession (imperative, stateful, cancellable) → Trajectory/EnsembleResult (immutable, columnar). No layer mutates another's artifacts.

**(c) Interactive / Batch.** The same `integrate()` function serves the 60 fps interactive path (one IVP, loose tolerance, dense output on) and the batch path (thousands of IVPs, no dense output, statistics only). The batch path is the seam along which WASM and GPU backends attach later; the interface is fixed in Phase 2 precisely so Phase 7 is a backend swap, not a redesign.

## 2.5 Technology Baseline

- **Language:** TypeScript (strict mode) everywhere; numerics in a dependency-free core subset amenable to later AssemblyScript/Rust-WASM porting.
- **UI framework:** Preact (or React) with signals/store for state; chosen for ecosystem, but L0–L3 are framework-agnostic by construction.
- **Rendering:** Canvas 2D for Phase 3 (sufficient to ~50k line segments per frame); WebGL2 instanced rendering introduced in Phase 7 for ensembles; Plotly or a lightweight custom plot layer for analysis charts (decision recorded as ADR-007, Section 6.4).
- **Testing:** Vitest for unit/property tests; golden-file trajectory regression harness; Playwright for UI smoke tests.
- **Build/deploy:** Vite; static hosting (GitHub Pages / Cloudflare Pages); no backend services.

## 2.6 Quality Attributes and Budgets

| Attribute | Budget / requirement |
|---|---|
| Interactive latency | slider change → first rendered frame of new trajectory < 16 ms (one frame) for default scenario at RK45 tol $10^{-6}$ |
| Frame rate | 60 fps with ≤ 8 simultaneous trajectories + field overlay on 2019 mid-range laptop |
| Determinism | identical ScenarioSpec (incl. seed) ⇒ bit-identical Trajectory on same platform; cross-platform agreement within documented FP tolerance |
| Accuracy | default solver global error < $10^{-6}$ relative on the drag-free analytic benchmark over full flight |
| Batch throughput (CPU) | ≥ $10^4$ full trajectories/s (RK4, fixed step, typical flight) on 4 workers by end of Phase 6 |
| Batch throughput (GPU) | ≥ $10^6$ trajectories/s target for Phase 7 WebGPU backend |
| Bundle size | core interactive app ≤ 300 kB gzipped excluding optional plot library |
---

# 3. Physics Modeling Framework

## 3.1 Newtonian Formulation

The projectile is modeled as a rigid body of mass $m$ whose translational dynamics are governed by Newton's second law:

$$m \frac{d^2\mathbf{r}}{dt^2} = \sum_i \mathbf{F}_i(t, \mathbf{r}, \mathbf{v}, \boldsymbol{\omega}; \boldsymbol{\mu}, \mathcal{E})
\tag{3.1}$$

where $\mathbf{r}$ is position, $\mathbf{v} = \dot{\mathbf{r}}$ velocity, $\boldsymbol{\omega}$ spin angular velocity, $\boldsymbol{\mu}$ the parameter vector (mass, geometry, aerodynamic coefficients), and $\mathcal{E}$ the environment (gravity model, atmosphere, wind field). For the core roadmap, rotational dynamics are simplified: $\boldsymbol{\omega}$ is either constant or subject to first-order exponential spin decay (Section 3.6); full Euler rigid-body equations are a Phase-4+ extension.

The planar (2D) case, with $\mathbf{r} = (x, y)$, $y$ vertical, is the primary configuration through Phase 6; the formulation below is written to generalize to 3D with no structural change (all force laws are stated vectorially).

**Force inventory.** The total force is a *composition* of independent, individually-toggleable terms:

$$\mathbf{F} = \mathbf{F}_g + \mathbf{F}_{d,\text{lin}} + \mathbf{F}_{d,\text{quad}} + \mathbf{F}_M + \mathbf{F}_b + \mathbf{F}_{\text{ext}}
\tag{3.2}$$

(gravity, linear drag, quadratic drag, Magnus, buoyancy, user-defined). Composability is an architectural requirement (Section 5.2): each force is a pure function conforming to a common interface, and the engine sums contributions into a preallocated accumulator.

## 3.2 Gravity

**Uniform model (default):** $\mathbf{F}_g = -mg\,\hat{\mathbf{e}}_y$ with $g = 9.80665\ \text{m s}^{-2}$ (standard gravity), user-adjustable for other bodies (Moon $1.62$, Mars $3.71$).

**Altitude-dependent model (optional, Phase 4):**

$$g(y) = g_0 \left( \frac{R_E}{R_E + y} \right)^2, \qquad R_E = 6.371\times10^6\ \text{m}
\tag{3.3}$$

The correction is $\sim 3\times10^{-5}$ relative per 100 m of altitude — negligible for sports projectiles, pedagogically useful for long-range ballistics and for demonstrating that force models are swappable.

## 3.3 Drag: Linear and Quadratic Regimes

Aerodynamic drag opposes the velocity of the projectile **relative to the air**. Define the relative velocity

$$\mathbf{v}_{\text{rel}} = \mathbf{v} - \mathbf{w}(t, \mathbf{r})
\tag{3.4}$$

where $\mathbf{w}$ is the wind field (Section 3.5). All aerodynamic forces are functions of $\mathbf{v}_{\text{rel}}$, never of $\mathbf{v}$ directly; conflating these is the single most common student bug and is caught by a dedicated regression test (T-VAL-09).

**Linear (Stokes) drag** — valid for Reynolds number $Re \lesssim 1$ (mist droplets, dust):

$$\mathbf{F}_{d,\text{lin}} = -b\, \mathbf{v}_{\text{rel}}, \qquad b = 6\pi \eta R \ \ \text{(Stokes sphere)}
\tag{3.5}$$

with dynamic viscosity $\eta$ and radius $R$. Its virtue is analytical solvability: with $\mathbf{w} = 0$, the components decouple,

$$v_x(t) = v_{x0} e^{-t/\tau}, \qquad
v_y(t) = -v_T + (v_{y0} + v_T) e^{-t/\tau}, \qquad
\tau = \frac{m}{b},\ v_T = \frac{mg}{b}
\tag{3.6}$$

$$x(t) = x_0 + v_{x0}\,\tau\,(1 - e^{-t/\tau}), \qquad
y(t) = y_0 - v_T t + (v_{y0} + v_T)\,\tau\,(1 - e^{-t/\tau})
\tag{3.7}$$

Equations (3.6)–(3.7) are the platform's second analytical validation pillar (after the drag-free parabola) and the basis of the convergence-rate test suite (Section 8.2).

**Quadratic (Newtonian) drag** — valid for $Re \gtrsim 10^3$, i.e., essentially all sports and ballistic regimes:

$$\mathbf{F}_{d,\text{quad}} = -\tfrac{1}{2}\, \rho(\mathbf{r})\, C_d(Re, M)\, A\, \lVert \mathbf{v}_{\text{rel}} \rVert\, \mathbf{v}_{\text{rel}}
\tag{3.8}$$

with air density $\rho$, drag coefficient $C_d$, reference (cross-sectional) area $A = \pi R^2$ for spheres. The Reynolds and Mach numbers are

$$Re = \frac{\rho \lVert\mathbf{v}_{\text{rel}}\rVert D}{\eta}, \qquad M = \frac{\lVert\mathbf{v}_{\text{rel}}\rVert}{c(T)}, \quad c = \sqrt{\gamma R_s T}
\tag{3.9}$$

**Drag coefficient models**, in increasing fidelity, all behind one `DragCoefficientModel` interface:

1. **Constant:** $C_d = 0.47$ (smooth sphere, subcritical). Default.
2. **Reynolds-dependent smooth sphere** (covers the drag crisis near $Re \approx 3\times10^5$ where $C_d$ drops to $\approx 0.1$): piecewise correlation, e.g., a Morrison-type fit; implemented as tabulated $(Re, C_d)$ with monotone cubic (PCHIP) interpolation to guarantee smoothness of $\mathbf{f}$ (a $C^0$-only $C_d(Re)$ degrades observed integrator convergence order — this is itself a planned Solver Lab demonstration).
3. **Sport-specific tables:** golf (dimpled, $C_d \approx 0.25$ in operating range), soccer, baseball (seam effects folded into effective $C_d$), each stored as data assets with provenance notes.
4. **Mach-dependent** (Phase 4 ballistics): $C_d(M)$ table with transonic rise; requires atmosphere with temperature model for local $c$.

**Terminal velocity** for quadratic drag, used in validation and in the UI's characteristic-scales readout:

$$v_T = \sqrt{ \frac{2 m g}{\rho C_d A} }
\tag{3.10}$$

**Regime blending.** For completeness, a combined law $\mathbf{F}_d = -(b_1 + b_2\lVert\mathbf{v}_{\text{rel}}\rVert)\,\mathbf{v}_{\text{rel}}$ is provided; the UI displays instantaneous $Re$ so students can see which regime dominates.

## 3.4 Atmosphere Model

Air density and viscosity vary with altitude and weather. The engine defines an `Atmosphere` interface returning $(\rho, T, p, \eta, c)$ at a query point.

**Constant atmosphere (default):** $\rho = 1.225\ \text{kg m}^{-3}$, $T = 288.15\ \text{K}$ (ISA sea level).

**Isothermal exponential:** $\rho(y) = \rho_0 e^{-y/H}$, scale height $H = \frac{R_s T}{g} \approx 8.5\ \text{km}$.

**ISA troposphere (Phase 4):** linear lapse $T(y) = T_0 - L y$ with $L = 6.5\ \text{K km}^{-1}$, and

$$p(y) = p_0\left(1 - \frac{L y}{T_0}\right)^{g/(R_s L)}, \qquad \rho = \frac{p}{R_s T}
\tag{3.11}$$

valid to 11 km, with $R_s = 287.05\ \text{J kg}^{-1}\text{K}^{-1}$. Sutherland's law supplies $\eta(T)$:

$$\eta(T) = \eta_{\text{ref}} \left(\frac{T}{T_{\text{ref}}}\right)^{3/2} \frac{T_{\text{ref}} + S}{T + S}, \qquad S = 110.4\ \text{K}
\tag{3.12}$$

**Buoyancy** (small but honest): $\mathbf{F}_b = \rho V g\, \hat{\mathbf{e}}_y$ with projectile volume $V$; for a soccer ball this is $\sim1\%$ of weight and its inclusion is a toggle used in the "how big are the effects we ignore?" exercise. Added-mass effects are documented as deliberately neglected (relevant only for $\rho_{\text{body}} \sim \rho_{\text{air}}$).

## 3.5 Wind Interaction Model

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

## 3.6 Magnus Force and Spin

A spinning body in flow experiences a lift force orthogonal to both spin axis and relative velocity. The platform uses the standard lift-coefficient parameterization:

$$\mathbf{F}_M = \tfrac{1}{2}\, \rho\, C_L(S)\, A\, \lVert \mathbf{v}_{\text{rel}} \rVert^2 \; \frac{ \hat{\boldsymbol{\omega}} \times \mathbf{v}_{\text{rel}} }{ \lVert \hat{\boldsymbol{\omega}} \times \mathbf{v}_{\text{rel}} \rVert } \;\; \xrightarrow{\ \text{implemented as}\ } \;\;
\tfrac{1}{2}\, \rho\, C_L\, A\, \lVert \mathbf{v}_{\text{rel}} \rVert \, \left( \hat{\boldsymbol{\omega}} \times \mathbf{v}_{\text{rel}} \right)
\tag{3.15}$$

where the right-hand implemented form (valid when $\hat{\boldsymbol{\omega}} \perp \mathbf{v}_{\text{rel}}$, exact in the 2D configuration) avoids the normalization singularity as $\hat{\boldsymbol{\omega}} \times \mathbf{v}_{\text{rel}} \to 0$. The lift coefficient is modeled as a function of the **spin ratio**

$$S = \frac{\omega R}{\lVert \mathbf{v}_{\text{rel}} \rVert}, \qquad C_L(S) \approx \min(0.6,\ 1.6\,S) \ \text{(smooth-saturating fit; sport-specific tables in data assets)}
\tag{3.16}$$

In 2D, spin is a scalar $\omega$ (positive = backspin for rightward motion), $\hat{\boldsymbol{\omega}} = \hat{\mathbf{e}}_z$, and $\hat{\mathbf{e}}_z \times \mathbf{v}_{\text{rel}} = (-v_{\text{rel},y},\, v_{\text{rel},x})$: backspin lifts, topspin dives. Note the singularity risk at $\lVert\mathbf{v}_{\text{rel}}\rVert \to 0$ hidden in (3.16) through $S$; the implementation clamps $S$ and multiplies through so that $\mathbf{F}_M \to 0$ smoothly with $\lVert\mathbf{v}_{\text{rel}}\rVert$ (regression test T-VAL-14, apex of a vertical throw in still air).

**Spin decay:** $\dot{\omega} = -\omega / \tau_\omega$ with sport-typical $\tau_\omega \sim 20$–$30$ s, adding one state component when enabled. This is the first place the state dimension becomes model-dependent, exercising the variable-dimension design of Section 3.7.

## 3.7 State Vector Formulation

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
  jacobian?(t, y, out, ctx): void;             // optional analytic J = ∂f/∂y
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

## 3.8 Continuous-Time System Properties

Several analytic properties of (3.17) shape the numerical design and must be documented alongside the model:

**Smoothness.** With smooth $C_d$, $C_L$, atmosphere, and wind models, $\mathbf{f} \in C^\infty$ except at $\mathbf{v}_{\text{rel}} = 0$, where $u\,\mathbf{u}$ is $C^1$ but not $C^2$. Trajectories passing near stagnation (vertical throws in still air near apex have $u \ne 0$ generally, but pure vertical drop from rest starts *at* the kink) can locally limit high-order convergence; the validation suite includes this case deliberately.

**Lipschitz constant / stiffness scales.** Linearizing drag gives a velocity-relaxation timescale; for quadratic drag near speed $u$, $\tau_{\text{drag}} \sim m / (\rho C_d A\, u)$. Stiffness in this system is **parameter-induced**: a table-tennis ball ($\tau \sim 0.4$ s) is benign, a dust grain ($\tau \sim 10^{-4}$ s) with flight time of seconds yields stiffness ratio $\sim10^4$ and makes explicit Euler at visually-reasonable $\Delta t$ unstable — the platform's canonical stiffness demonstration (Section 4.8).

**Energy balance.** Define mechanical energy $E = \tfrac12 m \lVert\mathbf v\rVert^2 + mgy$. Along trajectories,

$$\frac{dE}{dt} = \mathbf{F}_{\text{aero}} \cdot \mathbf{v} = -\tfrac12 \rho C_d A\, u\, (\mathbf u \cdot \mathbf v) + \mathbf F_M \cdot \mathbf v
\tag{3.19}$$

In still air, drag strictly dissipates ($\mathbf u = \mathbf v$ ⇒ $dE/dt = -\rho C_d A\, \lVert\mathbf v\rVert^3/2 \le 0$) and the *ideal* Magnus force does no work ($\mathbf F_M \perp \mathbf v_{\text{rel}} = \mathbf v$). These give two exact runtime checks: (i) with all aero off, $E$ is conserved; (ii) with Magnus only, $E$ is conserved; (iii) with drag on in still air, $E$ is monotone non-increasing. The Recorder computes the **energy residual** $\;\mathcal R_E(t) = E(t) - E(0) - \int_0^t \mathbf F_{\text{aero}}\cdot\mathbf v\, dt'\;$ (work integral accumulated by the same quadrature order as the stepper) as a first-class diagnostic channel.

**Nondimensionalization.** With characteristic speed $v_0$ and time $v_0/g$, the drag-to-gravity ratio is governed by a single dimensionless group $\Pi = \rho C_d A v_0^2 / (2mg) = (v_0/v_T)^2$. The UI surfaces $\Pi$, $Re$, $S$, and $M$ live; the scenario library is organized by these groups rather than by raw parameters, which is both better pedagogy and better test coverage (each analytic/qualitative regime gets a representative scenario).

**Well-posedness of events.** Ground impact is the root of $g_{\text{gnd}}(t) = y(t) - y_{\text{terrain}}(x(t))$; apex is the root of $v_y(t)$. Both are simple roots for generic trajectories (transversality), but grazing impacts (near-tangent terrain) are a documented hard case with a dedicated bisection fallback in the event detector (Section 4.9 / task P2.31).

## 3.9 Projectile and Scenario Database

`ProjectileSpec` records $(m, R\ \text{or}\ A, C_d\text{-model}, C_L\text{-model}, \tau_\omega, \text{provenance})$. Initial data assets: smooth sphere, golf ball, soccer ball, baseball, table-tennis ball, cannonball (0.1 m iron), shot put, and "custom." Every numeric datum carries a citation field; the asset loader validates schemas (zod) at build time. Scenarios compose a projectile + environment + initial conditions + solver config into the ScenarioSpec of Section 2.3, and the preset library (Phase 3) ships with regime-spanning defaults: drag-free reference, low-$\Pi$ shot put, high-$\Pi$ table tennis, Magnus-dominated golf drive, stiff dust-grain, headwind/tailwind pairs.
---

# 4. Numerical Methods

This section is the intellectual core of the platform. Every method described here is (a) implemented in SolverKit behind the uniform `Stepper` interface, (b) accompanied by a convergence test in `@ballista/validation`, and (c) surfaced in the Solver Lab UI with its derivation.

## 4.1 Discretization of the IVP

We seek $\mathbf y(t)$ solving $\dot{\mathbf y} = \mathbf f(t, \mathbf y)$, $\mathbf y(t_0) = \mathbf y_0$, on $[t_0, t_f]$. A one-step method generates $\mathbf y_{k+1} = \mathbf y_k + h\, \boldsymbol\Phi(t_k, \mathbf y_k; h)$ with increment function $\boldsymbol\Phi$ and step $h = t_{k+1} - t_k$.

Two error notions must never be conflated (the Solver Lab visualizes both):

- **Local truncation error (LTE):** the defect after one step from exact data, $\boldsymbol\tau_{k+1} = \mathbf y(t_{k+1}) - \big[\mathbf y(t_k) + h\boldsymbol\Phi(t_k, \mathbf y(t_k); h)\big]$. A method has **order $p$** if $\boldsymbol\tau = \mathcal O(h^{p+1})$.
- **Global error:** $\mathbf e_k = \mathbf y(t_k) - \mathbf y_k$. For a stable order-$p$ method on a Lipschitz problem, $\lVert\mathbf e_k\rVert \le C h^p$, with the classical bound

$$\lVert \mathbf e_k \rVert \;\le\; \frac{C_\tau h^{p}}{L}\left( e^{L (t_k - t_0)} - 1 \right)
\tag{4.1}$$

where $L$ is the Lipschitz constant of $\mathbf f$. The exponential factor is not pessimism-for-show: it is why long integrations amplify early errors, and why the convergence harness always measures error at *fixed final time*, halving $h$, fitting the slope of $\log\lVert e\rVert$ vs. $\log h$.

## 4.2 Explicit Euler

$$\mathbf y_{k+1} = \mathbf y_k + h\, \mathbf f(t_k, \mathbf y_k)
\tag{4.2}$$

**Derivation.** Taylor: $\mathbf y(t_{k+1}) = \mathbf y(t_k) + h\dot{\mathbf y}(t_k) + \tfrac{h^2}{2}\ddot{\mathbf y}(\xi)$. Dropping the second-order term gives (4.2) with LTE $\tfrac{h^2}{2}\ddot{\mathbf y}$: order 1.

**Pitfalls, each demonstrable in-platform:**

1. **Energy growth on oscillatory/conservative dynamics.** For $\dot y = i\lambda y$ (undamped rotation), $|y_{k+1}| = |1 + ih\lambda||y_k| = \sqrt{1 + h^2\lambda^2}\,|y_k| > |y_k|$ for any $h>0$: explicit Euler *always* spirals outward on pure oscillation, regardless of step size. On the projectile this appears as systematic range/apex bias; on the pendulum model (Stage B) as the classic outward phase-space spiral.
2. **Conditional stability on dissipative dynamics.** See Section 4.6: stability requires $h < 2\tau_{\text{drag}}$ for the linearized drag mode.
3. **First-order error is *expensive*.** To reach $10^{-6}$ global error where RK4 needs $\sim10^2$ steps, Euler needs $\sim10^6$ — the platform's error-vs-cost (work–precision) diagram makes this visceral.

**Semi-implicit (symplectic) Euler**, nearly free to implement and dramatically better on mechanical systems:

$$\mathbf v_{k+1} = \mathbf v_k + h\, \mathbf a(t_k, \mathbf r_k, \mathbf v_k), \qquad \mathbf r_{k+1} = \mathbf r_k + h\, \mathbf v_{k+1}
\tag{4.3}$$

First order, but symplectic on separable Hamiltonian problems — bounded energy error rather than secular drift. Its inclusion beside explicit Euler is the platform's cheapest profound lesson.

## 4.3 Runge–Kutta 2 (Midpoint and Heun)

General explicit 2-stage RK:

$$\mathbf k_1 = \mathbf f(t_k, \mathbf y_k), \quad
\mathbf k_2 = \mathbf f(t_k + c_2 h,\ \mathbf y_k + h\, a_{21} \mathbf k_1), \quad
\mathbf y_{k+1} = \mathbf y_k + h (b_1 \mathbf k_1 + b_2 \mathbf k_2)
\tag{4.4}$$

**Order conditions (full derivation).** Expand the exact solution: with $\mathbf f' = \mathbf f_t + \mathbf f_y \mathbf f$ evaluated at $(t_k, \mathbf y(t_k))$,

$$\mathbf y(t_{k+1}) = \mathbf y + h \mathbf f + \tfrac{h^2}{2}(\mathbf f_t + \mathbf f_y \mathbf f) + \mathcal O(h^3).$$

Expand the method: $\mathbf k_2 = \mathbf f + c_2 h \mathbf f_t + a_{21} h\, \mathbf f_y \mathbf f + \mathcal O(h^2)$, so

$$\mathbf y_{k+1} = \mathbf y + h(b_1 + b_2)\mathbf f + h^2 b_2 \big( c_2 \mathbf f_t + a_{21} \mathbf f_y \mathbf f \big) + \mathcal O(h^3).$$

Matching through $h^2$:

$$b_1 + b_2 = 1, \qquad b_2 c_2 = \tfrac12, \qquad b_2 a_{21} = \tfrac12
\tag{4.5}$$

A one-parameter family. Named members: **midpoint** ($c_2 = a_{21} = \tfrac12$, $b = (0,1)$) and **Heun/trapezoidal** ($c_2 = a_{21} = 1$, $b = (\tfrac12, \tfrac12)$). Both are order 2; their LTE constants differ, which the platform demonstrates empirically (same slope, offset intercepts on the work–precision plot). Note $c_2 = a_{21}$ is forced — a fact worth surfacing pedagogically.

## 4.4 Classical RK4

Butcher tableau and scheme:

$$
\begin{array}{c|cccc}
0 & & & & \\
\tfrac12 & \tfrac12 & & & \\
\tfrac12 & 0 & \tfrac12 & & \\
1 & 0 & 0 & 1 & \\
\hline
 & \tfrac16 & \tfrac13 & \tfrac13 & \tfrac16
\end{array}
\qquad
\begin{aligned}
\mathbf k_1 &= \mathbf f(t_k, \mathbf y_k)\\
\mathbf k_2 &= \mathbf f(t_k + \tfrac h2, \mathbf y_k + \tfrac h2 \mathbf k_1)\\
\mathbf k_3 &= \mathbf f(t_k + \tfrac h2, \mathbf y_k + \tfrac h2 \mathbf k_2)\\
\mathbf k_4 &= \mathbf f(t_k + h, \mathbf y_k + h \mathbf k_3)\\
\mathbf y_{k+1} &= \mathbf y_k + \tfrac h6(\mathbf k_1 + 2\mathbf k_2 + 2\mathbf k_3 + \mathbf k_4)
\end{aligned}
\tag{4.6}$$

**Derivation sketch (honest but bounded).** Order-4 accuracy requires matching the Taylor expansion of the exact flow through $h^4$. The systematic tool is Butcher's rooted-tree theory: each elementary differential of $\mathbf f$ (e.g., $\mathbf f_y \mathbf f$, $\mathbf f_{yy}(\mathbf f,\mathbf f)$, $\mathbf f_y \mathbf f_y \mathbf f$, ...) corresponds to a rooted tree $\tau$, and order $p$ holds iff

$$\sum_i b_i\, \phi_i(\tau) = \frac{1}{\gamma(\tau)} \quad \text{for all trees with } |\tau| \le p
\tag{4.7}$$

where $\phi_i$ are stage weights and $\gamma$ the tree density. For $p=4$ there are 8 trees, hence 8 conditions; the classical coefficients (4.6) satisfy all 8 (the document's appendix-level companion notebook verifies this symbolically — task P2.14). For the scalar autonomous case the four explicit conditions are $\sum b_i = 1$, $\sum b_i c_i = \tfrac12$, $\sum b_i c_i^2 = \tfrac13$, $\sum b_i a_{ij} c_j = \tfrac16$, plus $\sum b_i c_i^3 = \tfrac14$, $\sum b_i c_i a_{ij}c_j = \tfrac18$, $\sum b_i a_{ij}c_j^2 = \tfrac1{12}$, $\sum b_i a_{ij}a_{jl}c_l = \tfrac1{24}$ for the vector case.

**Properties.** Order 4 with only 4 function evaluations per step — sitting exactly on the boundary where stage count equals order (for $p \ge 5$, explicit RK needs $> p$ stages; the platform states this Butcher-barrier fact in the Solver Lab). No embedded error estimate and no dense output natively — motivating Sections 4.5 and 4.9.

## 4.5 Adaptive Runge–Kutta (Embedded Pairs)

**Principle.** Run two methods of orders $p$ and $\hat p = p-1$ (or $p+1$) sharing the same stages; their difference estimates the LTE of the lower-order result:

$$\boldsymbol\delta_{k+1} = \mathbf y_{k+1} - \hat{\mathbf y}_{k+1} = h \sum_i (b_i - \hat b_i)\, \mathbf k_i = \mathcal O(h^{\hat p + 1})
\tag{4.8}$$

**Implemented pairs.**

- **Bogacki–Shampine 3(2)** (`RK23`): 4 stages, FSAL (first-same-as-last: $\mathbf k_4$ of step $k$ is $\mathbf k_1$ of step $k+1$), effective 3 evaluations/step; the right default for loose-tolerance interactive use.
- **Dormand–Prince 5(4)** (`RK45`, a.k.a. DOPRI5): 7 stages, FSAL, with a free 4th-order dense-output interpolant — the platform's reference production solver and the one used by MATLAB's `ode45`/SciPy's default.

**Step-size controller.** Given per-component tolerance $sc_i = \text{atol}_i + \text{rtol}\cdot\max(|y_{k,i}|, |y_{k+1,i}|)$ and error norm

$$\text{err} = \sqrt{ \frac{1}{n} \sum_{i=1}^{n} \left( \frac{\delta_i}{sc_i} \right)^2 }
\tag{4.9}$$

accept the step iff $\text{err} \le 1$ and update

$$h_{\text{new}} = h \cdot \min\Big( f_{\max},\ \max\big( f_{\min},\ f_s\, \text{err}^{-1/(\hat p + 1)} \big) \Big)
\tag{4.10}$$

with safety $f_s = 0.9$, clamps $f_{\min} = 0.2$, $f_{\max} = 5$ (tighter $f_{\max} = 1$ conventions after a rejection). A **PI controller** variant, $h_{\text{new}} = h\, f_s\, \text{err}_k^{-\alpha}\, \text{err}_{k-1}^{\beta}$ with $(\alpha, \beta) \approx (0.7/\hat p,\ 0.4/\hat p)$, is implemented as a selectable strategy: it visibly suppresses the accept/reject chatter of the elementary controller on the drag-crisis scenario (where $C_d(Re)$ changes rapidly), which is a Solver Lab exhibit in its own right. Mandatory guards: $h_{\min}$ floor with diagnostic failure (not silent stall), step clamping at $t_f$ and at event localizations, and rejection-count telemetry in `SolveStats`.

**What tolerance means.** rtol/atol control *local* error per step; global error is related but not bounded by tolerance. The platform makes this honest distinction measurable: a "tolerance calibration" exhibit plots achieved global error against requested rtol across scenarios.

## 4.6 Linear Stability Analysis

Apply a method to the Dahlquist test equation $\dot y = \lambda y$, $\lambda \in \mathbb C$, giving $y_{k+1} = R(z) y_k$, $z = h\lambda$. The **stability region** is $\mathcal S = \{ z : |R(z)| \le 1 \}$.

$$R_{\text{Euler}}(z) = 1 + z, \qquad
R_{\text{RK2}}(z) = 1 + z + \tfrac{z^2}{2}, \qquad
R_{\text{RK4}}(z) = \sum_{j=0}^{4} \frac{z^j}{j!}
\tag{4.11}$$

Euler's region is the disk $|1+z| \le 1$; RK4's region extends to $\approx -2.785$ on the real axis and, unlike Euler/RK2, includes a genuine interval of the imaginary axis ($|z| \lesssim 2\sqrt2$) — the reason RK4 tolerates oscillatory dynamics that destabilize Euler at any $h$. The Solver Lab renders $|R(z)| = 1$ contours interactively and overlays the *actual eigenvalues* $h\lambda_i$ of the current scenario's Jacobian along the trajectory (Jacobian by analytic formula or automatic finite differences), animating how $z$ migrates as the projectile decelerates. This connects abstract stability theory to the concrete simulation like nothing else in the platform.

For the projectile, linearization of quadratic drag about speed $u$ yields velocity-block eigenvalues $\lambda \approx -\rho C_d A\, u / m \cdot \{1, \tfrac12\}$ (streamwise doubles the crosswise rate since $\partial_u(u^2) = 2u$). Explicit Euler thus requires approximately

$$h < \frac{2}{|\lambda|_{\max}} = \frac{m}{\rho C_d A\, u_{\max}}
\tag{4.12}$$

— the quantitative form of the stiffness statement in Section 3.8, verified empirically by task P2.22's automated stability-boundary sweep.

**A-stability and the implicit outlook.** No explicit RK method is A-stable ($\mathcal S \supseteq \mathbb C^-$). The platform includes one implicit reference method — backward Euler with damped Newton, $R(z) = (1-z)^{-1}$ — precisely to complete the stiffness story: on the dust-grain scenario it takes visually-sized stable steps where RK4 must crawl. TR-BDF2 or SDIRK2 is an optional Phase-4 stretch (task P4.38).

## 4.7 Error Propagation and Floating Point

Beyond truncation error, three propagation effects are treated explicitly:

1. **Condition of the IVP itself.** Perturbations grow like the fundamental matrix $\lVert \partial \mathbf y(t_f)/\partial \mathbf y_0 \rVert$; drag makes the projectile *contractive* in velocity (errors decay), while near-grazing terrain events are ill-conditioned in *outcome* (impact point) even when the state is well-conditioned. The Monte Carlo machinery of Phase 6 doubles as an empirical conditioning probe.
2. **Rounding.** Global rounding error scales like $\epsilon_{\text{mach}} \cdot t_f / h$ — it *grows* as $h$ shrinks, producing the classic V-shaped total-error curve $E(h) \approx C_1 h^p + C_2 \epsilon/h$ with optimum $h^* \sim (\epsilon/C)^{1/(p+1)}$. The convergence harness runs deep enough in $h$ to *show* the V on the Euler curve in Float64 and dramatically in an optional Float32 mode (which also previews GPU precision issues, Section 10.1). **Compensated (Kahan) summation** on the state update is implemented as a toggle; its visible flattening of the rounding branch is a flagship exhibit.
3. **Reproducibility.** Determinism budget per Section 2.6: fixed evaluation order, no `Math.fma` reliance, seeded RNG (PCG32 or xoshiro128**), and documented tolerance for cross-browser drift ($\lesssim 10^{-13}$ relative over a standard flight; measured, not assumed, in CI across engines).

## 4.8 Energy Behavior and Geometric Integration

For the *conservative* sub-problem (drag off), the system is Hamiltonian with $H(\mathbf r, \mathbf v) = \tfrac12 m\lVert\mathbf v\rVert^2 + mgy$. Non-symplectic methods exhibit secular energy drift $\Delta E \propto t$; symplectic integrators of order $p$ instead conserve a *modified* Hamiltonian $\tilde H = H + \mathcal O(h^p)$, yielding bounded oscillatory energy error over exponentially long times (backward error analysis). Implemented structure-preserving methods:

**Störmer–Verlet / leapfrog (order 2, symplectic, symmetric)** for $\ddot{\mathbf q} = \mathbf a(\mathbf q)$:

$$\mathbf v_{k+1/2} = \mathbf v_k + \tfrac h2 \mathbf a(\mathbf q_k), \quad
\mathbf q_{k+1} = \mathbf q_k + h\, \mathbf v_{k+1/2}, \quad
\mathbf v_{k+1} = \mathbf v_{k+1/2} + \tfrac h2 \mathbf a(\mathbf q_{k+1})
\tag{4.13}$$

Velocity-dependent forces (drag, Magnus) break exact symplecticity; the platform ships the standard practical compromise (velocity-Verlet with one fixed-point or extrapolated velocity pass for $\mathbf a(\mathbf q, \mathbf v)$) and *labels it honestly* — the drag projectile is dissipative anyway, so "energy conservation" is replaced by the **work–energy residual** $\mathcal R_E$ of Eq. (3.19) as the universal correctness diagnostic. The gravity-only mode remains the clean stage for the symplectic story (pendulum and two-body models in Stage B extend it).

**The flagship comparison exhibit** (task P4.12): gravity-only lofted shot, fixed cost budget (equal RHS evaluations), four traces of $E(t)/E(0) - 1$: explicit Euler (linear growth), RK4 (tiny but *secular* drift), symplectic Euler (bounded sawtooth), Verlet (smaller bounded sawtooth). This single plot teaches more geometric integration than a lecture.

## 4.9 Dense Output and Event Detection

**Dense output.** Rendering, event location, and Monte Carlo observables all need $\mathbf y(t)$ *between* steps. For DOPRI5 the free 4th-order interpolant $\boldsymbol\theta \mapsto \mathbf y_{k+\theta}$ built from the stages is used; for fixed-step RK4, cubic Hermite interpolation on $(\mathbf y_k, \mathbf f_k, \mathbf y_{k+1}, \mathbf f_{k+1})$ (order 3 locally, adequate for display; documented as lower-order than the step). The `Trajectory` object stores per-step interpolation coefficients so playback never re-integrates.

**Event detection.** Events are declared as $g_j(t, \mathbf y) = 0$ with direction (rising/falling/any) and terminal flag. Algorithm per accepted step: (1) sign check $g_j(t_k)\,g_j(t_{k+1}) < 0$ (plus a stationary-point guard sampling the dense output at 3 interior points for grazing detection); (2) localize the root of $\theta \mapsto g_j(t_k + \theta h,\ \mathbf y_{k+\theta})$ by safeguarded Newton/bisection (Brent) to tolerance $\sim 10^2 \epsilon_{\text{mach}} \cdot t$; (3) if terminal, truncate the step to the event time, record the event state, stop or reflect (bounce model multiplies $v$ components by restitution/friction coefficients — Phase 4). Ordering matters when multiple events fire within a step: earliest-first, re-scan remainder.

## 4.10 Method Selection Guidance (as encoded in the platform)

| Regime | Recommended | Rationale |
|---|---|---|
| Interactive sliders, sports projectiles | DOPRI5, rtol $10^{-6}$ | fast, robust, dense output free |
| Teaching order/convergence | Euler, RK2 (both), RK4 fixed-step | clean orders, no controller confound |
| Gravity-only, long-time, conservation focus | Verlet / symplectic Euler | bounded energy error |
| Stiff (dust grain, heavy drag, small $m$) | backward Euler (reference), or DOPRI5 with warning + step telemetry | correctness of story over speed |
| Ensembles / Monte Carlo | fixed-step RK4 (uniform cost, GPU-friendly) or RK23 loose | throughput; divergence-free control flow for GPU |

The runtime encodes this table as a *solver advisor*: it inspects scenario dimensionless groups and emits non-blocking recommendations with links to the relevant Solver Lab exhibit — pedagogy embedded in UX.
---

# 5. Software Architecture

## 5.1 Core Simulation Engine Design

The engine's design goal is stated as an invariant: **the hot path allocates nothing.** A single RHS evaluation, a single RK stage, a single accepted step — none may allocate on the JS heap. All working memory (stage buffers $\mathbf k_1..\mathbf k_7$, temporary states, force accumulator) is preallocated per solver instance at `init(model)` and reused. This is what keeps interactive latency under one frame, keeps GC pauses out of the render loop, and makes the eventual WASM port near-mechanical.

Core type sketch (TypeScript, abbreviated):

```ts
// L0 — physics
interface ForceModel {
  readonly id: string;
  readonly paramsSchema: Schema;                    // zod schema, drives auto-UI
  accumulate(t: number, s: KinematicState, env: EnvSample,
             p: Params, outForce: Vec): void;       // ADDS into outForce
  energyPower?(t, s, env, p): number;               // F·v for work-integral channel
}

interface Environment {
  sample(t: number, r: Vec, out: EnvSample): void;  // ρ, T, η, c, w(t,r), g(r)
}

interface Model {                                    // as declared in §3.7
  dim: number; channels: ChannelMeta[];
  rhs(t: number, y: F64, out: F64, ctx: EvalCtx): void;
  invariants?: InvariantSpec[]; events?: EventSpec[];
  jacobian?(t: number, y: F64, outJ: F64): void;
  partitions?: Partitions;
}

// L1 — numerics
interface Stepper {
  readonly info: { id: string; order: number; embeddedOrder?: number;
                   fsal: boolean; denseOrder?: number; symplectic: boolean };
  init(model: Model): void;                          // allocate stage buffers
  step(t: number, y: F64, h: number, out: StepResult): void;
  interpolant?(theta: number, out: F64): void;       // dense output for last step
}

interface SolverConfig { stepper: StepperId; h?: number;
  rtol?: number; atol?: number | F64; controller?: 'I'|'PI';
  maxSteps: number; hMin?: number; }

function integrate(model: Model, y0: F64, tspan: [number, number],
  cfg: SolverConfig, sinks: Sink[]): SolveReport;    // pull/push hybrid, cancellable
```

Design points:

- **Forces add, never set.** `accumulate` sums into a shared accumulator; the projectile model's `rhs` zeroes it, samples the environment once per evaluation (one `EnvSample` reused), runs the enabled force list, divides by $m$. Force order is fixed (sorted by id) for determinism.
- **Sinks, not arrays.** `integrate` emits to composable `Sink`s: `TrajectoryRecorder` (columnar store, optional stride/decimation), `InvariantMonitor` (energy residual channel), `EventCollector`, `StatsCollector` (n_steps, n_rejected, n_rhs, h histogram). Batch mode attaches only the sinks it needs — Monte Carlo typically records nothing but event states and observables, which is the difference between $10^3$ and $10^5$ runs/s.
- **Cancellation & chunking.** Long integrations yield control cooperatively (`maxSteps`-per-slice with a continuation token) so both main-thread interactivity and worker-side cancellation are structural, not bolted on.
- **Error taxonomy.** Every failure is typed: `StepSizeUnderflow`, `MaxStepsExceeded`, `NonFiniteState` (NaN guard checks the state each accepted step — the single most valuable debugging feature in any solver), `EventLocalizationFailure`. Reports carry the last-good state and time.

## 5.2 Physics Module Interfaces and Extensibility

Adding a force must require: one file implementing `ForceModel`, one registration call, zero engine edits. The **registry pattern** governs forces, atmospheres, wind fields, drag/lift coefficient models, steppers, projectiles, and scenarios alike:

```ts
registry.force.register(magnusForce);
registry.stepper.register(dopri5);
registry.model.register(planarProjectileModel);
```

Because every registrable carries a `paramsSchema`, the UI *generates* parameter controls (slider/number/select with units and ranges) from the schema — new physics appears in the interface without UI code (Section 6.3). Schemas also serialize: ScenarioSpec stores `(registryId, paramsJSON)` pairs, so save/load and shareable URLs survive extension.

**Versioned specs.** ScenarioSpec carries `schemaVersion`; loaders migrate old versions forward (a small chain of pure migration functions, each tested). Golden regression trajectories (Section 8.4) pin both scenario schema version and engine version, so numerical changes are always deliberate and reviewed.

## 5.3 Model / View / Controller Separation

The platform applies MVC at the *application* scale (not per-widget):

- **Model** = domain state: the current ScenarioSpec (draft, being edited) + the last committed `Trajectory`/`EnsembleResult` + session status. Held in a framework-agnostic store (nanostores/zustand-style) with immutable snapshots.
- **Controller** = `SimulationSession` (L2): validates a ScenarioSpec, decides main-thread vs. worker execution, runs `integrate`, owns the playback clock, publishes results and diagnostics to the store. All mutation flows through session commands (`commitScenario`, `play`, `pause`, `scrubTo`, `cancel`).
- **View** = L3 + L4: pure functions of store snapshots. Viz reads `(Trajectory, playbackTime, cameraState)`; UI reads `(draftSpec, status, diagnostics)` and dispatches commands.

Two subtleties that make or break interactive scientific UIs:

1. **Draft/committed split.** Slider drags mutate a *draft* spec at input rate; commits (and thus re-integration) are scheduled per animation frame with latest-wins coalescing. Because a full solve is sub-millisecond at interactive tolerance, the user experiences continuous re-simulation — but the architecture never *assumes* that speed, so heavier scenarios degrade to debounced commits gracefully.
2. **Playback is derived state.** `playbackTime` maps to trajectory state via dense output; scrubbing is pure lookup. Pause/slow-motion/replay require no solver interaction. The Recorder retains interpolation coefficients precisely for this.

## 5.4 State Management and Data Model

Canonical stores and their lifetimes:

| Store | Contents | Mutability |
|---|---|---|
| `scenarioStore` | draft ScenarioSpec, committed ScenarioSpec, preset list | draft mutable; committed replaced atomically |
| `resultStore` | Trajectory / EnsembleResult (columnar, typed arrays), SolveStats, events | immutable after publish |
| `playbackStore` | playbackTime, speed, loop mode | mutable, per-frame |
| `uiStore` | panel layout, selected exhibits, units display prefs | mutable, persisted to localStorage |
| `compareStore` | list of pinned trajectories (method-comparison mode) | append/remove |

Immutability of results is enforced by construction: recorders return frozen objects exposing `subarray` views. The compare workflow ("pin" a trajectory, change solver, re-run, overlay) falls out of result immutability for free and is the backbone of Solver Lab exhibits.

## 5.5 Extensibility Design: Worked Examples

The architecture is validated by three paper exercises that Phase 4/5 then implement literally:

1. **New force (buoyancy).** Implement `ForceModel` (8 lines of math), schema (density ratio), register. Auto-UI shows toggle+params; energy channel picks up `energyPower`. *No other edits.* — Realized as task P4.20.
2. **New model dimension (spin decay).** Register `planarProjectileSpinModel` with `dim = 5`, extra channel `ω`; steppers are dimension-agnostic; Viz gains a channel automatically (plottable in analysis pane); trajectory renderer ignores unknown channels. — Task P4.07.
3. **New stepper (Verlet).** Implement `Stepper` using `model.partitions`; register; appears in solver panel dropdown; convergence harness auto-includes it (order asserted from `info.order`). — Task P4.10.

If any of these requires touching a file outside the new module + registration, that is an architecture defect to be fixed, not worked around.

## 5.6 Concurrency Architecture

- **Main thread:** UI, Viz, and *interactive* single solves (latency-critical, sub-ms).
- **Worker pool (L2):** `navigator.hardwareConcurrency - 1` workers, each loading the pure L0/L1 bundle. Job types: `sweep` (parameter grids), `mc` (Monte Carlo batches with per-worker RNG substreams — seed + stream-id, never shared state), `convergence`, `optimize`. Results return as transferable `ArrayBuffer`s; progress via streamed messages (throttled).
- **Determinism under parallelism:** MC estimators define a *reduction order* (by replicate index, not arrival order) so ensemble statistics are bit-stable regardless of scheduling. This is cheap now and priceless later.
- **Phase 7 seam:** the worker job protocol is the exact interface a WASM or WebGPU executor implements; the pool becomes a heterogeneous scheduler (Section 10.2).

## 5.7 Repository, Tooling, Documentation

Monorepo layout mirrors Section 2.2 (`packages/engine`, `solverkit`, `analysis`, `runtime`, `viz`, `ui`, `app`, `validation`). CI pipeline: typecheck → lint (incl. import-boundary rule) → unit tests → convergence suite (fast subset) → golden-trajectory regression → bundle-size check → deploy preview. Architecture Decision Records live in `/docs/adr/` (numbered; ADR-001 layering, ADR-004 no-allocation hot path, ADR-007 plotting library, ADR-011 frozen stochastic realizations, ADR-014 Float64-only core, ...). Every public API carries TSDoc; the derivations of Section 4 live as literate docs beside their implementations.

---

# 6. Visualization and Web Interface

## 6.1 Real-Time Rendering Architecture

The Viz layer is a small retained-mode scene graph over an immediate-mode Canvas 2D backend (WebGL2 backend added in Phase 7 behind the same layer API):

```
Scene
 ├── WorldLayer (world coordinates, camera-transformed)
 │    ├── TerrainLayer        ground line / height function
 │    ├── FieldLayer          wind vector field (grid arrows / streamlines)
 │    ├── TrajectoryLayer[×N] committed + pinned trajectories
 │    ├── GhostLayer          faded comparison / analytic overlay
 │    ├── ProjectileLayer     marker at playbackTime, velocity/force glyphs
 │    └── AnnotationLayer     apex, impact, range markers, target
 └── HudLayer (screen coordinates)
      ├── AxesLayer           adaptive ticks (1-2-5 progression), units
      └── ReadoutLayer        t, |v|, E, Re, S, Π live values
```

**Frame loop discipline.** One `requestAnimationFrame` driver; each frame: advance playback clock → sample dense output for marker states → redraw only invalidated layers (dirty flags; static trajectory geometry is cached to an offscreen canvas and blitted, so steady-state cost is marker + HUD only). Device-pixel-ratio-aware sizing; all text via a HUD pass so world zoom never blurs labels.

**Camera.** `Camera2D` = pan + zoom (anisotropic allowed: $x$ and $y$ scales may differ, essential when range ≫ height). Auto-fit computes bounds from trajectory extrema with padding; user pan/zoom disables auto-fit until reset. World↔screen transforms are pure functions used by both rendering and picking (hover-to-inspect a trajectory point shows full state tooltip).

## 6.2 Trajectory and Field Plotting

- **Trajectory polyline:** rendered from the columnar store via `Path2D`, decimated for display with a tolerance-based algorithm (Ramer–Douglas–Peucker in *screen* space, recomputed on zoom) so a 50k-step stiff run still draws in ≪1 ms. Optional coloring by scalar channel (speed, $|F_d|$, local $Re$) using a perceptually-uniform colormap (viridis family only; no rainbow — stated as a hard style rule).
- **Vector field overlay:** wind sampled on a screen-anchored grid (~24×16 arrows), arrow length ∝ magnitude with a max-length clamp and a magnitude legend; optional streamlines by RK2 integration of the *display* field (cheap, purely visual — explicitly not the physics path). Time-varying winds animate the field at reduced tick rate (10 Hz) to avoid distraction.
- **Force glyphs at the projectile:** live arrows for $\mathbf F_g$, $\mathbf F_d$, $\mathbf F_M$ and resultant — small, always-legible, log-scaled with legend. This single feature does more for physical intuition than any panel of numbers.
- **Analysis plots (PlotPane):** time series ($y$, $v$, $E$, $\mathcal R_E$, $h_k$ step-size trace), phase plots, work–precision (log–log) charts, stability-region view. Implementation: a thin custom canvas plotter for the always-on panes (tiny, fast, matches app style) + lazy-loaded Plotly for exploratory panes (zoom/export-rich). This split is ADR-007; revisit if the custom plotter's scope creeps.

## 6.3 UI Controls

**Control panel groups** (right dock, collapsible, generated from schemas where possible):

1. **Launch:** $v_0$ (0–150 m/s), $\theta$ (0–90°), height, spin $\omega$ (±500 rad/s). Sliders with synced numeric inputs; logarithmic scaling where ranges are wide; keyboard nudge (±1 step, shift = fine).
2. **Projectile:** preset dropdown (Section 3.9) + custom mass/radius/$C_d$ model.
3. **Environment:** gravity preset, atmosphere model, wind model + its params.
4. **Forces:** per-force enable toggles with live badge showing current magnitude at playhead.
5. **Solver:** method dropdown (grouped: fixed / adaptive / geometric / implicit), $h$ or rtol/atol, controller I/PI, advisor hints inline.
6. **Simulation controls:** run/pause/step-one-frame/scrub bar (with event tick marks at apex/impact), speed 0.1×–10×, "pin trajectory" for comparison, reset.
7. **Presets & sharing:** scenario library, save/load (localStorage + JSON file), copy-URL (spec compressed into fragment via base64url of deflated JSON).

**Interaction principles:** every scientifically meaningful quantity visible somewhere on demand; every control change reflected within one frame; units toggleable (SI default; imperial display-only conversion at the boundary — internal state never leaves SI); full keyboard operability and prefers-reduced-motion respected (accessibility is a stated requirement, tasks P3.34–P3.36).

**Solver Lab mode** (distinct route): the pedagogical face. Side-by-side method comparison against reference solution, convergence-study runner (pick scenario + methods + $h$ ladder → auto log–log plot with fitted slopes), stability-region explorer, energy-drift dashboard, tolerance-calibration exhibit. Each exhibit pairs the interactive view with a short derivation panel (rendered from the same markdown/LaTeX sources as this document's Section 4 — single-source pedagogy).

## 6.4 Web Technology Decisions

| Concern | Choice | Alternatives considered / trigger to revisit |
|---|---|---|
| World rendering | Canvas 2D | WebGL2 now: rejected (complexity unneeded ≤ ~50k segments); adopt in Phase 7 for ensembles (>200 trajectories or heatmaps) |
| 3D (Phase 7+) | Three.js | regl/raw WebGL if bundle budget threatened |
| Analysis plots | custom canvas + lazy Plotly | uPlot if Plotly weight bites; D3 rejected (imperative canvas is simpler here) |
| Math rendering | KaTeX | MathJax rejected (weight/speed) |
| State | nanostores (framework-agnostic) | Redux rejected (ceremony) |
| Numerics language | TypeScript now; AS/Rust-WASM Phase 7 | JS BigInt/decimal rejected; Float64 core is ADR-014 |

## 6.5 Browser Performance Constraints

Hard realities the design already respects, restated as budgets: 16.6 ms frame budget with ≤ 4 ms for Viz at steady state; no per-frame allocation in the render loop (reused transforms, cached paths); main-thread solve budget 5 ms (beyond → worker); typed-array transfers, never structured-clone of large results; passive event listeners for wheel/touch; `content-visibility` and lazy mounting for analysis panes; Lighthouse performance ≥ 90 as a CI gate on the deployed preview. Memory: a 10 s flight at rtol $10^{-6}$ is ~$10^2$–$10^3$ steps ⇒ trajectories are kilobytes; the constraint that matters is *ensembles* (Phase 6: cap retained per-replicate data, stream reductions) — designed for from the start via Sink selection, not retrofitted.
---

# 7. Task-Based Development Roadmap

**Conventions.** Each task is atomic (5–30 min), testable, and lands on main behind CI. Difficulty: E(asy)/M(edium)/H(ard). "Validation" states the objective acceptance check — a passing test, a measured number, or an observable behavior. Tasks within a phase are ordered by dependency; cross-phase dependencies are noted inline. Estimated totals: **278 tasks, ≈ 95 hours of focused implementation time** (calendar time will be larger; treat estimates as complexity signals, not commitments).

## Phase 0: Project Bootstrap (12 tasks)

| ID | Task | Est | Diff | Validation |
|---|---|---|---|---|
| P0.01 | Init pnpm monorepo with `packages/{engine,solverkit,analysis,runtime,viz,ui,app,validation}` | 20m | E | `pnpm -r build` succeeds on empty packages |
| P0.02 | Configure TypeScript strict mode, project references, path aliases | 20m | E | cross-package import typechecks; `tsc -b` clean |
| P0.03 | Add Vitest; one trivial test per package | 10m | E | `pnpm -r test` green |
| P0.04 | Add ESLint + import-boundary rule (dependency-cruiser) encoding L0–L5 layering | 30m | M | test: import from `viz` inside `engine` fails CI |
| P0.05 | GitHub Actions CI: typecheck, lint, test on push | 20m | E | red/green status visible on PR |
| P0.06 | Vite app shell in `app`; deploys "hello" page | 15m | E | static preview URL renders |
| P0.07 | Set up ADR directory; write ADR-001 (layering) and ADR-004 (no-alloc hot path) | 25m | E | ADRs reviewed and merged |
| P0.08 | Add Prettier + pre-commit hook | 10m | E | formatting enforced in CI |
| P0.09 | Define `Vec2` ops module (add, scale, norm, dot, cross-z) as pure functions on arrays | 20m | E | unit tests incl. norm of zero vector |
| P0.10 | Define units/constants module (`G_STD`, ISA constants, conversions deg↔rad, SI↔display) | 15m | E | round-trip conversion property test |
| P0.11 | Seeded PRNG (PCG32): `nextF64`, `nextGaussian` (ziggurat or Box–Muller), substreams | 30m | M | KS test vs uniform on 1e5 draws passes; same seed ⇒ same sequence |
| P0.12 | Bundle-size CI check (budget from §2.6) | 15m | E | CI fails if app > 300 kB gz |

## Phase 1: Core Physics Engine (44 tasks)

| ID | Task | Est | Diff | Validation |
|---|---|---|---|---|
| P1.01 | Define `ChannelMeta`, `Params`, `Schema` types; adopt zod for schemas | 20m | E | schema parse/reject unit tests |
| P1.02 | Define `EnvSample` struct (ρ, T, p, η, c, w[2], g) as reusable buffer object | 15m | E | typecheck; zero-alloc reuse test (no new objects across 1e4 samples) |
| P1.03 | Define `Environment` interface + `ConstantAtmosphere` (ISA sea level) | 15m | E | returns ρ=1.225 ±0 everywhere |
| P1.04 | Implement `UniformGravity` environment component; altitude model behind flag | 15m | E | g(0)=9.80665; g(100)/g(0) matches (3.3) to 1e-12 |
| P1.05 | Define `ForceModel` interface with `accumulate` (adds into out) + `energyPower` | 20m | E | mock force: accumulator sums two forces correctly |
| P1.06 | Implement gravity force | 10m | E | F=(0,−mg) exact |
| P1.07 | Implement linear drag force with wind-relative velocity per (3.4)–(3.5) | 20m | E | F ∥ −v_rel; magnitude b·|v_rel| to 1e-15 |
| P1.08 | Implement quadratic drag with constant C_d per (3.8) | 20m | E | magnitude ½ρC_dA|u|² at 5 random states |
| P1.09 | Guard drag at |v_rel|→0 (no NaN; force→0 smoothly) | 15m | M | rhs at v=w returns finite zeros |
| P1.10 | Define `DragCoefficientModel` interface; `ConstantCd` impl | 10m | E | returns 0.47 |
| P1.11 | Implement PCHIP monotone cubic interpolator (general utility) | 30m | M | interpolates monotone data without overshoot; matches SciPy PCHIP on fixture to 1e-10 |
| P1.12 | Tabulated `Cd(Re)` smooth-sphere model using P1.11 incl. drag crisis | 25m | M | Cd(1e3)≈0.47±10%, Cd(4e5)<0.2; C¹ continuity spot-check by finite differences |
| P1.13 | Compute Re, Mach in `EvalContext` per (3.9); expose as derived channels | 20m | E | hand-computed Re for golf-ball case matches to 1e-12 |
| P1.14 | Implement Magnus force per (3.15) with C_L(S) per (3.16), 2D specialization | 25m | M | backspin ⇒ F_M·ĵ>0 for rightward motion; F_M ⊥ v_rel to 1e-14 |
| P1.15 | Clamp/smooth S at low speed; verify F_M→0 as |v_rel|→0 | 15m | M | no NaN at apex-of-vertical-throw state |
| P1.16 | Implement buoyancy force (toggle) | 10m | E | soccer preset: |F_b|/|F_g| ≈ 1.0–1.6% |
| P1.17 | Force registry with id-sorted deterministic iteration | 15m | E | registration order does not change rhs output (bit test) |
| P1.18 | `composeForces`: accumulator zeroing, env sampled once per eval | 15m | E | env.sample call-count == 1 per rhs (spy test) |
| P1.19 | Define `Model` interface (§3.7) incl. partitions, invariants, events decl | 20m | E | typecheck; mock model integrates via stub |
| P1.20 | Implement `planarProjectileModel` (dim 4) wiring forces per (3.17)–(3.18) | 25m | M | rhs vs hand-expanded (3.18) at 10 random states to 1e-14 |
| P1.21 | Zero-allocation audit of rhs path (allocation-count test harness) | 25m | M | 1e5 rhs evals allocate 0 objects after warmup |
| P1.22 | Analytic Jacobian for gravity+quadratic-drag (no Magnus) | 30m | H | matches central finite differences to 1e-7 at 10 states |
| P1.23 | Generic finite-difference Jacobian fallback (scaled steps) | 20m | M | matches P1.22 analytic where available |
| P1.24 | Energy invariant spec: E(y) and per-force `energyPower` wiring per (3.19) | 20m | M | drag-off: dE/dt from powers ≡ 0 to 1e-13 |
| P1.25 | `ProjectileSpec` schema + assets: sphere, golf, soccer, baseball, TT ball, cannonball, shot put | 30m | E | assets validate; each has provenance string |
| P1.26 | Asset loader with build-time schema validation | 15m | E | corrupt fixture rejected with useful error |
| P1.27 | Exponential atmosphere ρ(y)=ρ₀e^(−y/H) | 10m | E | ρ(H)=ρ₀/e to 1e-15 |
| P1.28 | Sutherland viscosity η(T) per (3.12) | 10m | E | η(288.15K)=1.789e−5±1% |
| P1.29 | `WindField` interface + uniform steady wind | 10m | E | w constant everywhere |
| P1.30 | Log-profile wind per (3.13) with y≤0 guard | 20m | M | w(y_r·(e−1))·κ/u* = 1 check; w finite at y=0 |
| P1.31 | Sinusoidal gust wind w(t) | 10m | E | matches formula at sampled t |
| P1.32 | Gaussian vortex analytic wind field | 25m | M | circulation integral on ring ≈ Γ to 1% (numeric quadrature test) |
| P1.33 | Gridded wind field + bilinear sampling, out-of-domain clamp policy | 30m | M | reproduces linear field exactly; clamp documented+tested |
| P1.34 | `ScenarioSpec` schema v1 (model, params, ICs, env, solver cfg, seed, schemaVersion) | 25m | M | serialize→parse round-trip bit-equal |
| P1.35 | Scenario migration framework (v_n→v_{n+1} chain) with identity v1 migration | 20m | M | fabricated v0 fixture migrates and validates |
| P1.36 | Preset scenarios: drag-free ref, shot put, table-tennis, golf-drive (Magnus), dust-grain (stiff), head/tailwind pair | 25m | E | each parses; dimensionless Π spans ≥3 decades across set |
| P1.37 | Characteristic-scales computer: v_T (3.10), τ_drag, Π, apex estimate | 20m | E | v_T for skydiver-like preset ≈ 50–60 m/s |
| P1.38 | Nondimensional groups exposed as scenario metadata | 10m | E | Π(shot put) < 0.1 < Π(TT ball) |
| P1.39 | Terrain model: flat y=0 + height function h(x) interface | 15m | E | ground event function g=y−h(x) evaluates |
| P1.40 | Event specs on model: ground impact (falling, terminal), apex (v_y falling) | 15m | E | declared specs typecheck; unit eval of g at states |
| P1.41 | `InvariantSpec` for momentum-x when no horizontal forces (teaching case) | 10m | E | drag-off, wind-off: dp_x/dt ≡ 0 |
| P1.42 | Property-based tests: force symmetry (mirror x ⇒ mirror F_x), rotational consistency of drag | 30m | M | fast-check suite green, 1e3 cases |
| P1.43 | Engine API docs (TSDoc) + generated reference page | 25m | E | docs build in CI; no missing-doc warnings on public API |
| P1.44 | ADR-011 (frozen stochastic realizations), ADR-014 (Float64 core) written | 20m | E | merged after review |

## Phase 2: Numerical Integration (52 tasks)

| ID | Task | Est | Diff | Validation |
|---|---|---|---|---|
| P2.01 | Define `Stepper`, `StepResult`, `SolverConfig`, `SolveReport` types (§5.1) | 25m | E | typecheck; mock stepper drives `integrate` skeleton |
| P2.02 | Implement `integrate()` fixed-step driver: loop, t_f clamp, sink dispatch | 30m | M | integrates ẏ=−y with mock Euler; final t exactly t_f |
| P2.03 | NaN/Inf state guard per accepted step with typed `NonFiniteState` failure | 15m | E | rhs returning NaN produces failure report with last-good state |
| P2.04 | `TrajectoryRecorder` sink: columnar Float64 SoA, growth by doubling, freeze on finish | 25m | M | 1e4 steps recorded; subarray views zero-copy (identity check) |
| P2.05 | `StatsCollector` sink: nSteps, nRHS, nRejected, h min/max/histogram | 15m | E | counts match instrumented mock |
| P2.06 | Explicit Euler stepper (preallocated buffers) | 15m | E | one step of ẏ=−y matches 1+h·(−1) exactly |
| P2.07 | Convergence harness: run method on problem at h, h/2, …; fit slope of log error | 30m | M | harness on Euler + linear-drag analytic (3.6–3.7) reports slope 1.00±0.05 |
| P2.08 | Golden analytic references module: drag-free parabola, linear-drag (3.6)–(3.7), terminal-velocity drop | 30m | M | reference self-tests (e.g., ẏ of formula satisfies ODE symbolically-sampled to 1e-12) |
| P2.09 | Euler global-error test vs drag-free parabola | 10m | E | error at t_f halves when h halves (ratio 2.0±5%) |
| P2.10 | Midpoint RK2 stepper | 15m | E | slope 2.00±0.05 on linear-drag benchmark |
| P2.11 | Heun RK2 stepper (shared 2-stage kernel, tableau-driven) | 15m | E | slope 2; differs from midpoint only in constant (intercept offset observed) |
| P2.12 | Generic explicit-RK kernel parameterized by Butcher tableau | 30m | M | reproduces P2.06/10/11 bit-identically via tableaux |
| P2.13 | Classical RK4 via tableau kernel | 10m | E | slope 4.00±0.1 on linear-drag benchmark |
| P2.14 | Order-condition checker: numerically verify (4.7)-style conditions for stored tableaux to p=4/5 | 30m | H | RK4 passes 8/8 order-4 conditions; corrupted tableau caught |
| P2.15 | Semi-implicit (symplectic) Euler stepper using `model.partitions` | 20m | M | slope 1; bounded energy oscillation on gravity-only (max |ΔE/E| non-growing over 100 periods of Stage-B pendulum fixture or long lofted shot) |
| P2.16 | Velocity-Verlet stepper (position-Verlet variant behind flag) | 25m | M | slope 2 gravity-only; bounded ΔE |
| P2.17 | Verlet velocity-dependent-force handling (extrapolated velocity pass) documented+tested | 25m | H | slope 2 retained on quadratic-drag benchmark vs tight-RK45 reference |
| P2.18 | Reference-solution utility: tight-tolerance DOPRI5 (after P2.24) or Richardson-extrapolated RK4 for problems without analytics | 20m | M | self-consistency: two reference resolutions agree to 1e-10 |
| P2.19 | Work–precision harness: error vs nRHS across methods, JSON output | 25m | M | Euler/RK2/RK4 curves ordered as expected at error 1e-6 |
| P2.20 | Kahan compensated summation option in state update | 20m | M | Float64 rounding branch of V-curve flattens measurably (documented plot artifact) |
| P2.21 | Float32 mode flag in solver core (for §4.7 demo and GPU preview) | 25m | M | V-curve minimum shifts to larger h; test asserts qualitative shape |
| P2.22 | Automated stability-boundary sweep: bisect h_crit for Euler on dust-grain scenario | 25m | M | h_crit within 20% of (4.12) prediction |
| P2.23 | Embedded-pair kernel: shared stages, two weight vectors, δ per (4.8) | 30m | M | δ ~ O(h^{p̂+1}) measured slope on smooth problem |
| P2.24 | Dormand–Prince 5(4) tableau + FSAL wiring | 30m | H | slope 5 (fixed-h mode); FSAL saves 1 eval/step (nRHS accounting test) |
| P2.25 | Bogacki–Shampine 3(2) tableau | 20m | M | slope 3 fixed-h; FSAL verified |
| P2.26 | Error norm (4.9) with atol/rtol vectors | 15m | E | hand case matches to 1e-15 |
| P2.27 | I controller per (4.10) with safety/clamps, rejection loop | 30m | H | tolerance sweep: achieved local error tracks rtol over 4 decades on benchmark |
| P2.28 | PI controller variant | 20m | M | on drag-crisis scenario: ≥30% fewer rejected steps than I controller (measured) |
| P2.29 | h_min underflow, maxSteps, and t_f-clamp behaviors with typed failures | 15m | E | forced-failure tests produce correct report types |
| P2.30 | DOPRI5 dense-output interpolant | 30m | H | interpolant error at 10 interior θ ≤ C·h⁴ (measured order ≥4) |
| P2.31 | Hermite dense output for fixed-step methods | 20m | M | cubic reproduces cubic polynomial exactly |
| P2.32 | Event framework: sign-change scan + 3-point grazing guard per §4.9 | 30m | H | detects contrived grazing event missed by naive sign check |
| P2.33 | Brent root localization on dense output; event time tol 1e2·ε·t | 30m | H | drag-free impact time matches analytic 2v₀sinθ/g to 1e-12 |
| P2.34 | Terminal-event step truncation + exact event-state recording | 20m | M | trajectory ends exactly at y=0 (|y_impact|<1e-10) |
| P2.35 | Multi-event ordering within a step (earliest-first, rescan) | 20m | M | apex+impact in same step handled in correct order (constructed case) |
| P2.36 | Apex event (v_y falling zero) as non-terminal event | 10m | E | apex height matches analytic v₀²sin²θ/2g drag-free to 1e-10 |
| P2.37 | `InvariantMonitor` sink: energy residual R_E(t) via work-integral quadrature matched to step order | 30m | H | drag-off: |R_E| < 1e-12·E₀; drag-on: R_E order matches method order under h-refinement |
| P2.38 | Backward Euler stepper: damped Newton using model Jacobian, FD fallback | 30m | H | A-stability demo: stable at h=100·h_crit(Euler) on dust-grain; slope 1 |
| P2.39 | Newton diagnostics (iterations, convergence failures) in StepResult | 15m | E | forced non-convergence surfaces typed info |
| P2.40 | Chunked cooperative integration (continuation token, maxSteps/slice) | 25m | M | 1e6-step run yields ≥ every 10 ms in simulated loop; resume bit-exact |
| P2.41 | Cancellation token honored between chunks | 10m | E | cancel mid-run returns partial trajectory flagged canceled |
| P2.42 | Zero-allocation audit of stepper hot paths (extend P1.21 harness) | 25m | M | 0 allocations/step after warmup for Euler..DOPRI5 |
| P2.43 | Micro-benchmark suite (steps/sec per method) with CI trend tracking | 25m | M | baseline recorded; regression >15% fails CI (soft warn) |
| P2.44 | Determinism test: same spec+seed ⇒ bit-identical trajectory across two runs and across worker/main | 20m | M | SHA-256 of buffers equal |
| P2.45 | Cross-engine drift measurement (Node vs Chromium vs Firefox in CI) | 30m | H | relative drift < 1e-13 documented; test warns if exceeded |
| P2.46 | Stiff-scenario telemetry: step-size trace channel h(t) recorded | 10m | E | h(t) plotted artifact shows collapse near high-u phase |
| P2.47 | Solver advisor rules v1 (table §4.10 as pure function of scenario groups) | 20m | E | dust-grain ⇒ stiff warning; golf ⇒ DOPRI5 recommendation |
| P2.48 | Vertical-drop-from-rest kink case (C¹ point §3.8) convergence study | 20m | M | measured RK4 order degradation documented (expect <4 locally) |
| P2.49 | Property test: time-reversibility of Verlet on gravity-only (integrate forward then backward) | 20m | M | returns to y₀ within 1e-9 over 100 steps |
| P2.50 | Property test: translation invariance (shift x₀ ⇒ shifted trajectory) | 15m | E | bit-equal after shift for wind-free scenarios |
| P2.51 | SolverKit API docs + literate derivation pages (§4 content) co-located | 30m | E | docs build; each stepper links its derivation |
| P2.52 | Golden-trajectory store v1: 6 presets × {RK4 fixed, DOPRI5} recorded with hashes | 25m | M | regression test compares within stated tolerances; update requires explicit flag |

## Phase 3: UI Integration (46 tasks)

| ID | Task | Est | Diff | Validation |
|---|---|---|---|---|
| P3.01 | App shell layout: canvas center, control dock right, analysis drawer bottom | 25m | E | responsive at 1280/1920/mobile; no scroll traps |
| P3.02 | Store setup: scenario/result/playback/ui stores per §5.4 | 25m | M | store unit tests; snapshot immutability asserted |
| P3.03 | `SimulationSession` v1: commit spec → integrate (main thread) → publish result | 30m | M | slider→result round trip < 16 ms (perf test on default scenario) |
| P3.04 | Draft/committed split with rAF-coalesced commits | 20m | M | 100 rapid slider events ⇒ ≤ 1 solve per frame (instrumented) |
| P3.05 | Canvas bootstrap: DPR-aware sizing, resize observer | 15m | E | crisp on 2× displays; no distortion on resize |
| P3.06 | `Camera2D`: world↔screen transforms, pan (drag), zoom (wheel, cursor-anchored) | 30m | M | round-trip transform property test; zoom keeps cursor point fixed |
| P3.07 | Anisotropic auto-fit from trajectory bounds + padding; reset button | 20m | M | full trajectory visible for all presets |
| P3.08 | AxesLayer: adaptive 1-2-5 ticks, unit labels, grid | 30m | M | tick count 4–8 across 6 zoom decades (test) |
| P3.09 | TrajectoryLayer: Path2D polyline from columnar store | 20m | E | drag-free preset renders parabola |
| P3.10 | Screen-space RDP decimation on zoom change | 30m | H | 50k-pt stiff run draws < 1 ms; max deviation < 0.5 px (test vs full path) |
| P3.11 | Offscreen-canvas caching of static layers + dirty flags | 25m | M | steady-state frame cost < 4 ms (perf probe) |
| P3.12 | ProjectileLayer: marker at playbackTime via dense output | 20m | E | marker position matches interpolant to sub-pixel |
| P3.13 | Playback clock: play/pause/speed/loop; scrub bar with event ticks | 30m | M | scrub to apex tick lands at v_y=0 state |
| P3.14 | Force glyphs (F_g, F_d, F_M, resultant) log-scaled with legend | 30m | M | glyph directions verified against rhs on 3 presets |
| P3.15 | HUD readouts: t, |v|, E, Re, S, Π live | 20m | E | values equal recorder channels at playhead |
| P3.16 | AnnotationLayer: apex, impact, range markers from events | 20m | E | drag-free range marker at v₀²sin2θ/g ±1e-9 |
| P3.17 | Hover picking: nearest trajectory point, full-state tooltip | 25m | M | picked index correct under zoom (test with synthetic click) |
| P3.18 | Schema-driven control generation (slider/number/select from zod meta) | 30m | H | adding mock force with schema yields working controls, zero UI edits |
| P3.19 | Launch panel: v₀, θ, y₀, ω sliders + synced numeric inputs, keyboard nudge | 25m | E | values clamp to schema ranges; shift-fine works |
| P3.20 | Projectile panel: preset dropdown + custom params | 20m | E | switching preset re-solves; custom persists in draft |
| P3.21 | Environment panel: gravity/atmosphere/wind model selectors + params | 25m | E | wind model swap regenerates its param controls |
| P3.22 | Forces panel: toggles + live magnitude badges | 20m | E | badge equals |F| channel at playhead |
| P3.23 | Solver panel: grouped method dropdown, h/rtol/atol, controller select | 20m | E | invalid combos (h with adaptive) prevented by schema |
| P3.24 | Advisor hints inline (from P2.47) with doc links | 15m | E | dust-grain shows stiff hint |
| P3.25 | Pin-trajectory compare: pinned list, color assignment, legend | 25m | M | Euler vs RK4 overlay reproduces §4 range-bias story visually |
| P3.26 | Ghost analytic overlay for drag-free and linear-drag references | 20m | E | overlay coincides with DOPRI5 at 1e-6 rtol (visual + max-dev test) |
| P3.27 | FieldLayer: wind arrows on screen-anchored grid, magnitude legend, clamp | 30m | M | uniform wind ⇒ identical arrows; vortex shows rotation |
| P3.28 | Streamline overlay (display-only RK2) toggle | 25m | M | streamlines tangent to arrows (spot test) |
| P3.29 | Analysis PlotPane v1 (custom canvas): time series of y, v, E, R_E, h(t) | 30m | M | curves match recorder channels; axes correct units |
| P3.30 | Lazy Plotly pane for exploratory plots (work–precision, phase) | 25m | M | bundle: Plotly not in initial chunk (size test) |
| P3.31 | Scenario save/load: localStorage + JSON file import/export | 25m | E | export→import bit-equal spec |
| P3.32 | Share-URL: deflate+base64url spec in fragment; load on boot | 25m | M | URL round-trip reproduces trajectory hash |
| P3.33 | Preset browser with regime tags (Π, stiff, Magnus) | 20m | E | filtering by tag works |
| P3.34 | Keyboard operability pass (all controls tabbable, ARIA labels) | 30m | M | axe-core audit: no critical violations |
| P3.35 | prefers-reduced-motion: disable auto-play/animation | 10m | E | media query honored (emulated test) |
| P3.36 | Colorblind-safe palette + viridis-only colormaps enforced | 15m | E | palette contrast checks pass |
| P3.37 | Units display toggle (SI/imperial) at boundary only | 20m | E | internal state unchanged (hash) when toggling |
| P3.38 | Error surfaces: solver failures render actionable messages (not toasts of doom) | 20m | E | forced h_min underflow shows guidance + last-good state |
| P3.39 | Worker pool v1: load L0/L1 bundle in worker, `sweep` job type | 30m | H | 11×11 (θ,v₀) sweep runs off-main; UI interactive throughout (long-task probe < 50 ms) |
| P3.40 | Transferable-buffer result protocol + progress messages | 25m | M | no structured-clone of Float64Array (transfer asserted) |
| P3.41 | Solver Lab route: side-by-side method comparison vs reference | 30m | M | Euler/RK4/DOPRI5 columns with error readouts |
| P3.42 | Convergence-study runner UI: pick scenario/methods/h-ladder → log–log with fitted slopes | 30m | H | slopes displayed match harness JSON (P2.07/19) |
| P3.43 | Stability-region explorer: |R(z)|=1 contours + live hλ eigenvalue overlay | 30m | H | Euler disk and RK4 lobes match (4.11); eigenvalues move as projectile decelerates |
| P3.44 | Energy-drift dashboard (flagship exhibit shell; full content P4.12) | 20m | M | four-method E(t) traces render from pinned runs |
| P3.45 | Exhibit derivation panels: KaTeX-rendered markdown from §4 sources | 25m | E | formulas render; source shared with docs build |
| P3.46 | Playwright smoke suite: load, run default, scrub, pin, share-URL | 30m | M | suite green in CI on Chromium+Firefox |

## Phase 4: Advanced Physics (40 tasks)

| ID | Task | Est | Diff | Validation |
|---|---|---|---|---|
| P4.01 | ISA troposphere atmosphere per (3.11) | 25m | M | p(11 km) ≈ 22.63 kPa ±0.5%; ρ continuous with lapse T |
| P4.02 | Altitude-dependent gravity (3.3) as environment option | 10m | E | long-range cannonball range shifts by predicted sign/order |
| P4.03 | Wire η(T), c(T) into EvalContext (Re, M now altitude-aware) | 15m | E | M at high-altitude preset > sea-level M for same speed |
| P4.04 | Mach-dependent C_d(M) table (transonic rise) with PCHIP | 25m | M | C_d(0.8)<C_d(1.1); smoothness FD check |
| P4.05 | Sport C_d/C_L data assets (golf, soccer, baseball) with provenance | 30m | M | schema-valid; values in literature ranges (asserted bounds) |
| P4.06 | Spin ratio S and C_L(S) saturating fit per (3.16) with clamp | 15m | E | C_L monotone, ≤0.6 |
| P4.07 | `planarProjectileSpinModel` (dim 5): spin-decay state ω̇=−ω/τ_ω | 25m | M | ω(t)=ω₀e^{−t/τ} to 1e-10; extensibility check: zero engine/UI edits beyond registration (§5.5) |
| P4.08 | Golf-drive validation scenario: carry distance with backspin | 25m | M | carry in plausible 200–300 m band for driver preset; backspin ⇒ +20–40% vs no-spin (qualitative assert) |
| P4.09 | Topspin/backspin visual exhibit (curve comparison preset pair) | 15m | E | trajectories diverge as theory predicts (sign test on apex) |
| P4.10 | Verlet + spin model integration check (partitioned dims with extra scalar state) | 20m | M | slope 2 retained; ω channel integrated by companion Euler documented |
| P4.11 | Restitution bounce event action: v_y ← −e·v_y, v_x ← μ_f·v_x; re-arm event | 30m | H | ball bounces N times; e=1,μ=1 conserves E at impacts to 1e-10 |
| P4.12 | Flagship energy exhibit: 4-method E(t)/E₀−1 at equal RHS budget (gravity-only) | 25m | M | Euler linear growth, RK4 secular tiny, sympl. Euler/Verlet bounded (automated shape asserts + exhibit page) |
| P4.13 | Terrain height function h(x): piecewise-PCHIP editor data model | 25m | M | impact event solves y=h(x) on slope; grazing case exercised |
| P4.14 | Terrain rendering + editor UI (drag control points) | 30m | M | edited terrain re-solves live; serialization round-trip |
| P4.15 | Sloped-ground analytic check: drag-free range on incline formula | 20m | M | matches R = 2v₀²cosθ sin(θ−α)/(g cos²α) to 1e-9 |
| P4.16 | OU gust generator: exact discretization w'_{k+1}=w'_k e^{−Δ/τ}+σ√(1−e^{−2Δ/τ})ξ | 30m | H | sample ACF matches e^{−t/τ} (χ² test, 1e4 samples) |
| P4.17 | Frozen-realization wind wrapper (seeded path + PCHIP interp) per ADR-011 | 25m | M | same seed ⇒ bit-identical trajectory; different seeds differ |
| P4.18 | 1-cosine discrete gust model | 15m | E | gust profile matches formula; smooth (C¹) |
| P4.19 | Wind gust visual: field animation at 10 Hz tick | 20m | E | animation does not affect physics hash (determinism guard) |
| P4.20 | Buoyancy force finalized + "neglected effects" exercise page (added mass note) | 20m | E | §5.5 worked example 1 satisfied: single-module diff |
| P4.21 | Backward Euler productionizing: Jacobian reuse, simplified-Newton option | 30m | H | dust-grain solved at h=1 ms stable; Newton iters ≤ 4 avg |
| P4.22 | Implicit-vs-explicit cost exhibit on stiff scenario (work–precision overlay) | 25m | M | crossover point visible and documented |
| P4.23 | 3D state groundwork: Vec3 ops, model dim 6, e_z conventions | 30m | M | 2D scenarios reproduce exactly as z≡0 slice (hash vs 2D model) |
| P4.24 | 3D Magnus with full ω̂×v_rel (spin axis param) | 25m | H | sidespin produces lateral deviation (slice/hook sign test) |
| P4.25 | Crosswind 3D scenario + lateral-drift validation vs small-perturbation estimate | 25m | M | drift within 10% of linearized prediction at small w_z |
| P4.26 | 3D camera: orthographic 3-view (xy, xz, yz) before any perspective work | 30m | M | trajectory consistent across views; picking works per-view |
| P4.27 | Coriolis force option: −2m Ω×v with latitude param | 25m | M | eastward deflection of vertical drop matches (1/3)Ω g t³cosφ to 1% |
| P4.28 | Long-range ballistic preset (Coriolis-visible) | 15m | E | deflection sign flips across hemispheres |
| P4.29 | Density-altitude exercise: same shot at sea level vs 2000 m | 15m | E | range increase measured and displayed |
| P4.30 | Model registry UI: model picker (projectile 2D/2D+spin/3D) | 20m | E | switching model regenerates channels/controls |
| P4.31 | Pendulum model registration (Stage-B seed): dim 2, H invariant, partitions | 25m | M | period vs amplitude curve matches elliptic-integral reference to 1e-6 |
| P4.32 | Phase-portrait plot pane (y vs v_y; q vs p for pendulum) | 20m | E | Euler spiral vs Verlet closed orbit visible (automated area-growth assert) |
| P4.33 | Two-body/Kepler model registration (Stage-B seed) with energy+angular momentum invariants | 30m | H | eccentric orbit: RK4 drifts, Verlet bounded (invariant asserts) |
| P4.34 | Solver Lab exhibit: C⁰-vs-C¹ C_d(Re) convergence degradation demo (§3.3) | 25m | M | measured order drop with non-smooth table documented |
| P4.35 | Force-magnitude stacked-area plot over flight (F_g, F_d, F_M shares) | 20m | E | shares sum to |ΣF| within 1e-12 |
| P4.36 | Scenario library v2 curation: 20 scenarios spanning regimes with teaching notes | 30m | E | each note links exhibit; CI validates all specs |
| P4.37 | Golden store v2 (new physics) + tolerance review | 20m | M | regression green; diffs from v1 explained in changelog |
| P4.38 | (Stretch) SDIRK2/TR-BDF2 stepper | 30m | H | L-stability demo; slope 2 |
| P4.39 | Rotational-dynamics ADR: scope Euler rigid-body eqs as future work | 15m | E | ADR merged with decision + revisit trigger |
| P4.40 | Docs pass: physics reference pages regenerated from §3 sources | 25m | E | all equations render; cross-links valid |

## Phase 5: Optimization and Inverse Problems (31 tasks)

| ID | Task | Est | Diff | Validation |
|---|---|---|---|---|
| P5.01 | Observable framework: pure functions Trajectory→scalar (range, apex, ToF, impact speed, miss distance to target) | 25m | M | drag-free observables match analytics to 1e-9 |
| P5.02 | Target model: point / ring / raised-platform with hit predicate + miss vector | 20m | E | miss vector zero at exact hit (constructed) |
| P5.03 | Scalar root problem: range(θ)=R* at fixed v₀ (drag-free) via Brent | 25m | M | recovers both analytic roots θ=½asin(gR*/v₀²) and complement to 1e-10 |
| P5.04 | Shooting residual for 2D target: F(θ,v₀)=r_impact−r* using event state | 25m | M | residual continuous across step boundaries (dense-output check) |
| P5.05 | FD Jacobian of shooting residual with adaptive-step *noise control* (fixed-step or tight-tol inner solves) | 30m | H | Jacobian FD convergence plateau documented; no tolerance-noise blowup |
| P5.06 | Newton shooting solver with line search (Armijo) | 30m | H | hits target with drag+wind in ≤ 8 iters from smart init |
| P5.07 | Smart initializer: drag-free closed-form (θ, v₀) guess | 20m | M | init within basin for all library targets (measured success rate 100%) |
| P5.08 | Multi-solution handling: report low/high arcs; UI selects | 25m | M | both arcs found for reachable targets; consistent labeling |
| P5.09 | Reachability boundary: max-range envelope (parabola of safety analog with drag) via θ sweep + bisection on feasibility | 30m | H | unreachable target reported with distance-to-envelope |
| P5.10 | Tangent-linear (variational) integration: augment state with ∂y/∂μ for selected params | 30m | H | sensitivity matches FD to 1e-6 on smooth scenario |
| P5.11 | Sensitivity channels UI: dRange/dv₀, dRange/dθ, dRange/dC_d live readouts | 20m | M | values match variational integration |
| P5.12 | Nelder–Mead implementation (general utility, bounded via transform) | 30m | M | Rosenbrock 2D to 1e-8; restarts on collapse |
| P5.13 | Golden-section / Brent 1D minimizer | 20m | E | unimodal test functions to 1e-10 |
| P5.14 | Optimal-angle problem: argmax_θ range with drag (compare to 45° folklore) | 20m | M | quadratic-drag optimum < 45° (typically 30–43° by regime); exhibit shows shift vs Π |
| P5.15 | Min-energy targeting: minimize v₀ subject to hit (θ free) via nested Brent/shooting | 30m | H | KKT-style check: range envelope tangency at solution |
| P5.16 | Constraint handling: bounds on θ, v₀; penalty + projection strategies | 25m | M | constrained solutions respect bounds; active-set reported |
| P5.17 | Wind-robust aim: optimize expected miss under wind uncertainty (preview of Phase 6 coupling) | 30m | H | robust aim differs from nominal in headwind-vs-gust scenario (measured) |
| P5.18 | Optimization job type in worker pool with iteration streaming | 25m | M | UI shows live convergence trace; cancel works |
| P5.19 | Convergence trace plot: log‖F‖ vs iteration (Newton quadratic tail visible) | 15m | E | slope doubling per iter near root (assert last-3 ratio) |
| P5.20 | Basin-of-attraction visual: initial-guess grid colored by converged solution | 30m | M | two-arc basins render; boundary fractal-ish structure noted |
| P5.21 | Target UI: draggable target marker; solve-on-drop with arc choice | 25m | M | drag→solution < 200 ms typical (measured) |
| P5.22 | Trajectory-designer mode: lock any two of (θ, v₀, R) solve the third | 25m | M | all three lock combinations function |
| P5.23 | Ill-conditioning exhibit: grazing target near envelope, Jacobian condition number readout | 25m | H | cond(J) spikes near envelope (plotted); solver warns |
| P5.24 | Discrete-adjoint note + prototype for range gradient (optional, documents scaling to many params) | 30m | H | adjoint gradient matches tangent-linear to 1e-8 on 3-param case |
| P5.25 | Regression: optimization golden results (targets, solutions, iters) pinned | 20m | M | CI compares within tolerances |
| P5.26 | Levenberg–Marquardt fallback for tough shooting cases | 30m | H | converges on case where pure Newton fails (constructed near-envelope) |
| P5.27 | Multi-start strategy with deduplication of solutions | 20m | M | finds both arcs without user hint |
| P5.28 | Exercise content: 5 guided inverse-problem exercises with auto-check | 30m | E | checker validates against stored solutions |
| P5.29 | Analysis API docs + method-selection notes (Newton vs NM vs LM) | 25m | E | docs build; decision table present |
| P5.30 | Perf pass: inverse solve p50 < 50 ms, p99 < 300 ms on library targets | 25m | M | benchmark artifact meets budget |
| P5.31 | ADR-017: tolerance coupling between inner IVP and outer optimizer | 20m | M | rule implemented (inner tol ≤ outer tol²-style heuristic) + test |

## Phase 6: Monte Carlo and Uncertainty (30 tasks)

| ID | Task | Est | Diff | Validation |
|---|---|---|---|---|
| P6.01 | Distribution schema: normal, lognormal, uniform, truncated variants on any scenario param | 25m | M | sampling moments match analytics (1e5 draws, 3σ bands) |
| P6.02 | `UncertainScenarioSpec`: base spec + distribution overlays + N + seed | 20m | E | serialize round-trip; validates against base schema |
| P6.03 | Replicate generator: seed+index substreams (P0.11) → param vectors | 20m | M | replicate i identical regardless of batch partitioning |
| P6.04 | `mc` worker job: batch integrate, record observables only (Sink selection) | 30m | M | 1e4 replicates without retaining trajectories; memory < 50 MB |
| P6.05 | Deterministic reduction order (by replicate index) for all statistics | 15m | M | shuffled worker completion ⇒ identical stats hash |
| P6.06 | Streaming moments: Welford mean/variance; P² or reservoir quantiles | 30m | H | matches offline numpy on fixture to 1e-10 (mean/var), quantile ±0.5% |
| P6.07 | MC convergence check: SE ∝ N^{−1/2} measured on range observable | 20m | M | log–log slope −0.50±0.05 |
| P6.08 | CI bands on estimates (t-based) + displayed honestly with N | 15m | E | coverage test: 95% CI covers truth ~95% over 200 repeats (drag-free analytic) |
| P6.09 | Impact-point scatter plot (x_impact histogram / 2D scatter in 3D mode) | 25m | M | scatter renders 1e4 pts < 16 ms (density downsample) |
| P6.10 | Trajectory ensemble fan: quantile envelope bands (5/25/50/75/95%) over time via dense-output resampling on common grid | 30m | H | bands nested and monotone; median ≈ nominal for symmetric inputs |
| P6.11 | Hit-probability estimator for target + Wilson interval | 20m | M | matches binomial simulation on constructed case |
| P6.12 | Antithetic variates option | 20m | M | variance reduction measured >0 on monotone observable (range vs v₀) |
| P6.13 | Control variate: drag-free analytic range as CV | 30m | H | variance reduction factor reported; estimator unbiased (test vs plain MC) |
| P6.14 | Latin hypercube sampling option | 25m | M | stratification verified per-dim; SE improvement on smooth observable |
| P6.15 | Quasi-MC (Sobol' sequence) generator + scrambling | 30m | H | error ~N^{−1} slope on smooth 2-param problem (measured vs MC) |
| P6.16 | Stochastic-wind replicates: one frozen OU path per replicate (ADR-011 integration) | 25m | M | seed determinism across pool sizes |
| P6.17 | First-order sensitivity: σ_out ≈ |∂R/∂μ|σ_μ vs MC comparison exhibit | 25m | M | agreement within 10% for small σ; divergence shown for large σ |
| P6.18 | One-at-a-time tornado chart of parameter influence | 20m | E | bar order matches |∂R/∂μ|σ_μ ranking |
| P6.19 | Sobol' first-order + total indices (Saltelli estimator) | 30m | H | indices on additive test function match analytics ±0.05 |
| P6.20 | Sensitivity UI pane: tornado + Sobol' bars with N controls | 25m | M | recompute streams progress; cancellable |
| P6.21 | k-means clustering of trajectories (feature vector: resampled y(t) + observables) | 30m | H | bimodal two-arc ensemble separates into 2 clusters (ARI > 0.9 on labeled fixture) |
| P6.22 | Cluster visualization: per-cluster median trajectory + membership coloring | 20m | M | legend/count per cluster; stable colors across reruns (seeded) |
| P6.23 | Rare-event note + simple importance-sampling demo (tail hit probability) | 30m | H | IS estimate matches brute force at 10× fewer samples (constructed tail) |
| P6.24 | MC dashboard route: inputs (distributions) → outputs (hist, fan, hit prob, sensitivities) | 30m | M | end-to-end run of golf-drive uncertainty study from UI |
| P6.25 | Progress + partial-result streaming (estimates tighten live) | 20m | M | CI band visibly narrows during run |
| P6.26 | Throughput benchmark: ≥1e4 trajectories/s on 4 workers (fixed-step RK4, observables-only) | 25m | M | CI perf artifact meets §2.6 budget |
| P6.27 | Reproducibility test: full MC study hash-stable across runs/platforms (within FP policy) | 20m | M | SHA of stats equal same-platform; cross-platform within tolerance |
| P6.28 | Golden MC results pinned for 3 studies | 15m | E | regression green |
| P6.29 | Exercise content: uncertainty lab (3 guided studies with auto-check) | 30m | E | checkers pass on reference solutions |
| P6.30 | ADR-019: estimator glossary + when-to-use table (MC/LHS/QMC/CV/IS) | 20m | E | merged; linked from dashboard help |

## Phase 7: Performance and GPU Acceleration (33 tasks)

| ID | Task | Est | Diff | Validation |
|---|---|---|---|---|
| P7.01 | Profiling baseline: flamegraphs of interactive solve + MC batch; hotspots documented | 30m | M | report artifact; top-3 hotspots named |
| P7.02 | SoA ensemble state layout: `Float64Array` blocks [param | state] per replicate batch | 30m | M | batch RK4 produces bit-identical results to per-replicate loop |
| P7.03 | Batched RK4 kernel over ensembles (structure-of-arrays inner loops) | 30m | H | ≥3× throughput vs naive loop (measured) |
| P7.04 | JIT-friendliness pass: monomorphic call sites, no megamorphic force dispatch in batch (specialized compiled RHS) | 30m | H | deopt log clean; +% throughput recorded |
| P7.05 | RHS specializer: compile enabled-force list into single flat function (codegen or hand fusion) | 30m | H | specialized ≡ generic (hash); ≥1.5× RHS speedup |
| P7.06 | Memory audit for 1e5-replicate study; pooled buffers | 25m | M | peak < 300 MB; zero GC major collections mid-run |
| P7.07 | WASM toolchain spike: Rust crate `ballista-core` with RK4 + quad-drag RHS, wasm-bindgen | 30m | H | WASM result matches TS within 1e-15 per step (same order of ops) |
| P7.08 | WASM batch API: init(paramsBuf) / run(n) / read(observablesBuf) with zero-copy views | 30m | H | 1e4 batch round-trip; no per-call allocation |
| P7.09 | WASM SIMD (f64x2 / f32x4) inner loops behind feature detect | 30m | H | ≥1.8× vs scalar WASM on batch benchmark |
| P7.10 | Heterogeneous executor: worker-pool scheduler dispatches jobs to TS or WASM backend uniformly | 30m | H | same job spec runs on both; results within stated FP tolerance |
| P7.11 | Backend equivalence CI: TS vs WASM golden comparison suite | 20m | M | max rel. diff < 1e-12 documented |
| P7.12 | Threads assessment: SharedArrayBuffer + COOP/COEP headers on host; wasm threads behind flag | 30m | H | 4-thread WASM scales ≥2.5× (or documented decision to defer) |
| P7.13 | WebGPU detection + capability report UI (fallback story explicit) | 20m | E | unsupported browsers get graceful CPU path |
| P7.14 | WGSL RK4 kernel: one thread = one trajectory, fixed step, f32 | 30m | H | 1e4 trajectories match CPU f32 mode within 1e-4 rel (per §4.7 expectations) |
| P7.15 | GPU parameter upload: storage buffers for param/IC arrays; workgroup sizing sweep | 25m | M | best workgroup size recorded per adapter class |
| P7.16 | GPU observables reduction on-device (range, apex via per-thread event capture) | 30m | H | matches CPU observables within f32 tolerance |
| P7.17 | Precision study: f32 GPU vs f64 CPU error budget per scenario class; document scenarios where f32 inadequate | 30m | H | published table; stiff scenario flagged CPU-only |
| P7.18 | Compensated-f32 (two-float) accumulation option for position update | 30m | H | error reduced ≥10× vs plain f32 on long flight |
| P7.19 | GPU event handling: in-kernel bisection for ground impact (fixed iteration count, branch-uniform) | 30m | H | impact x within 1e-3 m of CPU on 1e4 batch |
| P7.20 | Throughput benchmark: ≥1e6 trajectories/s GPU target scenario (short flight, RK4) | 25m | H | measured number published with adapter info; budget §2.6 assessed |
| P7.21 | MC pipeline on GPU: RNG (Philox counter-based) in-kernel for param jitter | 30m | H | Philox streams pass statistical tests; replicate determinism by counter |
| P7.22 | GPU→Viz zero-copy: results buffer rendered as heatmap without CPU readback where possible | 30m | H | interactive (θ, v₀)→range heatmap at ≥30 fps |
| P7.23 | Interactive ensemble mode: drag distribution sliders, live 1e5-replicate fan | 30m | H | fan updates < 100 ms per change |
| P7.24 | WebGL2 instanced trajectory renderer for >200 overlaid trajectories | 30m | H | 1e3 trajectories at 60 fps |
| P7.25 | Density/heatmap trajectory rendering (accumulation buffer) for huge ensembles | 30m | M | 1e5 trajectories render as density < 100 ms |
| P7.26 | Frame budget re-audit with GPU features on (§6.5 gates) | 20m | M | Lighthouse ≥ 90 maintained; frame p95 < 16.6 ms |
| P7.27 | Adaptive-on-GPU assessment: divergence cost of per-thread step control measured; decision ADR | 30m | H | ADR-023 with data (expected outcome: fixed-step for GPU, adaptive stays CPU) |
| P7.28 | Scheduler policy: job size + backend availability → routing (small→main TS, medium→workers/WASM, huge→GPU) | 25m | M | policy unit tests; end-to-end picks expected backend |
| P7.29 | Progressive enhancement QA matrix: no-WASM, no-GPU, no-SAB combinations | 25m | M | all combinations functional (Playwright matrix) |
| P7.30 | Bundle strategy: WASM+GPU code lazy-loaded on demand | 20m | E | initial bundle unchanged (size CI) |
| P7.31 | Perf regression CI: benchmark suite trend dashboard | 25m | M | historical chart artifact; alert thresholds set |
| P7.32 | Public benchmark page: user-runnable throughput test with anonymized adapter reporting (opt-in) | 30m | M | page produces shareable result card |
| P7.33 | Phase-7 retrospective ADRs + roadmap update for Stage C/D | 25m | E | merged; next-horizon backlog groomed |

**Roadmap accounting.** P0: 12, P1: 44, P2: 52, P3: 46, P4: 40, P5: 31, P6: 30, P7: 33 — **288 tasks**. Critical path: P0 → P1.01–P1.21 → P2.01–P2.27 → P3.01–P3.13 (first shippable interactive milestone, ≈ M1 at ~110 tasks). Phases 4–6 parallelize substantially after M1; Phase 7 gates only on frozen L0/L1 interfaces (end of Phase 2) plus profiling data from real usage.
---

# 8. Validation and Scientific Correctness

Validation is not a phase; it is a permanent subsystem (`@ballista/validation`) with its own package, CI stage, and documentation. The strategy is a five-layer pyramid, cheapest and most frequent at the bottom.

## 8.1 Layer 1 — Unit and Property Tests (every commit)

Force laws, interpolators, RNG, transforms, and observables are tested against hand computations and mathematical properties. Property-based testing (fast-check) encodes symmetries no example test covers: mirror symmetry (reflecting $x_0, v_{x0}, w_x$ negates $x$-history exactly), Galilean checks where applicable, translation invariance (P2.50), monotonicities (range increases with $v_0$ in drag-free flight), and dimensional sanity (scaling $m, \rho, A$ so that $\Pi$ is invariant leaves the nondimensionalized trajectory invariant — a powerful whole-engine test).

## 8.2 Layer 2 — Analytical Comparison Cases

The permanent reference library, each with closed forms and tolerance policy:

| Case | Closed form | What it validates |
|---|---|---|
| Drag-free projectile | parabola; $R = v_0^2\sin2\theta/g$, $T = 2v_0\sin\theta/g$, $H=v_0^2\sin^2\theta/2g$ | integrators, events (impact/apex), observables |
| Linear drag | Eqs. (3.6)–(3.7) | convergence orders (smooth, exactly solvable, genuinely 2D-coupled via IC only) |
| Terminal-velocity vertical drop | $v(t) = v_T\tanh(gt/v_T)$ for quadratic drag (1D) | quadratic-drag law; long-time asymptote $v\to v_T$ |
| Quadratic drag, horizontal 1D | $v(t) = v_0/(1 + k v_0 t)$ | drag magnitude/sign; algebraic decay |
| Incline range (drag-free) | $R=2v_0^2\cos\theta\sin(\theta-\alpha)/(g\cos^2\alpha)$ | terrain events |
| Coriolis drop deflection | $\tfrac13 \Omega g t^3 \cos\varphi$ | 3D rotating-frame force |
| Constant-wind drag-free | Galilean-shifted parabola | $\mathbf v_{\text{rel}}$ plumbing (T-VAL-09) |

Policy: analytic comparisons assert **absolute error bounds derived from method order and step size**, not "small numbers" — e.g., RK4 at $h$ must land within $C h^4$ with $C$ fitted once and frozen; drift in $C$ is itself a regression signal.

## 8.3 Layer 3 — Convergence and Conservation (CI, fast subset per commit; full nightly)

- **Order verification:** every registered stepper is automatically swept over an $h$-ladder on two benchmarks (linear drag = smooth; quadratic drag vs tight reference) and its fitted slope asserted against `info.order` within ±0.15. A new stepper cannot merge without passing — the registry drives the tests.
- **Conservation checks:** (i) drag-off energy conservation to near round-off for symplectic methods over long horizons, bounded-not-secular assertion (max drift over window k+1 ≤ max over window k × (1+ε)); (ii) work–energy residual $\mathcal R_E$ (3.19) converging at method order for dissipative runs; (iii) Magnus-only energy conservation; (iv) momentum invariants where declared.
- **Adaptive-controller audits:** achieved-vs-requested tolerance tracking across 4 decades; rejection-rate ceilings; dense-output order verification (P2.30).
- **Stability audits:** measured $h_{\text{crit}}$ vs Eq. (4.12) on the stiff scenario (P2.22) re-run to catch RHS regressions that change the Jacobian.

## 8.4 Layer 4 — Golden Trajectory Regression

Curated scenario × solver pairs have stored trajectories (hashes + full arrays for the small set). CI recomputes and compares: **bit-exact on same platform** for the deterministic core; documented tolerance ($10^{-13}$ relative) cross-platform. Any intentional numerical change requires an explicit `--update-goldens` commit with a changelog entry stating *why* results moved — turning silent numerical drift into reviewed, narrated change. Goldens are versioned with engine + schema versions (P1.35, P2.52, P4.37, P5.25, P6.28).

## 8.5 Layer 5 — Reproducibility and End-to-End

Determinism contract (§2.6) tested directly: same ScenarioSpec + seed ⇒ identical SHA-256 of result buffers across runs, across main-thread/worker execution, and across pool sizes (via fixed reduction order, P6.05). Share-URLs are covered by Playwright end-to-end: encode → fresh session → decode → hash-compare. Cross-engine drift is *measured and published* (P2.45) rather than wished away.

**External validation (honesty layer):** sports scenarios are compared against published measurements (golf carry vs launch-monitor literature bands, baseball trajectories) with the explicit stance that agreement validates *plausibility of parameterization*, not the code — code correctness comes from Layers 1–4. Divergence between the two kinds of validation is precisely the platform's lesson on verification vs. validation (V&V), and the docs say so in those words.

---

# 9. Optimization and Advanced Features

(Design rationale for the Phase 5–6 machinery; the tasks give the decomposition, this section the mathematics and the traps.)

## 9.1 Inverse Problem: Hitting a Target

Given target $\mathbf r^\*$, find controls $\mathbf u = (\theta, v_0)$ (optionally $\omega$) such that the impact point $\mathbf r_{\text{imp}}(\mathbf u)$ — defined via the terminal event — equals $\mathbf r^\*$. This is a two-point BVP solved by **shooting**: Newton on $F(\mathbf u) = \mathbf r_{\text{imp}}(\mathbf u) - \mathbf r^\*$.

Key design decisions:

- **Differentiability through events.** $\mathbf r_{\text{imp}}$ is differentiable where the impact is transversal; its derivative includes the event-time sensitivity term $\frac{d\mathbf r_{\text{imp}}}{d\mathbf u} = \frac{\partial \mathbf r}{\partial \mathbf u} - \dot{\mathbf r}\, \frac{\nabla g \cdot \partial \mathbf y/\partial \mathbf u}{\nabla g \cdot \mathbf f}$ evaluated at impact. The tangent-linear integrator (P5.10) computes $\partial\mathbf y/\partial\mathbf u$ exactly (to solver order); the correction term is applied explicitly rather than hoping FD absorbs it.
- **Noise-aware finite differences.** Differentiating through an *adaptive* solver injects step-acceptance noise into FD Jacobians; the platform either fixes the step sequence or tightens inner tolerance per ADR-017 ($\text{tol}_{\text{inner}} \ll \delta_{\text{FD}}^2$-scaled). This is a classic practitioner trap elevated to a teaching exhibit (P5.05).
- **Globalization.** Damped Newton with Armijo line search, drag-free closed-form initialization, LM fallback near the reachability envelope where $J$ degenerates (the envelope is a fold: the two solution arcs merge and $\det J \to 0$ — surfaced in the condition-number exhibit P5.23).

## 9.2 Parameter Optimization

Beyond root finding: $\min_{\mathbf u} \Phi(\mathbf u)$ for objectives like launch energy, time-of-flight, or arrival angle, with hit constraints. The kit deliberately spans regimes: derivative-free (Nelder–Mead, golden-section) for cheap robustness and pedagogy; gradient-based (via tangent-linear sensitivities) for efficiency; nested 1D structure exploited where present (P5.15). A short adjoint prototype (P5.24) documents the many-parameter scaling story ($\mathcal O(1)$ backward solves vs $\mathcal O(n_\mu)$ tangent solves) without committing the platform to full adjoint infrastructure.

## 9.3 Monte Carlo Uncertainty Analysis

Inputs $\boldsymbol\mu \sim \pi$ (independent or with simple correlation), outputs $Q = q(\text{trajectory})$. Plain MC: $\hat Q_N = \frac1N\sum q_i$, $\text{SE} = \sigma_q/\sqrt N$ — the measured $N^{-1/2}$ law is exhibit one. Variance reduction implemented as *comparable estimators over the same problem*: antithetic pairs, control variates (drag-free analytic range is a superb CV: cheap, correlated, exact mean), LHS, and scrambled Sobol' QMC with its near-$N^{-1}$ rate on smooth observables. Each estimator reports its own SE so reductions are *measured claims, never vibes* (P6.12–15). Stochastic wind enters via frozen per-replicate realizations (ADR-011), keeping the forward solver deterministic.

## 9.4 Sensitivity Analysis

Three rungs: (1) local derivatives $\partial Q/\partial\mu_i$ from tangent-linear integration → tornado chart via $|\partial Q/\partial\mu_i|\sigma_i$; (2) the first-order variance estimate $\sigma_Q^2 \approx \sum_i (\partial Q/\partial\mu_i)^2\sigma_i^2$ compared *live* against MC variance — agreement quantifies problem linearity; (3) global Sobol' indices $S_i = \mathrm{Var}[\mathbb E(Q|\mu_i)]/\mathrm{Var}(Q)$ and totals $S_{T_i}$ by Saltelli sampling, exposing interactions the local view cannot (e.g., $C_d$–wind coupling at high $\Pi$).

## 9.5 Trajectory Clustering

Ensembles under multi-modal control settings (two-arc solutions, bounce/no-bounce, gust-dominated splits) motivate unsupervised structure discovery: trajectories are featurized (time-warped resampling to a common grid + key observables, standardized), clustered by seeded k-means with silhouette-guided $k$, and rendered as per-cluster medians with membership shading. Framed honestly as exploratory statistics, validated on labeled synthetic fixtures (P6.21), and positioned as the platform's bridge toward data-science methods over simulation output — the pattern underlying modern surrogate and reduced-order modeling.

---

# 10. Future Extensions

## 10.1 GPU Acceleration (beyond Phase 7)

Phase 7 establishes the WebGPU ensemble engine (fixed-step, f32, one-thread-one-trajectory). Extensions: (a) mixed precision with compensated accumulation as default rather than option; (b) on-device statistics (parallel reductions for moments/quantile sketches) eliminating readback; (c) multi-kernel pipelines (simulate → reduce → render) fully resident on GPU for the interactive heatmap/fan modes; (d) revisit per-thread adaptivity if WebGPU subgroup operations mature enough to make divergence affordable (tracked in ADR-023).

## 10.2 WASM Core as an Embeddable Library

The Rust `ballista-core` crate (P7.07) is deliberately UI-free. Extension path: publish as (i) an npm package for third-party web embedding, (ii) a native crate usable in Python via PyO3 — enabling "same numerics in the browser and in your Jupyter notebook," a genuinely distinctive educational property (bit-comparable results across environments, given the documented FP policy).

## 10.3 Full 3D Simulation

Phase 4 establishes 3D state, forces, Coriolis, and orthographic multi-view. Beyond: perspective Three.js scene with trajectory tubes, ground-plane shadows for depth reading, spin-axis widget; full rigid-body attitude ($\mathbf q$ quaternion + Euler equations, $\mathbf I\dot{\boldsymbol\omega} + \boldsymbol\omega\times\mathbf I\boldsymbol\omega = \mathbf M_{\text{aero}}$) enabling angle-of-attack-dependent aerodynamics — the honest gateway to fin-stabilized projectiles and spin drift (yaw of repose) in exterior ballistics.

## 10.4 Turbulence and Richer Wind

Ordered by fidelity/complexity: (a) von Kármán / Dryden spectral gust models (the aerospace-standard filtered-noise forms, a natural upgrade of the OU model with prescribed PSD); (b) synthetic frozen turbulence: divergence-free 2D/3D velocity fields synthesized from a target energy spectrum $E(k)\sim k^{-5/3}$ via random Fourier modes, Taylor-frozen and advected — visually striking in the field layer and statistically meaningful for ensemble studies; (c) imported fields: sampling real CFD/weather grids through the gridded `WindField` seam (P1.33). Explicit non-goal restated: the platform never *solves* for turbulence; it consumes models of it.

## 10.5 Aerospace and Scientific Extensions

The model registry makes these additive: exterior ballistics package (Mach-dependent $C_d$ already in Phase 4; add standard drag laws G1/G7 as coefficient models, spin drift with attitude from §10.3); atmospheric entry toy (exponential atmosphere + heating proxy $\dot q \sim \rho^{1/2}v^3$ as a derived channel); orbital mechanics via the Kepler model (P4.33) growing into patched-conic exercises; and the Stage-D method-of-lines PDE demos (linear advection, heat, shallow water 1D) where SolverKit integrates semi-discretized systems — connecting, deliberately, to upwinding, CFL as *the* stability condition, and the Riemann-solver world that sits one abstraction level above this platform.

## 10.6 Research and Publication Potential

Three credible outputs: (1) an educational-software paper (JOSE — Journal of Open Source Education, or SIGCSE/CoRE venues) presenting the platform, its validation pyramid, and classroom exhibits; (2) a reproducibility/pedagogy note on *measured* cross-engine floating-point determinism of browser numerics — genuinely under-documented territory with publishable measurements falling out of P2.45/P7.11 for free; (3) an empirical study, if classroom deployment happens, on whether interactive solver instrumentation (energy dashboards, stability explorers) measurably improves numerical-methods learning outcomes versus static assignments. Prerequisites already designed in: citation-carrying data assets, versioned goldens, deterministic replication, and an open-source license (MIT or BSD-3, decided at Phase 0 in practice).

---

# 11. Closing Statement

This document fixes the load-bearing decisions: the six-layer architecture with a pure numerical core; the Model/Stepper/Sink abstractions that make physics, methods, and outputs independently extensible; the determinism and no-allocation invariants; the validation pyramid with golden regression as the ratchet; and a 288-task decomposition whose early milestones produce a working, honest, instrumented simulator within the first ~110 tasks. Everything else — every force, method, exhibit, and backend — is designed to be *added*, not *rebuilt*. When implementation reality diverges from this blueprint, the divergence is to be recorded as an ADR against the relevant section, so that the document and the system age together rather than apart.

*End of blueprint.*
