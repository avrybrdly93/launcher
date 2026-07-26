import { describe, expect, it } from "vitest";
import { runEnergyDriftStudy, type EnergyDriftStudy } from "@ballista/runtime";
import type { PlotlyFigureSpec } from "@ballista/viz";
import { EnergyDriftPage } from "./energy-drift-page.js";
import { LazyPlotlyView } from "./lazy-plotly-view.js";

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

/** Depth-first search for the first node whose vnode `type` matches (Preact doesn't expand a nested component's own render until actually mounted, so a nested `<LazyPlotlyView spec={...} />` shows up here as its own vnode, not its rendered `<div>`). */
function findByType(node: unknown, type: unknown): { props: Record<string, unknown> } | undefined {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  const candidate = node as { type?: unknown; props?: Record<string, unknown> };
  if (candidate.type === type) return candidate as { props: Record<string, unknown> };
  const children = candidate.props?.children;
  if (children === undefined) return undefined;
  for (const child of ([] as unknown[]).concat(children).flat(Infinity)) {
    const found = findByType(child, type);
    if (found) return found;
  }
  return undefined;
}

describe("EnergyDriftPage (P3.44)", () => {
  const study: EnergyDriftStudy = runEnergyDriftStudy();

  it("renders one method row per study.methods entry", () => {
    const vnode = EnergyDriftPage({ study });
    const methodsNode = findByTestId(vnode, "energy-drift-methods")!;
    const bodyNode = ([] as unknown[])
      .concat(methodsNode.props.children)
      .flat(Infinity)
      .find((child) => (child as { type?: unknown }).type === "tbody") as {
      props: Record<string, unknown>;
    };
    const rowNodes = ([] as unknown[]).concat(bodyNode.props.children).flat(Infinity);
    expect(rowNodes).toHaveLength(study.methods.length);
  });

  it("renders a distinct, finite final-drift readout for every method", () => {
    const vnode = EnergyDriftPage({ study });

    const readouts = study.methods.map((method) => {
      const node = findByTestId(vnode, `energy-drift-method-${method.stepperId}-final-error`)!;
      return node.props.children as string;
    });

    for (const readout of readouts) {
      expect(readout).not.toBe("NaN");
      expect(readout).not.toBe("∞");
    }
  });

  it("flags exactly the symplectic methods in the symplectic column", () => {
    const vnode = EnergyDriftPage({ study });

    for (const method of study.methods) {
      const node = findByTestId(vnode, `energy-drift-method-${method.stepperId}-symplectic`)!;
      expect(node.props.children).toBe(method.symplectic ? "yes" : "no");
    }
  });

  it("renders the shared landing time in the summary line", () => {
    const vnode = EnergyDriftPage({ study });
    const summaryNode = findByTestId(vnode, "energy-drift-summary")!;
    const text = ([] as unknown[]).concat(summaryNode.props.children).flat(Infinity).join("");
    expect(text).toContain(study.tFinal.toPrecision(6));
  });

  it("passes one E(t)/E(0)-1 trace per method to LazyPlotlyView, drawn from the study's own samples", () => {
    const vnode = EnergyDriftPage({ study });
    const plotNode = findByType(vnode, LazyPlotlyView)!;
    const spec = (plotNode.props as { spec: PlotlyFigureSpec }).spec;

    expect(spec.traces).toHaveLength(study.methods.length);
    expect(spec.traces.map((trace) => trace.name)).toEqual(study.methods.map((m) => m.label));
    expect(spec.traces[0]!.x).toEqual(Array.from(study.methods[0]!.t));
  });
});
