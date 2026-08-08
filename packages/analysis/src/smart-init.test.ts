import {
  BuoyancyForce,
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  type EvalContext,
  type ForceModel,
  G_STD,
  GravityForce,
  LinearDragForce,
  MagnusForce,
  type Model,
  QuadraticDragForce,
  SCENARIO_LIBRARY,
  type ScenarioSpec,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createPlanarProjectileSpinModel,
  createSphericalProjectileParams,
  createSpatialProjectileModel,
  environmentSpecToEnvironment,
  projectileSpecToParams,
} from "@ballista/engine";
import { type SolverConfig, createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { newtonShooting } from "./newton-shooting.js";
import { PLANAR_LAYOUT, SPATIAL_LAYOUT, type TrajectoryLayout } from "./observables.js";
import { dragFreeRange } from "./range-root.js";
import { type Aim, type ShootingProblem, createShootingResidual } from "./shooting-residual.js";
import { dragFreeAim, smartInitialAim } from "./smart-init.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.07's validation criterion is "init within basin for all library targets
 * (measured success rate 100%)", and the two halves of this file answer two
 * different questions.
 *
 * The unit tests below check that the closed form *is* the drag-free solution —
 * not by re-deriving the same formula in the test (which would pass for a
 * consistently wrong formula) but by substituting the aim back into the
 * drag-free equations of motion and asking whether the trajectory passes
 * through the target, and by sweeping the solution curve to confirm the chosen
 * point really is the minimum-speed one.
 *
 * The library harness at the bottom answers the criterion itself, and is where
 * the measurement lives.
 */

/* ------------------------------------------------------------------ */
/* The closed form                                                      */
/* ------------------------------------------------------------------ */

/**
 * Whether the drag-free trajectory of `aim` passes through `(downrange, rise)`.
 *
 * Substitution into `x(t) = v₀cos θ · t`, `y(t) = v₀ sin θ · t − ½gt²` at the
 * time the horizontal coordinate matches. This is the property "reaches the
 * target" itself, so a formula that is self-consistently wrong fails it.
 */
function drop(aim: Aim, downrange: number, gravity = G_STD): { t: number; y: number } {
  const vx = aim.speed * Math.cos(aim.theta);
  const t = downrange / vx;
  return { t, y: aim.speed * Math.sin(aim.theta) * t - 0.5 * gravity * t * t };
}

/**
 * The launch speed a *given* elevation needs to reach `(dx, dy)` drag-free:
 * `v² = g dx² / (2 cos²θ (dx tan θ − dy))`, undefined (negative denominator)
 * for elevations too shallow to clear the target.
 *
 * The minimum of this over θ is what {@link dragFreeAim} claims to return in
 * closed form, so it is the sweep the minimality test compares against.
 */
function speedForElevation(theta: number, dx: number, dy: number, gravity = G_STD): number {
  const c = Math.cos(theta);
  const denominator = 2 * c * c * (dx * Math.tan(theta) - dy);
  if (!(denominator > 0)) return Number.POSITIVE_INFINITY;
  return Math.sqrt((gravity * dx * dx) / denominator);
}

describe("dragFreeAim (P5.07's closed form)", () => {
  it("recovers the textbook flat-ground aim: 45 degrees at sqrt(g R)", () => {
    const aim = dragFreeAim(100, 0);
    expect(aim.theta).toBeCloseTo(Math.PI / 4, 15);
    expect(aim.speed).toBeCloseTo(Math.sqrt(G_STD * 100), 12);
    // And the range formula of P5.03 agrees that this aim carries exactly 100 m.
    expect(dragFreeRange(aim.speed, aim.theta)).toBeCloseTo(100, 9);
  });

  it("recovers the vertical aim for a target overhead", () => {
    // The limit dx -> 0 of a target 50 m up: straight up at exactly the speed
    // that rises 50 m, sqrt(2 g h).
    const aim = dragFreeAim(1e-9, 50);
    expect(aim.theta).toBeCloseTo(Math.PI / 2, 9);
    expect(aim.speed).toBeCloseTo(Math.sqrt(2 * G_STD * 50), 9);
  });

  it("reaches the target for every displacement in the plane, uphill and down", () => {
    for (const dx of [1, 12.5, 100, 1000, 25_000]) {
      for (const dy of [-400, -30, -1, 0, 1, 30, 400]) {
        const aim = dragFreeAim(dx, dy);
        const { t, y } = drop(aim, dx);
        expect(t).toBeGreaterThan(0);
        // Relative to the slant range, so the assertion means the same thing
        // at 1 m and at 25 km. The bound is full double precision, which the
        // formula only reaches because of the cancellation-free branch in
        // `dragFreeAim`: the direct `Δy + R` form leaves 4e-11 on the (1, -400)
        // corner of this very grid.
        expect(Math.abs(y - dy) / Math.hypot(dx, dy)).toBeLessThan(1e-14);
      }
    }
  });

  it("fires backwards for a target behind the launcher, and lands on it", () => {
    const aim = dragFreeAim(-250, 40);
    expect(aim.theta).toBeGreaterThan(Math.PI / 2);
    expect(aim.theta).toBeLessThan(Math.PI);
    expect(aim.speed * Math.cos(aim.theta)).toBeLessThan(0);

    const { t, y } = drop(aim, -250);
    expect(t).toBeGreaterThan(0);
    expect(y).toBeCloseTo(40, 9);
  });

  it("is symmetric under reflection: a mirrored target gives a mirrored aim", () => {
    const forward = dragFreeAim(300, 25);
    const backward = dragFreeAim(-300, 25);
    expect(backward.speed).toBeCloseTo(forward.speed, 12);
    expect(backward.theta).toBeCloseTo(Math.PI - forward.theta, 12);
  });

  it("really is the minimum-speed solution, not merely a solution", () => {
    for (const [dx, dy] of [
      [200, 0],
      [200, 60],
      [200, -60],
      [30, 120],
    ] as const) {
      const aim = dragFreeAim(dx, dy);
      // Every elevation that can reach the target needs at least as much speed.
      let best = Number.POSITIVE_INFINITY;
      for (let i = 1; i < 4000; i++) {
        const theta = (i / 4000) * (Math.PI / 2);
        best = Math.min(best, speedForElevation(theta, dx, dy));
      }
      expect(aim.speed).toBeLessThanOrEqual(best * (1 + 1e-12));
      // ...and the sweep gets arbitrarily close to it, so it is not merely a
      // lower bound: the closed form sits on the curve the sweep is minimizing.
      expect(best).toBeLessThan(aim.speed * (1 + 1e-6));
    }
  });

  it("scales the speed with the gravity it is given", () => {
    const earth = dragFreeAim(500, 0, G_STD);
    const moon = dragFreeAim(500, 0, 1.625);
    expect(moon.theta).toBeCloseTo(earth.theta, 15);
    expect(moon.speed / earth.speed).toBeCloseTo(Math.sqrt(1.625 / G_STD), 12);
    // Reaching the same point under weaker gravity is a matter of speed alone.
    expect(drop(moon, 500, 1.625).y).toBeCloseTo(0, 9);
  });

  it("treats a negative-zero rise as level ground, not as a downward target", () => {
    // atan2(-0, negative) is -pi, which without normalization flips a
    // backwards-and-up shot into a forwards-and-down one.
    const aim = dragFreeAim(-100, -0);
    expect(aim.theta).toBeCloseTo((3 * Math.PI) / 4, 15);
    expect(aim.speed * Math.sin(aim.theta)).toBeGreaterThan(0);
  });

  it("rejects a target at or directly below the launch point", () => {
    expect(() => dragFreeAim(0, 0)).toThrow(/at or directly below/);
    expect(() => dragFreeAim(0, -50)).toThrow(/at or directly below/);
    // A horizontal offset, however small, is enough to make it a shooting problem.
    expect(dragFreeAim(1e-6, -50).speed).toBeGreaterThan(0);
  });

  it("rejects non-finite arguments and non-positive gravity", () => {
    expect(() => dragFreeAim(Number.NaN, 0)).toThrow(/downrange must be finite/);
    expect(() => dragFreeAim(100, Number.POSITIVE_INFINITY)).toThrow(/rise must be finite/);
    expect(() => dragFreeAim(100, 0, 0)).toThrow(/gravity must be positive/);
    expect(() => dragFreeAim(100, 0, -9.8)).toThrow(/gravity must be positive/);
  });
});

/* ------------------------------------------------------------------ */
/* Wiring it to a shooting problem                                      */
/* ------------------------------------------------------------------ */

/** Tight enough that the residual's own error is far below any miss under test. */
const TIGHT_TOL: SolverConfig = {
  stepper: "dopri5",
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

function simpleProblem(
  target: PointTarget,
  dragCoefficient: number,
  launchPoint?: readonly number[],
): ShootingProblem {
  const forces =
    dragCoefficient === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
      createSphericalProjectileParams({
        mass: 1,
        radius: 0.05,
        dragCoefficient: new ConstantCd(dragCoefficient),
      }),
    ),
    target,
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 120],
    layout: PLANAR_LAYOUT,
    ...(launchPoint === undefined ? {} : { launchPoint }),
  };
}

