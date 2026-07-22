import { describe, expect, it, vi } from "vitest";
import { bootstrapCanvas } from "./canvas-bootstrap.js";

function createFakeCanvas(parentElement: unknown = null) {
  const setTransform = vi.fn();
  const style = { width: "", height: "" };
  const canvas = {
    width: 0,
    height: 0,
    style,
    parentElement,
    getContext: vi.fn(() => ({ setTransform })),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, setTransform, style };
}

/** Hand-rolled `ResizeObserver` double: captures its callback and observed targets so tests can fire synthetic resize entries deterministically (vitest runs in a `node` environment with no real `ResizeObserver`). */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: unknown[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  fire(width: number, height: number): void {
    this.callback(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

describe("bootstrapCanvas (P3.05)", () => {
  it("applies DPR-aware backing-store sizing without stretching the CSS box (dpr=2)", () => {
    const { canvas, setTransform, style } = createFakeCanvas();
    const bootstrap = bootstrapCanvas(canvas, { getDevicePixelRatio: () => 2 });

    bootstrap.resize(400, 300);

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(style.width).toBe("400px");
    expect(style.height).toBe("300px");
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });

  it("dpr=1 leaves the backing store at the CSS size with an identity transform", () => {
    const { canvas, setTransform, style } = createFakeCanvas();
    const bootstrap = bootstrapCanvas(canvas, { getDevicePixelRatio: () => 1 });

    bootstrap.resize(200, 150);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(150);
    expect(style.width).toBe("200px");
    expect(style.height).toBe("150px");
    expect(setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
  });

  it("rounds a fractional device-pixel size (dpr=1.5)", () => {
    const { canvas } = createFakeCanvas();
    const bootstrap = bootstrapCanvas(canvas, { getDevicePixelRatio: () => 1.5 });

    bootstrap.resize(333, 111);

    expect(canvas.width).toBe(Math.round(333 * 1.5));
    expect(canvas.height).toBe(Math.round(111 * 1.5));
  });

  it("observes the parent element (falling back to the canvas itself when detached) and re-applies sizing (no distortion) when its box resizes", () => {
    const { canvas, style } = createFakeCanvas();
    bootstrapCanvas(canvas, {
      getDevicePixelRatio: () => 2,
      ResizeObserverCtor: FakeResizeObserver as unknown as typeof ResizeObserver,
    });

    const observer = FakeResizeObserver.instances.at(-1)!;
    expect(observer.observed).toEqual([canvas]); // no parentElement here -> falls back to the canvas

    observer.fire(800, 450);

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(900);
    expect(style.width).toBe("800px");
    expect(style.height).toBe("450px");
    // aspect ratio preserved between the CSS box and the backing store
    expect(canvas.width / canvas.height).toBeCloseTo(800 / 450, 10);
  });

  it("observes the parent element, not the canvas itself, when the canvas is attached to one", () => {
    // Regression guard: resize() sets an inline pixel style.width/height on
    // `canvas` -- if the observer watched `canvas` itself, that self-write
    // would pin its own box and the observer would never see it "change"
    // again, silently breaking every resize after the first. Observing the
    // parent (whose box this module never touches) avoids the feedback loop.
    const fakeParent = { tag: "parent" };
    const { canvas } = createFakeCanvas(fakeParent);
    bootstrapCanvas(canvas, {
      ResizeObserverCtor: FakeResizeObserver as unknown as typeof ResizeObserver,
    });

    const observer = FakeResizeObserver.instances.at(-1)!;
    expect(observer.observed).toEqual([fakeParent]);
    expect(observer.observed).not.toContain(canvas);
  });

  it("dispose() disconnects the resize observer", () => {
    const { canvas } = createFakeCanvas();
    const bootstrap = bootstrapCanvas(canvas, {
      ResizeObserverCtor: FakeResizeObserver as unknown as typeof ResizeObserver,
    });
    const observer = FakeResizeObserver.instances.at(-1)!;

    bootstrap.dispose();

    expect(observer.disconnected).toBe(true);
  });

  it("still works without a ResizeObserver global (non-browser fallback): resize() applies sizing manually", () => {
    const { canvas, style } = createFakeCanvas();
    const bootstrap = bootstrapCanvas(canvas, { getDevicePixelRatio: () => 2 });

    bootstrap.resize(100, 50);

    expect(canvas.width).toBe(200);
    expect(style.width).toBe("100px");
    expect(() => bootstrap.dispose()).not.toThrow();
  });
});
