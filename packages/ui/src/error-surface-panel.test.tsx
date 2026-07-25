import { describe, expect, it } from "vitest";
import { ErrorSurfacePanel, type FailedOutcome } from "./error-surface-panel.js";

const UNDERFLOW_OUTCOME: FailedOutcome = {
  reason: "step-size-underflow",
  message: "integrate: proposed step h=0.0001 fell below hMin=0.01 at t=0.42",
  t: 0.42,
  y: new Float64Array([12.5, 3.1, 20, -4]),
};

describe("ErrorSurfacePanel: forced h_min underflow shows guidance + last-good state (P3.38 validation criterion)", () => {
  it("renders an actionable title/guidance (not a generic message) for step-size-underflow", () => {
    const vnode = ErrorSurfacePanel({ outcome: UNDERFLOW_OUTCOME });
    expect(vnode.props["data-reason"]).toBe("step-size-underflow");

    const [titleP, guidanceP, messageP] = vnode.props.children;
    expect(titleP.props.children).toBe("Step size collapsed");
    expect(guidanceP.props.children).toMatch(/rtol|atol|h_min/);
    expect(messageP.props.children).toBe(UNDERFLOW_OUTCOME.message);
  });

  it("renders the last-good (t, x, y, vx, vy) state", () => {
    const vnode = ErrorSurfacePanel({ outcome: UNDERFLOW_OUTCOME });
    const [, , , dl] = vnode.props.children;
    const values = dl.props.children.filter(
      (child: { type: string }) => child.type === "dd",
    ) as Array<{ props: { children: number } }>;

    expect(values.map((v) => v.props.children)).toEqual([0.42, 12.5, 3.1, 20, -4]);
  });

  it("every SolveFailureReason renders its own distinct title (not a shared fallback)", () => {
    const reasons = [
      "step-size-underflow",
      "max-steps-exceeded",
      "non-finite-state",
      "event-localization-failure",
    ] as const;
    const titles = reasons.map((reason) => {
      const vnode = ErrorSurfacePanel({ outcome: { ...UNDERFLOW_OUTCOME, reason } });
      const [titleP] = vnode.props.children;
      return titleP.props.children;
    });
    expect(new Set(titles).size).toBe(reasons.length);
  });
});
