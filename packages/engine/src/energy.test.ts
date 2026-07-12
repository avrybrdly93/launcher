import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { composeEnergyPower, energyDerivativeFromPowers, mechanicalEnergy } from "./energy.js";

function makeCtx(dragCd: number) {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(dragCd),
  });
  return createEvalContext(env, params);
}

describe("mechanicalEnergy", () => {
  it("matches E = (1/2)m|v|^2 + mgy by hand at a chosen state", () => {
    const ctx = makeCtx(0);
    const y = new Float64Array([0, 100, 20, -5]);

    const E = mechanicalEnergy(0, y, ctx);

    const expected = 0.5 * ctx.params.mass * (20 * 20 + 5 * 5) + ctx.params.mass * ctx.env.g * 100;
    expect(E).toBeCloseTo(expected, 12);
  });
});

describe("energy invariant wiring on the planar projectile model", () => {
  it("exposes an 'energy' invariant equal to mechanicalEnergy at a given state", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const ctx = makeCtx(0);
    const y = new Float64Array([0, 50, 10, -2]);

    const energyInvariant = model.invariants?.find((inv) => inv.name === "energy");
    expect(energyInvariant).toBeDefined();
    expect(energyInvariant!.evaluate(0, y, ctx)).toBeCloseTo(mechanicalEnergy(0, y, ctx), 12);
  });
});

describe("energyDerivativeFromPowers", () => {
  const STATES: readonly [number, number, number, number][] = [
    [0, 0, 12.3, 4.1],
    [10, 5, -8.2, 15.6],
    [-3, 20, 25.0, -30.1],
    [100, 10, -1.5, -1.5],
    [0, 0, 40, 0],
    [0, 0, 0, 40],
    [5, 5, 5, 5],
    [-10, -10, -20, 20],
  ];

  it("drag-off (gravity only): dE/dt from powers is 0 to 1e-13", () => {
    const forces = [new GravityForce()];
    const ctx = makeCtx(0);

    for (const state of STATES) {
      const y = new Float64Array(state);
      const dEdt = energyDerivativeFromPowers(forces, 0, y, ctx);
      expect(Math.abs(dEdt)).toBeLessThan(1e-13);
    }
  });

  it("drag-on, still air: dE/dt equals -1/2 rho Cd A |v|^3 (eq. 3.19 case iii)", () => {
    const cd = 0.47;
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const ctx = makeCtx(cd);
    const rho = 1.225; // ConstantAtmosphere ISA sea-level density

    for (const state of STATES) {
      const y = new Float64Array(state);
      const [, , vx, vy] = state;
      const speed = Math.hypot(vx, vy);

      const dEdt = energyDerivativeFromPowers(forces, 0, y, ctx);
      const expected = -0.5 * rho * cd * ctx.params.area * speed ** 3;

      expect(dEdt).toBeCloseTo(expected, 10);
      expect(dEdt).toBeLessThanOrEqual(1e-13); // strictly dissipative (or exactly 0 at v=0)
    }
  });

  it("composeEnergyPower sums per-force power, matching a single gravity force directly", () => {
    const forces = [new GravityForce()];
    const ctx = makeCtx(0);
    const y = new Float64Array([0, 0, 3, -7]);
    ctx.environment.sample(0, y[0]!, y[1]!, ctx.env);

    const composed = composeEnergyPower(forces, 0, y, ctx);
    const direct = new GravityForce().energyPower!(0, y, ctx);

    expect(composed).toBe(direct);
  });
});
