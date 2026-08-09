import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  type EvalContext,
  type ForceModel,
  type Model,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  finiteDifferenceJacobian,
} from "@ballista/engine";
import { type SolverConfig, createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { PLANAR_LAYOUT } from "./observables.js";
import { type Aim, type ShootingProblem, createFlight } from "./shooting-residual.js";
import {
  type TangentParameter,
  aimParameters,
  createTangentLinearFlight,
  createTangentLinearModel,
  rangeSensitivity,
} from "./tangent-linear.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.10's validation criterion is "sensitivity matches FD to 1e-6 on smooth
 * scenario", and this file meets it twice over, deliberately, because the two
 * references fail differently.
 *
 * **The closed form is the stronger one.** Drag-free,
 * $R = v_0^2\sin 2\theta/g$, so
 *
 *   $\partial R/\partial\theta = 2v_0^2\cos 2\theta/g$,
 *   $\partial R/\partial v_0 = 2v_0\sin 2\theta/g$,
 *   $T = 2v_0\sin\theta/g$, and so on.
 *
 * None of that is evaluated anywhere in `tangent-linear.ts`, which integrates
 * a variational ODE and applies an event-time correction. An algebra error in
 * either half shows up against it immediately, and — unlike a finite
 * difference — the reference has no accuracy of its own to get in the way.
 *
 * **The finite difference is the one the criterion literally names**, and it is
 * the only reference available once drag is switched on. It is also the thing
 * this module exists to *replace*, so the comparison is run at a tight
 * integration tolerance where the differencing noise floor
 * `shooting-jacobian.ts` documents is small enough not to be what is being
 * measured.
 *
 * Two numbers worth stating up front, because they are the reason the
 * event-time correction is not an optional refinement. On the 45° drag-free
 * shot the true `∂R/∂θ` is zero while the *uncorrected* one is −163 m/rad — the
 * correction is the entire answer, not a tweak to it. Below the optimum the two
 * have **opposite signs**: raising the elevation lengthens the shot, but at
 * fixed time it moves the projectile backwards. Both are asserted below rather
 * than described.
 */

const V0 = 40;
const THETA = Math.PI / 4;

/** Tight enough that the finite-difference reference is limited by its step, not by the solve. */
const TOL: SolverConfig = {
  stepper: "dopri5",
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

const TARGET: PointTarget = { kind: "point", center: [10, 0] };

function context(cd: number): EvalContext {
  return createEvalContext(
    new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
    createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(cd),
    }),
  );
}

function problem(cd = 0, launchPoint = [0, 0]): ShootingProblem {
  const forces: ForceModel[] =
    cd === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: context(cd),
    target: TARGET,
    launchPoint,
    config: TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 600],
    layout: PLANAR_LAYOUT,
  };
}

/** Downrange distance at impact, by integration — the observable being differentiated. */
function range(setup: ShootingProblem, aim: Aim): number {
  const flight = createFlight(setup)(aim);
  if (!flight.ok || flight.trajectory === null) {
    throw new Error(`range: no impact at θ=${aim.theta}, v₀=${aim.speed}`);
  }
  const row = flight.trajectory.nSteps - 1;
  return flight.trajectory.channels[0]![row]!;
}

/** Flight time to impact, by integration. */
function flightTime(setup: ShootingProblem, aim: Aim): number {
  const flight = createFlight(setup)(aim);
  if (!flight.ok || flight.trajectory === null) {
    throw new Error(`flightTime: no impact at θ=${aim.theta}, v₀=${aim.speed}`);
  }
  return flight.trajectory.t[flight.trajectory.nSteps - 1]!;
}

/** Central difference of a scalar observable in one aim component. */
function centralDifference(
  observable: (aim: Aim) => number,
  aim: Aim,
  component: "theta" | "speed",
  step: number,
): number {
  const shift = (delta: number): Aim =>
    component === "theta"
      ? { theta: aim.theta + delta, speed: aim.speed }
      : { theta: aim.theta, speed: aim.speed + delta };
  return (observable(shift(step)) - observable(shift(-step))) / (2 * step);
}

/** A drag-coefficient parameter: enters the dynamics, not the launch state. */
function dragCoefficientParameter(cd: number): TangentParameter {
  return {
    name: "cd",
    displaceContext: (delta) => context(cd + delta),
    scale: 1,
  };
}

