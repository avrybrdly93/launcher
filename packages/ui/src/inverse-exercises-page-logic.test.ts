/**
 * P0.108. The half of the exercise route that needs no DOM.
 *
 * The cases that matter most here are the two {@link revealedSolution} ones:
 * P5.28's contract is that a wrong attempt is never told the answer, and
 * `ExerciseCheck` carries `expected` either way, so this is the seam where a
 * UI could silently undo it. It is graded directly rather than only through
 * rendered output, because a rendering test would pass as soon as the markup
 * changed shape for an unrelated reason.
 */
import { INVERSE_EXERCISES, checkAnswer, getExercise } from "@ballista/runtime";
import { describe, expect, it } from "vitest";
import {
  exerciseStatus,
  formatGiven,
  formatSetProgress,
  formatTolerance,
  isSubmittable,
  parseAnswerInput,
  revealedInsight,
  revealedSolution,
} from "./inverse-exercises-page-logic.js";

const LOW_ARC = getExercise("low-arc");

describe("parseAnswerInput", () => {
  it("parses a decimal answer", () => {
    expect(parseAnswerInput("18.9")).toBeCloseTo(18.9, 12);
    expect(parseAnswerInput("  71.1  ")).toBeCloseTo(71.1, 12);
    expect(parseAnswerInput("-3.5")).toBeCloseTo(-3.5, 12);
  });

  it("gives NaN for an empty box rather than 0", () => {
    // Number("") is 0, which would grade an untouched box as a confident
    // wrong answer. This is the whole reason the function exists.
    expect(Number("")).toBe(0);
    expect(parseAnswerInput("")).toBeNaN();
    expect(parseAnswerInput("   ")).toBeNaN();
  });

  it("gives NaN for anything unparseable, so callers need no second branch", () => {
    for (const raw of ["abc", "1.2.3", "-", "1 2", "°"]) {
      expect(parseAnswerInput(raw), raw).toBeNaN();
    }
  });

  it("hands checkAnswer a value it already knows how to grade", () => {
    const check = checkAnswer(LOW_ARC, parseAnswerInput(""));
    expect(check.correct).toBe(false);
    expect(check.feedback).toContain("not a number");
  });
});

describe("isSubmittable", () => {
  it("is false for an empty or whitespace box and true otherwise", () => {
    expect(isSubmittable("")).toBe(false);
    expect(isSubmittable("  ")).toBe(false);
    expect(isSubmittable("0")).toBe(true);
    expect(isSubmittable("abc")).toBe(true);
  });
});

describe("formatGiven", () => {
  it("renders a value with its unit", () => {
    expect(formatGiven({ label: "launch speed", value: 80, unit: "m/s" })).toBe(
      "launch speed: 80 m/s",
    );
  });

  it("leaves no trailing space on a dimensionless given", () => {
    const rendered = formatGiven({ label: "drag coefficient", value: 0, unit: "" });
    expect(rendered).toBe("drag coefficient: 0");
    expect(rendered).not.toMatch(/\s$/);
  });

  it("keeps the small numbers legible without padding the round ones", () => {
    expect(formatGiven({ label: "ball radius", value: 0.0366, unit: "m" })).toBe(
      "ball radius: 0.0366 m",
    );
    expect(formatGiven({ label: "ball mass", value: 0.145, unit: "kg" })).toBe(
      "ball mass: 0.145 kg",
    );
  });

  it("renders every given of every shipped exercise without an artefact", () => {
    for (const exercise of INVERSE_EXERCISES) {
      for (const given of exercise.givens) {
        const rendered = formatGiven(given);
        expect(rendered, `${exercise.id}/${given.label}`).toContain(given.label);
        expect(rendered, `${exercise.id}/${given.label}`).not.toContain("NaN");
        expect(rendered, `${exercise.id}/${given.label}`).not.toMatch(/\s$/);
      }
    }
  });
});

