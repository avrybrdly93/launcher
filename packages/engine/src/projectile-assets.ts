import baseball from "./assets/baseball.json";
import cannonball from "./assets/cannonball.json";
import golfBall from "./assets/golf-ball.json";
import shotPut from "./assets/shot-put.json";
import smoothSphere from "./assets/smooth-sphere.json";
import soccerBall from "./assets/soccer-ball.json";
import tableTennisBall from "./assets/table-tennis-ball.json";
import { loadProjectileSpecs } from "./asset-loader.js";
import type { ProjectileSpec } from "./projectile-spec.js";

/**
 * The Phase-1 projectile asset library (§3.9): sphere, golf, soccer,
 * baseball, TT ball, cannonball, shot put. Each is a JSON fixture validated
 * eagerly, at module load, by `loadProjectileSpecs` — a corrupt fixture
 * breaks the build/import rather than surfacing as a runtime surprise.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = loadProjectileSpecs([
  { label: "smooth-sphere.json", data: smoothSphere },
  { label: "golf-ball.json", data: golfBall },
  { label: "soccer-ball.json", data: soccerBall },
  { label: "baseball.json", data: baseball },
  { label: "table-tennis-ball.json", data: tableTennisBall },
  { label: "cannonball.json", data: cannonball },
  { label: "shot-put.json", data: shotPut },
]);
