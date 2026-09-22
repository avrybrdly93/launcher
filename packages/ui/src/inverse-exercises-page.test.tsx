/**
 * P0.108. Vnode-inspection tests, in this package's established style
 * (`density-altitude-page.test.tsx`, `neglected-effects-page.test.tsx`).
 *
 * The interesting assertions are the three negative ones: before an attempt,
 * after a wrong attempt, and after a near miss, the rendered tree must not
 * contain the answer anywhere -- not in a hidden node, not in a class name,
 * not in a title attribute. They search the whole serialized tree rather
 * than one testid, because "the answer leaked" is not a claim about a
 * particular element.
 */
import {
  INVERSE_EXERCISES,
  checkAnswer,
  getExercise,
  type ExerciseCheck,
  type ExerciseId,
} from "@ballista/runtime";
import { describe, expect, it, vi } from "vitest";
import { InverseExercisesPage } from "./inverse-exercises-page.js";

function findByTestId(
  node: unknown,
  testId: string,
): { props: Record<string, unknown> } | undefined {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  const candidate = node as { props?: Record<string, unknown> };
  if (candidate.props && candidate.props["data-testid"] === testId) {
    return candidate as { props: Record<string, unknown> };
  }
  const children = candidate.props?.children;
  if (children === undefined) return undefined;
  for (const child of ([] as unknown[]).concat(children).flat(Infinity)) {
    const found = findByTestId(child, testId);
    if (found) return found;
  }
  return undefined;
}

function textOf(node: { props: Record<string, unknown> }): string {
  return ([] as unknown[]).concat(node.props.children).flat(Infinity).join("");
}

/**
 * Every string anywhere in the tree, including props. Used for the "the
 * answer is not on screen" assertions, where limiting the search to one
 * element would be assuming the conclusion.
 */
function collectStrings(node: unknown, into: string[] = []): string[] {
  if (typeof node === "string") {
    into.push(node);
    return into;
  }
  if (typeof node === "number") {
    into.push(String(node));
    return into;
  }
  if (node === null || node === undefined || typeof node !== "object") return into;
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, into));
    else collectStrings(value, into);
  }
  return into;
}

/** Render the card list for one exercise in one state. */
function renderWith(
  id: ExerciseId,
  draft: string,
  check: ExerciseCheck | undefined,
): { vnode: unknown; haystack: string } {
  const vnode = InverseExercisesPage({
    exercises: INVERSE_EXERCISES,
    drafts: { [id]: draft },
    checks: check === undefined ? {} : { [id]: check },
    onDraftChange: () => {},
    onSubmit: () => {},
  });
  return { vnode, haystack: collectStrings(vnode).join("\u0000") };
}

const LOW_ARC = getExercise("low-arc");

