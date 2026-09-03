/**
 * P5.28 "five guided inverse-problem exercises with auto-check" (ROADMAP
 * seq 221, validation "checker validates against stored solutions").
 *
 * An *inverse* problem here is the direction the simulator does not run in.
 * Firing a shot is forward: given an aim, integrate and see where it lands.
 * Every exercise below runs the other way — given where it must land, find the
 * aim — which is the whole subject of Phase 5 and the reason `@ballista/analysis`
 * exists.
 *
 * **The five are chosen to be five different inverse problems, not one problem
 * five times.** In order they are: a root-find with two roots (pick the low
 * one), the same root-find's *other* root, a maximization, a nested
 * minimization, and a reachability query against the envelope. Each lands on a
 * different module of `@ballista/analysis`, so a learner who finishes the set
 * has met the method-selection question P5.29 documents rather than having
 * turned one crank five times.
 *
 * ## Why every stored solution is also recomputable
 *
 * A stored answer key that is merely *pinned* records whatever the code said
 * on the day it was written, including whatever it got wrong. So each exercise
 * carries both a stored {@link ExerciseAnswer.solution} and a {@link
 * InverseExercise.recompute} that derives it from the solvers, and
 * `inverse-exercises.test.ts` asserts the two agree. Two of the five are
 * additionally checked against closed forms that owe nothing to this codebase
 * (drag-free range is `v₀² sin 2θ / g`), which is what makes them evidence
 * rather than a fixture agreeing with itself.
 *
 * The stored numbers are what the checker grades against, because grading must
 * be instant and must not integrate anything; `recompute` exists for the test
 * and for anyone auditing the key.
 *
 * ## Units
 *
 * Answers are in the units the *question* is asked in — degrees for elevations,
 * m/s for speeds, metres for heights — not in the radians the solvers use
 * internally. This is §3.7's "units converted at the boundary only" applied to
 * the exercise boundary: the learner types 33.6, and the conversion to radians
 * happens here, once, on the way into the solver.
 */
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  radToDeg,
  type ForceModel,
} from "@ballista/engine";
import {
  PLANAR_LAYOUT,
  assessReachability,
  createShootingResidual,
  maximizeRange,
  minimumSpeedToHit,
  solveArcs,
  type ShootingProblem,
} from "@ballista/analysis";
import { createDormandPrince54Stepper, type SolverConfig } from "@ballista/solverkit";

/**
 * Tighter than an interactive session would use, for the reason
 * `arcs.test.ts` gives: an app's working tolerance is step-sequence noise to a
 * root finder, and an answer key wants the root, not the noise.
 */
const KEY_TOLERANCE: SolverConfig = {
  stepper: "dopri5",
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

/**
 * A regulation baseball: 145 g and 36.6 mm. Real numbers rather than a round
 * 1 kg sphere, because the whole point of exercises 3 and 5 is how far drag
 * moves the answer, and a dense ball barely moves it. Measured: this ball at
 * 40 m/s puts the maximum-range elevation 4.94° below 45°, where a 1 kg 5 cm
 * sphere in the same air moves it only 1.86° and makes the lesson look like
 * rounding.
 */
const BALL_MASS = 0.145; // kg
const BALL_RADIUS = 0.0366; // m

/**
 * The shared problem builder. `cd = 0` gives the drag-free case whose answers
 * have closed forms; any positive `cd` adds quadratic drag and removes them,
 * which is exactly the pedagogical step exercises 3 and 5 are making.
 *
 * Mass and radius are passed in both cases and are simply inert in the
 * drag-free one — with only {@link GravityForce} acting, and gravity uniform,
 * the trajectory is independent of both. That is Galileo's observation, and it
 * is worth leaving visible in the code rather than branching around.
 */
function exerciseProblem(targetDownrange: number, cd: number): ShootingProblem {
  const forces: ForceModel[] =
    cd === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
      createSphericalProjectileParams({
        mass: BALL_MASS,
        radius: BALL_RADIUS,
        dragCoefficient: new ConstantCd(cd),
      }),
    ),
    target: { kind: "point", center: [targetDownrange, 0] },
    launchPoint: [0, 0],
    config: KEY_TOLERANCE,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 600],
    layout: PLANAR_LAYOUT,
  };
}

/** A quantity the learner is given before starting. */
export interface ExerciseGiven {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
}

