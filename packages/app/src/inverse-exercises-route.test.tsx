// @vitest-environment jsdom
/**
 * InverseExercisesRoute mount test (P0.108). Mirrors
 * `density-altitude-route.test.tsx`'s jsdom-mount pattern; no Plotly or viz
 * dependency here, so nothing needs mocking.
 *
 * This is the file that exercises the *wiring* the page tests cannot: typing
 * into a box, clicking Check, and getting a grade back. The negative case
 * matters as much as the positive one -- a wrong answer must produce
 * feedback and no solution -- and it is asserted against the real DOM here
 * rather than a vnode tree, so a leak through an attribute or a stale node
 * would show up.
 */
import { getExercise } from "@ballista/runtime";
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { InverseExercisesRoute } from "./inverse-exercises-route.js";

let container: HTMLDivElement | undefined;

function mount(children: ComponentChildren): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(children, container);
  return container;
}

/**
 * `act` from `preact/test-utils`, as `benchmark-route.test.tsx` uses it.
 * Preact batches state updates into a microtask, so without this every
 * assertion below would read the DOM one render behind the interaction that
 * caused it -- which is how this file first failed five of seven cases.
 */

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

function type(root: HTMLDivElement, id: string, value: string): void {
  act(() => {
    const box = root.querySelector(
      `[data-testid="inverse-exercise-input-${id}"]`,
    ) as HTMLInputElement;
    box.value = value;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function check(root: HTMLDivElement, id: string): void {
  act(() => {
    const button = root.querySelector(
      `[data-testid="inverse-exercise-submit-${id}"]`,
    ) as HTMLButtonElement;
    button.click();
  });
}

describe("InverseExercisesRoute (P0.108)", () => {
  it("renders all five exercises", () => {
    const root = mount(<InverseExercisesRoute />);
    for (const id of [
      "low-arc",
      "high-arc",
      "max-range-angle",
      "min-launch-speed",
      "envelope-clearance",
    ]) {
      expect(root.querySelector(`[data-testid="inverse-exercise-${id}"]`), id).not.toBeNull();
    }
    expect(root.querySelector('[data-testid="inverse-exercises-progress"]')!.textContent).toBe(
      "0 of 5 correct",
    );
  });

  it("renders a back link to the main simulator", () => {
    const root = mount(<InverseExercisesRoute />);
    const back = root.querySelector(
      '[data-testid="inverse-exercises-back-link"]',
    ) as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
  });

  it("grades a correct answer and shows the insight only then", () => {
    const root = mount(<InverseExercisesRoute />);
    const exercise = getExercise("low-arc");

    expect(root.querySelector('[data-testid="inverse-exercise-insight-low-arc"]')).toBeNull();

    type(root, "low-arc", exercise.answer.solution.toFixed(4));
    check(root, "low-arc");

    expect(
      root.querySelector('[data-testid="inverse-exercise-insight-low-arc"]')!.textContent,
    ).toBe(exercise.insight);
    expect(
      root.querySelector('[data-testid="inverse-exercise-solution-low-arc"]')!.textContent,
    ).toContain("18.9003");
    expect(root.querySelector('[data-testid="inverse-exercises-progress"]')!.textContent).toBe(
      "1 of 5 correct",
    );
  });

  it("grades a wrong answer without revealing the solution", () => {
    const root = mount(<InverseExercisesRoute />);

    type(root, "low-arc", "45");
    check(root, "low-arc");

    const feedback = root.querySelector('[data-testid="inverse-exercise-feedback-low-arc"]');
    expect(feedback).not.toBeNull();
    expect(feedback!.textContent).toContain("Too");
    expect(root.querySelector('[data-testid="inverse-exercise-solution-low-arc"]')).toBeNull();
    expect(root.querySelector('[data-testid="inverse-exercise-insight-low-arc"]')).toBeNull();
    // Nowhere in the rendered document, not just in the two nodes above.
    expect(root.innerHTML).not.toContain(getExercise("low-arc").answer.solution.toPrecision(6));
    expect(root.querySelector('[data-testid="inverse-exercises-progress"]')!.textContent).toBe(
      "0 of 5 correct",
    );
  });

  it("treats an empty box as unanswered rather than as zero", () => {
    const root = mount(<InverseExercisesRoute />);
    const button = root.querySelector(
      '[data-testid="inverse-exercise-submit-low-arc"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    type(root, "low-arc", "12");
    expect(
      (root.querySelector('[data-testid="inverse-exercise-submit-low-arc"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("clears a stale grade when the answer is edited again", () => {
    const root = mount(<InverseExercisesRoute />);

    type(root, "low-arc", "45");
    check(root, "low-arc");
    expect(root.querySelector('[data-testid="inverse-exercise-feedback-low-arc"]')).not.toBeNull();

    type(root, "low-arc", "18.9");
    expect(root.querySelector('[data-testid="inverse-exercise-feedback-low-arc"]')).toBeNull();
  });

  it("grades each exercise independently", () => {
    const root = mount(<InverseExercisesRoute />);

    type(root, "low-arc", getExercise("low-arc").answer.solution.toFixed(4));
    check(root, "low-arc");
    type(root, "high-arc", "0");
    check(root, "high-arc");

    expect(root.querySelector('[data-testid="inverse-exercise-insight-low-arc"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="inverse-exercise-insight-high-arc"]')).toBeNull();
    expect(root.querySelector('[data-testid="inverse-exercises-progress"]')!.textContent).toBe(
      "1 of 5 correct",
    );
  });
});
