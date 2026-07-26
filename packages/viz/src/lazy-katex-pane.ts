/**
 * Lazy-loaded KaTeX pane for derivation panels (§6.3 "each exhibit pairs the
 * interactive view with a short derivation panel", §6.4 "Math rendering:
 * KaTeX"; P3.45). Mirrors `lazy-plotly-pane.ts`'s split exactly, for the
 * same ADR-007 reason: a derivation panel is opened on demand (not on every
 * frame), so KaTeX's weight (JS + web fonts) has no business in the initial
 * bundle -- both the module and its stylesheet load via a single memoized
 * `import()` pair inside {@link loadKatexModule}, never a static import
 * anywhere in the module graph.
 *
 * Rendering ({@link renderDerivationBlocksToHtml}) is pure string building
 * from `derivation-markdown.ts`'s block/inline AST plus KaTeX's own
 * `renderToString` (which itself needs no DOM), so it stays unit-testable
 * without ever loading the real KaTeX module; only
 * {@link renderLazyKatexPane}/{@link disposeLazyKatexPane} touch the lazy
 * import and the DOM.
 */

import type { DerivationBlock, DerivationInline } from "./derivation-markdown.js";

/** The narrow slice of KaTeX's static API this pane calls. */
export interface KatexModule {
  renderToString(tex: string, options?: Record<string, unknown>): string;
}

let katexModulePromise: Promise<KatexModule> | undefined;

/**
 * Dynamically imports `katex` and its stylesheet together, memoized so
 * repeated panel opens within a session reuse the same module instance.
 * The stylesheet is imported for its side effect (injecting KaTeX's CSS,
 * including the `@font-face` rules its glyphs need) rather than any value
 * -- `renderToString` produces plain HTML the caller still has to mount,
 * but that HTML is unreadable without KaTeX's own CSS alongside it.
 */
export function loadKatexModule(): Promise<KatexModule> {
  if (!katexModulePromise) {
    katexModulePromise = Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
      ([mod]) => mod.default,
    );
  }
  return katexModulePromise;
}

/** Resets the memoized module promise -- test-only, so each test gets a fresh dynamic-import call. */
export function resetLazyKatexModuleForTesting(): void {
  katexModulePromise = undefined;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(inline: DerivationInline, katex: KatexModule): string {
  switch (inline.kind) {
    case "text":
      return escapeHtml(inline.text);
    case "bold":
      return `<strong>${escapeHtml(inline.text)}</strong>`;
    case "code":
      return `<code>${escapeHtml(inline.text)}</code>`;
    case "link":
      return `<code class="derivation-panel-link">${escapeHtml(inline.text)}</code>`;
    case "math":
      return katex.renderToString(inline.tex, { throwOnError: false, displayMode: false });
  }
}

function renderInlines(inlines: readonly DerivationInline[], katex: KatexModule): string {
  return inlines.map((inline) => renderInline(inline, katex)).join("");
}

/**
 * Renders `blocks` to an HTML string, `katex.renderToString` handling every
 * math span. Headings are shifted down two levels (`h1`->`h3`, `h2`->`h4`,
 * capped at `h6`) since a derivation panel is always embedded inside a page
 * that already owns the `h1`/`h2` document outline -- its own sub-sections
 * shouldn't compete with the page's.
 */
export function renderDerivationBlocksToHtml(
  blocks: readonly DerivationBlock[],
  katex: KatexModule,
): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "heading": {
          const tag = `h${Math.min(block.level + 2, 6)}`;
          return `<${tag}>${renderInlines(block.inlines, katex)}</${tag}>`;
        }
        case "paragraph":
          return `<p>${renderInlines(block.inlines, katex)}</p>`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const items = block.items
            .map((item) => `<li>${renderInlines(item, katex)}</li>`)
            .join("");
          return `<${tag}>${items}</${tag}>`;
        }
        case "display-math":
          return katex.renderToString(block.tex, { throwOnError: false, displayMode: true });
      }
    })
    .join("");
}

/**
 * Mounts `blocks` into `container` via lazy-loaded KaTeX. Safe to call
 * again on the same `container` to update in place.
 */
export async function renderLazyKatexPane(
  container: HTMLElement,
  blocks: readonly DerivationBlock[],
): Promise<void> {
  const katex = await loadKatexModule();
  container.innerHTML = renderDerivationBlocksToHtml(blocks, katex);
}

/** Tears down a pane mounted via {@link renderLazyKatexPane}. */
export function disposeLazyKatexPane(container: HTMLElement): void {
  container.innerHTML = "";
}