/** The stored answer key for one exercise. */
export interface ExerciseAnswer {
  /** What is being asked for, e.g. "launch elevation". */
  readonly quantity: string;
  /** The unit the learner answers in — degrees, m/s or m. */
  readonly unit: string;
  /**
   * The stored reference solution, in {@link unit}.
   *
   * Derived, not chosen: {@link InverseExercise.recompute} reproduces it from
   * `@ballista/analysis`, and the test asserts they agree to far finer than
   * {@link tolerance}.
   */
  readonly solution: number;
  /** Absolute tolerance in {@link unit}, inclusive at the boundary. */
  readonly tolerance: number;
  /** Why this tolerance and not a tighter or looser one. */
  readonly toleranceNote: string;
}

/** One guided inverse-problem exercise. */
export interface InverseExercise {
  readonly id: ExerciseId;
  readonly title: string;
  /** The question, in one or two sentences. */
  readonly prompt: string;
  /** What the learner starts from. */
  readonly givens: readonly ExerciseGiven[];
  /** The method this exercise is teaching, named as `@ballista/analysis` names it. */
  readonly method: string;
  /** Guidance, in the order it should be read. Never contains the answer. */
  readonly steps: readonly string[];
  /** What the exercise is actually about, revealed after a correct answer. */
  readonly insight: string;
  readonly answer: ExerciseAnswer;
  /**
   * Recompute the solution from the solvers, in {@link ExerciseAnswer.unit}.
   *
   * Integrates, so it is far too slow for grading. It exists so the stored key
   * can be audited rather than trusted.
   */
  readonly recompute: () => number;
}

/** The five exercise ids, in the order they are meant to be worked. */
export type ExerciseId =
  "low-arc" | "high-arc" | "max-range-angle" | "min-launch-speed" | "envelope-clearance";

/* ------------------------------------------------------------------ */
/* Exercise 1 and 2 — the two roots of one range equation              */
/* ------------------------------------------------------------------ */

const ARC_SPEED = 80; // m/s
const ARC_TARGET = 400; // m

function arcElevationDeg(which: "low" | "high"): number {
  const pair = solveArcs(exerciseProblem(ARC_TARGET, 0), ARC_SPEED);
  const solution = which === "low" ? pair.low : pair.high;
  if (solution === null) {
    throw new Error(`inverse-exercises: the ${which} arc for the stored problem did not solve`);
  }
  return radToDeg(solution.aim.theta);
}

/* ------------------------------------------------------------------ */
/* Exercise 3 — where the maximum actually is once drag is on          */
/* ------------------------------------------------------------------ */

const DRAG_CD = 0.47; // sphere, the value §3.4 quotes
const OPT_SPEED = 40; // m/s

function maxRangeElevationDeg(): number {
  const problem = exerciseProblem(100, DRAG_CD);
  const residual = createShootingResidual(problem);
  const optimum = maximizeRange((theta) => {
    const evaluation = residual({ theta, speed: OPT_SPEED });
    return evaluation.ok ? evaluation.impact![0]! : Number.NaN;
  });
  return radToDeg(optimum.theta);
}

/* ------------------------------------------------------------------ */
/* Exercise 4 — the cheapest shot that still arrives                   */
/* ------------------------------------------------------------------ */

const MIN_SPEED_TARGET = 300; // m downrange, on the ground

function minLaunchSpeed(): number {
  return minimumSpeedToHit(exerciseProblem(MIN_SPEED_TARGET, 0), [MIN_SPEED_TARGET, 0]).speed;
}

/* ------------------------------------------------------------------ */
/* Exercise 5 — how much room is left above a point                    */
/* ------------------------------------------------------------------ */

const CLEARANCE_SPEED = 40; // m/s
const CLEARANCE_DOWNRANGE = 60; // m

function envelopeClearance(): number {
  const report = assessReachability(exerciseProblem(100, DRAG_CD), CLEARANCE_SPEED, [
    CLEARANCE_DOWNRANGE,
    0,
  ]);
  if (report.envelopeHeight === null) {
    throw new Error(
      "inverse-exercises: no arc reaches the clearance abscissa, so the exercise has no answer",
    );
  }
  return report.envelopeHeight;
}

/* ------------------------------------------------------------------ */
/* The set                                                              */
/* ------------------------------------------------------------------ */

/**
 * The five exercises, in working order.
 *
 * Solutions are the values `recompute` produces, transcribed to more digits
 * than any tolerance here consults so that a drift in the solvers shows up in
 * the test as a disagreement rather than being absorbed.
 */
