/**
 * P5.28's validation criterion is "checker validates against stored
 * solutions", and this file reads that as three separate claims rather than
 * one, because the obvious test satisfies the sentence while proving almost
 * nothing:
 *
 * 1. **The checker accepts the stored solutions.** This is the literal
 *    criterion. On its own it is nearly vacuous — `checkAnswer(ex,
 *    ex.answer.solution)` compares a number with itself, and would pass
 *    against a key of five zeros.
 * 2. **The checker rejects.** A grader that returns `correct: true`
 *    unconditionally passes claim 1 perfectly. So the tolerance is probed from
 *    both sides and at the boundary.
 * 3. **The stored solutions are right.** This is the claim that carries the
 *    weight. Each key is recomputed from `@ballista/analysis`, and the two
 *    drag-free ones are additionally checked against closed forms that owe
 *    nothing to this codebase. A pinned key that agrees only with itself is a
 *    fixture, not an answer.
 *
 * Claim 3 is also the regression guard: if a solver changes underneath these
 * exercises, `recompute` moves and the stored key does not, and this file goes
 * red rather than the exercises quietly teaching a stale number.
 */
import { G_STD } from "@ballista/engine";
import { describe, expect, it } from "vitest";
import {
  INVERSE_EXERCISES,
  checkAll,
  checkAnswer,
  getExercise,
  type ExerciseId,
  type InverseExercise,
} from "./inverse-exercises.js";

/**
 * How closely a recomputed solution must match the stored one. Far tighter
 * than any exercise tolerance, deliberately: the point is to catch a solver
 * drift long before it grows big enough to change a grade.
 */
const KEY_DRIFT = 1e-9;

