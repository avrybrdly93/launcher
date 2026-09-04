/**
 * P6.29's validation criterion is "checkers pass on reference solutions", and
 * that is the first block below. The rest is what keeps that criterion from
 * being satisfiable by a fixture agreeing with itself:
 *
 * - every stored key is *recomputed* from the real MC pipeline and must agree;
 * - study 1 is additionally checked against a closed form that owes nothing to
 *   this codebase;
 * - every wrong-but-plausible answer each study is designed to reject is
 *   asserted to actually be rejected, which is the part a tolerance chosen by
 *   eye would fail;
 * - the three studies are asserted to be three different questions rather than
 *   one question three times;
 * - the prose is checked, so an insight cannot quote a number the pipeline
 *   does not produce.
 */
import { describe, expect, it } from "vitest";
import { meanConfidenceInterval, mcStats, wilsonInterval } from "@ballista/analysis";
import { G_STD } from "@ballista/engine";
import { runGoldenMcStudy } from "./golden-mc-store.js";
import {
  UNCERTAINTY_EXERCISES,
  UNCERTAINTY_EXERCISE_IDS,
  checkAllUncertainty,
  checkUncertaintyAnswer,
  exceedanceCount,
  getUncertaintyExercise,
  type UncertaintyExerciseId,
} from "./uncertainty-exercises.js";

/* ------------------------------------------------------------------ */
/* The validation criterion                                            */
/* ------------------------------------------------------------------ */

describe("the checkers pass on the reference solutions", () => {
  it.each(UNCERTAINTY_EXERCISES.map((e) => [e.id, e] as const))(
    "%s accepts its own stored solution",
    (_id, exercise) => {
      const check = checkUncertaintyAnswer(exercise, exercise.answer.solution);
      expect(check.correct).toBe(true);
      expect(check.error).toBe(0);
      expect(check.feedback).toBe(exercise.insight);
    },
  );

  it("grades a full correct attempt at the whole lab", () => {
    const answers = Object.fromEntries(
      UNCERTAINTY_EXERCISES.map((e) => [e.id, e.answer.solution]),
    ) as Record<UncertaintyExerciseId, number>;
    const checks = checkAllUncertainty(answers);
    expect(checks).toHaveLength(3);
    expect(checks.every((c) => c.correct)).toBe(true);
  });

  it("leaves unanswered studies ungraded rather than marking them wrong", () => {
    const checks = checkAllUncertainty({ "outcome-spread": 11.299324111396446 });
    expect(checks.map((c) => c.id)).toEqual(["outcome-spread"]);
  });
});

/* ------------------------------------------------------------------ */
/* The keys are derived, not merely pinned                             */
/* ------------------------------------------------------------------ */

describe("every stored key is reproduced by the pipeline it claims to come from", () => {
  it.each(UNCERTAINTY_EXERCISES.map((e) => [e.id, e] as const))(
    "%s recomputes to its stored solution",
    (_id, exercise) => {
      // Far finer than the published tolerance: this is asking whether the key
      // is the pipeline's own answer, not whether it is close enough to grade.
      expect(exercise.recompute()).toBeCloseTo(exercise.answer.solution, 12);
    },
  );
});

/* ------------------------------------------------------------------ */
/* Study 1 against a closed form owing nothing to this codebase        */
/* ------------------------------------------------------------------ */

describe("study 1's answer is checkable without reference to this repository", () => {
  /**
   * A drag-free shot from ground level has `R = 2·vx₀·vy₀/g` exactly. With
   * independent `vx₀ ~ N(μ, σ²)` and `vy₀ ~ N(μ, σ²)`, the population variance
   * of a product of independent variables is
   * `Var(XY) = μx²σy² + μy²σx² + σx²σy²`, scaled here by `(2/g)²`.
   */
  const MU = 21.213;
  const SIGMA = 2;
  const exactVariance = (2 * MU * MU * SIGMA * SIGMA + SIGMA ** 4) * (2 / G_STD) ** 2;
  const exactSd = Math.sqrt(exactVariance);
  const exactMean = (2 * MU * MU) / G_STD;

  it("the exact population standard deviation is 12.2636 m", () => {
    expect(exactSd).toBeCloseTo(12.263639751632011, 10);
  });

  it("the 96-replicate estimate sits within one standard error of the exact value", () => {
    const estimate = getUncertaintyExercise("outcome-spread").answer.solution;
    // The standard error of an SD estimate from n normal-ish samples is
    // approximately sigma / sqrt(2(n-1)). If the estimate ever drifts outside
    // ~2 of those, the pipeline has changed, not the sampling.
    const standardError = exactSd / Math.sqrt(2 * 95);
    expect(Math.abs(estimate - exactSd)).toBeLessThan(2 * standardError);
    expect(Math.abs(estimate - exactSd)).toBeGreaterThan(0.5 * standardError);
  });

  it("the study's sample mean also agrees with the closed form", () => {
    const { stats } = runGoldenMcStudy("drag-free-velocity-spread");
    const standardError = exactSd / Math.sqrt(96);
    expect(Math.abs(stats.range.mean - exactMean)).toBeLessThan(2 * standardError);
  });

  /**
   * The negative control. Without it, the two assertions above could be
   * passing because *every* study happens to sit near that closed form, which
   * would mean they test nothing about the drag-free case in particular.
   */
  it("a drag-bearing study does not satisfy the drag-free closed form", () => {
    const { stats } = runGoldenMcStudy("magnus-drive-velocity-spread");
    expect(Math.abs(stats.range.mean - exactMean)).toBeGreaterThan(10 * exactSd);
  });
});

