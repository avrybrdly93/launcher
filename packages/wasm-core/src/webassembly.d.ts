/**
 * Minimal ambient declarations for the `WebAssembly` global.
 *
 * The repository compiles with `"lib": ["ES2022"]` and no `DOM`, because §2.1's
 * purity constraint -- "L0 and L1 are pure TypeScript with zero DOM
 * dependencies", called the single most important architectural invariant in
 * the project -- is enforced partly by simply not having those types in scope.
 * `WebAssembly` is declared in `lib.dom.d.ts`, so adding it the easy way would
 * mean adding `DOM` to this package's `lib` and bringing `document`, `window`
 * and the rest along with it. That would trade a real invariant for a
 * convenience.
 *
 * So the surface this package actually uses is declared here instead, and
 * nothing more: if a later task needs `Table`, `Global`, streaming
 * instantiation or the error classes, it adds them deliberately.
 *
 * These match the WebAssembly JS API as implemented by Node and by browsers.
 * `wasm-rk4-backend.ts` is the only consumer of the value side.
 */
declare namespace WebAssembly {
  /** A module's linear memory. `buffer` detaches and is replaced if the memory grows. */
  interface Memory {
    readonly buffer: ArrayBuffer;
  }

  /**
   * A compiled, not-yet-instantiated module. Genuinely opaque: the platform
   * gives it no public members, and its only uses are being passed to
   * `instantiate` or reflected over by the `Module` namespace below.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Module {}

  /** An instantiated module. `exports` is untyped by the platform; callers narrow it. */
  interface Instance {
    readonly exports: Record<string, unknown>;
  }

  interface WebAssemblyInstantiatedSource {
    readonly module: Module;
    readonly instance: Instance;
  }

  type ImportExportKind = "function" | "global" | "memory" | "table";

  interface ModuleExportDescriptor {
    readonly name: string;
    readonly kind: ImportExportKind;
  }

  interface ModuleImportDescriptor {
    readonly module: string;
    readonly name: string;
    readonly kind: ImportExportKind;
  }

  /** Static reflection over a compiled module, used to assert the ABI in tests. */
  namespace Module {
    function exports(module: Module): ModuleExportDescriptor[];
    function imports(module: Module): ModuleImportDescriptor[];
  }

  function compile(bytes: BufferSource): Promise<Module>;

  function instantiate(
    bytes: BufferSource,
    importObject?: Record<string, Record<string, unknown>>,
  ): Promise<WebAssemblyInstantiatedSource>;
}
