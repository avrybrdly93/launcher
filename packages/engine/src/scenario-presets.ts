import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { projectileSpecToParams, type ProjectileSpec } from "./projectile-spec.js";
import type { EnvironmentSpec, ScenarioSpec } from "./scenario-spec.js";
import { G_STD, ISA, sutherlandViscosity } from "./units.js";

function asset(id: string): ProjectileSpec {
  const found = PROJECTILE_ASSETS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown projectile asset id: ${id}`);
  return found;
}

/**
 * Reference-speed evaluation of the drag-to-gravity dimensionless group
 * Π = ρ·Cd(Re(v0), M(v0))·A·v0²/(2mg) = (v0/v_T)² (§3.6), at ISA sea-level
 * density/viscosity with M≈0 (no atmosphere-specific correction) -- exactly
 * what every preset below is defined against. This is a minimal, single-use
 * evaluation to validate the preset library's Π spread; P1.37 generalizes it
 * into a full characteristic-scales computer (v_T, τ_drag, apex estimate)
 * reused across the engine.
 */
export function referenceDimensionlessPi(projectile: ProjectileSpec, v0: number): number {
  const params = projectileSpecToParams(projectile);
  const eta = sutherlandViscosity(ISA.T0);
  const re = (ISA.rho0 * v0 * 2 * params.radius) / eta;
  const cd = params.dragCoefficient.cd(re, 0);
  return (ISA.rho0 * cd * params.area * v0 * v0) / (2 * params.mass * G_STD);
}

const ISA_ATMOSPHERE_NO_WIND: EnvironmentSpec = {
  atmosphere: { kind: "constant" },
  gravity: {},
  wind: { kind: "zero" },
};

const REFERENCE_SOLVER = {
  stepper: "rk45",
  rtol: 1e-6,
  atol: 1e-9,
  maxSteps: 10000,
  controller: "PI",
} as const;

/**
 * Idealized 5-micron-radius mineral dust grain (density 2000 kg/m^3, typical
 * of silicate mineral dust per Tegen, I. & Lacis, A.A. (1996) 'Modeling of
 * particle size distribution and its influence on the radiative properties
 * of mineral dust aerosol', J. Geophys. Res. 101(D14), 19237-19244); mass =
 * (4/3)*pi*r^3*rho. Its huge area/mass ratio makes P1.36's dust-grain preset
 * physically stiff (drag relaxation time tau=m/(6*pi*eta*r) << typical step
 * sizes). The constant Cd here is only a nominal reference value for the Π
 * group below -- the preset itself wires Stokes (drag-linear) drag, not
 * quadratic drag, since Re at this scale is far below the quadratic-drag
 * regime.
 */
const DUST_GRAIN_PROJECTILE: ProjectileSpec = {
  id: "dust-grain",
  name: "Mineral dust grain (5 µm)",
  mass: 1.0472e-12,
  radius: 5e-6,
  dragModel: { kind: "constant", cd: 0.5 },
  provenance:
    "Idealized 5-micron-radius mineral dust grain, density 2000 kg/m^3 (typical silicate mineral " +
    "dust) per Tegen, I. & Lacis, A.A. (1996) 'Modeling of particle size distribution and its " +
    "influence on the radiative properties of mineral dust aerosol', J. Geophys. Res. 101(D14), " +
    "19237-19244; mass = (4/3)*pi*r^3*rho. Nominal Cd=0.5 is a placeholder reference value only " +
    "(used for the Π characteristic-scale group); the preset itself wires Stokes drag, the " +
    "physically dominant regime at this particle's flight Reynolds number.",
};

/** Drag-free reference parabola: gravity only, no aero forces wired (§3.6 baseline case). */
const DRAG_FREE_REFERENCE: ScenarioSpec = {
  schemaVersion: 1,
  model: { id: "planar-projectile", forceIds: ["gravity"] },
  projectile: asset("smooth-sphere"),
  initialConditions: { x0: 0, y0: 1, vx0: 21.213, vy0: 21.213 },
  environment: ISA_ATMOSPHERE_NO_WIND,
  solver: REFERENCE_SOLVER,
  seed: 0,
};

/** Men's shot put: heavy, compact, low-Π regime (drag negligible vs. gravity). */
const SHOT_PUT: ScenarioSpec = {
  schemaVersion: 1,
  model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
  projectile: asset("shot-put"),
  initialConditions: { x0: 0, y0: 2.1, vx0: 11.13, vy0: 8.15 }, // 14 m/s @ 36 deg release
  environment: ISA_ATMOSPHERE_NO_WIND,
  solver: REFERENCE_SOLVER,
  seed: 0,
};

/** Table-tennis ball: light, high-drag-area regime, moderate-to-high Π. */
const TABLE_TENNIS: ScenarioSpec = {
  schemaVersion: 1,
  model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
  projectile: asset("table-tennis-ball"),
  initialConditions: { x0: 0, y0: 0.76, vx0: 11.28, vy0: 3.16 }, // ~12 m/s rally shot, shallow angle
  environment: ISA_ATMOSPHERE_NO_WIND,
  solver: REFERENCE_SOLVER,
  seed: 0,
};

/** Golf drive: quadratic drag + Magnus lift from backspin (typical driver: ~70 m/s ball speed, ~2865 rpm backspin). */
const GOLF_DRIVE: ScenarioSpec = {
  schemaVersion: 1,
  model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic", "magnus"] },
  projectile: asset("golf-ball"),
  initialConditions: { x0: 0, y0: 0, vx0: 68.45, vy0: 14.56, spin0: 300 }, // 70 m/s @ 12 deg, backspin 300 rad/s
  environment: ISA_ATMOSPHERE_NO_WIND,
  solver: REFERENCE_SOLVER,
  seed: 0,
};

/** Dust grain caught in a gust: extreme Π, and physically stiff (Stokes relaxation time << solver step). */
const DUST_GRAIN: ScenarioSpec = {
  schemaVersion: 1,
  model: { id: "planar-projectile", forceIds: ["gravity", "drag-linear"] },
  projectile: DUST_GRAIN_PROJECTILE,
  initialConditions: { x0: 0, y0: 0.01, vx0: 15, vy0: 0 },
  environment: ISA_ATMOSPHERE_NO_WIND,
  solver: REFERENCE_SOLVER,
  seed: 0,
};

const BASEBALL_WIND_PAIR_ICS = { x0: 0, y0: 1, vx0: 36.25, vy0: 16.9 }; // ~40 m/s batted ball @ 25 deg

/** Batted baseball into a headwind (opposes travel direction): shortens range vs. still air. */
const HEADWIND: ScenarioSpec = {
  schemaVersion: 1,
  model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
  projectile: asset("baseball"),
  initialConditions: BASEBALL_WIND_PAIR_ICS,
  environment: {
    atmosphere: { kind: "constant" },
    gravity: {},
    wind: { kind: "uniform", wx: -10 },
  },
  solver: REFERENCE_SOLVER,
  seed: 0,
};

/** Same batted baseball with a tailwind (aids travel direction): lengthens range vs. still air. */
const TAILWIND: ScenarioSpec = {
  schemaVersion: 1,
  model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
  projectile: asset("baseball"),
  initialConditions: BASEBALL_WIND_PAIR_ICS,
  environment: { atmosphere: { kind: "constant" }, gravity: {}, wind: { kind: "uniform", wx: 10 } },
  solver: REFERENCE_SOLVER,
  seed: 0,
};

/**
 * The preset scenario library (§3.9, §5.5): a small set spanning the
 * dimensionless drag-to-gravity group Π from shot put (drag negligible) to
 * a dust grain (drag-dominated and physically stiff), plus a Magnus-bearing
 * golf drive and a head/tailwind pair sharing one projectile to isolate the
 * wind's effect.
 */
export const PRESET_SCENARIOS: readonly ScenarioSpec[] = [
  DRAG_FREE_REFERENCE,
  SHOT_PUT,
  TABLE_TENNIS,
  GOLF_DRIVE,
  DUST_GRAIN,
  HEADWIND,
  TAILWIND,
];