describe("the exercise set", () => {
  it("has exactly the five exercises P5.28 asks for", () => {
    expect(INVERSE_EXERCISES).toHaveLength(5);
  });

  it("gives every exercise a unique id", () => {
    const ids = INVERSE_EXERCISES.map((exercise) => exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers five different methods, not one method five times", () => {
    const methods = INVERSE_EXERCISES.map((exercise) => exercise.method);
    expect(new Set(methods).size).toBe(5);
  });

  it("is guided: every exercise carries givens, ordered steps and an insight", () => {
    for (const exercise of INVERSE_EXERCISES) {
      expect(exercise.givens.length).toBeGreaterThan(0);
      expect(exercise.steps.length).toBeGreaterThanOrEqual(3);
      expect(exercise.prompt.length).toBeGreaterThan(0);
      expect(exercise.insight.length).toBeGreaterThan(0);
      expect(exercise.answer.toleranceNote.length).toBeGreaterThan(0);
      expect(exercise.answer.tolerance).toBeGreaterThan(0);
      expect(Number.isFinite(exercise.answer.solution)).toBe(true);
    }
  });

  /**
   * A step that contains the answer turns a guided exercise into a spoiler.
   * Checked numerically rather than by eye: no step may contain the solution
   * rounded to the precision the tolerance grades at.
   */
  it("never leaks the answer in the guidance", () => {
    for (const exercise of INVERSE_EXERCISES) {
      const digits = Math.max(0, Math.ceil(-Math.log10(exercise.answer.tolerance)));
      const rounded = exercise.answer.solution.toFixed(digits);
      const guidance = [exercise.prompt, ...exercise.steps].join(" ");
      expect(guidance).not.toContain(rounded);
    }
  });

  it("looks an exercise up by id, and throws on an id that does not exist", () => {
    for (const exercise of INVERSE_EXERCISES) {
      expect(getExercise(exercise.id)).toBe(exercise);
    }
    expect(() => getExercise("no-such-exercise" as ExerciseId)).toThrow(/no exercise with id/);
  });
});

/* ------------------------------------------------------------------ */
/* Claim 1 — the literal validation criterion                          */
/* ------------------------------------------------------------------ */

describe("the checker validates against the stored solutions", () => {
  it.each(INVERSE_EXERCISES.map((exercise) => [exercise.id, exercise] as const))(
    "accepts the stored solution for %s",
    (_id, exercise: InverseExercise) => {
      const check = checkAnswer(exercise, exercise.answer.solution);

      expect(check.correct).toBe(true);
      expect(check.error).toBe(0);
      expect(check.expected).toBe(exercise.answer.solution);
      // A correct answer earns the explanation, which is the point of the set.
      expect(check.feedback).toBe(exercise.insight);
    },
  );

  it("grades a whole attempt at once, and leaves unanswered exercises ungraded", () => {
    const answers: Partial<Record<ExerciseId, number>> = {};
    for (const exercise of INVERSE_EXERCISES) {
      answers[exercise.id] = exercise.answer.solution;
    }
    expect(checkAll(answers).every((check) => check.correct)).toBe(true);
    expect(checkAll(answers)).toHaveLength(5);

    expect(checkAll({ "low-arc": INVERSE_EXERCISES[0]!.answer.solution })).toHaveLength(1);
    expect(checkAll({})).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Claim 2 — it rejects, and at the stated boundary                    */
/* ------------------------------------------------------------------ */

describe("the checker rejects wrong answers", () => {
  it.each(INVERSE_EXERCISES.map((exercise) => [exercise.id, exercise] as const))(
    "rejects an answer outside the tolerance for %s, from both sides",
    (_id, exercise: InverseExercise) => {
      const { solution, tolerance } = exercise.answer;
      const past = tolerance * 1.001;

      for (const wrong of [solution + past, solution - past]) {
        const check = checkAnswer(exercise, wrong);
        expect(check.correct).toBe(false);
        expect(check.error).toBeGreaterThan(tolerance);
      }

      expect(checkAnswer(exercise, solution + past).feedback).toContain("high");
      expect(checkAnswer(exercise, solution - past).feedback).toContain("low");
    },
  );

  it.each(INVERSE_EXERCISES.map((exercise) => [exercise.id, exercise] as const))(
    "accepts exactly at the tolerance for %s, on both sides",
    (_id, exercise: InverseExercise) => {
      const { solution, tolerance } = exercise.answer;
      // The documented boundary is inclusive. Asserted rather than assumed,
      // because "within 0.05°" and "correct at 0.05°" is the kind of
      // off-by-one a learner meets as an unexplained failure.
      expect(checkAnswer(exercise, solution + tolerance).correct).toBe(true);
      expect(checkAnswer(exercise, solution - tolerance).correct).toBe(true);
    },
  );

  /**
   * The inclusive boundary is bought with a few ulps of slack, because
   * `solution + tolerance` is a rounded double whose distance back from
   * `solution` is not exactly `tolerance` (for low-arc it is 7.1e-16 too
   * large, which a naive `<=` grades wrong). This asserts the slack is a
   * representation correction and not a loosening: an answer outside by a
   * part in a billion — still absurdly closer than any real mistake — is
   * still rejected.
   */
  it.each(INVERSE_EXERCISES.map((exercise) => [exercise.id, exercise] as const))(
    "keeps the boundary slack at ulp scale for %s",
    (_id, exercise: InverseExercise) => {
      const { solution, tolerance } = exercise.answer;
      expect(checkAnswer(exercise, solution + tolerance * (1 + 1e-9)).correct).toBe(false);
      expect(checkAnswer(exercise, solution - tolerance * (1 + 1e-9)).correct).toBe(false);
    },
  );

  it("rejects a non-finite submission without throwing", () => {
    const exercise = getExercise("low-arc");
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const check = checkAnswer(exercise, bad);
      expect(check.correct).toBe(false);
      expect(check.error).toBeNaN();
      expect(check.feedback).toContain("not a number");
    }
  });

  it("never reveals the answer in the feedback for a wrong attempt", () => {
    for (const exercise of INVERSE_EXERCISES) {
      const digits = Math.max(0, Math.ceil(-Math.log10(exercise.answer.tolerance)));
      const rounded = exercise.answer.solution.toFixed(digits);
      const check = checkAnswer(
        exercise,
        exercise.answer.solution + 10 * exercise.answer.tolerance,
      );
      expect(check.correct).toBe(false);
      expect(check.feedback).not.toContain(rounded);
    }
  });

  it("distinguishes a near miss from a wrong method", () => {
    const exercise = getExercise("low-arc");
    const { solution, tolerance } = exercise.answer;
    expect(checkAnswer(exercise, solution + 1.5 * tolerance).feedback).toContain("just outside");
    expect(checkAnswer(exercise, solution + 50 * tolerance).feedback).toContain("well outside");
  });

  /**
   * The specific wrong answers these exercises exist to catch. If the
   * tolerances were ever loosened enough to accept these, the exercises would
   * still pass every test above while teaching nothing.
   */
  it("rejects the wrong answer each exercise is designed to catch", () => {
    // The two arcs must not accept each other: same target, same energy.
    expect(
      checkAnswer(getExercise("low-arc"), getExercise("high-arc").answer.solution).correct,
    ).toBe(false);
    expect(
      checkAnswer(getExercise("high-arc"), getExercise("low-arc").answer.solution).correct,
    ).toBe(false);
    // The drag optimum must not accept the 45° folklore.
    expect(checkAnswer(getExercise("max-range-angle"), 45).correct).toBe(false);
    // The envelope with drag must not accept the drag-free parabola of safety,
    // y = v₀²/2g − g x²/2v₀² at v₀ = 40 m/s, x = 60 m.
    const dragFreeCeiling = (40 * 40) / (2 * G_STD) - (G_STD * 60 * 60) / (2 * 40 * 40);
    expect(checkAnswer(getExercise("envelope-clearance"), dragFreeCeiling).correct).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Claim 3 — the stored key is right, not merely stored                */
/* ------------------------------------------------------------------ */

describe("the stored solutions are the ones the solvers produce", () => {
  it.each(INVERSE_EXERCISES.map((exercise) => [exercise.id, exercise] as const))(
    "recomputes the stored solution for %s",
    (_id, exercise: InverseExercise) => {
      const recomputed = exercise.recompute();

      expect(Math.abs(recomputed - exercise.answer.solution)).toBeLessThan(KEY_DRIFT);
      // And comfortably inside the grading tolerance, which is the practical
      // statement: a learner reproducing the solver's answer is graded correct.
      expect(checkAnswer(exercise, recomputed).correct).toBe(true);
    },
  );
});

describe("the drag-free keys agree with closed forms this codebase did not produce", () => {
  // Drag-free range is R = v₀² sin(2θ)/g, so a reachable R has roots
  // ½·asin(gR/v₀²) and its complement to 90°.
  const speed = 80;
  const range = 400;
  const lowDeg = (0.5 * Math.asin((G_STD * range) / (speed * speed)) * 180) / Math.PI;

  it("puts the low arc at ½·asin(gR/v₀²)", () => {
    expect(getExercise("low-arc").answer.solution).toBeCloseTo(lowDeg, 10);
  });

  it("puts the high arc at its complement to 90°", () => {
    expect(getExercise("high-arc").answer.solution).toBeCloseTo(90 - lowDeg, 10);
  });

  it("keeps the two arcs symmetric about the drag-free peak at 45°", () => {
    const low = getExercise("low-arc").answer.solution;
    const high = getExercise("high-arc").answer.solution;
    expect((low + high) / 2).toBeCloseTo(45, 10);
  });

  it("puts the minimum launch speed at √(gR)", () => {
    // The drag-free minimum-energy shot at a ground target is the 45° one, and
    // R = v₀²/g there, so v₀ = √(gR).
    expect(getExercise("min-launch-speed").answer.solution).toBeCloseTo(Math.sqrt(G_STD * 300), 10);
  });
});

describe("the drag exercises say something the drag-free ones cannot", () => {
  it("puts the maximum-range elevation below the drag-free 45°", () => {
    const theta = getExercise("max-range-angle").answer.solution;
    expect(theta).toBeLessThan(45);
    // And by enough to be a lesson rather than a rounding artefact: the gap is
    // many times the tolerance the answer is graded at.
    const gap = 45 - theta;
    expect(gap).toBeGreaterThan(10 * getExercise("max-range-angle").answer.tolerance);
  });

  it("puts the real ceiling well below the drag-free parabola of safety", () => {
    const measured = getExercise("envelope-clearance").answer.solution;
    const dragFree = (40 * 40) / (2 * G_STD) - (G_STD * 60 * 60) / (2 * 40 * 40);
    expect(measured).toBeLessThan(dragFree);
    expect(dragFree - measured).toBeGreaterThan(
      10 * getExercise("envelope-clearance").answer.tolerance,
    );
  });
});
