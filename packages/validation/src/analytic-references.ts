import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  LinearDragForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  type EvalContext,
  type Model,
} from "@ballista/engine";

const VX = 2;
const VY = 3;

/**
 * A closed-form reference solution to a planar-projectile scenario (§8.2,
 * "the platform's analytical validation pillars"): pairs the real `Model` +
 * `EvalContext` the solver would actually integrate with a hand-derived
 * exact solution, so a convergence harness (P2.07) can measure a stepper's
 * global error against ground truth rather than another numerical run.
 */
export interface AnalyticReference {
  readonly name: string;
  readonly model: Model;
  readonly ctx: EvalContext;
  readonly y0: Float64Array;
  /** Exact closed-form state [x, y, vx, vy] at time t. */
  state(t: number): Float64Array;
  /** Exact closed-form dy/dt at time t -- what `model.rhs(t, state(t), ., ctx)` must reproduce. */
  derivative(t: number): Float64Array;
}

/**
 * Drag-free parabola (§3.1): gravity only. x = x0+vx0 t, y = y0+vy0 t -
 * (1/2) g t^2, the platform's first analytical validation pillar.
 */
export function createDragFreeParabolaReference(): AnalyticReference {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  env.sample(0, 0, 0, ctx.env);
  const g = ctx.env.g;

  const model = createPlanarProjectileModel([new GravityForce()]);
  const y0 = new Float64Array([0, 0, 30, 40]);

  return {
    name: "drag-free-parabola",
    model,
    ctx,
    y0,
    state(t: number): Float64Array {
      const [x0, yy0, vx0, vy0] = y0 as unknown as [number, number, number, number];
      return new Float64Array([x0 + vx0 * t, yy0 + vy0 * t - 0.5 * g * t * t, vx0, vy0 - g * t]);
    },
    derivative(t: number): Float64Array {
      const s = this.state(t);
      return new Float64Array([s[VX]!, s[VY]!, 0, -g]);
    },
  };
}

/**
 * Linear (Stokes) drag (eq. 3.5-3.7): the platform's second analytical
 * validation pillar, and the basis of the convergence-rate test suite
 * (§8.2). tau = m/b, terminal velocity v_T = m g / b.
 */
export function createLinearDragReference(): AnalyticReference {
  const mass = 1;
  const radius = 0.01;
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  env.sample(0, 0, 0, ctx.env);
  const b = 6 * Math.PI * ctx.env.eta * radius;
  const tau = mass / b;
  const vT = (mass * ctx.env.g) / b;

  const model = createPlanarProjectileModel([new GravityForce(), new LinearDragForce()]);
  const y0 = new Float64Array([0, 100, 20, 5]);

  return {
    name: "linear-drag",
    model,
    ctx,
    y0,
    state(t: number): Float64Array {
      const [x0, yy0, vx0, vy0] = y0 as unknown as [number, number, number, number];
      const decay = Math.exp(-t / tau);
      return new Float64Array([
        x0 + vx0 * tau * (1 - decay),
        yy0 - vT * t + (vy0 + vT) * tau * (1 - decay),
        vx0 * decay,
        -vT + (vy0 + vT) * decay,
      ]);
    },
    derivative(t: number): Float64Array {
      const s = this.state(t);
      const vx = s[VX]!;
      const vy = s[VY]!;
      return new Float64Array([vx, vy, -vx / tau, -ctx.env.g - vy / tau]);
    },
  };
}

/**
 * Terminal-velocity drop (eq. 3.10): quadratic drag, launched exactly at
 * v_T so gravity and drag balance from t=0 -- a steady-state closed form
 * (constant velocity) that cross-checks (3.10) against the actual
 * `QuadraticDragForce` implementation, not just its own algebra.
 */
export function createTerminalVelocityDropReference(): AnalyticReference {
  const mass = 0.5;
  const radius = 0.05;
  const cd = 0.47;
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(cd),
  });
  const ctx = createEvalContext(env, params);
  env.sample(0, 0, 0, ctx.env);
  const vT = Math.sqrt((2 * mass * ctx.env.g) / (ctx.env.rho * cd * params.area));

  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const y0 = new Float64Array([0, 1000, 0, -vT]);

  return {
    name: "terminal-velocity-drop",
    model,
    ctx,
    y0,
    state(t: number): Float64Array {
      return new Float64Array([0, 1000 - vT * t, 0, -vT]);
    },
    derivative(): Float64Array {
      return new Float64Array([0, -vT, 0, 0]);
    },
  };
}
