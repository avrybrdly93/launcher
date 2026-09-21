import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  FunctionTerrain,
  G_STD,
  GravityForce,
  type Model,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  type EvalContext,
  type Terrain,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { constrainedShooting, withBoundsPenalty } from "./constraints.js";
import { levenbergMarquardt } from "./levenberg-marquardt.js";
import { newtonShooting } from "./newton-shooting.js";
import { PLANAR_LAYOUT } from "./observables.js";
import {
  type ResidualFunction,
  type ShootingProblem,
  createShootingResidual,
} from "./shooting-residual.js";
import type { Target } from "./targets.js";

/**
 * P0.105: a target off the terminal event surface can never be hit, and the
 * solver now says which rather than stalling.
 *
 * **What these tests are for is the *decline* direction as much as the
 * verdict.** The detector's correctness argument is that it can prove
 * unreachability and can never conclude reachability, so the cases below that
 * assert `undefined` are load-bearing: a false "unreachable" would turn a
 * solvable problem into a reported failure, which is strictly worse than the
 * stall this task was filed about.
 */

const ctx: EvalContext = createEvalContext(
  new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
  createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0.47),
  }),
);

/** `golden-optimization-store.ts`'s configuration, so the numbers are comparable. */
function problem(target: Target, terrain?: Terrain): ShootingProblem {
  return {
    model: createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()], terrain),
    ctx,
    target,
    config: { stepper: "dopri5", rtol: 1e-12, atol: 1e-14, maxSteps: 200_000 },
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

/** The golden store's `newton-raised-platform-unreachable` geometry, exactly. */
const RAISED_PLATFORM: Target = {
  kind: "platform",
  center: [120, 15],
  halfExtents: [2],
  tolerance: 1e-3,
};

describe("the unreachability proof", () => {
  it("names the terminal event and the offset for a platform above flat ground", () => {
    const residual = createShootingResidual(problem(RAISED_PLATFORM));
    const proof = residual.unreachableTarget;

    expect(proof).toBeDefined();
    expect(proof?.event).toBe("ground-impact");
    // Exact, not approximate: g_gnd = y - h(x) is 15 - 0 on flat terrain, and
    // the samples are required to agree bit-for-bit before a verdict is given.
    expect(proof?.offset).toBe(15);
    expect(proof?.reason).toContain("ground-impact");
  });

  it("is absent for a target on the ground, which is the reachable case", () => {
    const residual = createShootingResidual(problem({ kind: "point", center: [150, 0] }));
    expect(residual.unreachableTarget).toBeUndefined();
  });

  it("is present for a raised ring, not just a platform", () => {
    const residual = createShootingResidual(
      problem({ kind: "ring", center: [150, 8], radius: 5, tolerance: 1e-3 }),
    );
    expect(residual.unreachableTarget?.offset).toBe(8);
  });

  it("declines over sloped terrain, where the samples cannot speak for the points between them", () => {
    const slope = new FunctionTerrain((x: number) => 0.1 * x);
    expect(
      createShootingResidual(problem(RAISED_PLATFORM, slope)).unreachableTarget,
    ).toBeUndefined();
  });

  it("declines when the target's plane touches the terrain anywhere under its footprint", () => {
    // Terrain flat at 15 m — the platform's own height — so the centre probe
    // alone would read `g = 0` and decline for the right reason. This is the
    // control for the sample set: the verdict must not survive a zero.
    const shelf = new FunctionTerrain(() => 15);
    expect(
      createShootingResidual(problem(RAISED_PLATFORM, shelf)).unreachableTarget,
    ).toBeUndefined();
  });

  it("declines when the terminal event reads velocity, so one probe cannot speak for another", () => {
    // `g` here is the ordinary ground indicator plus a velocity term. A probe
    // at a single velocity would read a constant non-zero value across the
    // footprint and wrongly declare the target unreachable; the velocity sweep
    // is what catches it.
    const base = createPlanarProjectileModel([new GravityForce()]);
    const velocityDependent: Model = {
      ...base,
      events: [
        {
          name: "velocity-dependent",
          g: (_t: number, y: Float64Array) => y[1]! - 15 + 0.001 * y[3]!,
          terminal: true,
        },
      ],
    };
    const residual = createShootingResidual({
      ...problem(RAISED_PLATFORM),
      model: velocityDependent,
    });
    expect(residual.unreachableTarget).toBeUndefined();
  });

  it("declines when the terminal event surface moves with time", () => {
    const base = createPlanarProjectileModel([new GravityForce()]);
    const timeDependent: Model = {
      ...base,
      events: [
        {
          name: "time-dependent",
          g: (t: number, y: Float64Array) => y[1]! - 15 - t,
          terminal: true,
        },
      ],
    };
    const residual = createShootingResidual({ ...problem(RAISED_PLATFORM), model: timeDependent });
    expect(residual.unreachableTarget).toBeUndefined();
  });
});

