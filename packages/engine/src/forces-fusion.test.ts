import { describe, expect, it } from "vitest";
import {
  BuoyancyForce,
  composeForces,
  CoriolisForce,
  createForceRegistry,
  fuseForces,
  fusionMask,
  GravityForce,
  LinearDragForce,
  MagnusForce,
  QuadraticDragForce,
  type ForceModel,
} from "./forces.js";
import type { MutVec2 } from "./vec2.js";
import { createEvalContext } from "./eval-context.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { G_STD } from "./units.js";

/**
 * P7.05. `fuseForces` inlines the force bodies, so unlike `specializeForces`
 * (P7.04) it does not *call* the code it claims to be equivalent to — it
 * carries a second copy of the arithmetic. That is the whole risk of the task:
 * a transcription slip in the fused body cannot be caught by reading it beside
 * the original, because it is a copy that is *supposed* to look the same.
 *
 * So identity is asserted against `composeForces` with `Object.is` on raw
 * doubles, never a tolerance, over **every one of the 32 subsets** of the
 * fusable set rather than a sampled few — with fusion, each subset is a
 * distinct code path through the mask, and a bit that reads the wrong flag is
 * only visible in the subsets that separate them.
 */

function ctxFor(spin?: number) {
  const environment = new Environment(
    // (atmosphere, gravity, wind) -- P0.128: these are not interchangeable and
    // swapping them is silent, because they write disjoint EnvSample fields.
    new ConstantAtmosphere(),
    new UniformGravity(G_STD),
    new ZeroWind(),
  );
  const params = createSphericalProjectileParams({
    mass: 5,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0.47),
    ...(spin === undefined ? {} : { spin, liftCoefficient: new SaturatingLiftCoefficient() }),
  });
  return createEvalContext(environment, params);
}

/** Populates the derived context fields `rhs` normally fills before composing. */
function primeContext(ctx: ReturnType<typeof ctxFor>, y: Float64Array) {
  ctx.environment.sample(0, y[0]!, y[1]!, ctx.env);
  ctx.vRel[0] = y[2]! - ctx.env.wx;
  ctx.vRel[1] = y[3]! - ctx.env.wy;
  ctx.speedRel = Math.hypot(ctx.vRel[0]!, ctx.vRel[1]!);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
  return ctx;
}

/** The five fusable classes, deliberately NOT in id order — the registry sorts. */
const FUSABLE_FORCES: readonly (() => ForceModel)[] = [
  () => new GravityForce(),
  () => new QuadraticDragForce(),
  () => new BuoyancyForce(),
  () => new LinearDragForce(),
  () => new MagnusForce(),
];

/**
 * States chosen so no term is a round number, plus the two degenerate cases
 * that have bitten this file's neighbours: v_rel exactly zero (where Magnus'
 * spin-ratio clamp and quadratic drag's `|v|*v` both have to stay finite) and
 * a denormal-adjacent scale.
 */
const STATES: readonly Float64Array[] = [
  new Float64Array([0, 10, 60, 45]),
  new Float64Array([123.456, 78.9, -31.7, 12.3]),
  new Float64Array([0, 0, 0, 0]),
  new Float64Array([1e-8, 1e-8, 1e-8, -1e-8]),
  new Float64Array([1000, 500, 300.1234567, -200.7654321]),
  new Float64Array([12.5, 3.25, -0.0000173, 0.0000091]),
];

/** Spin settings, so the Magnus branch is exercised both taken and skipped. */
const SPINS: readonly (number | undefined)[] = [undefined, 250, -250];

describe("fuseForces is bit-identical to composeForces", () => {
  // All 2^5 subsets of the fusable set, including the empty one.
  for (let subset = 0; subset < 1 << FUSABLE_FORCES.length; subset++) {
    const members = FUSABLE_FORCES.filter((_, i) => (subset & (1 << i)) !== 0);

    it(`agrees bit-for-bit on subset 0b${subset.toString(2).padStart(5, "0")} (${members.length} force${members.length === 1 ? "" : "s"})`, () => {
      const registry = createForceRegistry(members.map((make) => make()));
      const fused = fuseForces(registry);

      // Fusion must actually have happened -- otherwise this test would pass
      // just as well against the P7.04 fallback and assert nothing new.
      expect(fusionMask(registry)).not.toBeNull();

      for (const spin of SPINS) {
        for (const y of STATES) {
          const viaCompose: MutVec2 = [0, 0];
          const viaFused: MutVec2 = [0, 0];

          composeForces(registry, 0, y, primeContext(ctxFor(spin), y), viaCompose);
          // Seeded dirty: `out` is reused scratch (ctx.forceAccum), so a fused
          // body that accumulated into it instead of overwriting would carry
          // force across rhs calls. This is the mutation that survived P7.04's
          // first test file; it does not survive this one.
          viaFused[0] = 1234.5;
          viaFused[1] = -6789.25;
          fused(0, y, primeContext(ctxFor(spin), y), viaFused);

          expect(Object.is(viaFused[0], viaCompose[0])).toBe(true);
          expect(Object.is(viaFused[1], viaCompose[1])).toBe(true);
        }
      }
    });
  }
});

