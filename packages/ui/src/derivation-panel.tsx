/**
 * On-demand derivation panel (§6.3 "each exhibit pairs the interactive view
 * with a short derivation panel (rendered from the same markdown/LaTeX
 * sources as this document's Section 4 -- single-source pedagogy)", §6.4
 * "Math rendering: KaTeX"; P3.45). A native `<details>` disclosure: the
 * KaTeX pane only mounts (and so only pays its lazy `import()` cost, ADR-007)
 * the first time a reader actually opens it, never on the exhibit's own
 * initial render. Purely presentational, mirroring `LazyPlotlyView`'s
 * mount/update/dispose split around `renderLazyKatexPane`/
 * `disposeLazyKatexPane` (`@ballista/viz`); the caller owns parsing the
 * source markdown into `blocks` (`parseDerivationMarkdown`) so this
 * component stays trivially testable without touching KaTeX.
 */

import { disposeLazyKatexPane, renderLazyKatexPane, type DerivationBlock } from "@ballista/viz";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export interface DerivationPanelProps {
  readonly title: string;
  readonly blocks: readonly DerivationBlock[];
}

export function DerivationPanel({ title, blocks }: DerivationPanelProps) {
  const [opened, setOpened] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!opened) return;
    const container = containerRef.current;
    if (!container) return;
    void renderLazyKatexPane(container, blocks);
    return () => {
      disposeLazyKatexPane(container);
    };
  }, [opened, blocks]);

  return (
    <details
      class="derivation-panel"
      data-testid="derivation-panel"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary data-testid="derivation-panel-summary">{title}</summary>
      <div
        class="derivation-panel-content"
        data-testid="derivation-panel-content"
        ref={containerRef}
      />
    </details>
  );
}
