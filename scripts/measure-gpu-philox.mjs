// GPU/CPU agreement for the in-kernel Philox4x32-10 generator (P7.21's
// validation criterion: "Philox streams pass statistical tests; replicate
// determinism by counter").
//
// Runs the same replicates two ways -- the CPU reference under Node, and the
// generator on a real WebGPU device inside Playwright Chromium -- and compares
// both arms: the raw u32 words and the f32 uniforms.
//
// ## WHICH HALF OF THE CRITERION THIS ANSWERS, SAID PLAINLY
//
// Neither clause, on its own terms. `packages/engine/src/philox.test.ts` is
// where the statistical tests and the counter-determinism tests live, and it is
// what the criterion is met by. THIS script answers the question those tests
// cannot reach and that the word "in-kernel" puts in the criterion's title:
// whether the generator the shader computes is the generator those tests
// measured. A CPU implementation that passes every statistical test in the world
// says nothing about the WGSL if the WGSL computes something else.
//
// Both facts are needed and neither substitutes for the other, so they are kept
// in separate places and reported separately.
//
// ## THE GATE IS EXACT EQUALITY, AND THAT IS NOT STRICTNESS
//
// Every other GPU check here gates on ULP because floating-point results have
// conformant latitude -- FMA contraction, mainly. The generator is INTEGER
// arithmetic: u32 add, multiply, shift and xor are exactly specified modulo
// 2^32, so there is no latitude to budget for and one differing bit is one bug.
// The uniform conversion is exact too, by construction: `f32(word >> 8u)` fits
// in 24 bits so the conversion is exact, and scaling by 2^-24 is exact because
// it is a power of two. A tolerance anywhere in this script would be covering
// for a defect rather than for arithmetic latitude.
//
// A ULP figure is still computed and reported for the uniform arm, because "0"
// is worth showing rather than asserting.
//
// ## WHAT A SOFTWARE ADAPTER DOES AND DOES NOT ESTABLISH
//
// The same distinction `measure-gpu-compensated-impact.mjs` draws, and it holds
// here for a stronger reason. This is a question about arithmetic; the same WGSL
// with the same u32 semantics runs on either adapter, so agreement here is
// evidence about the SHADER. It answers NO performance question -- this script
// measures no time and reports no rate. P7.20's 1e6 trajectories/s target is
// untouched by anything here.
//
// Requires `packages/{engine,runtime}/dist` to be built (`pnpm build`).

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";
import {
  chromiumChoiceLine,
  chromiumHintLines,
  resolveChromiumExecutable,
} from "./resolve-chromium.mjs";

import {
  computeCpuPhilox,
  computeCpuUniformsF64,
  PHILOX_LANES,
  WORKGROUP_SIZE,
} from "./gpu-philox-fixture.mjs";

const rootDir = join(import.meta.dirname, "..");
const resultsPath = join(rootDir, "scripts", "gpu-philox-results.json");
const fixtureEntry = join(rootDir, "scripts", "gpu-philox-fixture.mjs");

/**
 * Replicates compared.
 *
 * 65536 rather than P7.14's 10000 because the counters are what is under test
 * here, not a physical ensemble: a power of two sweeps every low-word bit
 * pattern up to 2^16 with none of the arithmetic-progression structure a round
 * decimal count leaves in the high bits of the index.
 */
const CRITERION_REPLICATES = 65_536;
const REPLICATES = Number(process.env.BALLISTA_PHILOX_REPLICATES ?? CRITERION_REPLICATES);

/** An arbitrary fixed key. Recorded, so the run is reproducible from the record. */
const KEY = [0x1234abcd, 0x5678ef01];

const shouldRecord = process.argv.slice(2).includes("--record");

if (shouldRecord && REPLICATES !== CRITERION_REPLICATES) {
  console.error(
    `Refusing to --record a ${REPLICATES}-replicate run: the recorded run is ` +
      `${CRITERION_REPLICATES}. Unset BALLISTA_PHILOX_REPLICATES to record.`,
  );
  process.exit(1);
}

/**
 * Distance in representable binary32 values, as in the sibling scripts: bits
 * reinterpreted as sign-magnitude then mapped to two's complement, so adjacent
 * representable values are adjacent integers.
 */
const ulpScratch = new ArrayBuffer(8);
const ulpF32 = new Float32Array(ulpScratch);
const ulpI32 = new Int32Array(ulpScratch);
function ulpDistance(a, b) {
  if (a === b) return 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  ulpF32[0] = a;
  ulpF32[1] = b;
  const toOrdered = (bits) => (bits < 0 ? 0x80000000 - (bits & 0x7fffffff) : bits);
  return Math.abs(toOrdered(ulpI32[0]) - toOrdered(ulpI32[1]));
}

// ---------------------------------------------------------------------------

