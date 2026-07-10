import type { Environment } from "./environment.js";
import { createEvalContext } from "./eval-context.js";
import type { ProjectileParams } from "./projectile-params.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Analytic Jacobian J = df/dy (§3.7) for gravity + quadratic drag only —
 * eq. 3.18 with the Magnus terms dropped (P1.22). Exact when the
 * environment is uniform in (t, x, y) (constant gravity/atmosphere/wind, so
 * dCd/dy = dg/dy = 0), which is the platform's default configuration.
 *
 * Row-major DIM x DIM: out[DIM*i + j] = df_i/dy_j. The drag block has a
 * removable singularity at v_rel = 0 (u appears in a denominator); the true
 * limit there is exactly zero since eq. 3.18's drag term is O(|v_rel|^2)
 * near that point (§3.8 smoothness note), so the block is left zeroed
 * rather than evaluated through 0/0.
 */
export function createGravityQuadraticDragJacobian(
  environment: Environment,
  params: ProjectileParams,
): (t: number, y: Float64Array, out: Float64Array) => void {
  const ctx = createEvalContext(environment, params);

  return (t: number, y: Float64Array, out: Float64Array): void => {
    const vx = y[VX]!;
    const vy = y[VY]!;

    ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
    ctx.vRel[0] = vx - ctx.env.wx;
    ctx.vRel[1] = vy - ctx.env.wy;
    const ux = ctx.vRel[0];
    const uy = ctx.vRel[1];
    const u = norm(ctx.vRel);
    ctx.speedRel = u;
    ctx.re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
    ctx.mach = ctx.env.c > 0 ? u / ctx.env.c : 0;

    out.fill(0);
    out[DIM * X + VX] = 1;
    out[DIM * Y + VY] = 1;

    if (u > 0) {
      const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
      const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

      out[DIM * VX + VX] = (-kd * (ux * ux + u * u)) / u;
      out[DIM * VX + VY] = (-kd * (ux * uy)) / u;
      out[DIM * VY + VX] = (-kd * (ux * uy)) / u;
      out[DIM * VY + VY] = (-kd * (uy * uy + u * u)) / u;
    }
  };
}