describe("formatTolerance", () => {
  it("states the bar in the answer's own unit", () => {
    expect(formatTolerance(LOW_ARC)).toBe("±0.05 deg");
  });
});

describe("exerciseStatus", () => {
  it("distinguishes unanswered from wrong", () => {
    expect(exerciseStatus(undefined)).toBe("unanswered");
    expect(exerciseStatus(checkAnswer(LOW_ARC, 0))).toBe("incorrect");
    expect(exerciseStatus(checkAnswer(LOW_ARC, LOW_ARC.answer.solution))).toBe("correct");
  });
});

describe("revealedSolution", () => {
  it("withholds the answer from a wrong attempt", () => {
    const wrong = checkAnswer(LOW_ARC, 45);
    expect(wrong.correct).toBe(false);
    // The check itself carries it -- that is why this function exists.
    expect(wrong.expected).toBeCloseTo(LOW_ARC.answer.solution, 9);
    expect(revealedSolution(LOW_ARC, wrong)).toBeUndefined();
  });

  it("withholds it from an ungraded exercise", () => {
    expect(revealedSolution(LOW_ARC, undefined)).toBeUndefined();
  });

  it("withholds it from a near miss, not only from a wild one", () => {
    // Just outside the 0.05 deg tolerance: the case where a UI is most
    // tempted to be helpful.
    const nearMiss = checkAnswer(LOW_ARC, LOW_ARC.answer.solution + 0.06);
    expect(nearMiss.correct).toBe(false);
    expect(revealedSolution(LOW_ARC, nearMiss)).toBeUndefined();
  });

  it("withholds it from a non-finite submission", () => {
    expect(revealedSolution(LOW_ARC, checkAnswer(LOW_ARC, Number.NaN))).toBeUndefined();
  });

  it("gives it, with its unit, once the attempt is correct", () => {
    const right = checkAnswer(LOW_ARC, LOW_ARC.answer.solution);
    expect(revealedSolution(LOW_ARC, right)).toBe("18.9003 deg");
  });

  it("withholds it from every shipped exercise on every wrong attempt", () => {
    for (const exercise of INVERSE_EXERCISES) {
      const { solution, tolerance } = exercise.answer;
      for (const submitted of [solution + tolerance * 2, solution - tolerance * 2, 0, Number.NaN]) {
        const check = checkAnswer(exercise, submitted);
        expect(check.correct, `${exercise.id} @ ${submitted}`).toBe(false);
        expect(revealedSolution(exercise, check), `${exercise.id} @ ${submitted}`).toBeUndefined();
      }
      const right = checkAnswer(exercise, solution);
      expect(right.correct, exercise.id).toBe(true);
      expect(revealedSolution(exercise, right), exercise.id).toBeDefined();
    }
  });
});

describe("revealedInsight", () => {
  it("is withheld until the answer is right, for every exercise", () => {
    for (const exercise of INVERSE_EXERCISES) {
      expect(revealedInsight(exercise, undefined), exercise.id).toBeUndefined();
      const wrong = checkAnswer(exercise, exercise.answer.solution + exercise.answer.tolerance * 3);
      expect(revealedInsight(exercise, wrong), exercise.id).toBeUndefined();
      expect(revealedInsight(exercise, checkAnswer(exercise, exercise.answer.solution))).toBe(
        exercise.insight,
      );
    }
  });
});

describe("formatSetProgress", () => {
  it("counts only the correct ones", () => {
    const checks = [
      checkAnswer(getExercise("low-arc"), getExercise("low-arc").answer.solution),
      checkAnswer(getExercise("high-arc"), 0),
    ];
    expect(formatSetProgress(checks, INVERSE_EXERCISES.length)).toBe("1 of 5 correct");
  });

  it("reads 0 of 5 before anything is attempted", () => {
    expect(formatSetProgress([], INVERSE_EXERCISES.length)).toBe("0 of 5 correct");
  });
});
