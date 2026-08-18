import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  type EvalContext,
  type ForceModel,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { type SolverConfig, createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import {
  createAdjointRangeGradient,
  createBackwardAdjointModel,
} from "./adjoint-range-gradient.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { type Aim, type ShootingProblem } from "./shooting-residual.js";
import {
  type TangentParameter,
  aimParameters,
  createTangentLinearFlight,
  rangeSensitivity,
} from "./tangent-linear.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.24's validation criterion is "adjoint gradient matches tangent-linear to
 * 1e-8 on 3-param case", and the 3-parameter case is the centre of this file:
 * `(θ, v₀, C_d)` with drag on, which is the smallest set that exercises both
 * halves of the adjoint identity — `λ(0)ᵀS_k(0)` for the two launch-state
 * parameters and `∫λᵀb_k dt` for the dynamics one.
 *
 * **Two references, because they fail differently.**
 *
 * The criterion names the tangent-linear module, and that comparison is the
 * one that matters: the two methods share the problem, the parameter list and
 * the `∂f/∂y` formula, but nothing else. One integrates `n(1+m)` equations
 * forward; the other integrates `2n+m` backwards with a transposed Jacobian
 * and a quadrature. An algebra error in either shows up as disagreement.
 *
 * But two implementations agreeing is not the same as two implementations
 * being right, and a shared misunderstanding of the *event-time correction*
 * would agree perfectly — the correction is the same formula in both, moved
 * from a post-hoc adjustment to a terminal condition. So the drag-free cases
 * are checked against `R = v₀² sin 2θ / g` and its derivatives, a closed form
 * neither module evaluates anywhere.
 *
 * **The number that makes the correction visible.** At 45° drag-free the true
 * `∂R/∂θ` is exactly zero — the range is at its maximum. `tangent-linear.ts`
 * records that the *uncorrected* value there is −163 m/rad. The adjoint gets
 * the zero because `λ(T)`'s vertical entry carries `−v_x/v_y`; a version that
 * seeded `λ(T) = e_R` instead would return that same −163, so the 45° case is
 * this file's sharpest single assertion.
 */

const V0 = 40;
const THETA = Math.PI / 4;
const CD = 0.47;

/** Tight, so the two methods are compared on their formulations, not on their step sequences. */
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

/** Drag-free problem: no drag force wired at all, so `R = v₀² sin 2θ / g` holds exactly. */
function dragFreeProblem(launchPoint = [0, 0]): ShootingProblem {
  return {
    model: createPlanarProjectileModel([new GravityForce()]),
    ctx: context(0),
    target: TARGET,
    launchPoint,
    config: TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 600],
    layout: PLANAR_LAYOUT,
  };
}

/** Drag problem: the drag force is always wired, so `C_d` is a live parameter of the dynamics. */
function draggingProblem(cd = CD, launchPoint = [0, 0]): ShootingProblem {
  const forces: ForceModel[] = [new GravityForce(), new QuadraticDragForce()];
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

/** A drag-coefficient parameter: enters the dynamics, not the launch state. */
function dragCoefficientParameter(cd: number): TangentParameter {
  return { name: "cd", displaceContext: (delta) => context(cd + delta), scale: 1 };
}

/** The 3-parameter list the criterion names: two launch-state, one dynamics. */
function threeParameters(cd: number): TangentParameter[] {
  return [...aimParameters(PLANAR_LAYOUT), dragCoefficientParameter(cd)];
}

/** Largest relative difference between two same-length gradients. */
function worstRelative(a: readonly number[], b: readonly number[]): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    const scale = Math.max(Math.abs(b[i]!), 1e-12);
    worst = Math.max(worst, Math.abs(a[i]! - b[i]!) / scale);
  }
  return worst;
}

function tangentGradient(setup: ShootingProblem, parameters: TangentParameter[], aim: Aim) {
  const flight = createTangentLinearFlight(setup, parameters)(aim);
  const gradient = rangeSensitivity(flight, PLANAR_LAYOUT);
  if (gradient === null) throw new Error(`tangentGradient: flight failed — ${flight.failure}`);
  return gradient;
}

