// @vitest-environment jsdom
/**
 * P5.21's marker under a real render cycle: the logic tests prove the state
 * machine, this proves a pointer gesture drives it and that exactly one solve
 * is issued per drop.
 *
 * The solve runner is a controllable fake, the same shape `basin-panel.test.tsx`
 * uses for its sweep — a test can hold a solve open and assert what the DOM
 * shows *at that moment*, which is the only way to check that a drag starting
 * mid-solve behaves. The real-solver timing that the criterion asks for is
 * measured in `packages/analysis/src/arcs.test.ts`; faking it here and calling
 * that a measurement would be worthless.
 */
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArcPair, ArcSolution } from "@ballista/analysis";
import { TargetMarkerPanel, type TargetSolveRunner } from "./target-marker-panel.js";
import type { PlotViewport, TargetPoint } from "./target-marker-logic.js";

const VIEWPORT: PlotViewport = {
  width: 400,
  height: 200,
  downrangeRange: [0, 200],
  heightRange: [0, 100],
};

function solution(arc: "low" | "high", theta: number): ArcSolution {
  return {
    arc,
    aim: { theta, speed: 60 },
    residual: {} as ArcSolution["residual"],
    downrangeMiss: 0.002,
    timeOfFlight: arc === "low" ? 4.25 : 9.5,
    iterations: 7,
  };
}

function pair(overrides: Partial<ArcPair> = {}): ArcPair {
  return {
    reachable: true,
    low: solution("low", 0.3),
    high: solution("high", 1.1),
    peakAngle: 0.7,
    maxDownrange: 300,
    evaluations: 40,
    ...overrides,
  } as ArcPair;
}

let host: HTMLDivElement | undefined;

// jsdom implements neither pointer capture nor getBoundingClientRect's layout,
// so both are supplied here. The box is the viewport at the origin, which makes
// clientX/clientY read directly as offsets within the plot.
function stubLayout(element: HTMLElement): void {
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height }) as DOMRect;
  element.setPointerCapture = () => {};
  element.releasePointerCapture = () => {};
}

function mount(
  runSolve: TargetSolveRunner,
  options: { readonly now?: () => number; readonly initialTarget?: TargetPoint } = {},
): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  render(
    <TargetMarkerPanel
      runSolve={runSolve}
      viewport={VIEWPORT}
      initialTarget={options.initialTarget ?? { downrange: 100, height: 0 }}
      {...(options.now ? { now: options.now } : {})}
    />,
    host,
  );
  stubLayout(query(host, "target-plot")!);
  return host;
}

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
  vi.clearAllMocks();
});

