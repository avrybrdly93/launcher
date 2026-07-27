import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import {
  createPlanarProjectileSpinModel,
  StatefulSpinMagnusForce,
} from "./planar-projectile-spin-model.js";

describe("createPlanarProjectileSpinModel (P4.07)", () => {
  it("declares dim=5 with the expected channels, omega last", () => {
    const model = createPlanarProjectileSpinModel([new GravityForce()], 25);
    expect(model.dim).toBe(5);
    expect(model.channels.map((c) => c.name)).toEqual(["x", "y", "vx", "vy", "omega"]);
  });

  it("rhs' omega row is exactly -omega/tauOmega, decoupled from translational forces", () => {
    const tauOmega = 25;
    const model = createPlanarProjectileSpinModel([new GravityForce()], tauOmega);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(5);

    for (const omega0 of [300, -300, 0, 12.5]) {
      const y = new Float64Array([0, 100, 20, 0, omega0]);
      model.rhs(0, y, out, ctx);
      expect(out[4]).toBeCloseTo(-omega0 / tauOmega, 15);
    }
  });

  it("partitions exclude omega: q=[x,y], p=[vx,vy]", () => {
    const model = createPlanarProjectileSpinModel([new GravityForce()], 25);
    expect(model.partitions).toEqual({ q: [0, 1], p: [2, 3] });
  });

  it("declares the same apex/ground-impact events and energy/momentum-x invariants as the dim-4 model", () => {
    const model = createPlanarProjectileSpinModel([new GravityForce()], 25);
    expect(model.events?.map((e) => e.name).sort()).toEqual(["apex", "ground-impact"]);
    expect(model.invariants?.map((inv) => inv.name)).toEqual(["energy", "momentum-x"]);
  });
});

describe("StatefulSpinMagnusForce (P4.07)", () => {
  it("reads omega from y[4], not from a constant ProjectileParams.spin", () => {
    const cl = new SaturatingLiftCoefficient();
    const mass = 0.0459;
    const radius = 0.02134;

    const model = createPlanarProjectileSpinModel(
      [new GravityForce(), new QuadraticDragForce(), new StatefulSpinMagnusForce()],
      25,
    );
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    // Note: no `spin` set on params -- StatefulSpinMagnusForce must not depend on it.
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.25),
      liftCoefficient: cl,
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(5);

    // Same (x,y,vx,vy) at two different omega: the vy acceleration (lift-bearing
    // component for rightward, backspin motion) must differ, proving the force
    // actually responds to the live state's omega rather than a fixed constant.
    const yNoSpin = new Float64Array([0, 0, 68.45, 14.56, 0]);
    const ySpin = new Float64Array([0, 0, 68.45, 14.56, 300]);

    model.rhs(0, yNoSpin, out, ctx);
    const vyDotNoSpin = out[3]!;
    model.rhs(0, ySpin, out, ctx);
    const vyDotSpin = out[3]!;

    expect(vyDotSpin).not.toBeCloseTo(vyDotNoSpin, 6);
    expect(vyDotSpin).toBeGreaterThan(vyDotNoSpin); // backspin lifts (§3.6)
  });

  it("force magnitude is symmetric in the sign of omega (Cl depends on |S|; direction flips via sign(omega))", () => {
    const cl = new SaturatingLiftCoefficient();
    const force = new StatefulSpinMagnusForce();
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.0459,
      radius: 0.02134,
      dragCoefficient: new ConstantCd(0.25),
      liftCoefficient: cl,
    });
    const ctx = createEvalContext(env, params);
    env.sample(0, 0, 0, ctx.env);
    ctx.vRel[0] = 68.45;
    ctx.vRel[1] = 14.56;
    ctx.speedRel = Math.hypot(68.45, 14.56);

    const outPos: [number, number] = [0, 0];
    force.accumulate(0, new Float64Array([0, 0, 68.45, 14.56, 300]), ctx, outPos);
    const outNeg: [number, number] = [0, 0];
    force.accumulate(0, new Float64Array([0, 0, 68.45, 14.56, -300]), ctx, outNeg);

    expect(outPos[0]).toBeCloseTo(-outNeg[0], 12);
    expect(outPos[1]).toBeCloseTo(-outNeg[1], 12);
  });

  it("is a no-op when omega is 0 or no lift model is configured", () => {
    const force = new StatefulSpinMagnusForce();
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const paramsNoLift = createSphericalProjectileParams({
      mass: 0.0459,
      radius: 0.02134,
      dragCoefficient: new ConstantCd(0.25),
    });
    const ctx = createEvalContext(env, paramsNoLift);
    env.sample(0, 0, 0, ctx.env);
    ctx.vRel[0] = 68.45;
    ctx.vRel[1] = 14.56;
    ctx.speedRel = Math.hypot(68.45, 14.56);

    const out: [number, number] = [0, 0];
    force.accumulate(0, new Float64Array([0, 0, 68.45, 14.56, 300]), ctx, out);
    expect(out).toEqual([0, 0]);

    const paramsWithLift = createSphericalProjectileParams({
      mass: 0.0459,
      radius: 0.02134,
      dragCoefficient: new ConstantCd(0.25),
      liftCoefficient: new SaturatingLiftCoefficient(),
    });
    const ctx2 = createEvalContext(env, paramsWithLift);
    env.sample(0, 0, 0, ctx2.env);
    ctx2.vRel[0] = 68.45;
    ctx2.vRel[1] = 14.56;
    ctx2.speedRel = Math.hypot(68.45, 14.56);
    const out2: [number, number] = [0, 0];
    force.accumulate(0, new Float64Array([0, 0, 68.45, 14.56, 0]), ctx2, out2);
    expect(out2).toEqual([0, 0]);
  });
});