describe("InverseExercisesPage (P0.108)", () => {
  it("renders all five exercises with prompt, givens, method and steps", () => {
    const { vnode } = renderWith("low-arc", "", undefined);
    expect(INVERSE_EXERCISES).toHaveLength(5);

    for (const exercise of INVERSE_EXERCISES) {
      const card = findByTestId(vnode, `inverse-exercise-${exercise.id}`);
      expect(card, exercise.id).toBeDefined();
      expect(textOf(findByTestId(vnode, `inverse-exercise-prompt-${exercise.id}`)!)).toBe(
        exercise.prompt,
      );
      expect(
        findByTestId(vnode, `inverse-exercise-method-${exercise.id}`),
        exercise.id,
      ).toBeDefined();
      const givens = findByTestId(vnode, `inverse-exercise-givens-${exercise.id}`)!;
      expect(collectStrings(givens).join(" "), exercise.id).toContain(exercise.givens[0]!.label);
      const steps = findByTestId(vnode, `inverse-exercise-steps-${exercise.id}`)!;
      const stepText = collectStrings(steps).join("\u0000");
      for (const step of exercise.steps) expect(stepText, exercise.id).toContain(step);
      expect(
        findByTestId(vnode, `inverse-exercise-input-${exercise.id}`),
        exercise.id,
      ).toBeDefined();
      expect(
        findByTestId(vnode, `inverse-exercise-submit-${exercise.id}`),
        exercise.id,
      ).toBeDefined();
    }
  });

  it("shows no feedback, no solution and no insight before an attempt", () => {
    const { vnode } = renderWith("low-arc", "", undefined);
    expect(findByTestId(vnode, "inverse-exercise-feedback-low-arc")).toBeUndefined();
    expect(findByTestId(vnode, "inverse-exercise-solution-low-arc")).toBeUndefined();
    expect(findByTestId(vnode, "inverse-exercise-insight-low-arc")).toBeUndefined();
  });

  it("grades a submitted answer and shows the insight once it is correct", () => {
    const check = checkAnswer(LOW_ARC, LOW_ARC.answer.solution);
    const { vnode } = renderWith("low-arc", "18.9003", check);

    expect(check.correct).toBe(true);
    expect(textOf(findByTestId(vnode, "inverse-exercise-feedback-low-arc")!)).toBe(check.feedback);
    expect(textOf(findByTestId(vnode, "inverse-exercise-insight-low-arc")!)).toBe(LOW_ARC.insight);
    expect(
      collectStrings(findByTestId(vnode, "inverse-exercise-solution-low-arc")!).join(" "),
    ).toContain("18.9003");
  });

  it("shows feedback but withholds the insight on a wrong attempt", () => {
    const check = checkAnswer(LOW_ARC, 45);
    const { vnode } = renderWith("low-arc", "45", check);

    expect(check.correct).toBe(false);
    expect(textOf(findByTestId(vnode, "inverse-exercise-feedback-low-arc")!)).toBe(check.feedback);
    expect(findByTestId(vnode, "inverse-exercise-insight-low-arc")).toBeUndefined();
    expect(findByTestId(vnode, "inverse-exercise-solution-low-arc")).toBeUndefined();
  });

  it("never renders the answer anywhere in the tree on a wrong attempt", () => {
    // The whole tree, props included -- "the answer leaked" is not a claim
    // about one element.
    for (const exercise of INVERSE_EXERCISES) {
      const { solution, tolerance } = exercise.answer;
      for (const submitted of [solution + tolerance * 4, solution + tolerance * 1.2, 0]) {
        const check = checkAnswer(exercise, submitted);
        expect(check.correct, `${exercise.id} @ ${submitted}`).toBe(false);
        const { haystack } = renderWith(exercise.id, String(submitted), check);
        // Six significant figures of the key: enough that a coincidental
        // match with a prompt number is not credible.
        const leak = solution.toPrecision(6);
        expect(haystack, `${exercise.id} @ ${submitted}`).not.toContain(leak);
      }
    }
  });

  it("disables the Check button until the box holds something", () => {
    const empty = renderWith("low-arc", "   ", undefined);
    expect(findByTestId(empty.vnode, "inverse-exercise-submit-low-arc")!.props.disabled).toBe(true);
    const filled = renderWith("low-arc", "18.9", undefined);
    expect(findByTestId(filled.vnode, "inverse-exercise-submit-low-arc")!.props.disabled).toBe(
      false,
    );
  });

  it("reports set progress from the checks it was given", () => {
    const vnode = InverseExercisesPage({
      exercises: INVERSE_EXERCISES,
      drafts: {},
      checks: {
        "low-arc": checkAnswer(LOW_ARC, LOW_ARC.answer.solution),
        "high-arc": checkAnswer(getExercise("high-arc"), 0),
      },
      onDraftChange: () => {},
      onSubmit: () => {},
    });
    expect(textOf(findByTestId(vnode, "inverse-exercises-progress")!)).toBe("1 of 5 correct");
  });

  it("reports the exercise id back through its callbacks", () => {
    const onDraftChange = vi.fn();
    const onSubmit = vi.fn();
    const vnode = InverseExercisesPage({
      exercises: INVERSE_EXERCISES,
      drafts: {},
      checks: {},
      onDraftChange,
      onSubmit,
    });

    const input = findByTestId(vnode, "inverse-exercise-input-max-range-angle")!;
    (input.props.onInput as (e: unknown) => void)({ currentTarget: { value: "40.1" } });
    expect(onDraftChange).toHaveBeenCalledWith("max-range-angle", "40.1");

    const button = findByTestId(vnode, "inverse-exercise-submit-max-range-angle")!;
    (button.props.onClick as () => void)();
    expect(onSubmit).toHaveBeenCalledWith("max-range-angle");
  });
});
