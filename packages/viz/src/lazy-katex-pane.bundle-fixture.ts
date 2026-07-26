/**
 * Minimal real consumer of {@link ./lazy-katex-pane.js}'s dynamic import,
 * used only as a Rollup/Vite build entry point by
 * `lazy-katex-pane.bundle.test.ts` to verify KaTeX ends up in its own
 * dynamic-import chunk rather than the initial bundle (P3.45, mirroring
 * P3.30's `lazy-plotly-pane.bundle-fixture.ts`). Not part of this
 * package's public API, so deliberately not re-exported from `index.ts`.
 */
import type { DerivationBlock } from "./derivation-markdown.js";
import { loadKatexModule, renderLazyKatexPane } from "./lazy-katex-pane.js";

export function openDerivationPanelOnDemand(container: HTMLElement, blocks: DerivationBlock[]) {
  return renderLazyKatexPane(container, blocks);
}

export function preloadKatex() {
  return loadKatexModule();
}
