// Bundle-size CI gate (§2.6 budget: core interactive app <= 300 kB gzipped,
// excluding the optional plot library). Run after `vite build`.
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const BUDGET_BYTES = 300 * 1024;
const distDir = join(import.meta.dirname, "..", "packages", "app", "dist");

async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsFiles(full)));
    } else if (entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

const files = await collectJsFiles(distDir);
if (files.length === 0) {
  console.error(
    `No built .js files found under ${distDir}. Run "pnpm --filter @ballista/app build" first.`,
  );
  process.exit(1);
}

let totalGzipBytes = 0;
for (const file of files) {
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