/**
 * A problem whose model always wires {@link QuadraticDragForce}, whatever `C_d`
 * is set to — including zero.
 *
 * {@link problem} drops the force entirely at `cd === 0`, which is the right
 * model for a drag-free study and the wrong one for asking how the answer
 * *responds* to drag: with no drag force in the model, displacing `C_d` moves
 * nothing and the sensitivity is exactly zero for a structural reason rather
 * than a physical one.
 */
function draggingProblem(cd: number, launchPoint = [0, 0]): ShootingProblem {
  return {
    ...problem(0.47, launchPoint),
    ctx: context(cd),
  };
}

/**
 * Evaluates the augmented right-hand side once at a fixed state, with a
 * parameter that has no dynamics dependence — so `∂f/∂μ` vanishes and the
 * sensitivity block is exactly `J·S`, which is the term these cases isolate.
 */
function variationalBlock(base: Model): {
  out: Float64Array;
  S: Float64Array;
  ctx: EvalContext;
  y: Float64Array;
} {
  const ctx = context(0.47);
  const seedOnly: TangentParameter = {
    name: "probe",
    seedInitialState: (_aim, out) => {
      out[2] = 1;
    },
  };
  const augmented = createTangentLinearModel(base, [seedOnly]);

  const y = Float64Array.from([3, 12, 25, 8]);
  const S = Float64Array.from([0.5, -1.25, 2, 0.75]);
  const Y = new Float64Array(augmented.dim);
  Y.set(y);
  Y.set(S, 4);
  const out = new Float64Array(augmented.dim);
  augmented.rhs(0.7, Y, out, ctx);
  return { out, S, ctx, y };
}

describe("createTangentLinearModel", () => {
  it("augments the dimension by one state block per parameter", () => {
    const base = createPlanarProjectileModel([new GravityForce()]);
    expect(createTangentLinearModel(base, aimParameters()).dim).toBe(4 * 3);
    expect(createTangentLinearModel(base, [aimParameters()[0]!]).dim).toBe(4 * 2);
  });

  it("names the sensitivity channels after the parameter they differentiate", () => {
    const base = createPlanarProjectileModel([new GravityForce()]);
    const names = createTangentLinearModel(base, aimParameters()).channels.map((c) => c.name);
    expect(names.slice(0, 4)).toEqual(base.channels.map((c) => c.name));
    expect(names[4]).toBe(`d(${base.channels[0]!.name})/d(theta)`);
    expect(names[8]).toBe(`d(${base.channels[0]!.name})/d(speed)`);
  });

  it("copies the base block through unchanged, so the state half is the original ODE", () => {
    const base = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = context(0.47);
    const augmented = createTangentLinearModel(base, aimParameters());

    const y = Float64Array.from([3, 12, 25, 8]);
    const expected = new Float64Array(4);
    base.rhs(0.7, y, expected, ctx);

    const Y = new Float64Array(augmented.dim);
    Y.set(y);
    const out = new Float64Array(augmented.dim);
    augmented.rhs(0.7, Y, out, ctx);

    expect(Array.from(out.subarray(0, 4))).toEqual(Array.from(expected));
  });

  it("evolves a sensitivity block as J·S, against the model's analytic Jacobian", () => {
    // Gravity + quadratic drag is exactly the set `createPlanarProjectileModel`
    // attaches a closed-form Jacobian to, so this case exercises the branch that
    // uses it — and the reference is that Jacobian rather than a difference of
    // it, so the agreement is exact rather than 1e-8.
    const base = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(base.jacobian).toBeDefined();

    const { out, S, ctx, y } = variationalBlock(base);
    const jac = new Float64Array(16);
    base.jacobian!(0.7, y, ctx, jac);

    for (let i = 0; i < 4; i++) {
      const expected = [0, 1, 2, 3].reduce((sum, j) => sum + jac[i * 4 + j]! * S[j]!, 0);
      expect(out[4 + i]!).toBeCloseTo(expected, 12);
    }
  });

  it("falls back to a finite-difference Jacobian that matches the engine's, digit for digit", () => {
    // This is the drift guard the module's `jacobianInto` comment promises: it
    // is `@ballista/engine`'s `finiteDifferenceJacobian` with the per-call
    // allocation hoisted out, and if the copy ever stops matching the original
    // this fails. Stripping `jacobian` from the model is what selects the
    // fallback — the same state a Magnus or linear-drag model is in.
    const withJacobian = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
    ]);
    const stripped: Model = {
      dim: withJacobian.dim,
      channels: withJacobian.channels,
      rhs: withJacobian.rhs.bind(withJacobian),
      ...(withJacobian.events !== undefined ? { events: withJacobian.events } : {}),
    };
    expect(stripped.jacobian).toBeUndefined();

    const { out, S, ctx, y } = variationalBlock(stripped);
    const jac = new Float64Array(16);
    finiteDifferenceJacobian(stripped, 0.7, y, ctx, jac);

    for (let i = 0; i < 4; i++) {
      const expected = [0, 1, 2, 3].reduce((sum, j) => sum + jac[i * 4 + j]! * S[j]!, 0);
      expect(out[4 + i]!).toBeCloseTo(expected, 12);
    }
  });

  it("lifts the terminal event so it reads only the base block", () => {
    const base = createPlanarProjectileModel([new GravityForce()]);
    const augmented = createTangentLinearModel(base, aimParameters());
    const event = augmented.events!.find((e) => e.terminal)!;

    const Y = new Float64Array(augmented.dim);
    Y[1] = 5;
    // Sensitivity channels are junk; a ground event must not see them.
    Y.fill(1e6, 4);
    expect(event.g(0, Y)).toBe(5);
  });
});