console.log(
  `Computing CPU reference for ${REPLICATES} replicates ` +
    `(key 0x${KEY[0].toString(16)}, 0x${KEY[1].toString(16)})...`,
);
const reference = computeCpuPhilox(REPLICATES, KEY);

const bundle = await esbuild.build({
  entryPoints: [fixtureEntry],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "__ballistaGpuPhilox",
  write: false,
});
const bundleCode = bundle.outputFiles[0].text;

// WebGPU is secure-context only, so the page must not be about:blank.
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>gpu-philox</title><body></body>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

/** Flag sets, most-preferred first; measured in this image by the 99th run. */
const FLAG_SETS = [
  {
    name: "swiftshader",
    args: [
      "--enable-unsafe-webgpu",
      "--use-webgpu-adapter=swiftshader",
      "--enable-features=Vulkan",
    ],
  },
  { name: "default", args: [] },
];

const { chromium } = await import("playwright");

/** See `resolve-chromium.mjs` (P0.138) for how the binary is chosen. */
const chromiumChoice = resolveChromiumExecutable();
const executablePath = chromiumChoice.executablePath;
console.log(chromiumChoiceLine(chromiumChoice));

async function measureWith(flagSet) {
  let browser;
  try {
    browser = await chromium.launch({ args: flagSet.args, executablePath });
  } catch (error) {
    return { status: "unavailable", reason: `launch failed: ${error.message}` };
  }
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(600_000);
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ content: bundleCode });
    const result = await page.evaluate(
      ([count, key, workgroupSize]) =>
        window.__ballistaGpuPhilox.runGpuPhilox(count, key, workgroupSize),
      [REPLICATES, KEY, WORKGROUP_SIZE],
    );
    return { ...result, chromiumVersion: browser.version(), flags: flagSet.args };
  } catch (error) {
    return { status: "failed", reason: "evaluate-threw", error: String(error) };
  } finally {
    await browser.close();
  }
}

let run = null;
for (const flagSet of FLAG_SETS) {
  console.log(`Trying Chromium flag set "${flagSet.name}"...`);
  const attempt = await measureWith(flagSet);
  if (attempt.status === "measured") {
    run = { ...attempt, flagSet: flagSet.name };
    break;
  }
  console.log(`  -> ${attempt.status}: ${attempt.reason ?? attempt.error ?? "(no reason)"}`);
  if (run === null) run = { ...attempt, flagSet: flagSet.name };
}
server.close();

if (run.status !== "measured") {
  // Never report an all-clear derived from nothing measured (P0.102).
  console.warn(
    `::warning::No WebGPU device could be obtained (${run.reason ?? run.error}), so the ` +
      `in-kernel generator was NOT checked. This is not a pass.`,
  );
  for (const line of chromiumHintLines(chromiumChoice)) {
    console.warn(`  ${line}`);
  }
  if (shouldRecord) {
    console.warn(
      `::warning::--record was passed but nothing was measured; leaving ${resultsPath} unmodified.`,
    );
  }
  process.exit(0);
}

const gpuWords = Uint32Array.from(run.words);
const gpuUniforms = Float32Array.from(run.uniforms);

if (
  gpuWords.length !== reference.words.length ||
  gpuUniforms.length !== reference.uniforms.length
) {
  console.error(
    `GPU returned ${gpuWords.length} words and ${gpuUniforms.length} uniforms, expected ` +
      `${reference.words.length} of each. Refusing to compare.`,
  );
  process.exit(1);
}

let wordMismatches = 0;
let firstWordMismatch = null;
for (let i = 0; i < gpuWords.length; i++) {
  if (gpuWords[i] !== reference.words[i]) {
    wordMismatches += 1;
    firstWordMismatch ??= {
      replicate: Math.floor(i / PHILOX_LANES),
      lane: i % PHILOX_LANES,
      cpu: reference.words[i],
      gpu: gpuWords[i],
    };
  }
}

let uniformMismatches = 0;
let worstUniformUlp = 0;
let firstUniformMismatch = null;
let maxUniform = 0;
for (let i = 0; i < gpuUniforms.length; i++) {
  if (gpuUniforms[i] > maxUniform) maxUniform = gpuUniforms[i];
  const ulp = ulpDistance(reference.uniforms[i], gpuUniforms[i]);
  if (ulp > worstUniformUlp) worstUniformUlp = ulp;
  if (gpuUniforms[i] !== reference.uniforms[i]) {
    uniformMismatches += 1;
    firstUniformMismatch ??= {
      replicate: Math.floor(i / PHILOX_LANES),
      lane: i % PHILOX_LANES,
      cpu: reference.uniforms[i],
      gpu: gpuUniforms[i],
    };
  }
}

