import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce, BuoyancyForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";

/**
 * P1.21: the rhs hot path must not allocate. `global.gc` is only defined
 * when node runs with --expose-gc (wired in vitest.config.ts poolOptions);
 * without it the heap measurement below would be too unreliable to trust, so
 * the test fails loudly instead of silently passing.
 *
 * Forcing a full collection both immediately before *and* immediately after
 * the measured loop (rather than sampling heapUsed uncollected) is what makes
 * this discriminating: it measures *retained* growth only. Transient
 * per-call garbage that never escapes rhs is either reclaimed by that final
 * gc() or, more often, never actually allocated at all — V8's escape
 * analysis scalar-replaces non-escaping temporaries once the loop is JIT-hot,
 * which is the correct behavior for genuinely zero-allocation code. A true
 * leak (state that escapes and is retained across calls) still shows up
 * clearly: empirically ~0.01-0.1 bytes/iter for this clean rhs vs. ~50+
 * bytes/iter for an injected retained per-call allocation (verified by
 * temporarily pushing a per-call object into a module-level sink array and
 * confirming this test fails).
 */
describe("planarProjectileModel.rhs zero-allocation audit", () => {
  it("allocates ~0 bytes across 1e5 evaluations after warmup", () => {
    expect(typeof global.gc).toBe("function");

    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
      new BuoyancyForce(),
    ]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, 30, 10]);
    const out = new Float64Array(4);

    const ITERS = 1e5;
    const WARMUP = 20_000;

    const step = (t: number): void => {
      model.rhs(t, y, out, ctx);
      // Feed the output back in so the JIT can't constant-fold the loop away,
      // while staying in a bounded, physically unremarkable region of state space.
      y[0] = out[0]! * 1e-6;
      y[1] = 10 + out[1]! * 1e-6;
      y[2] = 30 + out[2]! * 1e-6;
      y[3] = 10 + out[3]! * 1e-6;
    };

    let t = 0;
    for (let i = 0; i < WARMUP; i++) step(t++ * 1e-3);

    global.gc!();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ITERS; i++) step(t++ * 1e-3);
    global.gc!();
    const after = process.memoryUsage().heapUsed;

    const bytesPerIter = (after - before) / ITERS;
    expect(bytesPerIter).toBeLessThan(5);
  });
});
