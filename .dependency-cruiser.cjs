/**
 * Encodes the layered architecture of §2.1: L0 engine < L1 {solverkit,
 * analysis} < L2 runtime < L3 viz < L4 ui < L5 app, plus the dev-only
 * `validation` package which nothing else may import. Allowed deps mirror
 * each package.json's "dependencies" exactly (P0.04).
 */
const ALLOWED = {
  engine: [],
  solverkit: ["engine"],
  analysis: ["engine", "solverkit"],
  runtime: ["engine", "solverkit", "analysis", "wasm-core"],
  viz: ["engine", "solverkit", "analysis", "runtime"],
  ui: ["engine", "solverkit", "analysis", "runtime", "viz"],
  app: ["engine", "solverkit", "analysis", "runtime", "viz", "ui"],
  validation: ["engine", "solverkit", "analysis"],
  // P7.07. The WASM backend sits beside `runtime`: it may read L0/L1 to
  // compare against them. P7.10 added it to `runtime`'s list above, which is
  // what that task was for -- `heterogeneous-executor.ts` schedules ensemble
  // chunks onto a WASM backend built over a `WasmRk4Kernel`.
  //
  // That edge is TYPE-ONLY in the package's index-reachable code, and the
  // distinction is load-bearing rather than pedantic: `wasm-rk4-backend.ts`
  // imports `node:fs/promises` to read the committed artifact off disk, so a
  // value import would put a Node builtin into every browser bundle that
  // touches `@ballista/runtime`. `tsPreCompilationDeps` below sees type
  // imports too, which is why the entry is needed at all. Runtime's *tests*
  // do import the kernel for real, which is where the equivalence is measured.
  "wasm-core": ["engine", "solverkit"],
};

const packages = Object.keys(ALLOWED);

const forbidden = packages.flatMap((from) => {
  const allowed = new Set(ALLOWED[from]);
  const disallowedTargets = packages.filter((to) => to !== from && !allowed.has(to));
  if (disallowedTargets.length === 0) return [];
  return [
    {
      name: `no-${from}-to-{${disallowedTargets.join(",")}}`,
      severity: "error",
      comment: `packages/${from} may only import from {${ALLOWED[from].join(", ") || "nothing"}} per §2.1's layering.`,
      from: { path: `^packages/${from}/src` },
      to: {
        path: `^packages/(${disallowedTargets.join("|")})/src`,
      },
    },
  ];
});

module.exports = {
  forbidden,
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
