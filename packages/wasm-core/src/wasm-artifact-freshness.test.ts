import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WASM_ARTIFACT_PATH, WASM_SIMD_ARTIFACT_PATH } from "./wasm-rk4-backend.js";

/**
 * The committed `.wasm` is a build output living in version control (P7.07), so
 * it can drift from the Rust that is supposed to produce it. This is what
 * catches that.
 *
 * It only runs where a Rust toolchain exists. CI has none -- which is the
 * reason the artifact is committed at all -- so there it skips, and the
 * equivalence suite still runs against the committed bytes. The division of
 * labour is: `wasm-ts-equivalence.test.ts` proves the artifact is *correct*
 * everywhere, and this proves it is *current* wherever that can be checked.
 *
 * A skip is not a pass. If this suite skips everywhere forever, a stale
 * artifact could sit in the tree indefinitely while its source said something
 * else, and the first person to rebuild would find the difference. That is
 * accepted for a spike and is the thing to revisit if P7.11's backend
 * equivalence CI gains a Rust toolchain.
 *
 * P7.09 made this two artifacts rather than one, and the freshness obligation
 * doubled with it: a stale *simd* artifact is the more dangerous of the two,
 * because the equivalence test would then be comparing the scalar path against
 * a SIMD path built from source that no longer exists.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CRATE_DIR = join(REPO_ROOT, "packages/wasm-core/crate");
const TARGET = "wasm32-unknown-unknown";

/** The two committed builds and how each is produced. Mirrors `build-wasm-core.mjs`. */
const VARIANTS = [
  { name: "scalar", artifact: WASM_ARTIFACT_PATH, targetDir: "target", rustflags: undefined },
  {
    name: "simd128",
    artifact: WASM_SIMD_ARTIFACT_PATH,
    targetDir: "target-simd",
    rustflags: "-C target-feature=+simd128",
  },
] as const;

/**
 * Exports both builds carry. The simd128 build adds `batch_run_simd` on top,
 * and its absence from the scalar build is the property the host's feature
 * detect is checked against -- a wrong artifact is a missing symbol rather than
 * a quietly slower path.
 */
const COMMON_FUNCTION_EXPORTS = [
  // P7.07, the single-state path.
  "dim",
  "param_count",
  "params_ptr",
  "state_ptr",
  "step",
  "step_n",
  // P7.08, the batch path.
  "batch_capacity",
  "batch_init",
  "batch_observables_ptr",
  "batch_params_ptr",
  "batch_run",
  "batch_states_ptr",
  "obs_count",
  // P7.09, present in both so the host can ask an instance which one it is.
  "simd_enabled",
  "simd_lanes",
];

function hasCargo(): boolean {
  const probe = spawnSync("cargo", ["--version"], { stdio: "ignore" });
  return probe.error === undefined && probe.status === 0;
}

function hasWasmTarget(): boolean {
  const out = spawnSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" });
  return out.status === 0 && out.stdout.includes(TARGET);
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

describe.each(VARIANTS)("the committed $name .wasm artifact", (variant) => {
  it("exists and is a WebAssembly module", () => {
    expect(existsSync(variant.artifact)).toBe(true);
    const bytes = readFileSync(variant.artifact);
    // \0asm followed by version 1, the only header a v1 module can have.
    expect([...bytes.subarray(0, 8)]).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  });

  it("exports exactly the C ABI the host binds to, and imports nothing", async () => {
    // Imports being empty is the substantive half: a kernel that imported a
    // host function could produce results that depend on the embedder, and
    // then "matches TS" would be a statement about this host rather than about
    // the module.
    const module = await WebAssembly.compile(readFileSync(variant.artifact));
    expect(WebAssembly.Module.imports(module)).toEqual([]);

    const exported = WebAssembly.Module.exports(module);
    // Asserted by kind rather than as one flat set: rust-lld also exports the
    // `__data_end` and `__heap_base` globals, which are layout metadata this
    // module does not use and did not ask for. Pinning the function and memory
    // exports exactly still catches an accidentally-added or renamed entry
    // point, without pinning the linker's own conventions.
    const functions = exported
      .filter((e) => e.kind === "function")
      .map((e) => e.name)
      .sort();
    const expected =
      variant.name === "simd128"
        ? [...COMMON_FUNCTION_EXPORTS, "batch_run_simd"]
        : COMMON_FUNCTION_EXPORTS;
    expect(functions).toEqual([...expected].sort());
    expect(exported.filter((e) => e.kind === "memory").map((e) => e.name)).toEqual(["memory"]);
  });

  it.skipIf(!hasCargo() || !hasWasmTarget())(
    "is byte-identical to a fresh release build of the crate",
    () => {
      const env: NodeJS.ProcessEnv = { ...process.env, CARGO_TARGET_DIR: variant.targetDir };
      if (variant.rustflags === undefined) {
        // An inherited RUSTFLAGS would change what "scalar" means, and this
        // variant is defined by carrying no target features.
        delete env.RUSTFLAGS;
      } else {
        env.RUSTFLAGS = variant.rustflags;
      }
      const build = spawnSync("cargo", ["build", "--target", TARGET, "--release"], {
        cwd: CRATE_DIR,
        encoding: "utf8",
        env,
      });
      expect(build.status, build.stderr).toBe(0);

      const fresh = readFileSync(
        join(CRATE_DIR, variant.targetDir, TARGET, "release", "ballista_core.wasm"),
      );
      const committed = readFileSync(variant.artifact);

      expect(sha256(committed)).toBe(sha256(fresh));
    },
    120_000,
  );
});

describe("the two artifacts", () => {
  it("are different binaries, so a build that produced one twice would be caught", () => {
    // Cheap, but it is the assertion that fails if `build-wasm-core.mjs` ever
    // loses its RUSTFLAGS handling and installs the scalar build under both
    // names -- at which point every SIMD test would pass while testing nothing.
    expect(sha256(readFileSync(WASM_ARTIFACT_PATH))).not.toBe(
      sha256(readFileSync(WASM_SIMD_ARTIFACT_PATH)),
    );
  });
});
