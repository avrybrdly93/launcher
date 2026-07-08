import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { momentumX } from "./momentum.js";

describe("momentum-x invariant (teaching case)", () => {
  it("wires a 'momentum-x' InvariantSpec onto the planar projectile model", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.map((i) => i.name)).toEqual(["energy", "momentum-x"]);
  });

  it("drag-off, wind-off: dp_x/dt = m*ax = 0 exactly (no horizontal force)", () => {
    const forces = [new GravityForce()];
    const model = createPlanarProjectileModel(forces);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 2.5,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [100, 10, -1.5, -6.5],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx);
      const dPxDt = params.mass * out[2]!;
      expect(dPxDt).toBe(0);
    }
  });

  it("momentumX matches m*vx exactly", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 3,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    expect(momentumX(new Float64Array([0, 0, 7, -2]), ctx)).toBe(21);
  });
});