describe("createTangentLinearFlight — drag-free, against the closed form", () => {
  const setup = problem(0);
  const aim: Aim = { theta: THETA, speed: V0 };
  const fly = createTangentLinearFlight(setup, aimParameters());

  it("reproduces the analytic range sensitivities", () => {
    const flight = fly(aim);
    expect(flight.ok).toBe(true);

    const [dRdTheta, dRdV0] = rangeSensitivity(flight)!;
    const analyticTheta = (2 * V0 * V0 * Math.cos(2 * THETA)) / G_STD;
    const analyticSpeed = (2 * V0 * Math.sin(2 * THETA)) / G_STD;

    // cos(2·45°) = 0 exactly, so ∂R/∂θ is zero at the optimum: an absolute
    // bound, since a relative one against zero is meaningless.
    expect(Math.abs(dRdTheta! - analyticTheta)).toBeLessThan(1e-6);
    expect(Math.abs(dRdV0! / analyticSpeed - 1)).toBeLessThan(1e-9);
  });

  it("reproduces the analytic range sensitivities away from the optimum", () => {
    for (const theta of [0.35, 0.6, 1.1, 1.3]) {
      const flight = fly({ theta, speed: V0 });
      expect(flight.ok).toBe(true);
      const [dRdTheta, dRdV0] = rangeSensitivity(flight)!;
      const analyticTheta = (2 * V0 * V0 * Math.cos(2 * theta)) / G_STD;
      const analyticSpeed = (2 * V0 * Math.sin(2 * theta)) / G_STD;
      expect(Math.abs(dRdTheta! / analyticTheta - 1)).toBeLessThan(1e-9);
      expect(Math.abs(dRdV0! / analyticSpeed - 1)).toBeLessThan(1e-9);
    }
  });

  it("reproduces the analytic flight-time sensitivities", () => {
    const theta = 0.6;
    const flight = fly({ theta, speed: V0 });
    expect(flight.ok).toBe(true);
    const [dTdTheta, dTdV0] = flight.timeSensitivity!;
    // T = 2 v₀ sinθ / g
    expect(Math.abs(dTdTheta! / ((2 * V0 * Math.cos(theta)) / G_STD) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(dTdV0! / ((2 * Math.sin(theta)) / G_STD) - 1)).toBeLessThan(1e-9);
  });

  it("returns a vertical impact sensitivity of zero, because the ground pins it", () => {
    const flight = fly({ theta: 0.6, speed: V0 });
    // The impact lies on y = 0 for every aim, so d y_impact/dμ ≡ 0. This is the
    // component the event-time correction has to cancel exactly; a correction
    // applied with the wrong sign or a factor out leaves a residue here first.
    for (const block of flight.impactSensitivity!) {
      expect(Math.abs(block[1]!)).toBeLessThan(1e-9);
    }
  });

  it("keeps the base state on the trajectory the plain solve flies", () => {
    // Not bit-identical: the augmented solve's controller sees the sensitivity
    // channels and picks a different step sequence. Agreement to the tolerance
    // is the honest claim.
    const flight = fly(aim);
    expect(Math.abs(flight.state![0]! / range(setup, aim) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(flight.timeOfFlight! / flightTime(setup, aim) - 1)).toBeLessThan(1e-9);
  });
});

describe("the event-time correction is not optional", () => {
  const fly = createTangentLinearFlight(problem(0), aimParameters());

  it("is the whole answer at the 45° optimum", () => {
    const flight = fly({ theta: THETA, speed: V0 });
    const corrected = rangeSensitivity(flight)![0]!;
    const uncorrected = flight.stateSensitivity![0]![0]!;

    // The true value is 0 at 45°. The uncorrected number is −v₀ sinθ · T ≈
    // −163 m/rad — the entire horizontal travel of the flight, as if the impact
    // time did not move. The correction is not a refinement on this shot; it
    // *is* the answer.
    expect(Math.abs(corrected)).toBeLessThan(1e-6);
    expect(uncorrected).toBeLessThan(-150);
  });

  it("has the wrong sign without it, below the optimum", () => {
    // Below 45° raising the elevation lengthens the shot, so the true
    // sensitivity is positive; the fixed-time one is negative for every
    // positive elevation, since tilting up moves the projectile *backwards*
    // relative to where it would have been at that same instant.
    const theta = 0.35;
    const flight = fly({ theta, speed: V0 });
    const corrected = rangeSensitivity(flight)![0]!;
    const uncorrected = flight.stateSensitivity![0]![0]!;

    expect(corrected).toBeCloseTo((2 * V0 * V0 * Math.cos(2 * theta)) / G_STD, 6);
    expect(corrected).toBeGreaterThan(200);
    expect(uncorrected).toBeLessThan(0);
  });
});

describe("createTangentLinearFlight — with drag, against a finite difference", () => {
  const cd = 0.47;
  const setup = problem(cd);
  const aim: Aim = { theta: 0.7, speed: V0 };

  it("matches a finite difference of the whole solve to better than 1e-6 relative", () => {
    const flight = createTangentLinearFlight(setup, aimParameters())(aim);
    expect(flight.ok).toBe(true);
    const [dRdTheta, dRdV0] = rangeSensitivity(flight)!;

    // Steps chosen well above the differencing noise floor of an rtol=1e-12
    // solve and well below where O(h²) truncation would matter at 1e-6.
    const fdTheta = centralDifference((a) => range(setup, a), aim, "theta", 1e-4);
    const fdSpeed = centralDifference((a) => range(setup, a), aim, "speed", 1e-3);

    expect(Math.abs(dRdTheta! / fdTheta - 1)).toBeLessThan(1e-6);
    expect(Math.abs(dRdV0! / fdSpeed - 1)).toBeLessThan(1e-6);
  });

  it("matches a finite difference of flight time to better than 1e-6 relative", () => {
    const flight = createTangentLinearFlight(setup, aimParameters())(aim);
    const [dTdTheta, dTdV0] = flight.timeSensitivity!;
    const fdTheta = centralDifference((a) => flightTime(setup, a), aim, "theta", 1e-4);
    const fdSpeed = centralDifference((a) => flightTime(setup, a), aim, "speed", 1e-3);
    expect(Math.abs(dTdTheta! / fdTheta - 1)).toBeLessThan(1e-6);
    expect(Math.abs(dTdV0! / fdSpeed - 1)).toBeLessThan(1e-6);
  });

  it("holds from a raised launch point, where no closed form applies", () => {
    const raised = problem(cd, [0, 12]);
    const flight = createTangentLinearFlight(raised, aimParameters())(aim);
    expect(flight.ok).toBe(true);
    const [dRdTheta] = rangeSensitivity(flight)!;
    const fd = centralDifference((a) => range(raised, a), aim, "theta", 1e-4);
    expect(Math.abs(dRdTheta! / fd - 1)).toBeLessThan(1e-6);
  });

  it("differentiates a parameter that enters the dynamics rather than the launch state", () => {
    // C_d: seedInitialState absent, displaceContext present. This is the term
    // ∂f/∂μ, which every aim parameter leaves at zero — untested by everything
    // above.
    const flight = createTangentLinearFlight(setup, [dragCoefficientParameter(cd)])(aim);
    expect(flight.ok).toBe(true);
    const [dRdCd] = rangeSensitivity(flight)!;

    const h = 1e-5;
    const fd = (range(problem(cd + h), aim) - range(problem(cd - h), aim)) / (2 * h);

    expect(dRdCd!).toBeLessThan(0); // more drag, less range
    expect(Math.abs(dRdCd! / fd - 1)).toBeLessThan(1e-6);
  });

  it("reports a nonzero ∂R/∂C_d at C_d = 0, where the drag force itself vanishes", () => {
    // The drag force is identically zero here, but its *derivative* with
    // respect to C_d is not: ∂f/∂C_d is the full drag acceleration per unit
    // coefficient, and the first metre of range lost to drag is linear in it.
    // A module that read the force rather than differencing the field would
    // report zero and be wrong — so this pins the sign and the magnitude
    // against a finite difference taken about zero.
    const setupAtZero = draggingProblem(0);
    const flight = createTangentLinearFlight(setupAtZero, [dragCoefficientParameter(0)])(aim);
    expect(flight.ok).toBe(true);
    const dRdCd = rangeSensitivity(flight)![0]!;

    const h = 1e-5;
    const fd = (range(draggingProblem(h), aim) - range(draggingProblem(-h), aim)) / (2 * h);

    expect(dRdCd).toBeLessThan(-1);
    expect(Math.abs(dRdCd / fd - 1)).toBeLessThan(1e-6);
  });
});

describe("createTangentLinearFlight — rejected and failed cases", () => {
  it("rejects an empty parameter list", () => {
    expect(() => createTangentLinearFlight(problem(0), [])).toThrow(/no parameters/);
  });

  it("rejects a parameter that enters neither the state nor the dynamics", () => {
    expect(() => createTangentLinearFlight(problem(0), [{ name: "inert" }])).toThrow(
      /enters neither the launch state nor the dynamics/,
    );
  });

  it("rejects a terminal event carrying a reset map", () => {
    const base = createPlanarProjectileModel([new GravityForce()]);
    const bouncing = {
      ...base,
      events: (base.events ?? []).map((event) =>
        event.terminal
          ? {
              ...event,
              action(_t: number, y: Float64Array, out: Float64Array): void {
                out.set(y);
                out[3] = -0.6 * y[3]!;
              },
            }
          : event,
      ),
    };
    expect(() =>
      createTangentLinearFlight({ ...problem(0), model: bouncing }, aimParameters()),
    ).toThrow(/reset map/);
  });

  it("reports a solve that never reaches its terminal event, rather than throwing", () => {
    const flight = createTangentLinearFlight(
      { ...problem(0), tspan: [0, 0.5] },
      aimParameters(),
    )({ theta: THETA, speed: V0 });
    expect(flight.ok).toBe(false);
    expect(flight.failure).toMatch(/terminal event/);
    expect(flight.impactSensitivity).toBeNull();
  });

  it("throws on a non-finite aim", () => {
    const fly = createTangentLinearFlight(problem(0), aimParameters());
    expect(() => fly({ theta: Number.NaN, speed: V0 })).toThrow(/must be finite/);
  });
});

describe("aimParameters", () => {
  it("seeds ∂y₀/∂θ and ∂y₀/∂v₀ exactly", () => {
    const [theta, speed] = aimParameters();
    const aim: Aim = { theta: 0.6, speed: V0 };

    const a = new Float64Array(4);
    theta!.seedInitialState!(aim, a);
    expect(Array.from(a)).toEqual([0, 0, -V0 * Math.sin(0.6), V0 * Math.cos(0.6)]);

    const b = new Float64Array(4);
    speed!.seedInitialState!(aim, b);
    expect(Array.from(b)).toEqual([0, 0, Math.cos(0.6), Math.sin(0.6)]);
  });

  it("agrees with a finite difference of the launch state itself", () => {
    // The launch convention lives in shooting-residual.ts; these seeds are a
    // hand-differentiated copy of it, so the copy is checked against the
    // original rather than against itself.
    const aim: Aim = { theta: 0.6, speed: V0 };
    const h = 1e-6;
    const launch = (a: Aim): number[] => {
      const flight = createFlight(problem(0))(a);
      return [flight.trajectory!.channels[2]![0]!, flight.trajectory!.channels[3]![0]!];
    };
    const plus = launch({ theta: aim.theta + h, speed: aim.speed });
    const minus = launch({ theta: aim.theta - h, speed: aim.speed });

    const seeded = new Float64Array(4);
    aimParameters()[0]!.seedInitialState!(aim, seeded);
    expect(seeded[2]!).toBeCloseTo((plus[0]! - minus[0]!) / (2 * h), 6);
    expect(seeded[3]!).toBeCloseTo((plus[1]! - minus[1]!) / (2 * h), 6);
  });
});
