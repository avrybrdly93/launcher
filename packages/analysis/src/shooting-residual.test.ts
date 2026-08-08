import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import {
  ClassicalRK4Stepper,
  TrajectoryRecorder,
  createDormandPrince54Stepper,
  integrate,
} from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { PLANAR_LAYOUT } from "./observables.js";
import {
  type Aim,
  type ShootingProblem,
  createShootingResidual,
  residualNorm,
} from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.04's validation criterion is "residual continuous across step boundaries
 * (dense-output check)", and the whole file is built around making that
 * measurable rather than asserted.
 *
 * The measurement is a **fixed-step** solve. A fixed step is what pins the
 * grid: accepted steps land on `0, h, 2h, …` regardless of the aim, while the
 * ground-event time `T(θ) = 2v₀sin θ / g` slides continuously as `θ` does. So
 * sweeping `θ` walks the event across step boundary after step boundary, and
 * the step count changes at each one — which the sweep asserts directly rather
 * than assuming, because a sweep that never crossed a boundary would pass this
 * file's continuity assertions while measuring nothing at all.
 *
 * Continuity is then measured as the **second difference** of the residual
 * over a uniform `θ` grid. For a smooth residual that is `R''·Δθ²`; for a
 * residual read off the last grid point before the crossing it is the jump
 * itself, `≈ h·v_x`. The two are four orders of magnitude apart here, and
 * {@link gridPointResidualX} is a negative control that takes the grid-point
 * reading so the separation is demonstrated in the same run rather than
 * argued for in a comment.
 */

const V0 = 60;
const STEP = 0.05;

/** Drag-free ground-launch range, the independent reference for the impact point. */
function analyticRange(v0: number, theta: number): number {
  return (v0 * v0 * Math.sin(2 * theta)) / G_STD;
}

/** The elevation angle whose drag-free range is `targetRange` — the low arc. */
function analyticLowArc(v0: number, targetRange: number): number {
  return 0.5 * Math.asin((G_STD * targetRange) / (v0 * v0));
}

function dragFreeContext(): { ctx: ReturnType<typeof createEvalContext> } {
  const env = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(G_STD, false),
    new ZeroWind(),
  );
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  return { ctx: createEvalContext(env, params) };
}

function pointTargetAt(x: number, y = 0): PointTarget {
  return { kind: "point", center: [x, y] };
}

/**
 * A fixed-step drag-free shooting problem aimed at `target`.
 *
 * Fixed step (`h` set, `rtol` unset) is not incidental — see the file comment.
 * An adaptive solve chooses its own step sizes per aim, so its grid moves
 * *with* the aim and there is no fixed boundary for the event to cross.
 */
