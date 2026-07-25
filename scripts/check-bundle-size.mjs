// Bundle-size CI gate (§2.6 budget: core interactive app <= 300 kB gzipped,
// excluding the optional plot library). Run after `vite build`.
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUDGET_BYTES = 300 * 1024;
const distDir = join(import.meta.dirname, "..", "packages", "app", "dist");
const indexHtmlPath = join(distDir, "index.html");

let indexHtml;
try {
  indexHtml = readFileSync(indexHtmlPath, "utf8");
} catch {
  console.error(
    `No built index.html found at ${indexHtmlPath}. Run "pnpm --filter @ballista/app build" first.`,
  );
  process.exit(1);
}

// The initial bundle is exactly what `index.html` eagerly loads on first
// paint (`<script src>` tags) -- NOT every `.js` chunk Vite emitted under
// `dist/`. A lazily `import()`-ed chunk (e.g. `plotly.js-dist-min`,
// P3.30/ADR-007's exploratory analysis panes) is deliberately excluded from
// that first load and from the budget this gate enforces; summing every
// emitted chunk regardless of load timing (this script's behavior before
// P3.42 wired the app's first real lazy-Plotly consumer, ConvergenceStudyRoute,
// and so was the first build to actually emit a Plotly chunk under
// `packages/app/dist`) silently contradicted this file's own header comment.
const scriptPaths = [...indexHtml.matchAll(/<script[^>]*\bsrc="([^"]+\.js)"/g)].map((m) => m[1]);

if (scriptPaths.length === 0) {
  console.error(`No <script src> references found in ${indexHtmlPath}.`);
  process.exit(1);
}

let totalGzipBytes = 0;
for (const scriptPath of scriptPaths) {
  const file = join(distDir, scriptPath);
  const gz = gzipSync(readFileSync(file));
  totalGzipBytes += gz.length;
}

const kb = (totalGzipBytes / 1024).toFixed(1);
const budgetKb = (BUDGET_BYTES / 1024).toFixed(0);

if (totalGzipBytes > BUDGET_BYTES) {
  console.error(`Bundle size ${kb} kB gzipped exceeds budget of ${budgetKb} kB (§2.6).`);
  process.exit(1);
}

console.log(`Bundle size ${kb} kB gzipped, within budget of ${budgetKb} kB (§2.6).`);