describe("smartInitialAim (the closed form wired to a shooting problem)", () => {
  it("is not a guess at all without drag: the residual is already at tolerance", () => {
    const problem = simpleProblem({ kind: "point", center: [750, 0] }, 0);
    const residual = createShootingResidual(problem);
    const aim = smartInitialAim(problem);

    const evaluation = residual(aim);
    expect(evaluation.ok).toBe(true);
    // The closed form is exact for these dynamics, so the only error left is
    // the integrator's and the event localization's.
    expect(Math.hypot(...evaluation.residual!)).toBeLessThan(1e-6);

    // Which Newton then confirms without taking a step.
    const result = newtonShooting(residual, aim);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(0);
  });

  it("accounts for a raised launch point rather than assuming a ground shot", () => {
    const problem = simpleProblem({ kind: "point", center: [400, 0] }, 0, [0, 60]);
    const aim = smartInitialAim(problem);
    // Shooting downhill: the minimum-speed elevation drops below 45 degrees.
    expect(aim.theta).toBeLessThan(Math.PI / 4);

    const evaluation = createShootingResidual(problem)(aim);
    expect(evaluation.ok).toBe(true);
    expect(Math.hypot(...evaluation.residual!)).toBeLessThan(1e-6);
  });

  it("undershoots with drag, and says so in the direction of the miss", () => {
    const problem = simpleProblem({ kind: "point", center: [750, 0] }, 0.47);
    const evaluation = createShootingResidual(problem)(smartInitialAim(problem));
    expect(evaluation.ok).toBe(true);
    // Negative downrange residual = landed short. This is the documented cost
    // of a drag-free initializer, pinned so it cannot silently become a claim.
    expect(evaluation.residual![0]!).toBeLessThan(0);
  });

  it("reads gravity from the problem's environment instead of assuming G_STD", () => {
    const problem = simpleProblem({ kind: "point", center: [500, 0] }, 0);
    const withDefault = smartInitialAim(problem);
    const overridden = smartInitialAim(problem, { gravity: 1.625 });
    expect(withDefault.speed).toBeCloseTo(dragFreeAim(500, 0, G_STD).speed, 12);
    expect(overridden.speed).toBeCloseTo(dragFreeAim(500, 0, 1.625).speed, 12);
  });

  it("does not write to the context's rhs scratch buffer while sampling gravity", () => {
    const problem = simpleProblem({ kind: "point", center: [500, 0] }, 0);
    problem.ctx.env.g = -1; // A sentinel no environment would produce.
    smartInitialAim(problem);
    expect(problem.ctx.env.g).toBe(-1);
  });

  it("aims at the target's centre by default and honours an explicit aim point", () => {
    const problem = simpleProblem({ kind: "point", center: [500, 0] }, 0);
    expect(smartInitialAim(problem).speed).toBeCloseTo(dragFreeAim(500, 0).speed, 12);
    expect(smartInitialAim(problem, { aimPoint: [800, 0] }).speed).toBeCloseTo(
      dragFreeAim(800, 0).speed,
      12,
    );
  });

  it("aims along the same axis the launch state fires along, on a spatial layout", () => {
    // SPATIAL_LAYOUT's vertical is axis 1, so downrange is axis 0 and the
    // lateral offset on axis 2 is unreachable by a two-number aim. The
    // initializer must ignore it rather than fold it into the distance.
    const problem: ShootingProblem = {
      ...simpleProblem({ kind: "point", center: [0, 0] }, 0),
      model: createSpatialProjectileModel([new GravityForce()]),
      target: { kind: "point", center: [600, 0, 130] },
      layout: SPATIAL_LAYOUT,
      launchPoint: [0, 0, 0],
    };
    const aim = smartInitialAim(problem);
    expect(aim.speed).toBeCloseTo(dragFreeAim(600, 0).speed, 12);

    const evaluation = createShootingResidual(problem)(aim);
    expect(evaluation.ok).toBe(true);
    // Downrange is hit; the lateral 130 m is the irreducible part, reported in
    // full rather than half-absorbed into a worse downrange aim.
    expect(Math.abs(evaluation.residual![0]!)).toBeLessThan(1e-6);
    expect(evaluation.residual![2]!).toBeCloseTo(-130, 9);
  });

  it("rejects a launch point or aim point of the wrong arity", () => {
    const problem = simpleProblem({ kind: "point", center: [500, 0] }, 0);
    expect(() => smartInitialAim(problem, { aimPoint: [500, 0, 0] })).toThrow(/aimPoint has 3/);
    expect(() => smartInitialAim({ ...problem, launchPoint: [0] })).toThrow(/launchPoint has 1/);
  });
});