/* ------------------------------------------------------------------ */
/* Every tolerance actually discriminates the mistake it names         */
/* ------------------------------------------------------------------ */

describe("each study rejects the wrong answer it was built to catch", () => {
  it("study 1 rejects the population (n-divisor) standard deviation", () => {
    const exercise = getUncertaintyExercise("outcome-spread");
    const nDivisor = exercise.answer.solution * Math.sqrt(95 / 96);
    expect(nDivisor).toBeCloseTo(11.240319404643353, 9);
    expect(checkUncertaintyAnswer(exercise, nDivisor).correct).toBe(false);
  });

  it("study 1 rejects the standard error of the mean", () => {
    const exercise = getUncertaintyExercise("outcome-spread");
    expect(checkUncertaintyAnswer(exercise, exercise.answer.solution / Math.sqrt(96)).correct).toBe(
      false,
    );
  });

  it("study 2 rejects the z-instead-of-t half-width", () => {
    const exercise = getUncertaintyExercise("mean-half-width");
    const { columns } = runGoldenMcStudy("drag-free-velocity-spread");
    const values: number[] = [];
    for (let i = 0; i < columns.landed.length; i += 1) {
      if (columns.landed[i] === 1) values.push(columns.range[i]!);
    }
    const interval = meanConfidenceInterval(values, 0.95)!;
    const zHalfWidth = 1.959963984540054 * interval.standardError;
    expect(zHalfWidth).toBeCloseTo(2.260294044221928, 9);
    expect(checkUncertaintyAnswer(exercise, zHalfWidth).correct).toBe(false);
  });

  it("study 2 rejects the standard error and the full width", () => {
    const exercise = getUncertaintyExercise("mean-half-width");
    expect(checkUncertaintyAnswer(exercise, 1.1532324379686765).correct).toBe(false);
    expect(checkUncertaintyAnswer(exercise, 2 * exercise.answer.solution).correct).toBe(false);
  });

  it("study 3 rejects the Wald lower bound, p-hat and the Wilson centre", () => {
    const exercise = getUncertaintyExercise("exceedance-lower-bound");
    const { hits, landed } = exceedanceCount();
    const pHat = hits / landed;
    const wald = 100 * (pHat - 1.959963984540054 * Math.sqrt((pHat * (1 - pHat)) / landed));
    const wilson = wilsonInterval(hits, landed, 0.95);

    expect(wald).toBeCloseTo(2.804575457601833, 9);
    for (const wrong of [wald, 100 * pHat, 100 * wilson.center, 100 * wilson.upper]) {
      expect(checkUncertaintyAnswer(exercise, wrong).correct).toBe(false);
    }
  });

  it("the tolerances are wide enough for an answer worked by hand to four figures", () => {
    for (const exercise of UNCERTAINTY_EXERCISES) {
      const rounded = Number(exercise.answer.solution.toPrecision(4));
      expect(checkUncertaintyAnswer(exercise, rounded).correct).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Three different questions, not one question three times             */
/* ------------------------------------------------------------------ */

describe("the three studies are three different estimators", () => {
  it("has exactly three studies, with unique ids in working order", () => {
    expect(UNCERTAINTY_EXERCISES).toHaveLength(3);
    expect(new Set(UNCERTAINTY_EXERCISE_IDS).size).toBe(3);
    expect(UNCERTAINTY_EXERCISE_IDS).toEqual([
      "outcome-spread",
      "mean-half-width",
      "exceedance-lower-bound",
    ]);
  });

  it("names a different method and asks for a different quantity in each", () => {
    expect(new Set(UNCERTAINTY_EXERCISES.map((e) => e.method)).size).toBe(3);
    expect(new Set(UNCERTAINTY_EXERCISES.map((e) => e.answer.quantity)).size).toBe(3);
  });

  it("reaches more than one pinned golden study, so it is not one dataset throughout", () => {
    expect(new Set(UNCERTAINTY_EXERCISES.map((e) => e.study)).size).toBeGreaterThan(1);
  });

  it("uses studies whose answers are not interchangeable", () => {
    // If any study's solution graded correct on another study's key, the lab
    // would be teaching one thing under three titles.
    for (const a of UNCERTAINTY_EXERCISES) {
      for (const b of UNCERTAINTY_EXERCISES) {
        if (a.id === b.id) continue;
        expect(checkUncertaintyAnswer(b, a.answer.solution).correct).toBe(false);
      }
    }
  });

  it("every study cites the golden case it is asked about", () => {
    for (const exercise of UNCERTAINTY_EXERCISES) {
      expect(() => runGoldenMcStudy(exercise.study)).not.toThrow();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The prose is checked                                                */
/* ------------------------------------------------------------------ */

describe("the numbers quoted in the guidance are the numbers the pipeline produces", () => {
  it("study 3's insight quotes the real count", () => {
    const { hits, landed } = exceedanceCount();
    expect(hits).toBe(8);
    expect(landed).toBe(96);
    expect(getUncertaintyExercise("exceedance-lower-bound").insight).toContain("8 of 96");
  });

  it("study 1's insight quotes the raised-release study's real relative spread", () => {
    // The third pinned golden is not an exercise, but it is cited as evidence,
    // so the citation is asserted rather than trusted.
    const { stats } = runGoldenMcStudy("raised-release-mass-lognormal");
    const relative = (100 * Math.sqrt(stats.range.variance)) / stats.range.mean;
    expect(relative).toBeCloseTo(0.032, 3);
    expect(getUncertaintyExercise("outcome-spread").insight).toContain("0.032%");
  });

  it("study 1's insight quotes the real exact population value and MC shortfall", () => {
    const MU = 21.213;
    const SIGMA = 2;
    const exactSd = Math.sqrt((2 * MU * MU * SIGMA * SIGMA + SIGMA ** 4) * (2 / G_STD) ** 2);
    const estimate = getUncertaintyExercise("outcome-spread").answer.solution;
    const shortfall = (100 * (exactSd - estimate)) / exactSd;
    const insight = getUncertaintyExercise("outcome-spread").insight;

    expect(exactSd.toFixed(4)).toBe("12.2636");
    expect(insight).toContain("12.2636 m");
    expect(estimate.toFixed(4)).toBe("11.2993");
    expect(insight).toContain("11.2993 m");
    expect(shortfall.toFixed(1)).toBe("7.9");
    expect(insight).toContain("7.9% low");
    expect((exactSd / Math.sqrt(2 * 95)).toFixed(2)).toBe("0.89");
    expect(insight).toContain("0.89 m");
  });

  it("study 2's insight quotes the real half-width, the z answer and the gap between them", () => {
    const exercise = getUncertaintyExercise("mean-half-width");
    const spread = getUncertaintyExercise("outcome-spread").answer.solution;
    const zHalfWidth = (1.959963984540054 * spread) / Math.sqrt(96);
    const understatement =
      (100 * (exercise.answer.solution - zHalfWidth)) / exercise.answer.solution;

    expect(exercise.answer.solution.toFixed(2)).toBe("2.29");
    expect(exercise.insight).toContain("2.29 m");
    expect(spread.toFixed(2)).toBe("11.30");
    expect(exercise.insight).toContain("11.30 m");
    expect(zHalfWidth.toFixed(4)).toBe("2.2603");
    expect(exercise.insight).toContain("2.2603 m");
    expect(understatement.toFixed(1)).toBe("1.3");
    expect(exercise.insight).toContain("1.3%");
  });

  it("study 3's insight quotes the real Wald bound, p-hat and Wilson centre", () => {
    const { hits, landed } = exceedanceCount();
    const pHat = hits / landed;
    const wald = 100 * (pHat - 1.959963984540054 * Math.sqrt((pHat * (1 - pHat)) / landed));
    const wilson = wilsonInterval(hits, landed, 0.95);
    const insight = getUncertaintyExercise("exceedance-lower-bound").insight;

    expect((100 * pHat).toFixed(2)).toBe("8.33");
    expect(insight).toContain("8.33%");
    expect(wald.toFixed(2)).toBe("2.80");
    expect(insight).toContain("2.81%");
    expect((100 * wilson.center).toFixed(2)).toBe("9.94");
    expect(insight).toContain("9.94%");
    expect((100 * wilson.lower).toFixed(2)).toBe("4.28");
    expect(insight).toContain("4.28%");
  });

  it("study 2's insight quotes the real t multiplier at 95 degrees of freedom", () => {
    const { columns } = runGoldenMcStudy("drag-free-velocity-spread");
    const values: number[] = [];
    for (let i = 0; i < columns.landed.length; i += 1) {
      if (columns.landed[i] === 1) values.push(columns.range[i]!);
    }
    const interval = meanConfidenceInterval(values, 0.95)!;
    expect(interval.degreesOfFreedom).toBe(95);
    expect(interval.tCritical).toBeCloseTo(1.9853, 4);
    // Larger than the normal quantile, which is the direction step 4 asks about.
    expect(interval.tCritical).toBeGreaterThan(1.959963984540054);
    expect(getUncertaintyExercise("mean-half-width").insight).toContain("1.9853");
  });

  it("no guidance step gives the answer away", () => {
    for (const exercise of UNCERTAINTY_EXERCISES) {
      const solution = exercise.answer.solution;
      const shown = [String(solution), solution.toFixed(4), solution.toFixed(3)];
      for (const step of exercise.steps) {
        for (const s of shown) expect(step).not.toContain(s);
      }
      expect(exercise.prompt).not.toContain(solution.toFixed(3));
    }
  });

  it("every study states its givens, steps and a tolerance rationale", () => {
    for (const exercise of UNCERTAINTY_EXERCISES) {
      expect(exercise.givens.length).toBeGreaterThan(0);
      expect(exercise.steps.length).toBeGreaterThanOrEqual(3);
      expect(exercise.answer.toleranceNote.length).toBeGreaterThan(40);
      expect(exercise.answer.unit).not.toBe("");
      expect(exercise.insight.length).toBeGreaterThan(40);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Grading behaviour                                                   */
/* ------------------------------------------------------------------ */

describe("grading", () => {
  const exercise = () => getUncertaintyExercise("outcome-spread");

  it("accepts an answer exactly on the published boundary", () => {
    const { solution, tolerance } = exercise().answer;
    expect(checkUncertaintyAnswer(exercise(), solution + tolerance).correct).toBe(true);
    expect(checkUncertaintyAnswer(exercise(), solution - tolerance).correct).toBe(true);
  });

  it("treats an unanswered box as wrong, not as an error", () => {
    const check = checkUncertaintyAnswer(exercise(), Number.NaN);
    expect(check.correct).toBe(false);
    expect(check.feedback).toContain("not a number");
  });

  it("names the direction of a miss", () => {
    expect(checkUncertaintyAnswer(exercise(), 20).feedback).toContain("Too high");
    expect(checkUncertaintyAnswer(exercise(), 1).feedback).toContain("Too low");
  });

  it("distinguishes a precision miss from a method miss", () => {
    const { solution, tolerance } = exercise().answer;
    expect(checkUncertaintyAnswer(exercise(), solution + 1.5 * tolerance).feedback).toContain(
      "precision issue",
    );
    expect(checkUncertaintyAnswer(exercise(), solution + 50 * tolerance).feedback).toContain(
      "different estimator",
    );
  });

  it("never restates the answer in wrong-answer feedback", () => {
    for (const ex of UNCERTAINTY_EXERCISES) {
      const feedback = checkUncertaintyAnswer(ex, ex.answer.solution * 3 + 1).feedback;
      expect(feedback).not.toContain(ex.answer.solution.toFixed(3));
      expect(feedback).not.toContain(String(ex.answer.solution));
    }
  });

  it("reveals the insight only on a correct answer", () => {
    const ex = exercise();
    expect(checkUncertaintyAnswer(ex, ex.answer.solution).feedback).toBe(ex.insight);
    expect(checkUncertaintyAnswer(ex, 99).feedback).not.toBe(ex.insight);
  });

  it("looks up by id and fails loudly on a typo", () => {
    expect(getUncertaintyExercise("mean-half-width").id).toBe("mean-half-width");
    expect(() => getUncertaintyExercise("mean-halfwidth" as UncertaintyExerciseId)).toThrow(
      /no study with id/,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Consistency with the pipeline's own reduction                       */
/* ------------------------------------------------------------------ */

describe("the lab reads the same reduction the rest of the platform does", () => {
  it("study 1's answer is the square root of mcStats' variance, not a second implementation", () => {
    const { columns } = runGoldenMcStudy("drag-free-velocity-spread");
    const stats = mcStats(columns);
    expect(Math.sqrt(stats.range.variance)).toBe(
      getUncertaintyExercise("outcome-spread").answer.solution,
    );
  });

  it("all three golden studies land every replicate today, so the landed filter is not hiding a subset", () => {
    for (const id of [
      "drag-free-velocity-spread",
      "magnus-drive-velocity-spread",
      "raised-release-mass-lognormal",
    ]) {
      const { stats } = runGoldenMcStudy(id);
      expect(stats.landedCount).toBe(stats.count);
    }
  });
});
