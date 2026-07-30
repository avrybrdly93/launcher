// @vitest-environment jsdom
/**
 * TerrainEditorPage mount tests (P4.14). `TerrainEditorPage` is a
 * controlled component (mirrors `StabilityExplorerPage`'s split), so
 * `Harness` below owns the control-point state itself, exactly like the
 * real `TerrainEditorRoute` (`@ballista/app`) would -- this is what lets a
 * numeric-input edit or a simulated drag actually re-render the SVG with
 * the point moved, not just prove the callback fired once. Every
 * interaction is followed by `await flush()` (mirrors
 * `stability-explorer-route.test.tsx`'s pattern) since Preact's
 * hook-triggered re-render happens on a microtask, not synchronously
 * within the dispatched event.
 */
import { render } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it } from "vitest";
import type { TerrainControlPoint } from "@ballista/engine";
import type { TerrainEditorResult } from "@ballista/runtime";
import { TerrainEditorPage } from "./terrain-editor-page.js";

const DEFAULT_POINTS: TerrainControlPoint[] = [
  { x: 0, y: 0 },
  { x: 50, y: 10 },
  { x: 100, y: 0 },
];

const FAKE_RESULT: TerrainEditorResult = {
  trajectory: {
    nSteps: 2,
    t: new Float64Array([0, 1]),
    channels: [
      new Float64Array([0, 10]),
      new Float64Array([2, 0]),
      new Float64Array([10, 10]),
      new Float64Array([5, -5]),
    ],
  },
  impactX: 10,
  impactY: 0,
  landed: true,
};

function Harness({ initialPoints = DEFAULT_POINTS }: { initialPoints?: TerrainControlPoint[] }) {
  const [points, setPoints] = useState<readonly TerrainControlPoint[]>(initialPoints);
  const [exportedJson, setExportedJson] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  return (
    <TerrainEditorPage
      controlPoints={points}
      onControlPointsChange={setPoints}
      result={FAKE_RESULT}
      exportedJson={exportedJson}
      onExport={() => setExportedJson(JSON.stringify(points))}
      importText={importText}
      onImportTextChange={setImportText}
      onImport={() => {
        try {
          setPoints(JSON.parse(importText) as TerrainControlPoint[]);
          setImportError(null);
        } catch (error) {
          setImportError(String(error));
        }
      }}
      importError={importError}
    />
  );
}

let container: HTMLDivElement | undefined;

function mount(children: Parameters<typeof render>[0]): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(children, container);
  return container;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * jsdom in this repo's test environment has no global `PointerEvent`
 * constructor, nor `onpointerdown`/`onpointermove`/`onpointerup` IDL
 * properties on its `Element` prototypes (both exist in every real
 * browser). Preact's prop-to-listener casing inference
 * (`preact/src/diff/props.js`) checks `"onpointerdown" in dom` to decide
 * whether to lowercase an `onPointerDown` prop to the real event name
 * `"pointerdown"`; since that check is false under jsdom, it falls back to
 * registering the listener under the *unlowercased* `"PointerDown"` event
 * name instead. This only affects this jsdom test double -- in a real
 * browser the check succeeds and Preact registers the correct lowercase
 * `"pointerdown"` listener, exactly like `onClick`'s `"click"` above (whose
 * `"onclick" in dom` check jsdom does support). Dispatching with the
 * mixed-case type here is what makes the listener Preact actually attached
 * under this test double fire.
 */
function firePointerEvent(
  target: EventTarget,
  type: "PointerDown" | "PointerMove" | "PointerUp",
  coords: { clientX?: number; clientY?: number } = {},
): void {
  const event = new Event(type, { bubbles: true }) as Event & {
    clientX?: number;
    clientY?: number;
  };
  event.clientX = coords.clientX ?? 0;
  event.clientY = coords.clientY ?? 0;
  target.dispatchEvent(event);
}

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

