#!/usr/bin/env node
/**
 * Builds `packages/wasm-core/crate` for `wasm32-unknown-unknown` and copies the
 * results into `packages/wasm-core/src/generated/` (P7.07, P7.09).
 *
 * TWO artifacts, not one. P7.09 adds an f64x2 SIMD batch path, and a module
 * containing simd128 instructions does not *validate* on an engine without the
 * proposal -- it fails at compile time, not at the call site -- so one binary
 * cannot serve both engines. The scalar build stays the fallback and the
 * feature detect in `wasm-rk4-backend.ts` chooses between them:
 *
 *   ballista-core.wasm        no target features; runs anywhere
 *   ballista-core.simd.wasm   -C target-feature=+simd128
 *
 * The two builds use separate `CARGO_TARGET_DIR`s. Cargo keys its fingerprint
 * on RUSTFLAGS, so sharing one directory would make each build invalidate the
 * other's output and the pair would rebuild from scratch on every alternation.
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
 *   node scripts/build-wasm-core.mjs           build and install both
 *   node scripts/build-wasm-core.mjs --check   build both, report drift, write nothing
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRATE_DIR = join(REPO_ROOT, "packages/wasm-core/crate");
const TARGET = "wasm32-unknown-unknown";
const GENERATED_DIR = join(REPO_ROOT, "packages/wasm-core/src/generated");

/** The two builds, in the order they are reported. */
const VARIANTS = [
  {
    name: "scalar",
    targetDir: "target",
    rustflags: undefined,
    installed: join(GENERATED_DIR, "ballista-core.wasm"),
  },
  {
    name: "simd128",
    targetDir: "target-simd",
    rustflags: "-C target-feature=+simd128",
    installed: join(GENERATED_DIR, "ballista-core.simd.wasm"),
  },
];

const checkOnly = process.argv.includes("--check");

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

function build(variant) {
  const env = { ...process.env };
  env.CARGO_TARGET_DIR = variant.targetDir;
  if (variant.rustflags === undefined) {
    // Inherited RUSTFLAGS would silently change what "scalar" means, and the
    // whole point of this variant is that it carries no target features.
    delete env.RUSTFLAGS;
  } else {
    env.RUSTFLAGS = variant.rustflags;
  }

  const cargo = spawnSync("cargo", ["build", "--target", TARGET, "--release"], {
    cwd: CRATE_DIR,
    stdio: "inherit",
    env,
  });
  if (cargo.error?.code === "ENOENT") {
    console.error("build-wasm-core: cargo not found on PATH. Install Rust, then re-run.");
    process.exit(2);
  }
  if (cargo.status !== 0) {
    process.exit(cargo.status ?? 1);
  }
  return join(CRATE_DIR, variant.targetDir, TARGET, "release", "ballista_core.wasm");
}

let drifted = false;
for (const variant of VARIANTS) {
  const built = build(variant);
  const builtHash = sha(built);

  if (checkOnly) {
    let installedHash;
    try {
      installedHash = sha(variant.installed);
    } catch {
      console.error(`build-wasm-core: no committed ${variant.name} artifact to compare against.`);
      drifted = true;
      continue;
    }
    if (builtHash !== installedHash) {
      console.error(
        `build-wasm-core: committed ${variant.name} artifact differs from a fresh build.`,
      );
      console.error(`  committed ${installedHash}`);
      console.error(`  rebuilt   ${builtHash}`);
      drifted = true;
      continue;
    }
    console.log(
      `build-wasm-core: committed ${variant.name} artifact matches a fresh build (${builtHash}).`,
    );
    continue;
  }

  mkdirSync(dirname(variant.installed), { recursive: true });
  copyFileSync(built, variant.installed);
  console.log(`build-wasm-core: installed ${variant.installed}`);
  console.log(`  sha256 ${builtHash}`);
}

if (checkOnly && drifted) {
  console.error("  run `pnpm build:wasm` and commit the result.");
  process.exit(1);
}
