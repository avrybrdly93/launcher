#!/usr/bin/env node
/**
 * Builds `packages/wasm-core/crate` for `wasm32-unknown-unknown` and copies the
 * result to `packages/wasm-core/src/generated/ballista-core.wasm` (P7.07).
 *
 * The .wasm is committed. That is a deliberate choice, not laziness: CI has no
 * Rust toolchain, so if the artifact were built rather than committed, the one
 * test that verifies P7.07's criterion would be skipped on every CI run and the
 * criterion would be checked nowhere. Committing it means CI runs the real
 * comparison against the real binary.
 *
 * The cost of committing a build output is that it can drift from its source.
 * `wasm-artifact-freshness.test.ts` is what pays that cost down: where cargo is
 * available it rebuilds and compares bytes, and where it is not it skips. So a
 * drifted artifact fails for anyone who can rebuild it, and nobody else is
 * blocked.
 *
 *   node scripts/build-wasm-core.mjs           build and install
 *   node scripts/build-wasm-core.mjs --check   build and report drift, write nothing
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRATE_DIR = join(REPO_ROOT, "packages/wasm-core/crate");
const TARGET = "wasm32-unknown-unknown";
const BUILT = join(CRATE_DIR, "target", TARGET, "release", "ballista_core.wasm");
const INSTALLED = join(REPO_ROOT, "packages/wasm-core/src/generated/ballista-core.wasm");

const checkOnly = process.argv.includes("--check");

const cargo = spawnSync("cargo", ["build", "--target", TARGET, "--release"], {
  cwd: CRATE_DIR,
  stdio: "inherit",
});
if (cargo.error?.code === "ENOENT") {
  console.error("build-wasm-core: cargo not found on PATH. Install Rust, then re-run.");
  process.exit(2);
}
if (cargo.status !== 0) {
  process.exit(cargo.status ?? 1);
}

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const builtHash = sha(BUILT);

if (checkOnly) {
  let installedHash;
  try {
    installedHash = sha(INSTALLED);
  } catch {
    console.error("build-wasm-core: no committed artifact to compare against.");
    process.exit(1);
  }
  if (builtHash !== installedHash) {
    console.error("build-wasm-core: committed artifact differs from a fresh build.");
    console.error(`  committed ${installedHash}`);
    console.error(`  rebuilt   ${builtHash}`);
    console.error("  run `pnpm build:wasm` and commit the result.");
    process.exit(1);
  }
  console.log(`build-wasm-core: committed artifact matches a fresh build (${builtHash}).`);
  process.exit(0);
}

mkdirSync(dirname(INSTALLED), { recursive: true });
copyFileSync(BUILT, INSTALLED);
console.log(`build-wasm-core: installed ${INSTALLED}`);
console.log(`  sha256 ${builtHash}`);
