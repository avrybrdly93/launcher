import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WASM_ARTIFACT_PATH } from "./wasm-rk4-backend.js";

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
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CRATE_DIR = join(REPO_ROOT, "packages/wasm-core/crate");
const TARGET = "wasm32-unknown-unknown";

function hasCargo(): boolean {
  const probe = spawnSync("cargo", ["--version"], { stdio: "ignore" });
  return probe.error === undefined && probe.status === 0;
}

function hasWasmTarget(): boolean {
  const out = spawnSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" });
  return out.status === 0 && out.stdout.includes(TARGET);
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

describe("the committed .wasm artifact", () => {
  it("exists and is a WebAssembly module", () => {
    expect(existsSync(WASM_ARTIFACT_PATH)).toBe(true);
    const bytes = readFileSync(WASM_ARTIFACT_PATH);
    // \0asm followed by version 1, the only header a v1 module can have.
    expect([...bytes.subarray(0, 8)]).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  });

  it("exports exactly the C ABI the host binds to, and imports nothing", async () => {
    // Imports being empty is the substantive half: a kernel that imported a
    // host function could produce results that depend on the embedder, and
    // then "matches TS" would be a statement about this host rather than about
    // the module.
    const module = await WebAssembly.compile(readFileSync(WASM_ARTIFACT_PATH));
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
    expect(functions).toEqual(
      ["dim", "param_count", "params_ptr", "state_ptr", "step", "step_n"].sort(),
    );
    expect(exported.filter((e) => e.kind === "memory").map((e) => e.name)).toEqual(["memory"]);
  });

  it.skipIf(!hasCargo() || !hasWasmTarget())(
    "is byte-identical to a fresh release build of the crate",
    () => {
      const build = spawnSync("cargo", ["build", "--target", TARGET, "--release"], {
        cwd: CRATE_DIR,
        encoding: "utf8",
      });
      expect(build.status, build.stderr).toBe(0);

      const fresh = readFileSync(
        join(CRATE_DIR, "target", TARGET, "release", "ballista_core.wasm"),
      );
      const committed = readFileSync(WASM_ARTIFACT_PATH);

      expect(sha256(committed)).toBe(sha256(fresh));
    },
    120_000,
  );
});