describe("newtonShooting on a provably unreachable target", () => {
  const solve = () =>
    newtonShooting(createShootingResidual(problem(RAISED_PLATFORM)), { theta: 0.9, speed: 60 });

  it("reports the cause as a status rather than as a stall", () => {
    const result = solve();
    expect(result.status).toBe("target-unreachable");
    expect(result.converged).toBe(false);
  });

  it("renames the outcome without changing it, which is why the iteration still runs", () => {
    const result = solve();
    // Every one of these is the figure `golden-optimizations.json` pinned
    // while the status read "stalled". The point of relabelling at the end
    // rather than short-circuiting at the start is that `aim` is the closest
    // approach the solver can reach and `merit` is the irreducible miss — an
    // early return would have reported the caller's initial guess instead.
    expect(result.iterations).toBe(4);
    expect(result.evaluations).toBe(25);
    expect(result.aim.theta).toBeCloseTo(1.0313982570525626, 12);
    expect(result.aim.speed).toBeCloseTo(42.48200172068886, 10);
    expect(result.merit).toBeCloseTo(14.99999999999999, 10);
  });

  it("keeps the underlying stall in the failure text rather than discarding it", () => {
    const failure = solve().failure ?? "";
    expect(failure).toContain("ground-impact");
    // The original diagnosis is still there, now as detail under a cause
    // rather than as the whole answer.
    expect(failure).toContain('stopped with "stalled"');
    expect(failure).toContain("rank 1 of 2");
  });

  it("reports the irreducible miss in the vertical component alone", () => {
    const result = solve();
    expect(result.residual.residual?.[0]).toBeCloseTo(0, 6);
    expect(result.residual.residual?.[1]).toBeCloseTo(-15, 10);
  });
});

describe("newtonShooting does not relabel outcomes the proof does not explain", () => {
  it("leaves a converging ground solve alone", () => {
    const result = newtonShooting(
      createShootingResidual(problem({ kind: "point", center: [150, 0] })),
      { theta: 0.6, speed: 55 },
    );
    expect(result.status).toBe("converged");
    expect(result.converged).toBe(true);
  });

  it("still converges when the offset is smaller than the residual tolerance", () => {
    // A target 1e-9 m above the ground is provably off the terminal surface —
    // the proof is attached — but it is a hit by this solver's own definition,
    // and calling it unreachable would be wrong.
    const barelyRaised: Target = { kind: "point", center: [150, 1e-9] };
    const residual = createShootingResidual(problem(barelyRaised));
    expect(residual.unreachableTarget?.offset).toBe(1e-9);

    const result = newtonShooting(residual, { theta: 0.6, speed: 55 });
    expect(result.status).toBe("converged");
    expect(result.merit).toBeLessThanOrEqual(1e-6);
  });
});

/**
 * P0.146, half one: `ResidualFunction` is a call signature with an optional
 * property, so a wrapper that returns a bare arrow satisfies the type while
 * silently dropping the proof.
 *
 * **Every test here wraps, and that is the point.** The defect is invisible to
 * any test that builds a residual directly and asks whether the property is
 * there — it was, on the residual the old tests built — so asserting the
 * property *survives a wrap* is the only assertion that would have caught it.
 */
describe("the unreachability proof survives withBoundsPenalty", () => {
  const CAP = { speedMax: 70 } as const;

  it("is carried onto the wrapper, field for field", () => {
    const residual = createShootingResidual(problem(RAISED_PLATFORM));
    const wrapped = withBoundsPenalty(residual, CAP);

    expect(wrapped.unreachableTarget).toBeDefined();
    expect(wrapped.unreachableTarget).toEqual(residual.unreachableTarget);
    expect(wrapped.unreachableTarget?.offset).toBe(15);
    expect(wrapped.unreachableTarget?.event).toBe("ground-impact");
  });

  it("stays absent when the wrapped residual has none, because absent means unproven", () => {
    const residual = createShootingResidual(problem({ kind: "point", center: [150, 0] }));
    expect(residual.unreachableTarget).toBeUndefined();
    expect(withBoundsPenalty(residual, CAP).unreachableTarget).toBeUndefined();
  });

  it("still appends the four penalty rows, so carrying the proof costs the wrap nothing", () => {
    const residual = createShootingResidual(problem(RAISED_PLATFORM));
    const wrapped = withBoundsPenalty(residual, CAP);
    const aim = { theta: 0.9, speed: 60 };

    const bare = residual(aim).residual;
    const penalized = wrapped(aim).residual;
    expect(bare).not.toBeNull();
    expect(penalized).toHaveLength(bare!.length + 4);
    // Under the cap, so every hinge is inactive and the appended rows are zero.
    expect(penalized!.slice(bare!.length)).toEqual([0, 0, 0, 0]);
  });
});

/**
 * P0.146, half one's visible symptom: the same problem and the same target
 * answered differently depending on a strategy flag that has nothing to do
 * with reachability.
 */