/**
 * How far the device's f32 uniforms sit from the CPU's f64 ones.
 *
 * Reported, never gated. The two are different computations on purpose -- the
 * f64 conversion divides the whole word by 2^32 and the f32 one takes the top 24
 * bits -- so this number says what that costs rather than whether anything is
 * wrong. Expect it near 2^-25.
 */
const cpuF64 = computeCpuUniformsF64(REPLICATES, KEY);
let maxF64Gap = 0;
for (let i = 0; i < cpuF64.length; i++) {
  const gap = Math.abs(cpuF64[i] - gpuUniforms[i]);
  if (gap > maxF64Gap) maxF64Gap = gap;
}

console.log("");
console.log(
  `Adapter: vendor=${run.adapterInfo.vendor} architecture=${run.adapterInfo.architecture} ` +
    `fallback=${run.adapterInfo.isFallbackAdapter} (flag set: ${run.flagSet})`,
);
console.log(`Chromium: ${run.chromiumVersion}`);
console.log(`Kernel: ${run.kernelLength} characters, workgroup size ${WORKGROUP_SIZE}`);
if (run.deviceErrors.length > 0) {
  console.warn(`::warning::device reported uncaptured errors: ${run.deviceErrors.join("; ")}`);
}
console.log("");
console.log(`Replicates: ${REPLICATES} (${gpuWords.length} words, ${gpuUniforms.length} uniforms)`);
console.log(`  words    mismatches=${wordMismatches}`);
console.log(`  uniforms mismatches=${uniformMismatches} worstUlp=${worstUniformUlp}`);
console.log(`  largest uniform on device: ${maxUniform} (must be < 1)`);
console.log(`  f32-vs-f64 conversion gap (reported only): ${maxF64Gap.toExponential(3)}`);

const failures = [];
if (wordMismatches > 0) {
  failures.push(
    `${wordMismatches} of ${gpuWords.length} generator words differ; first at replicate ` +
      `${firstWordMismatch.replicate} lane ${firstWordMismatch.lane} ` +
      `(cpu ${firstWordMismatch.cpu}, gpu ${firstWordMismatch.gpu})`,
  );
}
if (uniformMismatches > 0) {
  failures.push(
    `${uniformMismatches} of ${gpuUniforms.length} uniforms differ; first at replicate ` +
      `${firstUniformMismatch.replicate} lane ${firstUniformMismatch.lane} ` +
      `(cpu ${firstUniformMismatch.cpu}, gpu ${firstUniformMismatch.gpu})`,
  );
}
// The half-open range, checked on the device rather than argued from the CPU.
// This is the one defect the exact-equality gate above would NOT catch on its
// own: if both arms converted through the whole word they would agree perfectly
// and both be wrong.
if (!(maxUniform < 1)) {
  failures.push(`a device uniform reached ${maxUniform}, so the range is not half-open`);
}

console.log("");
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(
  `PASS: ${gpuWords.length}/${gpuWords.length} generator words bit-identical, ` +
    `${gpuUniforms.length}/${gpuUniforms.length} uniforms bit-identical (0 ULP), ` +
    `largest uniform ${maxUniform} < 1.`,
);

if (shouldRecord) {
  const record = {
    task: "P7.21",
    criterion: "Philox streams pass statistical tests; replicate determinism by counter",
    criterionReading:
      "This script answers NEITHER clause on its own terms -- both live in " +
      "packages/engine/src/philox.test.ts, which is what the criterion is met by. It answers " +
      "what the word 'in-kernel' puts in the criterion's title and those tests cannot reach: " +
      "whether the generator the shader computes is the generator they measured.",
    provenance:
      "Correctness only. The adapter is recorded below; where it is software, these numbers " +
      "say what a conformant implementation computes and say NOTHING about throughput. That " +
      "is P7.20, which remains hardware-gated.",
    gate:
      "Exact equality, not a ULP budget. The generator is integer arithmetic, exactly " +
      "specified modulo 2^32, so a conformant implementation has no latitude and one " +
      "differing bit is one bug. The uniform conversion is exact by construction too: " +
      "f32(word >> 8u) fits in 24 bits and 2^-24 is a power of two.",
    measuredAt: new Date().toISOString(),
    replicates: REPLICATES,
    key: [`0x${KEY[0].toString(16)}`, `0x${KEY[1].toString(16)}`],
    workgroupSize: WORKGROUP_SIZE,
    kernelLength: run.kernelLength,
    adapterInfo: run.adapterInfo,
    chromiumVersion: run.chromiumVersion,
    flagSet: run.flagSet,
    deviceErrors: run.deviceErrors,
    wordMismatches,
    uniformMismatches,
    worstUniformUlp,
    largestUniform: maxUniform,
    f32VsF64ConversionGap: maxF64Gap,
  };
  writeFileSync(resultsPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Recorded to ${resultsPath}`);
}