describe("fusionMask refuses what it cannot fuse, rather than fusing it wrongly", () => {
  it("classifies the full planar set and preserves id order in the bits", () => {
    const registry = createForceRegistry(FUSABLE_FORCES.map((make) => make()));
    expect(registry.map((f) => f.id)).toEqual([
      "buoyancy",
      "drag-linear",
      "drag-quadratic",
      "gravity",
      "magnus",
    ]);
    expect(fusionMask(registry)).toBe(0b11111);
  });

  it("refuses an unknown force class, so an added force degrades and never miscomputes", () => {
    const custom: ForceModel = {
      id: "aardvark",
      accumulate(_t, _y, _c, out) {
        out[0] += 1;
      },
    };
    expect(fusionMask(createForceRegistry([new GravityForce(), custom]))).toBeNull();
  });

  it("refuses a SUBCLASS of a fusable force, because it may override accumulate", () => {
    // The point of keying on constructor identity rather than `instanceof`:
    // this class passes `instanceof GravityForce` but is not gravity.
    class HalfGravity extends GravityForce {
      override accumulate(_t: number, _y: Float64Array, ctx: never, out: MutVec2): void {
        out[1] += -0.5 * (ctx as unknown as { params: { mass: number } }).params.mass;
      }
    }
    const sub = new HalfGravity();
    expect(sub instanceof GravityForce).toBe(true);
    expect(fusionMask([sub])).toBeNull();
  });

  it("refuses a duplicated force, which a set-valued mask would silently apply once", () => {
    const registry = createForceRegistry([new GravityForce(), new GravityForce()]);
    expect(registry).toHaveLength(2);
    expect(fusionMask(registry)).toBeNull();
  });

  it("refuses an unsorted registry, because fusion accumulates in a fixed order", () => {
    // Sorted is fusable; the same two forces in the other order are not.
    expect(fusionMask([new BuoyancyForce(), new GravityForce()])).toBe(F_BUOY | F_GRAV);
    expect(fusionMask([new GravityForce(), new BuoyancyForce()])).toBeNull();
  });

  it("refuses CoriolisForce, which has no planar body to inline", () => {
    expect(fusionMask(createForceRegistry([new GravityForce(), new CoriolisForce()]))).toBeNull();
  });
});

describe("fuseForces falls back rather than failing", () => {
  it("hands an unfusable registry to specializeForces, preserving its behaviour", () => {
    const custom: ForceModel = {
      id: "aardvark",
      accumulate(_t, _y, _c, out) {
        out[0] += 3;
        out[1] += 7;
      },
    };
    const registry = createForceRegistry([new GravityForce(), custom]);
    const y = STATES[1]!;
    const viaCompose: MutVec2 = [0, 0];
    const viaFused: MutVec2 = [0, 0];
    composeForces(registry, 0, y, primeContext(ctxFor(), y), viaCompose);
    fuseForces(registry)(0, y, primeContext(ctxFor(), y), viaFused);
    expect(Object.is(viaFused[0], viaCompose[0])).toBe(true);
    expect(Object.is(viaFused[1], viaCompose[1])).toBe(true);
  });

  it("still throws for a 2D Coriolis registry instead of quietly dropping it", () => {
    const registry = createForceRegistry([new GravityForce(), new CoriolisForce()]);
    const y = STATES[0]!;
    expect(() => fuseForces(registry)(0, y, primeContext(ctxFor(), y), [0, 0])).toThrow(/3D-only/);
  });
});

// Bit values duplicated from forces.ts on purpose: importing them would make
// the ordering assertion above tautological.
const F_BUOY = 1 << 0;
const F_GRAV = 1 << 3;