describe("constrainedShooting reports the cause under either strategy", () => {
  const CAP = { speedMax: 70 } as const;
  const START = { theta: 0.9, speed: 60 } as const;

  it.each(["projection", "penalty"] as const)(
    "reports target-unreachable under the %s strategy",
    (strategy) => {
      const result = constrainedShooting(
        createShootingResidual(problem(RAISED_PLATFORM)),
        START,
        CAP,
        { strategy },
      );
      expect(result.newton.status).toBe("target-unreachable");
      expect(result.newton.failure).toContain("ground-impact");
    },
  );

  it("still reports the same physical miss under both strategies", () => {
    // The relabel is a rename, so the number it renames must not move. Quoted
    // to 10 places rather than approximately, because the two strategies reach
    // the same irreducible 15 m by different routes and a change in either
    // would be a real regression.
    for (const strategy of ["projection", "penalty"] as const) {
      const result = constrainedShooting(
        createShootingResidual(problem(RAISED_PLATFORM)),
        START,
        CAP,
        { strategy },
      );
      expect(result.miss).toBeCloseTo(14.99999999999999, 10);
    }
  });

  it("leaves the constrained status alone: an unreachable target is not a bound problem", () => {
    // Deliberately asserted rather than left implicit. The best aim sits at
    // ~42.5 m/s against a 70 m/s cap, so no bound is active, and
    // "unconstrained-failure" is the correct constrained reading — the box is
    // not what is stopping this solve. P0.146 must not widen that mapping.
    const result = constrainedShooting(
      createShootingResidual(problem(RAISED_PLATFORM)),
      START,
      CAP,
      { strategy: "penalty" },
    );
    expect(result.activeSet.activeCount).toBe(0);
    expect(result.status).toBe("unconstrained-failure");
  });
});

/**
 * P0.146, half two: `levenbergMarquardt` declared its own `stalled` whose doc
 * hedged in the same words `newtonShooting`'s used to — "part of the residual
 * *may* be structurally irreducible" — and never read the proof that says
 * which part, and why.
 */
describe("levenbergMarquardt on a provably unreachable target", () => {
  const solve = () =>
    levenbergMarquardt(createShootingResidual(problem(RAISED_PLATFORM)), {
      theta: 0.9,
      speed: 60,
    });

  it("reports the cause as a status rather than as a stall", () => {
    const result = solve();
    expect(result.status).toBe("target-unreachable");
    expect(result.converged).toBe(false);
  });

  it("renames the outcome without changing it", () => {
    // Every figure here was measured before the relabel existed, with the
    // status reading "stalled". Asserting them is what pins that the LABEL
    // moved and the ANSWER did not — a short-circuit at the start would have
    // returned the caller's initial guess (0.9, 60) instead.
    const result = solve();
    expect(result.iterations).toBe(2);
    expect(result.evaluations).toBe(20);
    expect(result.aim.theta).toBeCloseTo(1.2245603198624027, 12);
    expect(result.aim.speed).toBeCloseTo(51.7094760722548, 10);
    expect(result.merit).toBeCloseTo(15, 10);
  });

  it("keeps the underlying stall diagnosis in the failure text", () => {
    const failure = solve().failure ?? "";
    expect(failure).toContain("ground-impact");
    expect(failure).toContain('stopped with "stalled"');
    // The damped-step number the original diagnosis carried is still there,
    // now as detail under a cause rather than as the whole answer.
    expect(failure).toContain("damped step norm");
  });

  it("reports the irreducible miss in the vertical component alone", () => {
    const result = solve();
    expect(result.residual.residual?.[0]).toBeCloseTo(0, 6);
    expect(result.residual.residual?.[1]).toBeCloseTo(-15, 10);
  });
});

describe("levenbergMarquardt does not relabel outcomes the proof does not explain", () => {
  it("leaves a converging ground solve alone", () => {
    const result = levenbergMarquardt(
      createShootingResidual(problem({ kind: "point", center: [150, 0] })),
      { theta: 0.6, speed: 55 },
    );
    expect(result.status).toBe("converged");
    expect(result.converged).toBe(true);
  });

  it("still converges when the offset is smaller than the residual tolerance", () => {
    const residual = createShootingResidual(problem({ kind: "point", center: [150, 1e-9] }));
    expect(residual.unreachableTarget?.offset).toBe(1e-9);

    const result = levenbergMarquardt(residual, { theta: 0.6, speed: 55 });
    expect(result.status).toBe("converged");
    expect(result.merit).toBeLessThanOrEqual(1e-6);
  });

  it("leaves an unprovable non-convergence reading whatever it actually was", () => {
    // The same raised platform over sloped terrain, where the detector
    // declines because the samples cannot speak for the points between them.
    // The geometry is no more reachable than the flat case — but nothing has
    // been *proved*, and the relabel is driven by the proof rather than by the
    // shape of the failure. This is the case the `stalled` hedge still
    // describes, and it is why that wording was kept rather than deleted.
    const residual: ResidualFunction = createShootingResidual(
      problem(RAISED_PLATFORM, new FunctionTerrain((x: number) => 0.1 * x)),
    );
    expect(residual.unreachableTarget).toBeUndefined();

    const result = levenbergMarquardt(residual, { theta: 0.9, speed: 60 });
    expect(result.converged).toBe(false);
    expect(result.status).not.toBe("target-unreachable");
    expect(result.failure).not.toContain('ground-impact" terminal event surface');
  });
});
