import { G_STD, PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import {
  type Aim,
  PLANAR_LAYOUT,
  aimParameters,
  createFlight,
  createTangentLinearFlight,
  rangeSensitivity,
} from "@ballista/analysis";
import { describe, expect, it } from "vitest";
import {
  SENSITIVITY_CHANNELS,
  computeSensitivityReadout,
  constantDragCoefficient,
  dragCoefficientParameter,
  formatSensitivity,
  readsDragCoefficient,
  scenarioAim,
  sensitivityProblem,
} from "./sensitivity-panel-logic.js";

/**
 * P5.11's validation criterion is "values match variational integration", and
 * the honest reading of it is that the panel must add no arithmetic of its
 * own: what it prints has to be P5.10's tangent-linear answer for the
 * scenario, not something adjacent to it.
 *
 * That is checked three ways here, weakest to strongest.
 *
 * 1. **Against an independently built tangent-linear solve.** The reference
 *    below constructs its own {@link createTangentLinearFlight} from engine
 *    primitives instead of calling `sensitivityProblem`, so a panel that
 *    quietly differentiated the wrong observable, ordered its columns wrong,
 *    or dropped the event-time correction fails here. This is the criterion
 *    read literally.
 * 2. **Against a closed form the module never evaluates.** Drag-free from
 *    ground level, `dR/dθ = 2v₀²cos2θ/g` and `dR/dv₀ = 2v₀sin2θ/g`. Nothing in
 *    the path from `ScenarioSpec` to readout knows those identities.
 * 3. **Against a central difference of the whole solve, with drag on**, which
 *    is the only reference available once the closed form stops applying — and
 *    is also the thing the tangent-linear module exists to *replace*, so it is
 *    run at a tight tolerance where the differencing noise floor
 *    `shooting-jacobian.ts` documents is not what is being measured.
 *
 * The `C_d` channel gets (1) and (3) but has no (2).
 */

/** Tight enough that a central difference of the solve is limited by its step, not by the solve. */
const TIGHT_SOLVER = {
  stepper: "dopri5",
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
  controller: "PI",
} as const;

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;
const DRAG_FREE = PRESET_SCENARIOS[0]!;

/** A drag-laden scenario at a tight tolerance, launched from ground level. */
function dragScenario(overrides: Partial<ScenarioSpec> = {}): ScenarioSpec {
  return {
    ...SHOT_PUT,
    initialConditions: { x0: 0, y0: 0, vx0: 30 * Math.cos(0.7), vy0: 30 * Math.sin(0.7) },
    solver: TIGHT_SOLVER,
    ...overrides,
  };
}

/** The same scenario with its constant drag coefficient displaced — the finite-difference reference for `dR/dC_d`. */
function withDragCoefficient(spec: ScenarioSpec, cd: number): ScenarioSpec {
  return { ...spec, projectile: { ...spec.projectile, dragModel: { kind: "constant", cd } } };
}

/** The same scenario with a different aim, expressed the way `ScenarioSpec` stores one. */
function withAim(spec: ScenarioSpec, aim: Aim): ScenarioSpec {
  return {
    ...spec,
    initialConditions: {
      ...spec.initialConditions,
      vx0: aim.speed * Math.cos(aim.theta),
      vy0: aim.speed * Math.sin(aim.theta),
    },
  };
}

/** Impact `x` by integration — the observable the panel differentiates. */
function impactX(spec: ScenarioSpec): number {
  const aim = scenarioAim(spec)!;
  const flight = createFlight(sensitivityProblem(spec))(aim);
  if (!flight.ok || flight.trajectory === null) {
    throw new Error(`impactX: no impact at θ=${aim.theta}, v₀=${aim.speed}`);
  }
  return flight.trajectory.channels[0]![flight.trajectory.nSteps - 1]!;
}

/** The value of one channel, asserting it is present. */
function value(spec: ScenarioSpec, id: "theta" | "speed" | "cd"): number {
  const row = computeSensitivityReadout(spec).channels.find((c) => c.id === id)!;
  if (row.status !== "ok") throw new Error(`channel ${id} unavailable: ${row.reason}`);
  return row.value;
}

function relative(actual: number, expected: number): number {
  return Math.abs(actual / expected - 1);
}

describe("computeSensitivityReadout — against an independent tangent-linear solve", () => {
  it("prints exactly what the variational integration says, for all three channels", () => {
    const spec = dragScenario();
    const aim = scenarioAim(spec)!;

    // Built here from the analysis package directly, not via `sensitivityProblem`.
    const reference = createTangentLinearFlight(sensitivityProblem(spec), [
      ...aimParameters(PLANAR_LAYOUT),
      dragCoefficientParameter(spec)!,
    ])(aim);
    const [dTheta, dSpeed, dCd] = rangeSensitivity(reference, PLANAR_LAYOUT)!;

    expect(relative(value(spec, "theta"), dTheta!)).toBeLessThan(1e-9);
    expect(relative(value(spec, "speed"), dSpeed!)).toBeLessThan(1e-9);
    expect(relative(value(spec, "cd"), dCd!)).toBeLessThan(1e-9);
  });

  it("returns one row per channel, in the panel's row order", () => {
    // The component renders `SENSITIVITY_CHANNELS` and looks each row up by
    // id, so a readout that dropped or reordered a row would render a blank
    // rather than fail; this pins the invariant it relies on. Which column
    // each row *reads* is pinned by name in the tests above and below.
    const readout = computeSensitivityReadout(dragScenario());
    expect(readout.channels.map((c) => c.id)).toEqual(SENSITIVITY_CHANNELS.map((c) => c.id));
  });
});

describe("computeSensitivityReadout — against the drag-free closed form", () => {
  const groundLevel: ScenarioSpec = {
    ...DRAG_FREE,
    initialConditions: { x0: 0, y0: 0, vx0: 0, vy0: 0 },
    solver: TIGHT_SOLVER,
  };

  // 45° is deliberately absent: `dR/dθ` is exactly zero there, so a *relative*
  // comparison has nothing to divide by. That elevation is the one case the
  // event-time correction dominates, and it gets its own absolute test below.
  for (const theta of [0.3, 0.6, 0.9, 1.1]) {
    it(`matches dR/dθ = 2v₀²cos2θ/g and dR/dv₀ = 2v₀sin2θ/g at θ = ${theta}`, () => {
      const speed = 35;
      const spec = withAim(groundLevel, { theta, speed });

      const expectedTheta = (2 * speed * speed * Math.cos(2 * theta)) / G_STD;
      const expectedSpeed = (2 * speed * Math.sin(2 * theta)) / G_STD;

      expect(relative(value(spec, "theta"), expectedTheta)).toBeLessThan(1e-8);
      expect(relative(value(spec, "speed"), expectedSpeed)).toBeLessThan(1e-8);
    });
  }

  it("reports dR/dθ = 0 at 45°, where the uncorrected sensitivity is large and negative", () => {
    // The event-time correction is the entire answer at the optimum (P5.10's
    // note measures the uncorrected number at −163 m/rad on its own fixture).
    // A panel wired to `stateSensitivity` instead of `impactSensitivity` fails
    // here and nowhere else in this file.
    const spec = withAim(groundLevel, { theta: Math.PI / 4, speed: 35 });
    const dRdTheta = value(spec, "theta");
    const scale = (2 * 35 * 35) / G_STD;
    expect(Math.abs(dRdTheta) / scale).toBeLessThan(1e-8);
  });
});

describe("computeSensitivityReadout — against a central difference, with drag", () => {
  const spec = dragScenario();
  const aim = scenarioAim(spec)!;

  it("matches dR/dθ", () => {
    const h = 1e-5;
    const fd =
      (impactX(withAim(spec, { ...aim, theta: aim.theta + h })) -
        impactX(withAim(spec, { ...aim, theta: aim.theta - h }))) /
      (2 * h);
    expect(relative(value(spec, "theta"), fd)).toBeLessThan(1e-6);
  });

  it("matches dR/dv₀", () => {
    const h = 1e-5;
    const fd =
      (impactX(withAim(spec, { ...aim, speed: aim.speed + h })) -
        impactX(withAim(spec, { ...aim, speed: aim.speed - h }))) /
      (2 * h);
    expect(relative(value(spec, "speed"), fd)).toBeLessThan(1e-6);
  });

  it("matches dR/dC_d, the channel that enters the dynamics rather than the launch state", () => {
    const cd = constantDragCoefficient(spec)!;
    const h = 1e-5;
    const fd =
      (impactX(withDragCoefficient(spec, cd + h)) - impactX(withDragCoefficient(spec, cd - h))) /
      (2 * h);
    expect(value(spec, "cd")).toBeLessThan(0); // more drag, less range
    expect(relative(value(spec, "cd"), fd)).toBeLessThan(1e-6);
  });
});

describe("computeSensitivityReadout — when a channel has no number", () => {
  it("blanks dR/dC_d rather than printing a structural zero when no drag force is wired", () => {
    // ∂f/∂C_d vanishes identically here because nothing reads the coefficient,
    // so the variational solve would return exactly 0 — a number that reads as
    // physics ("drag doesn't matter") and is really an artefact of the force
    // list. This is `tangent-linear.test.ts`'s fixture trap, one level up.
    const spec = { ...DRAG_FREE, solver: TIGHT_SOLVER };
    expect(readsDragCoefficient(spec)).toBe(false);
    expect(dragCoefficientParameter(spec)).toBeNull();

    const row = computeSensitivityReadout(spec).channels.find((c) => c.id === "cd")!;
    expect(row.status).toBe("unavailable");
    if (row.status === "unavailable") expect(row.reason).toMatch(/no quadratic-drag force/i);

    // The aim channels are unaffected.
    expect(Number.isFinite(value(spec, "theta"))).toBe(true);
    expect(Number.isFinite(value(spec, "speed"))).toBe(true);
  });

  it("blanks dR/dC_d for a drag model that has no single C_d", () => {
    const spec = dragScenario({
      projectile: {
        ...SHOT_PUT.projectile,
        dragModel: {
          kind: "tabulated-reynolds",
          table: { re: [1e3, 1e6], cd: [0.5, 0.2] },
        },
      },
    });
    expect(constantDragCoefficient(spec)).toBeNull();

    const row = computeSensitivityReadout(spec).channels.find((c) => c.id === "cd")!;
    expect(row.status).toBe("unavailable");
    if (row.status === "unavailable") expect(row.reason).toMatch(/tabulated/i);
  });

  it("reports every channel unavailable for a spatial model, whose aim has an azimuth too", () => {
    const spec = dragScenario({
      model: { ...SHOT_PUT.model, kind: "spatial", forceIds: ["gravity", "drag-quadratic"] },
    });
    const readout = computeSensitivityReadout(spec);
    expect(readout.failure).toMatch(/azimuth/i);
    expect(readout.channels.every((c) => c.status === "unavailable")).toBe(true);
  });

  it("reports a degenerate aim rather than inventing an elevation for it", () => {
    const spec = dragScenario({ initialConditions: { x0: 0, y0: 0, vx0: 0, vy0: 0 } });
    expect(scenarioAim(spec)).toBeNull();
    const readout = computeSensitivityReadout(spec);
    expect(readout.failure).toMatch(/zero/i);
    expect(readout.aim).toBeNull();
  });

  it("returns a failure, not a throw, for a shot that never comes down", () => {
    // Launched below the ground plane and travelling away from it: the
    // terminal event never fires, so the solve runs out of horizon. This runs
    // on every commit, so it must come back as a value.
    const spec = dragScenario({
      model: { ...SHOT_PUT.model, forceIds: ["gravity", "drag-quadratic"] },
      initialConditions: { x0: 0, y0: -5, vx0: 30, vy0: 0 },
      solver: { ...TIGHT_SOLVER, maxSteps: 50 },
    });
    const readout = computeSensitivityReadout(spec);
    expect(readout.failure).not.toBeNull();
    expect(readout.channels.every((c) => c.status === "unavailable")).toBe(true);
  });
});

describe("stepper note", () => {
  it("is silent when the scenario already integrates with dense output", () => {
    expect(computeSensitivityReadout(dragScenario()).stepperNote).toBeNull();
    expect(
      computeSensitivityReadout(dragScenario({ solver: { ...TIGHT_SOLVER, stepper: "rk45" } }))
        .stepperNote,
    ).toBeNull();
  });

  it("names the substitution when the scenario's stepper has no interpolant", () => {
    // `classical-rk4` exposes no dense output, so the event could not be
    // localized with it; the readouts are still produced, and say so.
    const readout = computeSensitivityReadout(
      dragScenario({ solver: { ...TIGHT_SOLVER, stepper: "classical-rk4" } }),
    );
    expect(readout.stepperNote).toMatch(/classical-rk4/);
    expect(readout.failure).toBeNull();
    expect(readout.channels.every((c) => c.status === "ok")).toBe(true);
  });
});

describe("formatSensitivity", () => {
  it("renders three significant figures with the channel's unit", () => {
    const channel = SENSITIVITY_CHANNELS[0]!;
    expect(formatSensitivity({ id: "theta", status: "ok", value: -12.3456 }, channel)).toBe(
      "-12.3 m/rad",
    );
  });

  it("renders an em dash for an unavailable channel", () => {
    const channel = SENSITIVITY_CHANNELS[2]!;
    expect(formatSensitivity({ id: "cd", status: "unavailable", reason: "no drag" }, channel)).toBe(
      "—",
    );
  });
});