describe("TerrainEditorPage (P4.14)", () => {
  it("renders one control point row and one SVG circle per control point", () => {
    const root = mount(<Harness />);
    for (let i = 0; i < DEFAULT_POINTS.length; i++) {
      expect(root.querySelector(`[data-testid="terrain-editor-point-${i}"]`)).not.toBeNull();
      expect(
        root.querySelector(`[data-testid="terrain-editor-control-point-${i}"]`),
      ).not.toBeNull();
    }
  });

  it("editing a point's x numeric input updates that point's SVG marker (and leaves the others alone)", async () => {
    const root = mount(<Harness />);
    const circleBefore = root.querySelector(
      '[data-testid="terrain-editor-control-point-1"]',
    ) as unknown as SVGCircleElement;
    const cxBefore = circleBefore.getAttribute("cx");
    const circle0CxBefore = (
      root.querySelector(
        '[data-testid="terrain-editor-control-point-0"]',
      ) as unknown as SVGCircleElement
    ).getAttribute("cx");

    const xInput = root.querySelector(
      '[data-testid="terrain-editor-point-1-x"]',
    ) as HTMLInputElement;
    xInput.value = "60";
    xInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const circleAfter = root.querySelector(
      '[data-testid="terrain-editor-control-point-1"]',
    ) as unknown as SVGCircleElement;
    expect(circleAfter.getAttribute("cx")).not.toBe(cxBefore);
    expect(
      (
        root.querySelector(
          '[data-testid="terrain-editor-control-point-0"]',
        ) as unknown as SVGCircleElement
      ).getAttribute("cx"),
    ).toBe(circle0CxBefore);
  });

  it("editing a point's y numeric input is reflected back into the input's value", async () => {
    const root = mount(<Harness />);
    const yInput = root.querySelector(
      '[data-testid="terrain-editor-point-1-y"]',
    ) as HTMLInputElement;

    yInput.value = "25";
    yInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(
      (root.querySelector('[data-testid="terrain-editor-point-1-y"]') as HTMLInputElement).value,
    ).toBe("25");
  });

  it('"Add point" appends a new point past the current rightmost one', async () => {
    const root = mount(<Harness />);
    const addButton = root.querySelector(
      '[data-testid="terrain-editor-add-point"]',
    ) as HTMLButtonElement;

    addButton.click();
    await flush();

    const newPointX = root.querySelector(
      '[data-testid="terrain-editor-point-3-x"]',
    ) as HTMLInputElement;
    expect(newPointX).not.toBeNull();
    expect(Number(newPointX.value)).toBeGreaterThan(100);
  });

  it("Remove deletes that point, and disables itself once only 2 points remain", async () => {
    const root = mount(<Harness />);
    const removeButton1 = root.querySelector(
      '[data-testid="terrain-editor-point-1-remove"]',
    ) as HTMLButtonElement;
    removeButton1.click();
    await flush();

    expect(root.querySelector('[data-testid="terrain-editor-point-2"]')).toBeNull();
    const remainingRemove = root.querySelector(
      '[data-testid="terrain-editor-point-0-remove"]',
    ) as HTMLButtonElement;
    expect(remainingRemove.disabled).toBe(true);
  });

  it("dragging a control point (pointerdown on it, then pointermove on the SVG) moves that point", async () => {
    const getRectSpy = SVGSVGElement.prototype.getBoundingClientRect;
    SVGSVGElement.prototype.getBoundingClientRect = () =>
      ({ width: 800, height: 400, left: 0, top: 0, right: 800, bottom: 400 }) as DOMRect;

    try {
      const root = mount(<Harness />);
      const svg = root.querySelector(
        '[data-testid="terrain-editor-svg"]',
      ) as unknown as SVGSVGElement;
      const circle = root.querySelector(
        '[data-testid="terrain-editor-control-point-1"]',
      ) as unknown as SVGCircleElement;

      firePointerEvent(circle, "PointerDown");
      await flush();
      firePointerEvent(svg, "PointerMove", { clientX: 700, clientY: 350 });
      await flush();

      // Point 1 started at data (50, 10); dragging to a screen position near
      // the SVG's bottom-right corner should have moved it toward the
      // domain's high-x/low-y corner -- not left it at its original value.
      const xInput = root.querySelector(
        '[data-testid="terrain-editor-point-1-x"]',
      ) as HTMLInputElement;
      const yInput = root.querySelector(
        '[data-testid="terrain-editor-point-1-y"]',
      ) as HTMLInputElement;
      expect(Number(xInput.value)).toBeGreaterThan(50);
      expect(Number(yInput.value)).toBeLessThan(10);
    } finally {
      SVGSVGElement.prototype.getBoundingClientRect = getRectSpy;
    }
  });

  it("dragging stops on pointerup: a subsequent pointermove no longer moves the point", async () => {
    const getRectSpy = SVGSVGElement.prototype.getBoundingClientRect;
    SVGSVGElement.prototype.getBoundingClientRect = () =>
      ({ width: 800, height: 400, left: 0, top: 0, right: 800, bottom: 400 }) as DOMRect;

    try {
      const root = mount(<Harness />);
      const svg = root.querySelector(
        '[data-testid="terrain-editor-svg"]',
      ) as unknown as SVGSVGElement;
      const circle = root.querySelector(
        '[data-testid="terrain-editor-control-point-1"]',
      ) as unknown as SVGCircleElement;

      firePointerEvent(circle, "PointerDown");
      await flush();
      firePointerEvent(svg, "PointerUp");
      await flush();
      firePointerEvent(svg, "PointerMove", { clientX: 700, clientY: 350 });
      await flush();

      const xInput = root.querySelector(
        '[data-testid="terrain-editor-point-1-x"]',
      ) as HTMLInputElement;
      expect(Number(xInput.value)).toBe(50);
    } finally {
      SVGSVGElement.prototype.getBoundingClientRect = getRectSpy;
    }
  });

  it("shows the impact readout when landed, and the trajectory/impact-marker SVG elements", () => {
    const root = mount(<Harness />);
    expect(root.querySelector('[data-testid="terrain-editor-impact-readout"]')!.textContent).toBe(
      "Impact at x=10.0 m, y=0.0 m",
    );
    expect(root.querySelector('[data-testid="terrain-editor-trajectory-line"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="terrain-editor-impact-marker"]')).not.toBeNull();
  });

  it("Export writes the current points as JSON into the output textarea", async () => {
    const root = mount(<Harness />);
    const exportButton = root.querySelector(
      '[data-testid="terrain-editor-export-button"]',
    ) as HTMLButtonElement;
    exportButton.click();
    await flush();

    const output = root.querySelector(
      '[data-testid="terrain-editor-export-output"]',
    ) as HTMLTextAreaElement;
    expect(JSON.parse(output.value)).toEqual(DEFAULT_POINTS);
  });

  it("Import replaces the points with valid JSON typed into the input", async () => {
    const root = mount(<Harness />);
    const importInput = root.querySelector(
      '[data-testid="terrain-editor-import-input"]',
    ) as HTMLTextAreaElement;
    const newPoints = [
      { x: 0, y: 0 },
      { x: 30, y: 7 },
    ];
    importInput.value = JSON.stringify(newPoints);
    importInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    (
      root.querySelector('[data-testid="terrain-editor-import-button"]') as HTMLButtonElement
    ).click();
    await flush();

    expect(root.querySelector('[data-testid="terrain-editor-point-2"]')).toBeNull();
    expect(
      (root.querySelector('[data-testid="terrain-editor-point-1-x"]') as HTMLInputElement).value,
    ).toBe("30");
  });

  it("Import shows an error and leaves the points unchanged on malformed JSON", async () => {
    const root = mount(<Harness />);
    const importInput = root.querySelector(
      '[data-testid="terrain-editor-import-input"]',
    ) as HTMLTextAreaElement;
    importInput.value = "not json";
    importInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    (
      root.querySelector('[data-testid="terrain-editor-import-button"]') as HTMLButtonElement
    ).click();
    await flush();

    expect(root.querySelector('[data-testid="terrain-editor-import-error"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="terrain-editor-point-2"]')).not.toBeNull();
  });
});
