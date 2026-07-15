import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  createForceRegistry,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
  type ForceModel,
} from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { composeEnergyPower, createMechanicalEnergyInvariant, mechanicalEnergy } from "./energy.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 1.0, -2.0],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

/**
 * dE/dt at a state, computed purely from rhs's output (ax, ay) and E's
 * chain rule -- d(KE)/dt = m*(vx*ax+vy*ay), d(PE)/dt = m*g*vy -- with no
 * dependence on which forces produced ax/ay. This is the oracle every
 * `composeEnergyPower` comparison below is checked against.
 */
function energyRateFromRhs(
  mass: number,
  g: number,
  vx: number,
  vy: number,
  ax: number,
  ay: number,
): number {
  return mass * (vx * ax + vy * ay + g * vy);
}

describe("mechanicalEnergy / createMechanicalEnergyInvariant", () => {
  it("is 0.5*m*|v|^2 + m*g*y", () => {
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.1,
      dragCoefficient: new ConstantCd(0.47),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 3, 4]);
    const e = mechanicalEnergy(0, y, ctx);
    const expected = 0.5 * 2 * (3 * 3 + 4 * 4) + 2 * ctx.env.g * 10;
    expect(e).toBeCloseTo(expected, 12);
  });

  it("exposes an InvariantSpec named 'energy' wrapping mechanicalEnergy", () => {
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const ctx = createEvalContext(env, params);
    const invariant = createMechanicalEnergyInvariant();
    const y = new Float64Array([0, 5, 1, 2]);
    expect(invariant.name).toBe("energy");
    expect(invariant.evaluate(0, y, ctx)).toBe(mechanicalEnergy(0, y, ctx));
  });
});

describe("composeEnergyPower per-force wiring (eq. 3.19)", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);
  const cl = new SaturatingLiftCoefficient();
  const spin = 180;

  const gravity = new GravityForce();
  const drag = new QuadraticDragForce();
  const magnus = new MagnusForce();

  function buildCtx(forces: readonly ForceModel[]) {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: cd,
      liftCoefficient: cl,
      spin,
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel(forces);
    return { model, ctx };
  }

  it("drag-off (gravity only): dE/dt from powers is 0 to 1e-13", () => {
    const { model, ctx } = buildCtx([gravity]);
    const registry = createForceRegistry([gravity]);
    const nonGravity = registry.filter((f) => f.id !== "gravity");

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx);

      const dEdtFromRhs = energyRateFromRhs(mass, ctx.env.g, vx, vy, out[2]!, out[3]!);
      const dEdtFromPowers = composeEnergyPower(nonGravity, 0, y, ctx);

      expect(nonGravity.length).toBe(0);
      expect(dEdtFromPowers).toBe(0);
      expect(Math.abs(dEdtFromRhs)).toBeLessThan(1e-13);
      expect(Math.abs(dEdtFromRhs - dEdtFromPowers)).toBeLessThan(1e-13);
    }
  });

  it("drag+Magnus on: dE/dt from rhs matches the non-gravity power sum to 1e-11", () => {
    const forces = [gravity, drag, magnus];
    const { model, ctx } = buildCtx(forces);
    const registry = createForceRegistry(forces);
    const nonGravity = registry.filter((f) => f.id !== "gravity");
    expect(nonGravity.length).toBe(2);

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx);

      const dEdtFromRhs = energyRateFromRhs(mass, ctx.env.g, vx, vy, out[2]!, out[3]!);
      const dEdtFromPowers = composeEnergyPower(nonGravity, 0, y, ctx);

      expect(Math.abs(dEdtFromRhs - dEdtFromPowers)).toBeLessThan(1e-11);
    }
  });

  it("Magnus alone in still air does zero net work (energy-conserving ideal lift)", () => {
    const forces = [gravity, magnus];
    const { model, ctx } = buildCtx(forces);
    const registry = createForceRegistry(forces);
    const nonGravity = registry.filter((f) => f.id !== "gravity");

    const y = new Float64Array([0, 0, 25, 10]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx);
    const dEdtFromPowers = composeEnergyPower(nonGravity, 0, y, ctx);
    expect(Math.abs(dEdtFromPowers)).toBeLessThan(1e-11);

    const dEdtFromRhs = energyRateFromRhs(mass, ctx.env.g, y[2]!, y[3]!, out[2]!, out[3]!);
    expect(Math.abs(dEdtFromRhs)).toBeLessThan(1e-11);
  });

  it("gravity's own energyPower cancels exactly against d(PE)/dt (identity, all forces)", () => {
    const forces = [gravity, drag, magnus];
    const { model, ctx } = buildCtx(forces);
    const registry = createForceRegistry(forces);

    const y = new Float64Array([0, 0, 18, -6]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx);

    const dEdtFromRhs = energyRateFromRhs(mass, ctx.env.g, y[2]!, y[3]!, out[2]!, out[3]!);
    const allForcesPower = composeEnergyPower(registry, 0, y, ctx);
    const pePowerRate = mass * ctx.env.g * y[3]!; // d(m*g*y)/dt = m*g*vy

    expect(Math.abs(dEdtFromRhs - (allForcesPower + pePowerRate))).toBeLessThan(1e-11);
  });
});