/* ------------------------------------------------------------------ */
/* P5.07's validation criterion: every library target                   */
/* ------------------------------------------------------------------ */

/**
 * The criterion says "all library targets", and the library is
 * `@ballista/engine`'s `SCENARIO_LIBRARY` — the 20 curated scenarios the preset
 * browser ships (P4.36). Each one becomes a shooting problem here, and its
 * target is the impact point of *its own launch aim*, so every target is
 * reachable by construction: a scenario whose aim missed would be measuring the
 * target's reachability rather than the initializer's basin.
 *
 * Three deliberate choices in how the problems are built:
 *
 * 1. **Tolerances are this harness's, not the library's.** Nearly every entry
 *    carries `REFERENCE_SOLVER` (DOPRI5 at rtol 1e-6), which is the right
 *    working tolerance for an interactive app and too loose for a
 *    finite-difference Jacobian — the difference quotient would be measuring
 *    step-sequence noise. `golden-trajectory-store.ts` makes the same
 *    substitution for the same reason.
 * 2. **The spin channel starts at zero**, because `createShootingResidual`
 *    builds its launch state from the aim alone. The two spin scenarios
 *    therefore run their own models and forces (Magnus included) with no launch
 *    spin. That is a different flight from the library's, which is fine: the
 *    target is derived from the same parameterization, so the problem is
 *    self-consistent.
 * 3. **`vz0` is dropped** on the spatial entry, for the same reason: an aim
 *    cannot express azimuth.
 */
