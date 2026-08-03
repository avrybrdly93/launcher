/**
 * P4.29 "does thinner air make it go farther?" exercise (ROADMAP seq 182,
 * validation "range increase measured and displayed"). Fires the same
 * soccer-ball shot (same preset choice as P4.20's `NeglectedEffectsPage`,
 * `PROJECTILE_ASSETS`'s "soccer-ball") through the real ISA-troposphere air
 * density model (`IsaTroposphereAtmosphere`, §3.4 eq. 3.11) once with its
 * local ground at sea level and once with its local ground raised to
 * 2000 m ASL. Thinner air up there means less quadratic drag, so the shot
 * should carry farther -- this module measures exactly how much farther.
 *
 * The ground is modeled as a `FunctionTerrain` fixed at each site's own
 * altitude (rather than keeping a sea-level datum and moving the launch
 * height) so that `IsaTroposphereAtmosphere.sample`'s `y` argument --
 * height above sea level, §3.4 -- reads correctly for the whole flight (a
 * few meters of apex) at each site, and so the ground-impact event fires on
 * landing back at that site's own ground rather than a 2000 m fall to a
 * sea-level datum.
 */
import {
  Environment,
  EnvSample,
  FunctionTerrain,
  GravityForce,
  IsaTroposphereAtmosphere,
  PROJECTILE_ASSETS,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  degToRad,
  projectileSpecToParams,
  type ProjectileSpec,
} from "@ballista/engine";
import { createDormandPrince54Stepper, integrate } from "@ballista/solverkit";

/** Soccer ball: same preset P4.20's `NeglectedEffectsPage` reuses from `PROJECTILE_ASSETS`. */
const DENSITY_ALTITUDE_PRESET_ID = "soccer-ball";

/** A firm, plausible kick: ~25 m/s (90 km/h) at a 30 degree launch angle. */
const MUZZLE_SPEED = 25; // m/s
const ELEVATION_DEG = 30;

const SEA_LEVEL_ALTITUDE = 0; // m ASL
const HIGH_ALTITUDE = 2000; // m ASL

const T_MAX_SECONDS = 20;
const RTOL = 1e-9;
const ATOL = 1e-9;
const MAX_STEPS = 100_000;

/** One site's shot: the altitude it was fired at, the local air density, and the resulting range. */
export interface DensityAltitudeShot {
  readonly altitude: number;
  readonly rhoAir: number;
  readonly range: number;
}

export interface DensityAltitudeResult {
  readonly presetId: string;
  readonly presetName: string;
  readonly muzzleSpeed: number;
  readonly elevationDeg: number;
  readonly seaLevel: DensityAltitudeShot;
  readonly highAltitude: DensityAltitudeShot;
  /** highAltitude.range - seaLevel.range, m. Positive when thinner air let the shot carry farther. */
  readonly rangeIncrease: number;
  /** rangeIncrease as a percentage of the sea-level range. */
  readonly rangeIncreasePercent: number;
}

function resolvePreset(): ProjectileSpec {
  const spec = PROJECTILE_ASSETS.find((asset) => asset.id === DENSITY_ALTITUDE_PRESET_ID);
  if (!spec) {
    throw new Error(`Missing "${DENSITY_ALTITUDE_PRESET_ID}" in PROJECTILE_ASSETS`);
  }
  return spec;
}

/** ISA-troposphere air density at `altitude` metres above sea level (§3.4 eq. 3.11). */
function airDensityAt(altitude: number): number {
  const sample = new EnvSample();
  new IsaTroposphereAtmosphere().sample(0, altitude, sample);
  return sample.rho;
}

/**
 * Simulates {@link DENSITY_ALTITUDE_PRESET_ID} launched from ground at
 * `altitude` metres ASL, through gravity + quadratic drag under an ISA
 * troposphere atmosphere, until it lands back on that same (flat) ground.
 */
function simulateShot(spec: ProjectileSpec, altitude: number): DensityAltitudeShot {
  const params = projectileSpecToParams(spec);
  const env = new Environment(new IsaTroposphereAtmosphere(), new UniformGravity(), new ZeroWind());
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel(
    [new GravityForce(), new QuadraticDragForce()],
    new FunctionTerrain(() => altitude),
  );

  const elevationRad = degToRad(ELEVATION_DEG);
  const y0 = new Float64Array([
    0,
    altitude,
    MUZZLE_SPEED * Math.cos(elevationRad),
    MUZZLE_SPEED * Math.sin(elevationRad),
  ]);

  const stepper = createDormandPrince54Stepper();
  const report = integrate(
    model,
    ctx,
    y0,
    [0, T_MAX_SECONDS],
    { stepper: stepper.info.id, rtol: RTOL, atol: ATOL, maxSteps: MAX_STEPS },
    stepper,
  );

  if (report.status !== "ok" || report.tFinal >= T_MAX_SECONDS) {
    throw new Error(
      `Density-altitude shot at ${altitude} m ASL did not land within ${T_MAX_SECONDS}s ` +
        `(status="${report.status}")`,
    );
  }

  return {
    altitude,
    rhoAir: airDensityAt(altitude),
    range: report.yFinal[0]!,
  };
}

/**
 * Runs {@link DENSITY_ALTITUDE_PRESET_ID}'s shot once at sea level and once
 * at 2000 m ASL and returns both shots plus the resulting range increase
 * (§P4.29 validation: "range increase measured and displayed").
 */
export function computeDensityAltitudeComparison(): DensityAltitudeResult {
  const spec = resolvePreset();
  const seaLevel = simulateShot(spec, SEA_LEVEL_ALTITUDE);
  const highAltitude = simulateShot(spec, HIGH_ALTITUDE);
  const rangeIncrease = highAltitude.range - seaLevel.range;
  return {
    presetId: spec.id,
    presetName: spec.name,
    muzzleSpeed: MUZZLE_SPEED,
    elevationDeg: ELEVATION_DEG,
    seaLevel,
    highAltitude,
    rangeIncrease,
    rangeIncreasePercent: (rangeIncrease / seaLevel.range) * 100,
  };
}
