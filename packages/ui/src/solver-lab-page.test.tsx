import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import {
  runSolverLabComparison,
  SOLVER_LAB_COLUMN_STEPPERS,
  type SolverLabComparison,
} from "@ballista/runtime";
import { SolverLabPage } from "./solver-lab-page.js";

const TABLE_TENNIS = PRESET_SCENARIOS.find((s) => s.projectile.id === "table-tennis-ball")!;

/** Depth-first search of a raw Preact vnode tree for the first node whose `data-testid` matches. Mirrors the other panel tests' `flatChildren` helper, one level up. */
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

describe("SolverLabPage (P3.41)", () => {
  const comparison: SolverLabComparison = runSolverLabComparison(TABLE_TENNIS, 0.02);

  it("renders one column per SOLVER_LAB_COLUMN_STEPPERS entry", () => {
    const vnode = SolverLabPage({ comparison, onHChange: vi.fn() });
    const columnsNode = findByTestId(vnode, "solver-lab-columns")!;
    const columnNodes = ([] as unknown[]).concat(columnsNode.props.children).flat(Infinity);
    expect(columnNodes).toHaveLength(SOLVER_LAB_COLUMN_STEPPERS.length);
  });

  it("renders a distinct, finite error readout for every column", () => {
    const vnode = SolverLabPage({ comparison, onHChange: vi.fn() });

    const readouts = SOLVER_LAB_COLUMN_STEPPERS.map(({ id }) => {
      const errorNode = findByTestId(vnode, `solver-lab-column-${id}-error`)!;
      return errorNode.props.children as string;
    });

    expect(new Set(readouts).size).toBe(readouts.length);
    for (const readout of readouts) {
      expect(readout).not.toBe("NaN");
      expect(readout).not.toBe("∞");
    }
  });

  it("Euler's error readout is a larger number than DOPRI5's (the pedagogical point), read straight off the DOM text", () => {
    const vnode = SolverLabPage({ comparison, onHChange: vi.fn() });
    const eulerError = findByTestId(vnode, "solver-lab-column-explicit-euler-error")!.props
      .children as string;
    const dopri5Error = findByTestId(vnode, "solver-lab-column-dopri5-error")!.props
      .children as string;

    expect(Number(eulerError)).toBeGreaterThan(Number(dopri5Error));
  });

  it("the h input reflects comparison.h and calls onHChange with the parsed value on input", () => {
    const onHChange = vi.fn();
    const vnode = SolverLabPage({ comparison, onHChange });
    const input = findByTestId(vnode, "solver-lab-h-input")!;
    expect(input.props.value).toBe(0.02);

    const onInput = input.props.onInput as (e: { currentTarget: { value: string } }) => void;
    onInput({ currentTarget: { value: "0.05" } });
    expect(onHChange).toHaveBeenCalledWith(0.05);
  });

  it("ignores non-positive or non-numeric h input rather than committing garbage", () => {
    const onHChange = vi.fn();
    const vnode = SolverLabPage({ comparison, onHChange });
    const input = findByTestId(vnode, "solver-lab-h-input")!;
    const onInput = input.props.onInput as (e: { currentTarget: { value: string } }) => void;

    onInput({ currentTarget: { value: "0" } });
    onInput({ currentTarget: { value: "-1" } });
    onInput({ currentTarget: { value: "abc" } });
    expect(onHChange).not.toHaveBeenCalled();
  });
});