const DEFAULT_TAU_OMEGA = 25;

function forceById(id: string): ForceModel {
  switch (id) {
    case "gravity":
      return new GravityForce();
    case "drag-linear":
      return new LinearDragForce();
    case "drag-quadratic":
      return new QuadraticDragForce();
    case "magnus":
      return new MagnusForce();
    case "buoyancy":
      return new BuoyancyForce();
    default:
      throw new Error(`Unknown force id in scenario library: ${id}`);
  }
}

interface LibraryCase {
  readonly id: string;
  readonly model: Model;
  readonly ctx: EvalContext;
  readonly layout: TrajectoryLayout;
  readonly launchPoint: number[];
  /** The aim the library entry's own initial conditions encode. */
  readonly launchAim: Aim;
}

function libraryCase(id: string, spec: ScenarioSpec): LibraryCase {
  const forces = spec.model.forceIds.map(forceById);
  const ctx = createEvalContext(
    environmentSpecToEnvironment(spec.environment, spec.seed),
    projectileSpecToParams(spec.projectile, spec.initialConditions.spin0),
  );
  const ic = spec.initialConditions;
  const kind = spec.model.kind ?? "planar";
  const model =
    kind === "spatial"
      ? createSpatialProjectileModel(forces)
      : kind === "planar-spin"
        ? createPlanarProjectileSpinModel(forces, spec.model.tauOmega ?? DEFAULT_TAU_OMEGA)
        : createPlanarProjectileModel(forces);

  return {
    id,
    model,
    ctx,
    layout: kind === "spatial" ? SPATIAL_LAYOUT : PLANAR_LAYOUT,
    launchPoint: kind === "spatial" ? [ic.x0, ic.y0, ic.z0 ?? 0] : [ic.x0, ic.y0],
    launchAim: {
      theta: Math.atan2(ic.vy0, ic.vx0),
      speed: Math.hypot(ic.vx0, ic.vy0),
    },
  };
}