function query(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

/**
 * Dispatched with a mixed-case type for the reason `terrain-editor-page.test.tsx`
 * documents at length: jsdom has no `onpointerdown` IDL property, so Preact's
 * casing inference (`"onpointerdown" in dom`) fails and it registers the
 * listener under the unlowercased `"PointerDown"`. A real browser has the
 * property, the check succeeds, and the listener is the correct lowercase
 * `"pointerdown"`. This is a quirk of the test double, not of the component.
 */
function firePointerEvent(
  target: EventTarget,
  type: "PointerDown" | "PointerMove" | "PointerUp",
  coords: { clientX?: number; clientY?: number } = {},
): void {
  const event = new Event(type, { bubbles: true }) as Event & {
    clientX?: number;
    clientY?: number;
    pointerId?: number;
  };
  event.clientX = coords.clientX ?? 0;
  event.clientY = coords.clientY ?? 0;
  event.pointerId = 1;
  target.dispatchEvent(event);
}

function drag(root: HTMLElement, from: [number, number], to: [number, number]): void {
  const plot = query(root, "target-plot")!;
  firePointerEvent(plot, "PointerDown", { clientX: from[0], clientY: from[1] });
  firePointerEvent(plot, "PointerMove", { clientX: to[0], clientY: to[1] });
  firePointerEvent(plot, "PointerUp", { clientX: to[0], clientY: to[1] });
}

/** A solve whose resolution the test controls. */
function deferredSolve(): {
  runner: TargetSolveRunner;
  resolve: (arcs: ArcPair) => void;
  reject: (error: unknown) => void;
  calls: TargetPoint[];
} {
  let resolve!: (arcs: ArcPair) => void;
  let reject!: (error: unknown) => void;
  const calls: TargetPoint[] = [];
  const runner: TargetSolveRunner = (target, options) => {
    calls.push(target);
    return new Promise<ArcPair>((res, rej) => {
      resolve = res;
      reject = rej;
      options.signal?.addEventListener("abort", () => rej(new Error("aborted")));
    });
  };
  return {
    runner,
    resolve: (arcs: ArcPair) => resolve(arcs),
    reject: (error: unknown) => reject(error),
    calls,
  };
}

/**
 * Lets Preact's deferred rerender and effects run, and the await chain inside
 * `solve` with them. A microtask-only flush is not enough: Preact batches state
 * updates and defers `useEffect`, so the DOM and the unmount cleanup both lag a
 * synchronous dispatch by a task.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("TargetMarkerPanel (P5.21)", () => {
  it("moves the marker with the pointer during a drag and solves nothing", async () => {
    const solve = deferredSolve();
    const root = mount(solve.runner);
    const plot = query(root, "target-plot")!;

    firePointerEvent(plot, "PointerDown", { clientX: 200, clientY: 100 });
    firePointerEvent(plot, "PointerMove", { clientX: 300, clientY: 50 });
    await flush();

    const marker = query(root, "target-marker")!;
    expect(marker.dataset["dragging"]).toBe("true");
    expect(Number(marker.dataset["downrange"])).toBeCloseTo(150, 9);
    expect(Number(marker.dataset["height"])).toBeCloseTo(75, 9);
    // The whole point of solve-on-drop: a move issues no work.
    expect(solve.calls).toHaveLength(0);
  });

  it("issues exactly one solve on drop, at the dropped point", async () => {
    const solve = deferredSolve();
    const root = mount(solve.runner);

    drag(root, [200, 100], [280, 100]);
    await flush();

    expect(solve.calls).toHaveLength(1);
    expect(solve.calls[0]!.downrange).toBeCloseTo(140, 9);
    expect(query(root, "target-status")!.dataset["status"]).toBe("solving");
  });

  it("ignores a move that never had a pointerdown", async () => {
    // Without the drag latch, a hover would drag the marker.
    const solve = deferredSolve();
    const root = mount(solve.runner);
    firePointerEvent(query(root, "target-plot")!, "PointerMove", { clientX: 300, clientY: 20 });
    await flush();

    expect(query(root, "target-marker")!.dataset["dragging"]).toBe("false");
    expect(Number(query(root, "target-marker")!.dataset["downrange"])).toBe(100);
  });

  it("shows the chosen arc's aim once the solve lands", async () => {
    const solve = deferredSolve();
    const root = mount(solve.runner);

    drag(root, [200, 100], [280, 100]);
    solve.resolve(pair());
    await flush();

    expect(query(root, "target-status")!.dataset["status"]).toBe("ready");
    // 0.3 rad = 17.19 degrees, the low arc's elevation.
    expect(query(root, "target-aim-theta")!.textContent).toContain("17.19");
    expect(query(root, "target-aim-tof")!.textContent).toContain("4.25");
  });

  it("switches the displayed aim when the other arc is chosen", async () => {
    const solve = deferredSolve();
    const root = mount(solve.runner);

    drag(root, [200, 100], [280, 100]);
    solve.resolve(pair());
    await flush();

    const high = query(root, "target-arc-high")!.querySelector("input")!;
    high.checked = true;
    high.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    // 1.1 rad = 63.03 degrees, the lofted arc.
    expect(query(root, "target-aim-theta")!.textContent).toContain("63.03");
    expect(query(root, "target-aim-tof")!.textContent).toContain("9.50");
  });

  it("measures the drag→solution latency from the injected clock", async () => {
    // A real clock here would make the assertion a race. The measurement that
    // matters — a real solver against the 200 ms budget — is in arcs.test.ts.
    const solve = deferredSolve();
    let t = 1000;
    const root = mount(solve.runner, { now: () => t });

    drag(root, [200, 100], [280, 100]);
    t = 1042;
    solve.resolve(pair());
    await flush();

    expect(query(root, "target-latency")!.textContent).toContain("42 ms");
    expect(query(root, "target-latency")!.textContent).toContain("within");
  });

  it("hides the aim once the marker is dragged away from the solved point", async () => {
    const solve = deferredSolve();
    const root = mount(solve.runner);

    drag(root, [200, 100], [280, 100]);
    solve.resolve(pair());
    await flush();
    expect(query(root, "target-aim")).not.toBeNull();

    const plot = query(root, "target-plot")!;
    firePointerEvent(plot, "PointerDown", { clientX: 280, clientY: 100 });
    firePointerEvent(plot, "PointerMove", { clientX: 340, clientY: 100 });
    await flush();

    // The aim belonged to a point the user has left; the status line says so.
    expect(query(root, "target-aim")).toBeNull();
    expect(query(root, "target-status")!.dataset["status"]).toBe("dragging");
  });

  it("reports a failed solve rather than leaving the panel in solving", async () => {
    const solve = deferredSolve();
    const root = mount(solve.runner);

    drag(root, [200, 100], [280, 100]);
    solve.reject(new Error("no impact within tspan"));
    await flush();

    expect(query(root, "target-status")!.dataset["status"]).toBe("failed");
    expect(query(root, "target-status")!.textContent).toContain("no impact within tspan");
  });

  it("abandons an in-flight solve when a second drop supersedes it", async () => {
    const solve = deferredSolve();
    const root = mount(solve.runner);

    drag(root, [200, 100], [280, 100]);
    drag(root, [280, 100], [320, 100]);
    await flush();

    expect(solve.calls).toHaveLength(2);
    // The first solve's abort rejection must not surface as a failure: the
    // panel is waiting on the second solve, not broken.
    expect(query(root, "target-status")!.dataset["status"]).toBe("solving");
  });

  it("aborts a solve still running when the panel unmounts", async () => {
    let signal: AbortSignal | undefined;
    const runner: TargetSolveRunner = (_target, options) => {
      signal = options.signal;
      return new Promise<ArcPair>(() => {});
    };
    const root = mount(runner);

    drag(root, [200, 100], [280, 100]);
    await flush();
    expect(signal?.aborted).toBe(false);

    render(null, host!);
    expect(signal?.aborted).toBe(true);
  });

  it("says an out-of-reach target is out of reach", async () => {
    const solve = deferredSolve();
    const root = mount(solve.runner);

    drag(root, [200, 100], [400, 200]);
    solve.resolve(pair({ reachable: false, low: null, high: null }));
    await flush();

    expect(query(root, "target-status")!.textContent).toContain("beyond the reachable set");
    expect(query(root, "target-aim")).toBeNull();
  });
});
