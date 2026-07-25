import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { runConvergenceStudy } from "@ballista/runtime";
import { ConvergenceStudyPage, type ScenarioOption } from "./convergence-study-page.js";

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;
const SCENARIO_OPTIONS: readonly ScenarioOption[] = [
  { id: "shot-put", label: "Shot put", spec: SHOT_PUT },
];

const METHOD_IDS = ["explicit-euler", "classical-rk4"];
const HS = [0.02, 0.01, 0.005];
const STUDY = runConvergenceStudy(SHOT_PUT, METHOD_IDS, HS);

/** Depth-first search of a raw Preact vnode tree for the first node whose `data-testid` matches, mirroring `solver-lab-page.test.tsx`'s helper. */
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

function baseProps() {
  return {
    scenarioOptions: SCENARIO_OPTIONS,
    selectedScenarioId: "shot-put",
    onSelectScenario: vi.fn(),
    selectedMethodIds: METHOD_IDS,
    onToggleMethod: vi.fn(),
    hLadderText: HS.join(", "),
    onHLadderTextChange: vi.fn(),
    study: STUDY,
  };
}

describe("ConvergenceStudyPage (P3.42)", () => {
  it("renders a slope row per study method, with the slope read verbatim off the study (matches convergenceStudyToJSON by construction)", () => {
    const vnode = ConvergenceStudyPage(baseProps());

    for (const method of STUDY.methods) {
      const cell = findByTestId(vnode, `convergence-study-slope-${method.stepperId}-value`)!;
      expect(cell.props.children).toBe(method.slope.toFixed(2));
    }
  });

  it("checks a checkbox for every selected method id and none of the others", () => {
    const vnode = ConvergenceStudyPage(baseProps());

    for (const id of METHOD_IDS) {
      const checkbox = findByTestId(vnode, `convergence-study-method-${id}`)!;
      expect(checkbox.props.checked).toBe(true);
    }
    const unselected = findByTestId(vnode, "convergence-study-method-dopri5")!;
    expect(unselected.props.checked).toBe(false);
  });

  it("toggling a method checkbox calls onToggleMethod with that method's id", () => {
    const onToggleMethod = vi.fn();
    const vnode = ConvergenceStudyPage({ ...baseProps(), onToggleMethod });
    const checkbox = findByTestId(vnode, "convergence-study-method-dopri5")!;
    (checkbox.props.onChange as () => void)();
    expect(onToggleMethod).toHaveBeenCalledWith("dopri5");
  });

  it("selecting a scenario calls onSelectScenario with the option's id", () => {
    const onSelectScenario = vi.fn();
    const vnode = ConvergenceStudyPage({ ...baseProps(), onSelectScenario });
    const select = findByTestId(vnode, "convergence-study-scenario-select")!;
    (select.props.onInput as (e: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: "shot-put" },
    });
    expect(onSelectScenario).toHaveBeenCalledWith("shot-put");
  });

  it("editing the h-ladder text calls onHLadderTextChange with the raw text", () => {
    const onHLadderTextChange = vi.fn();
    const vnode = ConvergenceStudyPage({ ...baseProps(), onHLadderTextChange });
    const input = findByTestId(vnode, "convergence-study-h-ladder-input")!;
    (input.props.onInput as (e: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: "0.1, 0.05" },
    });
    expect(onHLadderTextChange).toHaveBeenCalledWith("0.1, 0.05");
  });

  it("warns when the h-ladder text doesn't parse to at least 2 usable step sizes", () => {
    const tooFew = ConvergenceStudyPage({ ...baseProps(), hLadderText: "0.05" });
    expect(findByTestId(tooFew, "convergence-study-h-ladder-warning")).toBeDefined();

    const enough = ConvergenceStudyPage(baseProps());
    expect(findByTestId(enough, "convergence-study-h-ladder-warning")).toBeUndefined();
  });
});
