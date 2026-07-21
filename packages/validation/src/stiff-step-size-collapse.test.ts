import { describe, expect, it } from "vitest";
import {
  GravityForce,
  LinearDragForce,
  PRESET_SCENARIOS,
  createEvalContext,
  createPlanarProjectileModel,
  environmentSpecToEnvironment,
  projectileSpecToParams,
  type ForceModel,
} from "@ballista/engine";
import {
  StepSizeRecorder,
  TrajectoryRecorder,
  createDormandPrince54Stepper,
  integrate,
  type SolverConfig,
} from "@ballista/solverkit";

/** Same stand-in force-id resolver as solverkit's determinism.test.ts (P2.44) -- a real spec-id registry is P3.03+ territory. */
function forceById(id: string): ForceModel {
  switch (id) {
    case "gravity":
      return new GravityForce();
    case "drag-linear":
      return new LinearDragForce();
    default:
      throw new Error(`Unknown force id in test fixture: ${id}`);
  }
}

describe("stiff-scenario telemetry: h(t) collapse near the high-speed phase (P2.46)", () => {
  const dustGrain = PRESET_SCENARIOS.find((s) => s.projectile.id === "dust-grain");
  if (!dustGrain) throw new Error("expected the dust-grain preset (P1.36) in PRESET_SCENARIOS");

  it("StepSizeRecorder's adaptive h(t) trace collapses while speed is still high, then relaxes once it isn't", () => {
    const forces = dustGrain.model.forceIds.map(forceById);
    const model = createPlanarProjectileModel(forces);
    const env = environmentSpecToEnvironment(dustGrain.environment);
    const params = projectileSpecToParams(dustGrain.projectile);
    const ctx = createEvalContext(env, params);

    const ic = dustGrain.initialConditions;
    const y0 = new Float64Array([ic.x0, ic.y0, ic.vx0, ic.vy0]);
    const u0 = Math.hypot(ic.vx0, ic.vy0);

    const cfg: SolverConfig = {
      stepper: "dopri5",
      maxSteps: dustGrain.solver.maxSteps,
      ...(dustGrain.solver.rtol !== undefined ? { rtol: dustGrain.solver.rtol } : {}),
      ...(dustGrain.solver.atol !== undefined
        ? {
            atol: Array.isArray(dustGrain.solver.atol)
              ? Float64Array.from(dustGrain.solver.atol)
              : dustGrain.solver.atol,
          }
        : {}),
      ...(dustGrain.solver.controller !== undefined
        ? { controller: dustGrain.solver.controller }
        : {}),
    };

    const trajectory = new TrajectoryRecorder();
    const stepSizes = new StepSizeRecorder();
    const stepper = createDormandPrince54Stepper();
    const report = integrate(model, ctx, y0, [0, 1], cfg, stepper, [trajectory, stepSizes]);
    expect(report.status).toBe("ok");

    const h = stepSizes.trace.h;
    expect(h.length).toBeGreaterThan(10);

    let minH = Infinity;
    let minIdx = -1;
    let maxH = -Infinity;
    for (let i = 0; i < h.length; i++) {
      const hi = h[i]!;
      if (hi < minH) {
        minH = hi;
        minIdx = i;
      }
      if (hi > maxH) maxH = hi;
    }

    // TrajectoryRecorder's row 0 is the initial state (start()); row i+1 is
    // StepSizeRecorder's step i, since both sinks see the same accept()
    // dispatch in lockstep -- so speed at the h-minimizing step is channel
    // row minIdx+1, not minIdx.
    const vx = trajectory.trajectory.channels[2]!;
    const vy = trajectory.trajectory.channels[3]!;
    const uAtMinH = Math.hypot(vx[minIdx + 1]!, vy[minIdx + 1]!);

    // Order-of-magnitude collapse (measured ~21x on this fixture; asserting
    // 10x leaves comfortable margin without pinning an exact ratio -- the
    // physically meaningful claim is "collapses by an order of magnitude
    // or more", not a specific decimal).
    expect(maxH / minH).toBeGreaterThan(10);
    // The collapse happens early: within the first 5% of accepted steps
    // (measured at step 1 of 550, i.e. a fraction of ~0.002).
    expect(minIdx).toBeLessThan(h.length * 0.05);
    // "High-u phase": speed at the step-size minimum is still a majority
    // of the launch speed (measured ~66% of u0; the dust grain's Stokes
    // relaxation is fast enough that by the time speed has decayed much
    // further, h has already started growing back out).
    expect(uAtMinH).toBeGreaterThan(0.5 * u0);
  });
});
