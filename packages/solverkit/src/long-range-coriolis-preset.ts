import {
  CoriolisForce,
  EARTH_ANGULAR_VELOCITY,
  Environment,
  GravityForce,
  IsaTroposphereAtmosphere,
  PROJECTILE_ASSETS,
  QuadraticDragForce,
  UniformGravity,
  UniformRotation,
  ZeroWind,
  createEvalContext,
  createSpatialProjectileModel,
  degToRad,
  projectileSpecToParams,
  type ProjectileSpec,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { integrate } from "./integrate.js";
import type { SolveReport } from "./types.js";

function cannonballAsset(): ProjectileSpec {
  const found = PROJECTILE_ASSETS.find((a) => a.id === "cannonball");
  if (!found) throw new Error('Unknown projectile asset id: "cannonball"');
  return found;
}

/**
 * P4.28 (blueprint §8.2): "Long-range ballistic preset (Coriolis-visible)",
 * validation criterion "deflection sign flips across hemispheres".
 *
 * Unlike P4.27's vertical-drop scenario (whose lateral Coriolis term is
 * `-2*m*Omega*cos(phi)*v_y`, and `cos` is *even* -- same-sign deflection in
 * both hemispheres, per that task's own notes), a long-range shot has
 * substantial *downrange* velocity `v_x`, which drives the OTHER lateral
 * Coriolis term (`spatial-projectile-model.ts`'s "coriolis" rhs case):
 *
 *   Fz = -2*m*Omega*cos(phi)*v_y + 2*m*Omega*sin(phi)*v_x
 *
 * `sin(phi)` is *odd*: it has the same magnitude but opposite sign at a
 * mirrored latitude (+45N vs. -45S), so the `sin(phi)*v_x` term flips sign
 * across the equator while the `cos(phi)*v_y` term does not. For a shot
 * with large, sustained `v_x` (a long-range trajectory, as opposed to
 * P4.27's from-rest vertical drop where `v_x = 0` throughout), this term
 * dominates the net lateral deflection, which is what makes the sign flip
 * visible here and not in P4.27 -- this is the classic "long-range gunnery
 * Coriolis deflection" real artillery ballistics accounts for: a shot
 * deflects to the right of its line of fire in the Northern Hemisphere
 * (`+z`, this engine's ENU-East convention, per `CoriolisForce`'s doc) and
 * to the left in the Southern Hemisphere (`-z`).
 *
 * Preset parameters: the `cannonball` projectile asset (`projectile-assets.ts`
 * -- 0.1 m smooth cast-iron sphere, Achenbach Cd(Re) table), launched at
 * 500 m/s, 45 degrees elevation (near max-range angle for a drag-free shot,
 * and still a good compromise under quadratic drag), through an ISA
 * troposphere atmosphere, with gravity + quadratic drag + Coriolis active.
 * At Earth's real rotation rate this covers ~6.4 km downrange over ~44 s of
 * flight and produces several meters of lateral deflection -- large enough
 * to be a genuinely "Coriolis-visible" demonstration, not a
 * technically-nonzero-but-negligible one.
 */
export const LONG_RANGE_CORIOLIS_PRESET = {
  muzzleSpeed: 500, // m/s
  elevationRad: degToRad(45),
  launchHeight: 1, // m, matches this repo's other ground-launch presets/tests
} as const;

/**
 * Simulates {@link LONG_RANGE_CORIOLIS_PRESET} at Earth's real rotation rate
 * and the given launch-site `latitudeRad` (positive = Northern Hemisphere,
 * per `UniformRotation`'s convention), returning the full `SolveReport` so
 * callers can inspect the impact state (`yFinal`), not just its z-channel.
 * `omega` defaults to `EARTH_ANGULAR_VELOCITY`; pass `0` to disable the
 * Coriolis contribution entirely (matching `NoRotation`'s effect) without
 * changing any other parameter, e.g. for a same-preset zero-rotation control.
 */
export function simulateLongRangeShot(
  latitudeRad: number,
  omega: number = EARTH_ANGULAR_VELOCITY,
): SolveReport {
  const params = projectileSpecToParams(cannonballAsset());
  const env = new Environment(
    new IsaTroposphereAtmosphere(),
    new UniformGravity(),
    new ZeroWind(),
    new UniformRotation(latitudeRad, omega),
  );
  const ctx = createEvalContext(env, params);
  const model = createSpatialProjectileModel([
    new GravityForce(),
    new QuadraticDragForce(),
    new CoriolisForce(),
  ]);

  const { muzzleSpeed, elevationRad, launchHeight } = LONG_RANGE_CORIOLIS_PRESET;
  const vx0 = muzzleSpeed * Math.cos(elevationRad);
  const vy0 = muzzleSpeed * Math.sin(elevationRad);
  const y0 = new Float64Array([0, launchHeight, 0, vx0, vy0, 0]);

  const stepper = createDormandPrince54Stepper();
  return integrate(
    model,
    ctx,
    y0,
    [0, 200],
    { stepper: stepper.info.id, rtol: 1e-10, atol: 1e-8, maxSteps: 500_000 },
    stepper,
  );
}
