/**
 * The scenarios the P7.17 precision study is run over: one per class the planar
 * kernel's model can express, plus a drag-free case that exists to check the
 * reference arm rather than to produce a budget.
 *
 * ## Where the classes come from
 *
 * Not from eye. `@ballista/engine`'s `scenarioRegimeTags` splits scenarios on
 * `dimensionlessPi` at 0.1 (low-pi against high-pi) and calls a scenario `stiff`
 * when `recommendSolver` says so, which happens at a stiffness ratio above 50.
 *
 * For quadratic drag those two classifiers are the **same number twice**, and the
 * study's stiff row is built on that identity rather than on a parameter set that
 * looked extreme. The advisor's ratio is `v0 / (g * tau)` with
 * `tau = v0 / (2 * g * Pi)`, so
 *
 * ```
 *   ratio = v0 / (g * v0 / (2 * g * Pi)) = 2 * Pi
 * ```
 *
 * and its threshold `ratio > 50` is exactly `Pi > 25`.
 * `planar-precision-study.test.ts` asserts that collapse against
 * `recommendSolver` itself, so "stiff" in the published table means what the
 * advisor means by it and cannot drift from it silently.
 *
 * ## Why the stiff row is not the library's stiff preset
 *
 * The library's canonical stiff scenario is `dust-grain`, which is **linear
 * (Stokes) drag**. `PlanarDragParams` cannot express that -- its drag term is
 * quadratic with a constant `Cd` -- so the preset is unrunnable here in any
 * precision. The stiff row is instead a quadratic-drag scenario placed an order
 * of magnitude past the advisor's own threshold. That is a real stiff scenario by
 * the repo's own definition; it is simply not that preset, and the difference is
 * recorded rather than papered over.
 */

import type { PlanarDragParams } from "@ballista/solverkit";

import type { PrecisionScenario } from "./planar-precision-study.js";

/** Standard gravity, matching `@ballista/engine`'s `G_STD`. */
const G = 9.80665;
/** Sea-level density, matching the library presets' `ConstantAtmosphere`. */
const RHO = 1.225;
/** Sphere drag coefficient, matching the presets' `ConstantCd`. */
const CD = 0.47;

/** Cross-sectional area of a sphere of radius `r`. */
function sphereArea(r: number): number {
  return Math.PI * r * r;
}

/**
 * The dimensionless drag-to-gravity group, spelled here exactly as
 * `@ballista/engine`'s `dimensionlessPi` spells it.
 *
 * Duplicated rather than imported for one reason only: it is used below to
 * *construct* the scenarios, and a construction that imported the classifier it
 * will later be checked against would be checking the classifier against itself.
 * `planar-precision-study.test.ts` asserts the two agree, which is the
 * check that keeps this copy honest.
 */
export function planarPi(params: PlanarDragParams, v0: number): number {
  return (params.rho * params.cd * params.area * v0 * v0) / (2 * params.mass * params.g);
}

/** The advisor's stiffness ratio for a quadratic-drag scenario: exactly `2 * Pi`. */
export function planarStiffnessRatio(params: PlanarDragParams, v0: number): number {
  return 2 * planarPi(params, v0);
}

/** `recommendSolver`'s own threshold, restated so the tests can pin it. */
export const STIFFNESS_RATIO_THRESHOLD = 50;

function launch(speed: number, degrees: number): readonly number[] {
  const theta = (degrees * Math.PI) / 180;
  return [0, 0, speed * Math.cos(theta), speed * Math.sin(theta)];
}

/** Shot put: heavy, small, slow. The library's low-Pi end. */
const SHOT_PUT: PlanarDragParams = {
  mass: 7.26,
  area: sphereArea(0.0625),
  cd: CD,
  rho: RHO,
  g: G,
  windX: 0,
  windY: 0,
};

/** Table tennis ball: light, large for its mass. The library's high-Pi end. */
const TABLE_TENNIS: PlanarDragParams = {
  mass: 0.0027,
  area: sphereArea(0.02),
  cd: CD,
  rho: RHO,
  g: G,
  windX: 0,
  windY: 0,
};

/**
 * The same ball fired far faster.
 *
 * Pi scales as `v0^2`, so speed alone carries this scenario from high-Pi into
 * the advisor's stiff regime without changing a single property of the
 * projectile. That is deliberate: it isolates the regime change from every other
 * difference between the rows, exactly as the library's headwind/tailwind pair
 * isolates wind. A ping-pong ball at this speed is a real apparatus, not a
 * contrivance.
 */
const TABLE_TENNIS_STIFF = TABLE_TENNIS;

/** Drag-free: gravity only. Exists for the closed-form check, not for a budget. */
const VACUUM: PlanarDragParams = {
  mass: 1,
  area: 0,
  cd: 0,
  rho: 0,
  g: G,
  windX: 0,
  windY: 0,
};

/**
 * The study's scenarios.
 *
 * `h` and `steps` are chosen per scenario so the flight actually lands inside
 * the march: `range` and `impactT` are undefined until a trajectory crosses the
 * ground, and a study whose rows all report `impacted: false` would compare two
 * zeros and report perfect agreement having tested nothing. The tests assert
 * every row impacts.
 */
export const PRECISION_SCENARIOS: readonly PrecisionScenario[] = [
  {
    id: "vacuum-45deg",
    scenarioClass: "low-pi",
    description:
      "Drag-free 45-degree launch at 30 m/s. Pi is exactly 0. Present for the closed-form " +
      "check on the f64 arm, not for a budget: with no drag the Hermite refinement is exact " +
      "to roundoff, so this row says whether the reference is right rather than how far f32 is " +
      "from it.",
    params: VACUUM,
    y0: launch(30, 45),
    h: 0.001,
    steps: 6000,
    withinP716Family: true,
  },
  {
    id: "shot-put",
    scenarioClass: "low-pi",
    description: "7.26 kg shot at 14 m/s, 41 degrees. Drag is a small correction to a parabola.",
    params: SHOT_PUT,
    y0: launch(14, 41),
    h: 0.001,
    steps: 4000,
    withinP716Family: true,
  },
  {
    id: "table-tennis",
    scenarioClass: "high-pi",
    description: "2.7 g ball at 25 m/s, 35 degrees. Drag dominates: the arc is visibly asymmetric.",
    params: TABLE_TENNIS,
    y0: launch(25, 35),
    h: 0.001,
    steps: 6000,
    withinP716Family: true,
  },
  {
    id: "table-tennis-cannon",
    scenarioClass: "stiff",
    description:
      "The same 2.7 g ball at 140 m/s, 35 degrees. Identical projectile; only the launch speed " +
      "changes, and Pi scales as v0^2, which carries it past recommendSolver's stiffness " +
      "threshold. The regime change is therefore isolated from every other property.",
    params: TABLE_TENNIS_STIFF,
    y0: launch(140, 35),
    h: 0.001,
    steps: 6000,
    withinP716Family: false,
  },
];
