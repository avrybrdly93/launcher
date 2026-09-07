import { describe, expect, it } from "vitest";
import {
  BuoyancyForce,
  composeForces,
  createForceRegistry,
  GravityForce,
  LinearDragForce,
  MagnusForce,
  QuadraticDragForce,
  specializeForces,
  UNROLL_LIMIT,
  type ForceModel,
} from "./forces.js";
import type { MutVec2 } from "./vec2.js";
import { createEvalContext } from "./eval-context.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { ConstantCd } from "./drag-coefficient.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { G_STD } from "./units.js";

/**
 * P7.04. `specializeForces` exists for throughput, but the only thing that
 * makes it *safe* is that it is bit-identical to `composeForces` — and
 * "obviously identical by inspection" is exactly the claim
 * `explicit-rk-kernel.ts` warns about, because floating-point addition is
 * order-dependent at the ULP level and force order is id-sorted for that
 * reason (P1.17).
 *
 * So identity is asserted with `Object.is` on the raw doubles, never a
 * tolerance, over every arity the specializer unrolls and over the fallback
 * past it.
 */

function ctxFor(spin?: number) {
  const environment = new Environment(
    // (atmosphere, gravity, wind) -- this order matters and the two are not
    // interchangeable. They happen to write disjoint EnvSample fields, which
    // is why swapping them is silent rather than loud in untyped code.
    new ConstantAtmosphere(),
    new UniformGravity(G_STD),
    new ZeroWind(),
  );
  const params = createSphericalProjectileParams({
    mass: 5,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0.47),
    ...(spin === undefined ? {} : { spin }),
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

const ALL_PLANAR: readonly ForceModel[] = [
  new GravityForce(),
  new QuadraticDragForce(),
  new BuoyancyForce(),
  new LinearDragForce(),
  new MagnusForce(),
];

/** A distinct trivial force class, so arities past the real library can be built. */
function filler(id: string, k: number): ForceModel {
  return {
    id,
    accumulate(_t, _y, _c, out) {
      out[0] += k;
      out[1] += k * 0.5;
    },
  };
}

/** Several states, including ones where the drag terms are not round numbers. */
const STATES: readonly Float64Array[] = [
  new Float64Array([0, 10, 60, 45]),
  new Float64Array([123.456, 78.9, -31.7, 12.3]),
  new Float64Array([0, 0, 0, 0]),
  new Float64Array([1e-8, 1e-8, 1e-8, -1e-8]),
  new Float64Array([1000, 500, 300.1234567, -200.7654321]),
];

describe("specializeForces is bit-identical to composeForces", () => {
  for (let n = 0; n <= UNROLL_LIMIT + 2; n++) {
    it(`agrees bit-for-bit on ${n} force${n === 1 ? "" : "s"}`, () => {
      const forces: ForceModel[] = [];
      for (let i = 0; i < n; i++) {
        forces.push(ALL_PLANAR[i] ?? filler(`z-filler-${i}`, 0.125 * (i + 1)));
      }
      const registry = createForceRegistry(forces);
      const specialized = specializeForces(registry);

      for (const y of STATES) {
        const viaLoop: MutVec2 = [0, 0];
        // Deliberately DIRTY, and that is load-bearing at every arity. With a
        // fresh zeroed buffer here, dropping `out[0] = 0; out[1] = 0;` from a
        // single `case` passes all 14 tests — measured, by doing exactly that
        // to `case 3` and watching this file stay green. `outForce` is a
        // reused per-context scratch (`ctx.forceAccum`), so a specialization
        // that forgets to zero it accumulates across rhs calls and quietly
        // integrates a growing force.
        const viaSpecialized: MutVec2 = [1e6, -7.5];
        composeForces(registry, 0, y, primeContext(ctxFor(50), y), viaLoop);
        specialized(0, y, primeContext(ctxFor(50), y), viaSpecialized);

        // Object.is, not toBeCloseTo and not toEqual: -0 and +0 are different
        // answers here, and a tolerance would hide exactly the reassociation
        // this test exists to forbid.
        expect(Object.is(viaSpecialized[0], viaLoop[0])).toBe(true);
        expect(Object.is(viaSpecialized[1], viaLoop[1])).toBe(true);
      }
    });
  }

  it("falls back to the loop past the unroll limit and still agrees", () => {
    const forces = Array.from({ length: UNROLL_LIMIT + 5 }, (_, i) =>
      filler(`f-${String(i).padStart(2, "0")}`, 1 / (i + 3)),
    );
    const registry = createForceRegistry(forces);
    const y = STATES[1]!;
    const viaLoop: MutVec2 = [0, 0];
    const viaSpecialized: MutVec2 = [0, 0];
    composeForces(registry, 0, y, primeContext(ctxFor(), y), viaLoop);
    specializeForces(registry)(0, y, primeContext(ctxFor(), y), viaSpecialized);
    expect(Object.is(viaSpecialized[0], viaLoop[0])).toBe(true);
    expect(Object.is(viaSpecialized[1], viaLoop[1])).toBe(true);
  });

  it("zeroes the accumulator, so a reused buffer cannot leak between calls", () => {
    const registry = createForceRegistry([new GravityForce()]);
    const out: MutVec2 = [999, -999];
    const y = STATES[0]!;
    specializeForces(registry)(0, y, primeContext(ctxFor(), y), out);
    const fresh: MutVec2 = [0, 0];
    composeForces(registry, 0, y, primeContext(ctxFor(), y), fresh);
    expect(Object.is(out[0], fresh[0])).toBe(true);
    expect(Object.is(out[1], fresh[1])).toBe(true);
  });

  it("preserves id-sorted accumulation order, not the order passed in", () => {
    // The whole reason bit-identity is achievable: both paths consume the
    // registry, and the registry is sorted. Shuffling the input must not move
    // a single bit of the answer.
    const shuffled = [ALL_PLANAR[4]!, ALL_PLANAR[0]!, ALL_PLANAR[3]!, ALL_PLANAR[1]!];
    const inOrder = [ALL_PLANAR[0]!, ALL_PLANAR[1]!, ALL_PLANAR[3]!, ALL_PLANAR[4]!];
    const y = STATES[1]!;
    const a: MutVec2 = [0, 0];
    const b: MutVec2 = [0, 0];
    specializeForces(createForceRegistry(shuffled))(0, y, primeContext(ctxFor(50), y), a);
    specializeForces(createForceRegistry(inOrder))(0, y, primeContext(ctxFor(50), y), b);
    expect(Object.is(a[0], b[0])).toBe(true);
    expect(Object.is(a[1], b[1])).toBe(true);
  });
});