export const INVERSE_EXERCISES: readonly InverseExercise[] = [
  {
    id: "low-arc",
    title: "Hit the target on the flat arc",
    prompt:
      "A drag-free shot leaves the ground at 80 m/s and must land on a target 400 m downrange. " +
      "Two elevations do it. Find the flatter one.",
    givens: [
      { label: "launch speed", value: ARC_SPEED, unit: "m/s" },
      { label: "target downrange", value: ARC_TARGET, unit: "m" },
      { label: "drag coefficient", value: 0, unit: "" },
    ],
    method: "range root-find (solveArcs), low branch",
    steps: [
      "Write the forward map first: for a fixed speed, elevation θ produces some range R(θ). You are being asked to invert it.",
      "R(θ) is not monotonic — it rises to a peak and falls away — so it takes each reachable range twice. That is why the question has to say which arc it wants.",
      "Bracket the low root between 0 and the peak elevation, then close on it. Drag-free, the peak is at exactly 45°.",
      "Check your answer by firing it forward: the impact should land on 400 m, not near it.",
    ],
    insight:
      "Root-finding an inverse problem starts with counting the roots. A solver handed the whole interval will return whichever root its bracket happened to contain, and be entirely convergent about it.",
    answer: {
      quantity: "launch elevation",
      unit: "deg",
      solution: 18.90031076438649,
      tolerance: 0.05,
      toleranceNote:
        "0.05° is far coarser than the solver resolves this root (it agrees with the closed " +
        "form ½·asin(gR/v₀²) to 13 significant figures) and far finer than any wrong method " +
        "lands, so it grades the method rather than the learner's arithmetic precision.",
    },
    recompute: () => arcElevationDeg("low"),
  },
  {
    id: "high-arc",
    title: "Hit the same target on the lofted arc",
    prompt:
      "Same shot, same 400 m target. Find the other elevation that reaches it — the steep one.",
    givens: [
      { label: "launch speed", value: ARC_SPEED, unit: "m/s" },
      { label: "target downrange", value: ARC_TARGET, unit: "m" },
      { label: "drag coefficient", value: 0, unit: "" },
    ],
    method: "range root-find (solveArcs), high branch",
    steps: [
      "Bracket on the far side of the peak this time: between 45° and 90°.",
      "Before you solve, predict the answer from exercise 1. Drag-free, the two arcs are symmetric about the peak.",
      "Fire it forward and compare the flight time with the low arc's. Which shell is in the air longer?",
    ],
    insight:
      "The two arcs cost the same launch energy and are not otherwise interchangeable: the lofted one flies far longer, arrives far steeper, and spends much more of its flight exposed to any wind. Identical objective value, different physics.",
    answer: {
      quantity: "launch elevation",
      unit: "deg",
      solution: 71.09968923561345,
      tolerance: 0.05,
      toleranceNote: "Same as exercise 1; the two answers are graded on the same footing.",
    },
    recompute: () => arcElevationDeg("high"),
  },
  {
    id: "max-range-angle",
    title: "Find the best elevation once the air pushes back",
    prompt:
      "Now switch drag on: a baseball (145 g, 36.6 mm radius, C_d = 0.47) thrown at 40 m/s. " +
      "Which elevation carries it farthest? Answer to the nearest tenth of a degree.",
    givens: [
      { label: "launch speed", value: OPT_SPEED, unit: "m/s" },
      { label: "drag coefficient", value: DRAG_CD, unit: "" },
      { label: "ball mass", value: BALL_MASS, unit: "kg" },
      { label: "ball radius", value: BALL_RADIUS, unit: "m" },
    ],
    method: "1D maximization (maximizeRange, Brent on the range curve)",
    steps: [
      "This is a maximization, not a root-find: there is no target to hit, only a curve to top out.",
      "Sweep coarsely first to bracket the peak, then refine inside the bracket. Do not differentiate the range curve — each evaluation is a numerical integration and its derivative is noisy.",
      "Expect the answer to be below 45°. Work out why before you look: which part of the flight does drag take the most out of?",
      "Notice how flat the peak is. Compare the range at your answer with the range one degree either side.",
    ],
    insight:
      "45° is the drag-free answer and folklore everywhere else. Drag penalizes time in the air, so the optimum flattens — here by 4.94°, to 40.06°. The peak is broad enough that being a degree off costs almost nothing, which is why the folklore survives contact with reality.",
    answer: {
      quantity: "launch elevation",
      unit: "deg",
      // Re-recorded 2026-09-03 (P0.120), 40.05839098344464 -> 40.058390383890014,
      // a move of 6.0e-7 deg. That is 2.5e5 times smaller than the 0.15 deg
      // grading tolerance below and does not change the answer to the nearest
      // tenth of a degree the prompt asks for. The size is what the note below
      // already predicts: this is the location of a *maximum*, and near a
      // quadratically flat peak an O(eps) change in the range curve moves the
      // argmax by O(sqrt(eps)) -- so a last-bit change in the RHS shows up
      // here around 1e-7, several decades larger than it does at any root.
      solution: 40.058390383890014,
      tolerance: 0.15,
      toleranceNote:
        "Looser than exercises 1-2 because a maximum is intrinsically less localizable than a " +
        "root — near the peak the range is quadratically flat, so the location floor is around " +
        "1e-4 rad. Still 33x tighter than the 4.94° gap to 45°, so answering the folklore fails.",
    },
    recompute: maxRangeElevationDeg,
  },
  {
    id: "min-launch-speed",
    title: "Find the cheapest shot that still arrives",
    prompt:
      "A drag-free target sits 300 m downrange on the ground. Launch speed is now yours to choose. " +
      "What is the slowest launch that still reaches it?",
    givens: [{ label: "target downrange", value: MIN_SPEED_TARGET, unit: "m" }],
    method: "nested minimization (minimumSpeedToHit: Brent outside, shooting inside)",
    steps: [
      "Two unknowns now, elevation and speed, and one equation. The extra freedom is what you are minimizing over.",
      "For each candidate speed, ask whether any elevation reaches the target. That inner question is exercise 1 again.",
      "The answer is the speed at which the reachable set only just touches the target — below it nothing reaches, above it two arcs do.",
      "What happens to the two arcs of exercise 1 as the speed falls to this value?",
    ],
    insight:
      "At the minimum the low and high arcs merge into one grazing solution, so the hit condition goes quadratically flat in elevation. That is why the minimizing speed is recoverable to many digits while the elevation that achieves it is not — a conditioning difference, not a bug.",
    answer: {
      quantity: "minimum launch speed",
      unit: "m/s",
      solution: 54.24016039799292,
      tolerance: 0.05,
      toleranceNote:
        "The drag-free minimum is √(gR) exactly, and the solver reproduces it to every digit " +
        "shown, so a learner who finds the right method lands far inside this; 0.05 m/s rejects " +
        "an answer that guessed a nearby speed.",
    },
    recompute: minLaunchSpeed,
  },
  {
    id: "envelope-clearance",
    title: "Find the ceiling over a point",
    prompt:
      "Back to the drag case at 40 m/s. A point sits 60 m downrange. Across every elevation you " +
      "could fire, what is the greatest height at which a shot can still pass over that point?",
    givens: [
      { label: "launch speed", value: CLEARANCE_SPEED, unit: "m/s" },
      { label: "downrange abscissa", value: CLEARANCE_DOWNRANGE, unit: "m" },
      { label: "drag coefficient", value: DRAG_CD, unit: "" },
    ],
    method: "reachability against the max-range envelope (assessReachability)",
    steps: [
      "You are not aiming at anything. You are asking what the whole family of trajectories can cover.",
      "For the fixed abscissa, maximize height over elevation. The maximum is one point of the envelope.",
      "Drag-free this boundary is the parabola of safety, y = v₀²/2g − gx²/2v₀². Work out what that gives here, then measure the real one — the gap is the exercise.",
      "A target above your answer cannot be hit at this speed by any aim at all. No solver failure will tell you that; only the envelope will.",
    ],
    insight:
      "Reachability is prior to aiming. An inverse solver pointed at an unreachable target does not report 'impossible' — it reports a converged near-miss, or stalls, and both look like solver trouble rather than a target outside the envelope.",
    answer: {
      quantity: "envelope height above the point",
      unit: "m",
      solution: 28.27681605762528,
      tolerance: 0.5,
      toleranceNote:
        "0.5 m on a ~28 m height is under 2%, matched to the fact that this answer comes from a " +
        "maximization over a flat top — the same localization argument as exercise 3, in metres. " +
        "It is nowhere near loose enough to accept the drag-free parabola of safety, which puts " +
        "the ceiling here at 70.5 m; that 42 m gap is the exercise.",
    },
    recompute: envelopeClearance,
  },
];

