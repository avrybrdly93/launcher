import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { sampleTrajectoryEigenvalues } from "@ballista/runtime";
import { StabilityExplorerPage, type StabilityScenarioOption } from "./stability-explorer-page.js";

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;
const SCENARIO_OPTIONS: readonly StabilityScenarioOption[] = [
  { id: "shot-put", label: "Shot put", spec: SHOT_PUT },
];
const RESULT = sampleTrajectoryEigenvalues(SHOT_PUT, 12);

/** Depth-first search of a raw Preact vnode tree for the first node whose `data-testid` matches, mirroring `convergence-study-page.test.tsx`'s helper. */
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
    selectedMethodId: "classical-rk4",
    onSelectMethod: vi.fn(),
    hText: "0.05",
    onHTextChange: vi.fn(),
    result: RESULT,
    selectedSampleIndex: 0,
    onSelectedSampleIndexChange: vi.fn(),
  };
}

describe("StabilityExplorerPage (P3.43)", () => {
  it("selects the given method in the method dropdown", () => {
    const vnode = StabilityExplorerPage(baseProps());
    const select = findByTestId(vnode, "stability-explorer-method-select")!;
    expect(select.props.value).toBe("classical-rk4");
  });

  it("choosing a method calls onSelectMethod with that method's id", () => {
    const onSelectMethod = vi.fn();
    const vnode = StabilityExplorerPage({ ...baseProps(), onSelectMethod });
    const select = findByTestId(vnode, "stability-explorer-method-select")!;
    (select.props.onInput as (e: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: "explicit-euler" },
    });
    expect(onSelectMethod).toHaveBeenCalledWith("explicit-euler");
  });

  it("selecting a scenario calls onSelectScenario with the option's id", () => {
    const onSelectScenario = vi.fn();
    const vnode = StabilityExplorerPage({ ...baseProps(), onSelectScenario });
    const select = findByTestId(vnode, "stability-explorer-scenario-select")!;
    (select.props.onInput as (e: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: "shot-put" },
    });
    expect(onSelectScenario).toHaveBeenCalledWith("shot-put");
  });

  it("editing the h field calls onHTextChange with the raw text", () => {
    const onHTextChange = vi.fn();
    const vnode = StabilityExplorerPage({ ...baseProps(), onHTextChange });
    const input = findByTestId(vnode, "stability-explorer-h-input")!;
    (input.props.onInput as (e: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: "0.02" },
    });
    expect(onHTextChange).toHaveBeenCalledWith("0.02");
  });

  it("warns when h doesn't parse to a positive number", () => {
    const invalid = StabilityExplorerPage({ ...baseProps(), hText: "abc" });
    expect(findByTestId(invalid, "stability-explorer-h-warning")).toBeDefined();

    const valid = StabilityExplorerPage(baseProps());
    expect(findByTestId(valid, "stability-explorer-h-warning")).toBeUndefined();
  });

  it("renders a lambda/z readout row per velocity-block eigenvalue at the selected sample", () => {
    const vnode = StabilityExplorerPage({ ...baseProps(), selectedSampleIndex: 3 });
    const sample = RESULT.samples[3]!;

    for (let i = 0; i < sample.lambda.length; i++) {
      const cell = findByTestId(vnode, `stability-explorer-z-${i}-value`)!;
      const expectedZ = { re: 0.05 * sample.lambda[i]!.re, im: 0.05 * sample.lambda[i]!.im };
      expect(cell.props.children).toContain(expectedZ.re.toFixed(3));
    }
  });

  it("scrubbing the trajectory-position slider calls onSelectedSampleIndexChange with the new index", () => {
    const onSelectedSampleIndexChange = vi.fn();
    const vnode = StabilityExplorerPage({ ...baseProps(), onSelectedSampleIndexChange });
    const slider = findByTestId(vnode, "stability-explorer-scrub")!;
    (slider.props.onInput as (e: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: "5" },
    });
    expect(onSelectedSampleIndexChange).toHaveBeenCalledWith(5);
  });
});
