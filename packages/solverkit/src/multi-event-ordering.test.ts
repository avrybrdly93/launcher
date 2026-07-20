import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { integrate } from "./integrate.js";

/**
 * P2.35's constructed case: apex (v_y=0, non-terminal) and ground-impact
 * (terminal) both occur *within the same accepted step*, apex strictly
 * earlier. The driver must not let the earlier non-terminal candidate
 * block, misorder, or otherwise interfere with correctly truncating at
 * the later terminal one.
 */
describe("integrate: multi-event ordering within a step (P2.35, §4.9)", () => {
  it("apex+impact in the same step: solve truncates at the later terminal impact, not the earlier apex", () => {
    const g = 9.80665;
    const y0Height = 5;
    const vy0 = 10;
    // Apex at t = vy0/g ~= 1.02s; impact (drag-free, from y0Height) at
    // t = (vy0 + sqrt(vy0^2 + 2*g*y0Height))/g ~= 2.42s -- both comfortably
    // inside a single h=3s step, apex strictly first.
    const analyticApexTime = vy0 / g;
    const analyticImpactTime = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * y0Height)) / g;
    expect(analyticApexTime).toBeLessThan(analyticImpactTime);

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()]);

    const y0 = new Float64Array([0, y0Height, 0, vy0]);
    const stepper = createDormandPrince54Stepper();

    const report = integrate(
      model,
      ctx,
      y0,
      [0, 100],
      { stepper: stepper.info.id, h: 3, maxSteps: 5 },
      stepper,
    );

    expect(report.status).toBe("ok");
    // Truncated at the impact time, not the (earlier, non-terminal) apex time.
    expect(Math.abs(report.tFinal - analyticImpactTime)).toBeLessThan(1e-9);
    expect(report.tFinal).toBeGreaterThan(analyticApexTime);
    expect(Math.abs(report.yFinal[1]!)).toBeLessThan(1e-9);
  });

  it("two terminal events in the same step: the earlier one (by localized time, not declaration order) wins", () => {
    // Two independent scalar "terminal" events on a 1-D linear ramp
    // g(t) = t - root: declared in reverse time order (later root first)
    // to prove the driver picks by true localized time, not array order.
    const model = {
      dim: 1,
      channels: [{ name: "y", unit: "m" }],
      events: [
        { name: "later", g: (t: number) => t - 0.7, direction: "rising" as const, terminal: true },
        {
          name: "earlier",
          g: (t: number) => t - 0.3,
          direction: "rising" as const,
          terminal: true,
        },
      ],
      rhs(_t: number, _y: Float64Array, out: Float64Array): void {
        out[0] = 1;
      },
    };

    // Uses closures rather than `this` -- once detached from the stepper
    // object (as `integrate` does when passing `stepper.interpolant`
    // through to `scanStepForEvents`), a plain method's `this` binding is
    // lost; real dense-output steppers (DOPRI5, the Hermite decorator)
    // avoid this by assigning `interpolant` as an arrow-function field.
    let lastY0 = 0;
    let lastH = 0;
    const stepper = {
      info: { id: "test-linear", order: 1, fsal: false, denseOrder: 1, symplectic: false },
      init(): void {},
      step(
        t: number,
        y: Float64Array,
        h: number,
        out: { yNext: Float64Array; h: number; nRHS: number },
      ): void {
        lastY0 = y[0]!;
        lastH = h;
        out.yNext[0] = y[0]! + h;
        out.h = h;
        out.nRHS = 1;
      },
      interpolant: (theta: number, out: Float64Array): void => {
        out[0] = lastY0 + theta * lastH;
      },
    };

    const ctx = createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind()),
      createSphericalProjectileParams({
        mass: 1,
        radius: 0.05,
        dragCoefficient: new ConstantCd(0),
      }),
    );

    const report = integrate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model as any,
      ctx,
      new Float64Array([0]),
      [0, 1],
      { stepper: "test-linear", h: 1, maxSteps: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stepper as any,
    );

    expect(report.status).toBe("ok");
    expect(Math.abs(report.tFinal - 0.3)).toBeLessThan(1e-9);
  });
});
