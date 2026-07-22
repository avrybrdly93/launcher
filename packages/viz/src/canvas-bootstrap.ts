/**
 * DPR-aware canvas sizing + resize handling (§6.1 frame loop discipline,
 * §6.5 "no per-frame allocation ... device-pixel-ratio-aware sizing").
 *
 * A `<canvas>` has two independent sizes: its backing store (`width`/
 * `height`, in device pixels -- what actually gets rasterized) and its CSS
 * box (`style.width`/`style.height` -- what it occupies on the page). Naively
 * leaving the backing store at its CSS-pixel size renders blurry on
 * high-DPI ("2x", "3x") displays; naively leaving `style.width`/`height`
 * unset after changing `width`/`height` stretches/distorts the box to match
 * the (now device-pixel-sized) backing store. `resize()` sets both from a
 * single CSS-pixel box plus the current device pixel ratio, and applies a
 * matching context scale so drawing code always works in CSS-pixel
 * coordinates -- avoiding both failure modes by construction.
 */

/** The subset of `CanvasRenderingContext2D` this module needs. */
export interface Canvas2DScaleTarget {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

export interface CanvasBootstrapOptions {
  /** Overrides `window.devicePixelRatio` probing; defaults to 1 if neither is available. */
  readonly getDevicePixelRatio?: () => number;
  /**
   * Overrides the global `ResizeObserver` constructor (for tests, or
   * environments that polyfill it differently). If neither is available,
   * {@link bootstrapCanvas} still returns a working handle -- `resize()` just
   * has to be called manually, since there is nothing to observe with.
   */
  readonly ResizeObserverCtor?: typeof ResizeObserver;
}

export interface CanvasBootstrap {
  /** Immediately (re)applies DPR-aware sizing for a `cssWidth × cssHeight` CSS-pixel box. */
  resize(cssWidth: number, cssHeight: number): void;
  /** Disconnects the resize observer, if one was attached. Idempotent. */
  dispose(): void;
}

function defaultGetDevicePixelRatio(): number {
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return typeof dpr === "number" && dpr > 0 ? dpr : 1;
}

function resolveResizeObserverCtor(): typeof ResizeObserver | undefined {
  return (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
}

/**
 * Wires `canvas` up for DPR-aware sizing and keeps it in sync with its
 * *containing* element's CSS box via `ResizeObserver` (falls back to a
 * no-observer handle -- callers must invoke `resize()` themselves -- if
 * `ResizeObserver` isn't available, e.g. non-browser contexts).
 *
 * Deliberately observes `canvas.parentElement`, not `canvas` itself:
 * `resize()` sets an explicit inline pixel `style.width`/`height` on the
 * canvas (that's how it avoids the CSS-box-stretches-to-match-the-backing-
 * store distortion bug), which pins the canvas's own box to a fixed size.
 * Observing the canvas would make the loop self-referential -- once its box
 * stops changing, `ResizeObserver` has nothing left to report -- so the
 * canvas would never track its container's later resizes. The parent's box
 * is unaffected by anything this module writes, so it stays a faithful
 * signal of "the space available to the canvas."
 */
export function bootstrapCanvas(
  canvas: HTMLCanvasElement,
  options: CanvasBootstrapOptions = {},
): CanvasBootstrap {
  const getDevicePixelRatio = options.getDevicePixelRatio ?? defaultGetDevicePixelRatio;
  const ResizeObserverCtor = options.ResizeObserverCtor ?? resolveResizeObserverCtor();
  const sizeSource = canvas.parentElement ?? canvas;

  function resize(cssWidth: number, cssHeight: number): void {
    const dpr = getDevicePixelRatio();
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    (canvas.getContext("2d") as Canvas2DScaleTarget | null)?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let observer: ResizeObserver | undefined;
  if (ResizeObserverCtor) {
    observer = new ResizeObserverCtor((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(sizeSource);
  }

  return {
    resize,
    dispose() {
      observer?.disconnect();
    },
  };
}
