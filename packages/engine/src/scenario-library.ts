/**
 * Curated scenario library v2 (P4.36, §3.9/§5.5): the 20 scenarios the
 * preset browser offers, each carrying a teaching note and a link to the
 * exhibit that makes its point.
 *
 * This module is *curation*, not new physics. Every entry is a plain
 * {@link ScenarioSpec} built from the existing projectile assets, force
 * ids, environment specs and steppers; the seven `PRESET_SCENARIOS` (P1.36)
 * are re-exported through it by reference rather than restated, so the two
 * lists cannot drift apart.
 *
 * Two deliberate scope boundaries, both dictated by what a `ScenarioSpec`
 * can currently express rather than by what would be pedagogically nice:
 *
 * 1. **Only forces `resolveForce` (`@ballista/runtime`) can build appear
 *    here** -- gravity, drag-linear, drag-quadratic, magnus, buoyancy. The
 *    Coriolis force exists in `forces.ts` (P4.27) but has no entry in that
 *    resolver's `FORCE_FACTORIES`, so a Coriolis scenario spec would parse
 *    and then throw on resolve. Filed rather than fixed here (see
 *    ROADMAP.json P4.36 notes); a library entry that cannot be run is worse
 *    than an absent one.
 * 2. **Only the three registered model kinds appear** (planar,
 *    planar-spin, spatial). The pendulum (P4.31) and Kepler (P4.33)
 *    Stage-B model seeds are not reachable through `modelSpecSchema`'s
 *    `kind` enum at all, so they get no library entry despite the
 *    model-registry exhibit showing them.
 *
 * Terrain, bounce restitution and the like are likewise absent from
 * `ScenarioSpec`; where a scenario is *meant* to be explored with one of
 * those, that intent lives in its {@link CuratedScenario.exhibit} link and
 * teaching note, which is exactly what those fields are for.
 */
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import type { ProjectileSpec } from "./projectile-spec.js";
import { PRESET_SCENARIOS } from "./scenario-presets.js";
import type { EnvironmentSpec, ScenarioSpec } from "./scenario-spec.js";