/** How one submitted answer was graded. */
export interface ExerciseCheck {
  readonly id: ExerciseId;
  /** What the learner submitted, in the exercise's unit. */
  readonly submitted: number;
  /** The stored reference solution. */
  readonly expected: number;
  /** `|submitted - expected|`, or `NaN` for a non-finite submission. */
  readonly error: number;
  readonly tolerance: number;
  readonly correct: boolean;
  /** One sentence the learner can act on. Never restates the answer when wrong. */
  readonly feedback: string;
}

/**
 * Ulps of headroom {@link checkAnswer} allows past the stated tolerance, so
 * that an answer sitting exactly on the boundary is graded as meeting it.
 *
 * Four, because forming the boundary costs at most one rounding on the
 * subtraction and one on the addition that produced the submission, and two
 * more is free: the gap between this and the smallest wrong answer any
 * exercise can produce is enormous. The loosest tolerance here is 0.5 m and
 * the slack it buys is under 1.4e-14 m.
 */
const BOUNDARY_ULPS = 4;

/** Look one up by id. Throws rather than returning undefined, so a typo fails loudly. */
export function getExercise(id: ExerciseId): InverseExercise {
  const exercise = INVERSE_EXERCISES.find((candidate) => candidate.id === id);
  if (exercise === undefined) {
    throw new Error(`getExercise: no exercise with id "${id}"`);
  }
  return exercise;
}