function libraryProblem(entry: LibraryCase, target: PointTarget): ShootingProblem {
  return {
    model: entry.model,
    ctx: entry.ctx,
    target,
    launchPoint: entry.launchPoint,
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 600],
    layout: entry.layout,
  };
}

describe("P5.07 validation: the initializer's basin over every library target", () => {
  const cases = SCENARIO_LIBRARY.map((entry) => libraryCase(entry.id, entry.spec));

  it("covers the whole scenario library", () => {
    expect(cases).toHaveLength(SCENARIO_LIBRARY.length);
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it("converges from the closed-form init on every library target (success rate 100%)", () => {
    const failures: string[] = [];
    const iterationCounts: number[] = [];

    for (const entry of cases) {
      // A placeholder target only to build the residual that locates the real one.
      const probe = libraryProblem(entry, {
        kind: "point",
        center: entry.launchPoint.map(() => 0),
      });
      const probeResidual = createShootingResidual(probe)(entry.launchAim);
      if (!probeResidual.ok) {
        failures.push(`${entry.id}: its own launch aim produced no impact, so it has no target`);
        continue;
      }

      const target: PointTarget = { kind: "point", center: probeResidual.impact! };
      const problem = libraryProblem(entry, target);
      const residual = createShootingResidual(problem);
      const initial = smartInitialAim(problem);
      const result = newtonShooting(residual, initial);

      // The vertical row of the Jacobian is structurally zero for a
      // ground-impact shot (P5.05), so "converged" is judged on the reducible
      // part: the downrange miss. A raised target's vertical component cannot
      // be driven anywhere by any aim, and `newtonShooting` reports that as a
      // stall rather than a failure.
      const downrangeMiss = Math.abs(result.residual.residual?.[0] ?? Number.POSITIVE_INFINITY);
      if (!(downrangeMiss < 1e-6)) {
        failures.push(
          `${entry.id}: status ${result.status}, downrange miss ${downrangeMiss} m after ` +
            `${result.iterations} iterations from theta=${initial.theta}, v0=${initial.speed}`,
        );
        continue;
      }
      iterationCounts.push(result.iterations);
    }

    expect(failures).toEqual([]);
    expect(iterationCounts).toHaveLength(cases.length);
    // Recorded rather than asserted tightly: the criterion is the success rate,
    // and the iteration count is what P5.06's own criterion is measured with.
    expect(Math.max(...iterationCounts)).toBeLessThanOrEqual(8);
  });
});
