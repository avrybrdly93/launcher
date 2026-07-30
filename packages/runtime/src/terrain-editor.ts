/**
 * Terrain-editor live re-solve (§7 P4.14, blueprint §6.1 scene-graph
 * `TerrainLayer`). Recomputes a fixed representative launch's trajectory
 * over a freshly-edited {@link PiecewisePchipTerrain} every time its control
 * points change, so dragging a point in the editor UI re-solves immediately
 * rather than only updating the drawn ground line.
 *
 * Deliberately not routed through `ScenarioSpec`/`scenario-resolver.js`:
 * terrain isn't a scenario field yet (no `terrain` slot in `schema.ts`), so
 * this owns a small fixed cannonball config directly -- mirroring
 * solverkit's own `sloped-terrain-impact.test.ts` recipe (gravity-only
 * spherical projectile, `ConstantCd(0)`, DOPRI5) rather than reusing
 * machinery built for `ScenarioSpec`-shaped input. Launching from directly
 * above the first (leftmost) control point, rather than a fixed `(0, 0)`,
 * keeps the launch point above ground regardless of how the terrain has
 * been edited.
 */
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  PiecewisePchipTerrain,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  sanitizeTerrainControlPoints,
  type TerrainControlPoint,
} from "@ballista/engine";
import {
  createDormandPrince54Stepper,
  integrate,
  TrajectoryRecorder,
  type Trajectory,
} from "@ballista/solverkit";

const LAUNCH_SPEED = 30; // m/s
const LAUNCH_ANGLE_DEG = 45;
const LAUNCH_HEIGHT_OFFSET = 2; // m above the terrain at the launch point
const T_MAX_SECONDS = 60;
const RTOL = 1e-9;
const ATOL = 1e-9;
const MAX_STEPS = 100_000;

export interface TerrainEditorResult {
  readonly trajectory: Trajectory;
  readonly impactX: number;
  readonly impactY: number;
  /** False if the solve ran out of `tspan`/step budget before a ground impact fired. */
  readonly landed: boolean;
}

/**
 * Re-solves the fixed representative launch over `controlPoints`, sanitizing
 * them first (§`sanitizeTerrainControlPoints`) so the editor UI can hand
 * over points in any drag order without hand-rolling that bookkeeping.
 */
export function solveTerrainEditorLaunch(
  controlPoints: readonly TerrainControlPoint[],
): TerrainEditorResult {
  const points = sanitizeTerrainControlPoints(controlPoints);
  const terrain = new PiecewisePchipTerrain(points);

  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.1,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce()], terrain);

  const x0 = points[0]!.x;
  const y0Height = terrain.height(x0) + LAUNCH_HEIGHT_OFFSET;
  const angleRad = (LAUNCH_ANGLE_DEG * Math.PI) / 180;
  const y0 = new Float64Array([
    x0,
    y0Height,
    LAUNCH_SPEED * Math.cos(angleRad),
    LAUNCH_SPEED * Math.sin(angleRad),
  ]);

  const stepper = createDormandPrince54Stepper();
  const recorder = new TrajectoryRecorder();
  const report = integrate(
    model,
    ctx,
    y0,
    [0, T_MAX_SECONDS],
    { stepper: stepper.info.id, rtol: RTOL, atol: ATOL, maxSteps: MAX_STEPS },
    stepper,
    [recorder],
  );

  return {
    trajectory: recorder.trajectory,
    impactX: report.yFinal[0]!,
    impactY: report.yFinal[1]!,
    landed: report.status === "ok" && report.tFinal < T_MAX_SECONDS,
  };
}