/**
 * Grade one answer against the stored key.
 *
 * **The comparison is absolute and inclusive at the boundary.** Absolute
 * because every tolerance here was reasoned about in the answer's own unit —
 * "0.05 degrees", not "0.05 of an angle" — and a relative test would silently
 * tighten exercise 1 relative to exercise 2 purely because the low arc is a
 * smaller number. Inclusive because a learner who lands exactly on the stated
 * tolerance has met the stated bar, and an exclusive test would make the
 * published tolerance a lie by one ulp.
 *
 * **And "inclusive" has to be bought, not assumed, because the boundary is not
 * a representable number.** `solution + tolerance` is a rounded double, so its
 * distance back from `solution` is not `tolerance` — for exercise 1 it comes
 * out 7.1e-16 too large, and a naive `error <= tolerance` grades the exact
 * boundary *wrong*. The excess is bounded by a couple of ulps of the operands,
 * so that is exactly what {@link BOUNDARY_ULPS} allows back. It is a
 * representation correction and nothing more: the smallest genuinely-wrong
 * answer any exercise here can receive is more than ten orders of magnitude
 * outside it.
 *
 * **A non-finite submission is wrong, not an error.** `NaN` is what an empty
 * input box parses to, and a thrown exception is the wrong response to a
 * learner who has not answered yet.
 */
export function checkAnswer(exercise: InverseExercise, submitted: number): ExerciseCheck {
  const { solution, tolerance, unit } = exercise.answer;

  if (!Number.isFinite(submitted)) {
    return {
      id: exercise.id,
      submitted,
      expected: solution,
      error: Number.NaN,
      tolerance,
      correct: false,
      feedback: "That is not a number — enter your answer as a decimal value.",
    };
  }

  const error = Math.abs(submitted - solution);
  const slack =
    BOUNDARY_ULPS * Number.EPSILON * Math.max(Math.abs(submitted), Math.abs(solution), tolerance);
  const correct = error <= tolerance + slack;

  if (correct) {
    return {
      id: exercise.id,
      submitted,
      expected: solution,
      error,
      tolerance,
      correct: true,
      feedback: exercise.insight,
    };
  }

  // Direction, magnitude and a nudge — but never the number itself, or the
  // second attempt is not an attempt.
  const direction = submitted > solution ? "high" : "low";
  const scale =
    error > 10 * tolerance
      ? "well outside"
      : error > 2 * tolerance
        ? "outside"
        : "just outside (a precision issue rather than a method one)";
  return {
    id: exercise.id,
    submitted,
    expected: solution,
    error,
    tolerance,
    correct: false,
    feedback:
      `Too ${direction}, and ${scale} the ${tolerance} ${unit} tolerance. ` +
      `Re-read step ${exercise.steps.length} and check the branch you solved on.`,
  };
}

/** Grade a whole attempt at the set. Ids absent from `answers` are left ungraded. */
export function checkAll(answers: Partial<Record<ExerciseId, number>>): readonly ExerciseCheck[] {
  return INVERSE_EXERCISES.filter((exercise) => answers[exercise.id] !== undefined).map(
    (exercise) => checkAnswer(exercise, answers[exercise.id]!),
  );
}