function fixedStepProblem(target: PointTarget): ShootingProblem {
  const { ctx } = dragFreeContext();
  return {
    model: createPlanarProjectileModel([new GravityForce()]),
    ctx,
    target,
    config: { stepper: "dopri5", h: STEP, maxSteps: 200_000 },
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

/**
 * The negative control: the downrange residual read off the **last step grid
 * point before the crossing** instead of the event-localized row.
 *
 * The recorder's rows are `0, h, 2h, …, k·h, T`, so row `nSteps - 2` is the
 * grid point at `k·h`. Reading it is precisely the mistake P5.04's criterion
 * exists to rule out, and it is implemented here rather than described so the
 * sweep can show it failing the same assertion the real residual passes.
 */
function gridPointResidualX(problem: ShootingProblem, aim: Aim, targetX: number): number {
  const y0 = new Float64Array([
    0,
    0,
    aim.speed * Math.cos(aim.theta),
    aim.speed * Math.sin(aim.theta),
  ]);
  const recorder = new TrajectoryRecorder();
  const report = integrate(
    problem.model,
    problem.ctx,
    y0,
    problem.tspan!,
    problem.config,
    problem.stepper,
    [recorder],
  );
  expect(report.status).toBe("ok");
  const traj = recorder.trajectory;
  return traj.channels[0]![traj.nSteps - 2]! - targetX;
}

/** Max |second difference| of a uniformly sampled series. */
function maxSecondDifference(values: readonly number[]): number {
  let worst = 0;
  for (let i = 1; i < values.length - 1; i++) {
    const d2 = Math.abs(values[i + 1]! - 2 * values[i]! + values[i - 1]!);
    if (d2 > worst) worst = d2;
  }
  return worst;
}

describe("P5.04 residual continuity across step boundaries (dense-output check)", () => {
  const TARGET_X = 300;
  const target = pointTargetAt(TARGET_X);
  const problem = fixedStepProblem(target);
  const residual = createShootingResidual(problem);

  // 401 samples of θ over [0.60, 0.70] rad. Flight time 2v₀sin θ/g runs from
  // 6.907 s to 7.886 s across that span, so the event crosses ≈19 boundaries
  // of the h = 0.05 grid — asserted below, not assumed.
  const THETA_LO = 0.6;
  const THETA_HI = 0.7;
  const SAMPLES = 401;
  const dTheta = (THETA_HI - THETA_LO) / (SAMPLES - 1);

  const thetas: number[] = [];
  for (let i = 0; i < SAMPLES; i++) thetas.push(THETA_LO + i * dTheta);

  const evaluations = thetas.map((theta) => residual({ theta, speed: V0 }));
  const residualX = evaluations.map((e) => e.residual![0]!);
  const stepCounts = evaluations.map((e) => e.report.nSteps);

  it("every solve in the sweep reached the ground event", () => {
    expect(evaluations.every((e) => e.ok)).toBe(true);
  });

  it("the sweep really does walk the event across step boundaries", () => {
    // Without this the continuity assertions below are vacuous: a residual
    // sampled entirely inside one step interval is continuous for free.
    // Measured: 20 distinct step counts spanning 139–158.
    const distinct = new Set(stepCounts);
    expect(distinct.size).toBeGreaterThanOrEqual(15);
    expect(Math.max(...stepCounts) - Math.min(...stepCounts)).toBeGreaterThanOrEqual(15);
  });

  it("the residual is continuous: second differences stay at curvature scale", () => {
    // R(θ) = v₀²sin(2θ)/g has |R''| ≤ 4v₀²/g ≈ 1468 m/rad², so a smooth
    // residual has |Δ²| ≈ |R''|·Δθ² ≈ 8.8e-5 m. Measured: 9.04e-5 m — the
    // curvature of the range curve and nothing else. The negative control
    // below measures 2.47 m on the identical sweep, a factor of 2.7e4. The
    // 1e-3 bound sits an order above the curvature and three below the jump,
    // so it fails on a staircase and does not fail on ordinary sampling.
    expect(maxSecondDifference(residualX)).toBeLessThan(1e-3);
  });

  it("no single sample jumps: successive differences track the analytic slope", () => {
    // dR/dθ = 2v₀²cos(2θ)/g, at most 2v₀²/g ≈ 734 m/rad, so |ΔR| ≤ 0.184 m
    // per 2.5e-4 rad sample. Measured: 6.65e-2 m. The control's largest
    // single-sample jump is 2.41 m.
    for (let i = 1; i < residualX.length; i++) {
      expect(Math.abs(residualX[i]! - residualX[i - 1]!)).toBeLessThan(0.2);
    }
  });

  it("NEGATIVE CONTROL: the grid-point reading is discontinuous at the boundaries", () => {
    const control = thetas.map((theta) =>
      gridPointResidualX(problem, { theta, speed: V0 }, TARGET_X),
    );
    // The same two assertions the real residual passes, both violated, and by
    // margins that show the sweep is measuring the crossing rather than noise.
    expect(maxSecondDifference(control)).toBeGreaterThan(1);
    const biggestJump = Math.max(...control.slice(1).map((v, i) => Math.abs(v - control[i]!)));
    expect(biggestJump).toBeGreaterThan(1);
  });
});

describe("P5.04 residual value", () => {
  const V = 55;

  it("is r_impact − r*: matches the drag-free closed form to 1e-6 m", () => {
    const theta = 0.55;
    const targetX = 250;
    const residual = createShootingResidual(fixedStepProblem(pointTargetAt(targetX)));
    const got = residual({ theta, speed: V });
    expect(got.ok).toBe(true);
    // The reference never touches this code path: it is v₀²sin(2θ)/g.
    expect(got.residual![0]!).toBeCloseTo(analyticRange(V, theta) - targetX, 6);
  });

  it("is zero at the analytic solution angle, to 1e-6 m", () => {
    const targetX = 200;
    const theta = analyticLowArc(V, targetX);
    const residual = createShootingResidual(fixedStepProblem(pointTargetAt(targetX)));
    const got = residual({ theta, speed: V });
    expect(Math.abs(got.residual![0]!)).toBeLessThan(1e-6);
  });

  it("carries the sign convention impact − target, not target − impact", () => {
    // No magnitude assertion can catch a flipped sign, so it gets its own test:
    // overshoot is positive, undershoot negative.
    const targetX = 200;
    const solution = analyticLowArc(V, targetX);
    const residual = createShootingResidual(fixedStepProblem(pointTargetAt(targetX)));
    expect(residual({ theta: solution + 0.05, speed: V }).residual![0]!).toBeGreaterThan(0);
    expect(residual({ theta: solution - 0.05, speed: V }).residual![0]!).toBeLessThan(0);
  });

  it("puts the vertical component at the event surface, not at the target height", () => {
    // A ground-launch point target sits at y = 0 and the impact is localized
    // onto y = 0, so this component is ~0 for every aim — the reason a
    // 2-unknown Newton solve needs a raised target or a second condition, and
    // a fact worth pinning rather than discovering in P5.06.
    const residual = createShootingResidual(fixedStepProblem(pointTargetAt(200)));
    expect(Math.abs(residual({ theta: 0.7, speed: V }).residual![1]!)).toBeLessThan(1e-9);
  });

  it("reports a raised target's vertical miss in the vertical component", () => {
    const residual = createShootingResidual(fixedStepProblem(pointTargetAt(200, 12)));
    const got = residual({ theta: 0.7, speed: V });
    // Impact is on the ground at y ≈ 0; the target is 12 m up.
    expect(got.residual![1]!).toBeCloseTo(-12, 6);
  });

  it("residualNorm is the Euclidean norm of the components", () => {
    const residual = createShootingResidual(fixedStepProblem(pointTargetAt(200, 12)));
    const got = residual({ theta: 0.7, speed: V });
    const [dx, dy] = got.residual!;
    expect(residualNorm(got)).toBeCloseTo(Math.hypot(dx!, dy!), 12);
  });

  it("reports time of flight alongside the residual", () => {
    const theta = 0.6;
    const residual = createShootingResidual(fixedStepProblem(pointTargetAt(200)));
    const got = residual({ theta, speed: V });
    expect(got.timeOfFlight!).toBeCloseTo((2 * V * Math.sin(theta)) / G_STD, 6);
  });
});

describe("P5.04 residual reports failure as a value", () => {
  it("returns ok: false rather than throwing when the solve never reaches impact", () => {
    // A Newton line search stepping into a bad trial aim must be able to
    // shorten its step; that needs the failure back as a value.
    const problem: ShootingProblem = { ...fixedStepProblem(pointTargetAt(200)), tspan: [0, 1] };
    const got = createShootingResidual(problem)({ theta: 0.9, speed: 90 });
    expect(got.ok).toBe(false);
    expect(got.residual).toBeNull();
    expect(got.impact).toBeNull();
    expect(got.timeOfFlight).toBeNull();
    expect(residualNorm(got)).toBe(Number.POSITIVE_INFINITY);
  });

  it("an exhausted span is a SUCCESSFUL solve, and is still not an impact", () => {
    // The trap this guards. Flight time here is 2·90·sin(0.9)/g ≈ 14.4 s, so
    // at tspan [0, 1] the shot is still climbing — yet the driver reached t_f,
    // so the solve's own status is "ok" and its final recorded row is an
    // ordinary mid-air point. Keying `ok` off `report.status` would report
    // that point's distance from the target as a residual.
    const problem: ShootingProblem = { ...fixedStepProblem(pointTargetAt(200)), tspan: [0, 1] };
    const got = createShootingResidual(problem)({ theta: 0.9, speed: 90 });
    expect(got.report.status).toBe("ok");
    expect(got.report.tFinal).toBe(1);
    expect(got.ok).toBe(false);
    expect(got.aim).toEqual({ theta: 0.9, speed: 90 });
  });

  it("returns ok: false on a typed solve failure too", () => {
    const problem: ShootingProblem = {
      ...fixedStepProblem(pointTargetAt(200)),
      config: { stepper: "dopri5", h: STEP, maxSteps: 5 },
    };
    const got = createShootingResidual(problem)({ theta: 0.6, speed: V0 });
    expect(got.report.status).toBe("failed");
    expect(got.ok).toBe(false);
    expect(residualNorm(got)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("P5.04 construction preconditions", () => {
  it("rejects a stepper with no dense-output interpolant", () => {
    // Classical RK4 has no interpolant, so `integrate` cannot truncate the
    // step at the event root — the residual would be the staircase the
    // negative control above measures.
    const problem: ShootingProblem = {
      ...fixedStepProblem(pointTargetAt(200)),
      config: { stepper: "rk4", h: STEP, maxSteps: 200_000 },
      stepper: new ClassicalRK4Stepper(),
    };
    expect(() => createShootingResidual(problem)).toThrow(/interpolant/);
  });

  it("rejects a model that declares no terminal event", () => {
    const base = fixedStepProblem(pointTargetAt(200));
    const problem: ShootingProblem = {
      ...base,
      model: { ...base.model, events: [] },
    };
    expect(() => createShootingResidual(problem)).toThrow(/terminal event/);
  });

  it("rejects a launch point whose length disagrees with the layout", () => {
    const problem: ShootingProblem = {
      ...fixedStepProblem(pointTargetAt(200)),
      launchPoint: [0, 0, 0],
    };
    expect(() => createShootingResidual(problem)({ theta: 0.6, speed: V0 })).toThrow(/launchPoint/);
  });

  it("rejects a non-finite aim rather than returning a NaN residual", () => {
    // A NaN residual reaching a Newton iteration is unattributable several
    // frames later; the throw names the offending component.
    const residual = createShootingResidual(fixedStepProblem(pointTargetAt(200)));
    expect(() => residual({ theta: Number.NaN, speed: V0 })).toThrow(/finite/);
    expect(() => residual({ theta: 0.6, speed: Number.POSITIVE_INFINITY })).toThrow(/finite/);
  });

  it("validates the target against the layout at construction", () => {
    const problem: ShootingProblem = {
      ...fixedStepProblem(pointTargetAt(200)),
      target: { kind: "point", center: [1, 2, 3] },
    };
    expect(() => createShootingResidual(problem)).toThrow();
  });
});

describe("P5.04 raised launch", () => {
  it("flies further from a raised launch point than from the ground", () => {
    // The case that makes the closed form inapplicable and the integrated
    // residual necessary: P5.03's dragFreeRange documents that it does not
    // cover a raised launch.
    const target = pointTargetAt(200);
    const ground = createShootingResidual(fixedStepProblem(target));
    const raised = createShootingResidual({ ...fixedStepProblem(target), launchPoint: [0, 30] });
    const aim: Aim = { theta: 0.6, speed: 50 };
    expect(raised(aim).residual![0]!).toBeGreaterThan(ground(aim).residual![0]! + 20);
  });

  it("the raised-launch residual is continuous across step boundaries too", () => {
    // The continuity property must not depend on the launch height, since
    // that is exactly the configuration P5.06 will be solving in.
    const problem: ShootingProblem = {
      ...fixedStepProblem(pointTargetAt(300)),
      launchPoint: [0, 25],
    };
    const residual = createShootingResidual(problem);
    const values: number[] = [];
    const counts: number[] = [];
    for (let i = 0; i < 201; i++) {
      const got = residual({ theta: 0.6 + i * 5e-4, speed: V0 });
      values.push(got.residual![0]!);
      counts.push(got.report.nSteps);
    }
    expect(new Set(counts).size).toBeGreaterThanOrEqual(10);
    expect(maxSecondDifference(values)).toBeLessThan(1e-2);
  });
});