function asset(id: string): ProjectileSpec {
  const found = PROJECTILE_ASSETS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown projectile asset id: ${id}`);
  return found;
}

/**
 * The exhibits a teaching note can link to: the eight dedicated routes
 * `packages/app/src/routes.ts` dispatches on, plus `"simulator"` for the
 * default route. Kept as a string union in `engine` (which owns the
 * scenario data) rather than in `app` (which owns the URLs) so the library
 * stays a leaf data module; `app`'s `routes.test.ts` asserts the mapping
 * between these ids and real `#/...` hashes, so a note cannot link an
 * exhibit that does not exist.
 */
export const EXHIBIT_IDS = [
  "simulator",
  "solver-lab",
  "convergence-study",
  "stability-explorer",
  "energy-drift",
  "terrain-editor",
  "neglected-effects",
  "density-altitude",
  "model-registry",
] as const;

/** One of {@link EXHIBIT_IDS}. */
export type ExhibitId = (typeof EXHIBIT_IDS)[number];

/** A library scenario: the runnable spec plus the curation around it. */
export interface CuratedScenario {
  /** Stable slug, unique across the library -- the id a share URL or preset chip refers to. */
  readonly id: string;
  /** Short human-facing name for the preset browser. */
  readonly title: string;
  /**
   * The teaching note: what this scenario is *for*, in terms of the regime
   * it occupies and what a learner should watch happen. Prose, one or two
   * sentences, always naming the physics rather than the numbers.
   */
  readonly note: string;
  /** The exhibit that demonstrates this scenario's point (see {@link EXHIBIT_IDS}). */
  readonly exhibit: ExhibitId;
  /** The runnable spec. */
  readonly spec: ScenarioSpec;
}

const ISA_ATMOSPHERE_NO_WIND: EnvironmentSpec = {
  atmosphere: { kind: "constant" },
  gravity: {},
  wind: { kind: "zero" },
};

/** Same adaptive reference solver every P1.36 preset uses, restated here for the new entries. */
const REFERENCE_SOLVER = {
  stepper: "rk45",
  rtol: 1e-6,
  atol: 1e-9,
  maxSteps: 10000,
  controller: "PI",
} as const;

/**
 * Fixed-step classical RK4, for the entries whose whole point is a
 * *fixed*-step method's behaviour (energy drift, stiffness). An adaptive
 * controller would silently shrink the step until the effect under study
 * disappeared, which is the opposite of the teaching goal.
 */
const FIXED_RK4_SOLVER = {
  stepper: "classical-rk4",
  h: 0.005,
  maxSteps: 200000,
} as const;

/**
 * Isothermal exponential atmosphere (`ExponentialAtmosphere`, §3.4): the
 * only altitude-varying atmosphere `atmosphereSpecSchema` can express. The
 * ISA-troposphere model (P4.01) is richer but has no spec variant, which is
 * why the density-altitude pair below uses this one.
 */
const EXPONENTIAL_ATMOSPHERE = { kind: "exponential" } as const;

/** Shared ICs for the density-altitude pair: one firm ~25 m/s kick at 30 degrees, fired at two altitudes. */
const DENSITY_ALTITUDE_LAUNCH = { vx0: 21.651, vy0: 12.5 };

/**
 * Every entry added by P4.36 on top of the seven P1.36 presets. Order is
 * pedagogical (baseline -> drag -> spin -> wind -> atmosphere -> numerics),
 * not alphabetical, and is the order the preset browser lists them in.
 */
const CURATED_ADDITIONS: readonly CuratedScenario[] = [
  {
    id: "cannonball-muzzle",
    title: "Cannonball at muzzle speed",
    note:
      "A 0.1 m iron sphere leaving the barrel at 250 m/s, heavy enough that drag bends the " +
      "trajectory without dominating it. Its drag coefficient comes from a tabulated Cd(Re) curve " +
      "rather than a constant, so the right-hand side is only piecewise-smooth in the state -- the " +
      "exact condition that degrades a high-order integrator's observed convergence order.",
    exhibit: "solver-lab",
    spec: {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
      projectile: asset("cannonball"),
      initialConditions: { x0: 0, y0: 2, vx0: 216.506, vy0: 125 }, // 250 m/s @ 30 deg
      environment: ISA_ATMOSPHERE_NO_WIND,
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
  {
    id: "smooth-sphere-drag-crisis",
    title: "Smooth sphere through the drag crisis",
    note:
      "Launched fast enough that its Reynolds number crosses the drag crisis mid-flight, where a " +
      "smooth sphere's Cd falls by roughly a factor of three over a narrow Re band. The steep, " +
      "narrow feature in Cd(Re) is what a convergence study has to resolve before its measured " +
      "error slope means anything.",
    exhibit: "convergence-study",
    spec: {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
      projectile: asset("smooth-sphere"),
      initialConditions: { x0: 0, y0: 1, vx0: 106.066, vy0: 106.066 }, // 150 m/s @ 45 deg
      environment: ISA_ATMOSPHERE_NO_WIND,
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
  {
    id: "table-tennis-topspin-decay",
    title: "Topspin drive with decaying spin",
    note:
      "The same table-tennis ball on the dim-5 planar-spin model, whose extra state channel lets " +
      "spin decay as omega-dot = -omega/tau instead of staying pinned at its launch value. Negative " +
      "spin0 is topspin for rightward motion: Magnus pushes the ball down, steepening the descent.",
    exhibit: "model-registry",
    spec: {
      schemaVersion: 1,
      model: {
        id: "planar-projectile-spin",
        kind: "planar-spin",
        forceIds: ["gravity", "drag-quadratic", "magnus"],
        tauOmega: 20,
      },
      initialConditions: { x0: 0, y0: 0.3, vx0: 24.115, vy0: 6.463, spin0: -400 }, // 25 m/s @ 15 deg
      projectile: asset("table-tennis-ball"),
      environment: ISA_ATMOSPHERE_NO_WIND,
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
  {
    id: "lateral-launch-3d",
    title: "Lateral launch (3D)",
    note:
      "The dim-6 spatial model, launched with an out-of-plane velocity component. Quadratic drag " +
      "depends on the speed |v|, not on each axis separately, so the lateral motion and the in-plane " +
      "motion are coupled through it: adding vz0 shortens the downrange distance even though nothing " +
      "about the x-y launch changed. Note this is a lateral *launch*, not a crosswind -- the wind " +
      "spec carries only wx/wy, so a genuinely out-of-plane wind is not expressible in a scenario " +
      "spec today (see this module's doc comment).",
    exhibit: "simulator",
    spec: {
      schemaVersion: 1,
      model: { id: "spatial-projectile", kind: "spatial", forceIds: ["gravity", "drag-quadratic"] },
      projectile: asset("baseball"),
      initialConditions: { x0: 0, y0: 1, z0: 0, vx0: 36.25, vy0: 16.9, vz0: 8 },
      environment: ISA_ATMOSPHERE_NO_WIND,
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
  {
    id: "log-profile-boundary-layer",
    title: "Low shot through a boundary layer",
    note:
      "A shallow shot fired low, where the logarithmic wind profile means the headwind it meets " +
      "grows with height instead of being uniform. The shot therefore feels a different wind on the " +
      "way up than on the way down -- wind shear, not just wind.",
    exhibit: "simulator",
    spec: {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
      projectile: asset("baseball"),
      initialConditions: { x0: 0, y0: 0.5, vx0: 34.472, vy0: 12.856 }, // ~36.8 m/s @ 20 deg
      environment: {
        atmosphere: { kind: "constant" },
        gravity: {},
        wind: { kind: "log-profile", frictionVelocity: -0.6, roughnessLength: 0.03 },
      },
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
  {
    id: "one-cosine-gust",
    title: "Discrete 1-cosine gust",
    note:
      "The standard airworthiness gust shape: a single smooth 1-cosine pulse crossing the flight " +
      "mid-trajectory. Because the gust is deterministic and time-windowed, the resulting deflection " +
      "is repeatable and can be attributed to one event rather than to accumulated noise.",
    exhibit: "simulator",
    spec: {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
      projectile: asset("baseball"),
      initialConditions: { x0: 0, y0: 1, vx0: 36.25, vy0: 16.9 },
      environment: {
        atmosphere: { kind: "constant" },
        gravity: {},
        wind: { kind: "one-cosine-gust", startTime: 0.8, duration: 1.2, peakMagnitude: -12 },
      },
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
  {
    id: "frozen-ou-gust",
    title: "Turbulent gusts (frozen OU realisation)",
    note:
      "An Ornstein-Uhlenbeck gust field sampled once into a frozen path, so the run stays " +
      "reproducible under a fixed seed while still being genuinely stochastic across seeds. This is " +
      "the scenario a Monte-Carlo study varies the seed of; a single run of it is one realisation, " +
      "not an answer.",
    exhibit: "simulator",
    spec: {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
      projectile: asset("baseball"),
      initialConditions: { x0: 0, y0: 1, vx0: 36.25, vy0: 16.9 },
      environment: {
        atmosphere: { kind: "constant" },
        gravity: {},
        wind: { kind: "frozen-ou-gust", tau: 1.5, sigma: 3, dt: 0.02, steps: 500 },
      },
      solver: REFERENCE_SOLVER,
      seed: 20260806,
    },
  },
  {
    id: "vortex-crossing",
    title: "Flight through a vortex core",
    note:
      "A Gaussian (Lamb-Oseen) vortex parked over the trajectory: the wind reverses sign as the " +
      "shot crosses the core, so the lateral forcing changes direction mid-flight rather than " +
      "accumulating one way. A spatially varying wind field, unlike every uniform case above.",
    exhibit: "simulator",
    spec: {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
      projectile: asset("table-tennis-ball"),
      initialConditions: { x0: 0, y0: 1, vx0: 10.607, vy0: 10.607 }, // 15 m/s @ 45 deg
      environment: {
        atmosphere: { kind: "constant" },
        gravity: {},
        wind: { kind: "gaussian-vortex", circulation: 60, coreRadius: 1.5, centerX: 6, centerY: 4 },
      },
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
  {
    id: "density-altitude-sea-level",
    title: "Density altitude: sea level",
    note:
      "The control half of the density-altitude exercise: one firm kick fired from sea level under " +
      "an exponential atmosphere. Its only job is to be identical to the 2000 m entry in every " +
      "respect except launch altitude, so the range difference has exactly one cause.",
    exhibit: "density-altitude",
    spec: {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
      projectile: asset("soccer-ball"),
      initialConditions: { x0: 0, y0: 0, ...DENSITY_ALTITUDE_LAUNCH },
      environment: {
        atmosphere: EXPONENTIAL_ATMOSPHERE,
        gravity: {},
        wind: { kind: "zero" },
      },
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
  {
    id: "density-altitude-2000m",
    title: "Density altitude: 2000 m",
    note:
      "The same kick fired at 2000 m, where the exponential atmosphere's density has fallen to " +
      "about 79% of its sea-level value. Less air means less quadratic drag and a longer carry -- " +
      "the whole 'thin air' effect, with no change to the launch itself.",
    exhibit: "density-altitude",
    spec: {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
      projectile: asset("soccer-ball"),
      initialConditions: { x0: 0, y0: 2000, ...DENSITY_ALTITUDE_LAUNCH },
      environment: {
        atmosphere: EXPONENTIAL_ATMOSPHERE,
        gravity: { altitudeDependent: true },
        wind: { kind: "zero" },
      },
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
  {
    id: "buoyancy-visible",
    title: "Where buoyancy stops being negligible",
    note:
      "A table-tennis ball is light enough that the displaced air's weight is a measurable fraction " +
      "of its own -- so buoyancy, routinely dropped from projectile models, is wired on here. Toggle " +
      "it off to see the size of the error the usual omission commits.",
    exhibit: "neglected-effects",
    spec: {
      schemaVersion: 1,
      model: {
        id: "planar-projectile",
        forceIds: ["gravity", "drag-quadratic", "buoyancy"],
      },
      projectile: asset("table-tennis-ball"),
      initialConditions: { x0: 0, y0: 0.76, vx0: 11.28, vy0: 3.16 },
      environment: ISA_ATMOSPHERE_NO_WIND,
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
  {
    id: "energy-drift-gravity-only",
    title: "Energy drift on a conservative shot",
    note:
      "Gravity alone, so the dynamics are conservative and total energy is exactly invariant: any " +
      "drift in E(t)/E0 - 1 is the integrator's, not the physics'. Deliberately fixed-step -- an " +
      "adaptive controller would shrink the step until the drift it is meant to expose vanished.",
    exhibit: "energy-drift",
    spec: {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity"] },
      projectile: asset("shot-put"),
      initialConditions: { x0: 0, y0: 2.1, vx0: 21.213, vy0: 21.213 },
      environment: ISA_ATMOSPHERE_NO_WIND,
      solver: FIXED_RK4_SOLVER,
      seed: 0,
    },
  },
  {
    id: "lofted-mortar",
    title: "Lofted shot over varied ground",
    note:
      "A steeply lofted, long-hanging shot -- the case where the ground it lands on stops being a " +
      "detail. Ground shape is not part of a scenario spec, so open this one in the terrain editor " +
      "and drag the profile to see how much the impact point moves.",
    exhibit: "terrain-editor",
    spec: {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
      projectile: asset("cannonball"),
      initialConditions: { x0: 0, y0: 0, vx0: 34.202, vy0: 93.969 }, // 100 m/s @ 70 deg
      environment: ISA_ATMOSPHERE_NO_WIND,
      solver: REFERENCE_SOLVER,
      seed: 0,
    },
  },
];

/** Titles and notes for the seven P1.36 presets, which carry a spec but no curation of their own. */
const PRESET_CURATION: readonly {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly exhibit: ExhibitId;
}[] = [
  {
    id: "drag-free-reference",
    title: "Drag-free reference parabola",
    note:
      "Gravity only, no aerodynamics wired at all: the exact parabola every closed-form textbook " +
      "result assumes. Every other entry in this library is best read as a departure from this one.",
    exhibit: "simulator",
  },
  {
    id: "shot-put",
    title: "Shot put",
    note:
      "Heavy, compact and slow: the drag-to-gravity group is small enough that the flight is nearly " +
      "the drag-free parabola. The low-Pi end of the library.",
    exhibit: "simulator",
  },
  {
    id: "table-tennis",
    title: "Table-tennis rally shot",
    note:
      "Almost no mass behind a large frontal area, so drag is comparable to gravity and the path is " +
      "visibly asymmetric -- the descent is steeper than the climb. The high-Pi counterpart to the " +
      "shot put.",
    exhibit: "simulator",
  },
  {
    id: "golf-drive",
    title: "Golf drive",
    note:
      "Backspin turns the Magnus force upward, holding the ball aloft well past where a spin-free " +
      "drive would land. The library's reference Magnus scenario.",
    exhibit: "simulator",
  },
  {
    id: "dust-grain",
    title: "Dust grain (Stokes drag)",
    note:
      "At micron scale the Reynolds number is tiny, so drag is linear rather than quadratic, and the " +
      "relaxation time is so short the system is genuinely stiff. The extreme-Pi end of the library.",
    exhibit: "stability-explorer",
  },
  {
    id: "headwind",
    title: "Batted ball into a headwind",
    note:
      "Half of a matched pair: identical launch, uniform wind opposing travel. Shortens the range " +
      "relative to still air.",
    exhibit: "simulator",
  },
  {
    id: "tailwind",
    title: "Batted ball with a tailwind",
    note:
      "The other half of the pair -- same ball, same launch, wind reversed. Comparing the two " +
      "isolates the wind's contribution from every other parameter, which a single run cannot do.",
    exhibit: "simulator",
  },
];

function curatedPresets(): readonly CuratedScenario[] {
  if (PRESET_CURATION.length !== PRESET_SCENARIOS.length) {
    throw new Error(
      `PRESET_CURATION covers ${PRESET_CURATION.length} of ${PRESET_SCENARIOS.length} PRESET_SCENARIOS`,
    );
  }
  return PRESET_CURATION.map((curation, i) => ({ ...curation, spec: PRESET_SCENARIOS[i]! }));
}

/**
 * The curated library (§3.9, §5.5): the seven P1.36 presets, curated in
 * place, followed by P4.36's additions. Twenty entries spanning the
 * drag-to-gravity group from the drag-free parabola to a stiff dust grain,
 * every wind spec variant, both altitude-varying environment options, all
 * three registered model kinds, and both adaptive and fixed-step solvers.
 */
export const SCENARIO_LIBRARY: readonly CuratedScenario[] = [
  ...curatedPresets(),
  ...CURATED_ADDITIONS,
];

/** Looks up a library entry by {@link CuratedScenario.id}; undefined when absent. */
export function findCuratedScenario(id: string): CuratedScenario | undefined {
  return SCENARIO_LIBRARY.find((entry) => entry.id === id);
}