describe("createAdjointRangeGradient (P5.24)", () => {
  // ---- The validation criterion ------------------------------------------

  it("matches the tangent-linear gradient to 1e-8 on the 3-parameter case", () => {
    const setup = draggingProblem();
    const parameters = threeParameters(CD);
    const aim: Aim = { theta: 0.7, speed: V0 };

    const adjoint = createAdjointRangeGradient(setup, parameters)(aim);
    expect(adjoint.ok).toBe(true);
    expect(adjoint.parameters).toEqual(["theta", "speed", "cd"]);

    const tangent = tangentGradient(setup, parameters, aim);
    expect(adjoint.gradient).not.toBeNull();
    expect(worstRelative(adjoint.gradient!, tangent)).toBeLessThan(1e-8);
  });

  it("still matches at 1e-8 from a raised launch point, where no closed form applies", () => {
    const setup = draggingProblem(CD, [0, 12]);
    const parameters = threeParameters(CD);
    const aim: Aim = { theta: 0.55, speed: 35 };

    const adjoint = createAdjointRangeGradient(setup, parameters)(aim);
    expect(adjoint.ok).toBe(true);
    const tangent = tangentGradient(setup, parameters, aim);
    expect(worstRelative(adjoint.gradient!, tangent)).toBeLessThan(1e-8);
  });

  it("matches at 1e-8 across a sweep of elevations, not just one lucky aim", () => {
    const setup = draggingProblem();
    const parameters = threeParameters(CD);
    const solve = createAdjointRangeGradient(setup, parameters);

    for (const theta of [0.25, 0.4, 0.55, 0.7, 0.9, 1.1]) {
      const aim: Aim = { theta, speed: V0 };
      const adjoint = solve(aim);
      expect(adjoint.ok, `θ = ${theta}`).toBe(true);
      const tangent = tangentGradient(setup, parameters, aim);
      expect(worstRelative(adjoint.gradient!, tangent), `θ = ${theta}`).toBeLessThan(1e-8);
    }
  });

  // ---- Against a closed form neither module evaluates ---------------------

  it("reproduces dR/dθ and dR/dv₀ of the drag-free closed form", () => {
    // R = v₀² sin2θ / g  ⇒  ∂R/∂θ = 2v₀² cos2θ / g, ∂R/∂v₀ = 2v₀ sin2θ / g.
    const setup = dragFreeProblem();
    const parameters = aimParameters(PLANAR_LAYOUT);
    const theta = 0.6;
    const adjoint = createAdjointRangeGradient(setup, parameters)({ theta, speed: V0 });

    expect(adjoint.ok).toBe(true);
    const dTheta = (2 * V0 * V0 * Math.cos(2 * theta)) / G_STD;
    const dSpeed = (2 * V0 * Math.sin(2 * theta)) / G_STD;
    expect(adjoint.gradient![0]!).toBeCloseTo(dTheta, 8);
    expect(adjoint.gradient![1]!).toBeCloseTo(dSpeed, 8);
    expect(adjoint.range!).toBeCloseTo((V0 * V0 * Math.sin(2 * theta)) / G_STD, 8);
  });

  it("returns dR/dθ = 0 at the drag-free optimum, which is the event-time correction's whole job", () => {
    // Without the correction in λ(T) this is roughly −163 m/rad, the number
    // tangent-linear.ts records for the uncorrected sensitivity. Zero is only
    // reachable if λ(T)'s vertical entry carries −v_x/v_y.
    const setup = dragFreeProblem();
    const adjoint = createAdjointRangeGradient(
      setup,
      aimParameters(PLANAR_LAYOUT),
    )({ theta: THETA, speed: V0 });

    expect(adjoint.ok).toBe(true);
    expect(Math.abs(adjoint.gradient![0]!)).toBeLessThan(1e-6);
    expect(adjoint.gradient![1]!).toBeCloseTo((2 * V0) / G_STD, 8);
  });

  it("puts the event-time correction in λ(T), as −v_x/v_y on the vertical channel", () => {
    const setup = dragFreeProblem();
    const solve = createAdjointRangeGradient(setup, aimParameters(PLANAR_LAYOUT));
    const adjoint = solve({ theta: 0.6, speed: V0 });

    expect(adjoint.ok).toBe(true);
    const lambdaT = adjoint.terminalAdjoint!;
    // [x, y, vx, vy]: unit weight on downrange position, the correction on the
    // vertical position, nothing on the velocities — range does not read them.
    expect(lambdaT[0]!).toBe(1);
    expect(lambdaT[2]!).toBe(0);
    expect(lambdaT[3]!).toBe(0);

    // Drag-free the impact speed mirrors the launch speed, so
    // v_x = v₀cosθ and v_y = −v₀sinθ, giving −v_x/v_y = +cot θ… but with the
    // sign of the definition λ_y = −(e_R·f)/(∇g·f) that is −cot θ. Checked
    // against the launch angle rather than against the impact state, so the
    // assertion does not read the same numbers the code did.
    expect(lambdaT[1]!).toBeCloseTo(-(Math.cos(0.6) / -Math.sin(0.6)), 6);
  });

  // ---- The split between the two halves of the identity -------------------

  it("puts a launch-state parameter's whole gradient in λ(0)ᵀS(0) and none in the quadrature", () => {
    const setup = draggingProblem();
    const adjoint = createAdjointRangeGradient(
      setup,
      aimParameters(PLANAR_LAYOUT),
    )({ theta: 0.7, speed: V0 });

    expect(adjoint.ok).toBe(true);
    // ∂f/∂μ ≡ 0 for θ and v₀, so the quadrature is not merely small — it is
    // never accumulated at all.
    expect(adjoint.quadrature).toEqual([0, 0]);
    expect(adjoint.gradient![0]).not.toBe(0);
  });

  it("puts a dynamics parameter's whole gradient in the quadrature and none in λ(0)ᵀS(0)", () => {
    const setup = draggingProblem();
    const adjoint = createAdjointRangeGradient(setup, [dragCoefficientParameter(CD)])({
      theta: 0.7,
      speed: V0,
    });

    expect(adjoint.ok).toBe(true);
    // C_d has no seedInitialState, so the launch term is skipped entirely and
    // the gradient is exactly the quadrature.
    expect(adjoint.gradient![0]!).toBe(adjoint.quadrature![0]!);
    // Drag shortens the shot, so more drag means less range.
    expect(adjoint.gradient![0]!).toBeLessThan(0);
  });

  it("reports λ(0), whose downrange entry is 1 because a downrange shift of the launch moves the impact one-for-one", () => {
    const setup = draggingProblem();
    const adjoint = createAdjointRangeGradient(
      setup,
      aimParameters(PLANAR_LAYOUT),
    )({ theta: 0.7, speed: V0 });

    expect(adjoint.ok).toBe(true);
    // Translating the whole problem downrange translates the impact by the
    // same amount, whatever the dynamics — so ∂R/∂x₀ = 1 exactly, and this is
    // a statement about the adjoint solve rather than about the seeds.
    expect(adjoint.launchAdjoint![0]!).toBeCloseTo(1, 9);
  });

  // ---- The scaling story, measured ---------------------------------------

  it("reports both augmented dimensions, so the O(1)-vs-O(n_μ) claim is checkable", () => {
    const setup = draggingProblem();
    const aim: Aim = { theta: 0.7, speed: V0 };
    const n = setup.model.dim;

    for (const m of [1, 3, 30]) {
      const parameters: TangentParameter[] = Array.from({ length: m }, (_unused, index) => ({
        name: `cd${index}`,
        displaceContext: (delta: number) => context(CD + delta),
        scale: 1,
      }));
      const adjoint = createAdjointRangeGradient(setup, parameters)(aim);
      expect(adjoint.ok, `m = ${m}`).toBe(true);
      expect(adjoint.forwardDimension).toBe(n * (1 + m));
      expect(adjoint.backwardDimension).toBe(2 * n + m);
    }

    // The crossover, spelled out: the backward dimension is smaller once
    // m > n/(n−1)·… — for n = 4 that is every m ≥ 3 (16 vs 11), and the gap
    // widens linearly. At m = 1 the forward method is smaller (8 vs 9), which
    // is the honest half of the story and is asserted rather than omitted.
    expect(n * (1 + 1)).toBeLessThan(2 * n + 1);
    expect(2 * n + 3).toBeLessThan(n * (1 + 3));
    expect(2 * n + 30).toBeLessThan(n * (1 + 30));
  });

  it("gives every one of 30 identical parameters the same gradient", () => {
    // A sanity check on the quadrature block's indexing: 30 copies of the same
    // parameter must produce 30 identical numbers, and an off-by-one in the
    // `2n + k` offsets would not.
    const setup = draggingProblem();
    const parameters: TangentParameter[] = Array.from({ length: 30 }, (_unused, index) => ({
      name: `cd${index}`,
      displaceContext: (delta: number) => context(CD + delta),
      scale: 1,
    }));
    const adjoint = createAdjointRangeGradient(setup, parameters)({ theta: 0.7, speed: V0 });

    expect(adjoint.ok).toBe(true);
    const first = adjoint.gradient![0]!;
    for (const value of adjoint.gradient!) expect(value).toBe(first);
  });

  // ---- The prototype's shortcut, made measurable --------------------------

  it("reports how far the replayed base state drifted, and it is small here", () => {
    const setup = draggingProblem();
    const adjoint = createAdjointRangeGradient(
      setup,
      threeParameters(CD),
    )({
      theta: 0.7,
      speed: V0,
    });

    expect(adjoint.ok).toBe(true);
    // Re-integrating ẏ = f backwards from impact is the prototype's shortcut
    // in place of checkpointing. On a projectile flight at rtol 1e-12 the
    // round trip closes to well under a micrometre / micrometre-per-second;
    // the field exists so that a longer or stiffer problem shows the shortcut
    // failing instead of returning a quietly wrong gradient.
    expect(adjoint.stateRoundTripError).not.toBeNull();
    expect(adjoint.stateRoundTripError!).toBeLessThan(1e-6);
    expect(adjoint.stateRoundTripError!).toBeGreaterThan(0);
  });

  // ---- The backward model in isolation ------------------------------------

  it("drives λ by Aᵀ, not by A", () => {
    // The transpose is the single line that separates this module from the
    // variational block in tangent-linear.ts, and on a state where A is
    // genuinely asymmetric (drag couples v_x and v_y) the two differ. Compared
    // against a hand-written Aᵀλ built from the model's own analytic jacobian.
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = context(CD);
    const backward = createBackwardAdjointModel(model, [dragCoefficientParameter(CD)], 3.5);
    const n = model.dim;

    const y = Float64Array.from([12, 7, 21, -9]);
    const lambda = Float64Array.from([1, -0.4, 0.25, 0.6]);
    const z = new Float64Array(backward.dim);
    z.set(y, 0);
    z.set(lambda, n);
    const out = new Float64Array(backward.dim);
    backward.rhs(0.5, z, out, ctx);

    const jac = new Float64Array(n * n);
    expect(model.jacobian).toBeDefined();
    model.jacobian!(3.0, y, ctx, jac); // t = impactTime − s = 3.5 − 0.5

    for (let i = 0; i < n; i++) {
      let expected = 0;
      for (let j = 0; j < n; j++) expected += jac[j * n + i]! * lambda[j]!;
      expect(out[n + i]!).toBeCloseTo(expected, 6);
    }

    // And the base block runs backwards: dy/ds = −f.
    const f = new Float64Array(n);
    model.rhs(3.0, y, f, ctx);
    for (let i = 0; i < n; i++) expect(out[i]!).toBeCloseTo(-f[i]!, 12);
  });

  it("declares no events on the backward model", () => {
    // The forward terminal event fires at s = 0 by construction — the backward
    // solve starts *on* the ground. Carrying it over would end the solve
    // immediately.
    const model = createPlanarProjectileModel([new GravityForce()]);
    const backward = createBackwardAdjointModel(model, aimParameters(PLANAR_LAYOUT), 2);
    expect(backward.events).toBeUndefined();
    expect(backward.dim).toBe(2 * model.dim + 2);
    expect(backward.channels).toHaveLength(backward.dim);
  });

  // ---- Rejections ---------------------------------------------------------

  it("rejects an empty parameter list", () => {
    expect(() => createAdjointRangeGradient(draggingProblem(), [])).toThrow(
      /no parameters to differentiate/,
    );
  });

  it("rejects a parameter that enters neither the launch state nor the dynamics", () => {
    expect(() => createAdjointRangeGradient(draggingProblem(), [{ name: "inert" }])).toThrow(
      /enters neither the launch state nor the dynamics/,
    );
  });

  it("rejects a model with no terminal event", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const noEvents = { ...model, events: [] };
    expect(() =>
      createAdjointRangeGradient(
        { ...draggingProblem(), model: noEvents },
        aimParameters(PLANAR_LAYOUT),
      ),
    ).toThrow(/no terminal event/);
  });

  it("rejects a terminal event that declares an action, rather than carrying λ through a reset", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const bouncing = {
      ...model,
      events: (model.events ?? []).map((event) =>
        event.terminal
          ? {
              ...event,
              action(_t: number, y: Float64Array, out: Float64Array): void {
                out.set(y);
              },
            }
          : event,
      ),
    };
    expect(() =>
      createAdjointRangeGradient(
        { ...draggingProblem(), model: bouncing },
        aimParameters(PLANAR_LAYOUT),
      ),
    ).toThrow(/declares an action/);
  });

  it("reports a base solve that never reaches impact instead of returning a gradient", () => {
    // A span far too short for the shot: the solve runs out of tspan with the
    // projectile still in the air, so there is no impact time and no λ(T).
    const setup: ShootingProblem = { ...draggingProblem(), tspan: [0, 0.25] };
    const adjoint = createAdjointRangeGradient(
      setup,
      threeParameters(CD),
    )({
      theta: 0.7,
      speed: V0,
    });

    expect(adjoint.ok).toBe(false);
    expect(adjoint.gradient).toBeNull();
    expect(adjoint.failure).toMatch(/did not reach its terminal event/);
    expect(adjoint.backwardReport).toBeNull();
  });
});
