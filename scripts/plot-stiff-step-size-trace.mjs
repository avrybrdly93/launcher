// Stiff-scenario step-size telemetry artifact (P2.46).
//
// Runs the dust-grain preset (P1.36 -- physically stiff: Stokes drag
// relaxation time orders of magnitude shorter than the flight, blueprint
// §3.8) through the adaptive DOPRI5 stepper with a StepSizeRecorder (P2.46)
// attached, and renders the resulting h(t) trace as a checked-in SVG line
// plot: the "plotted artifact" the validation criterion calls for, ahead of
// P3.29's PlotPane doing the equivalent rendering inside the app itself.
// The quantitative version of the same claim ("h(t) collapses while speed
// is still high, then relaxes") is asserted as a real, deterministic test
// in packages/validation/src/stiff-step-size-collapse.test.ts -- this
// script only produces the visual companion artifact, it does not gate CI.
//
// Both axes are log-scaled: t spans nothing-to-1s with almost all of the
// interesting behavior in the first few percent, and h spans roughly one
// and a half decades -- a linear plot would flatten both into a single
// vertical/horizontal smear.
//
// Requires packages/{engine,solverkit}/dist to already be built (`pnpm
// typecheck`, already a prior CI step), same precondition as P2.43/P2.45's
// scripts.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dirname, "..");
const outPath = join(rootDir, "scripts", "stiff-step-size-trace.svg");

const {
  GravityForce,
  LinearDragForce,
  PRESET_SCENARIOS,
  createEvalContext,
  createPlanarProjectileModel,
  environmentSpecToEnvironment,
  projectileSpecToParams,
} = await import(join(rootDir, "packages", "engine", "dist", "index.js"));
const { StepSizeRecorder, createDormandPrince54Stepper, integrate } = await import(
  join(rootDir, "packages", "solverkit", "dist", "index.js")
);

const dustGrain = PRESET_SCENARIOS.find((s) => s.projectile.id === "dust-grain");
if (!dustGrain) {
  console.error("expected the dust-grain preset (P1.36) in PRESET_SCENARIOS");
  process.exit(1);
}

function forceById(id) {
  if (id === "gravity") return new GravityForce();
  if (id === "drag-linear") return new LinearDragForce();
  throw new Error(`Unknown force id in fixture: ${id}`);
}

const forces = dustGrain.model.forceIds.map(forceById);
const model = createPlanarProjectileModel(forces);
const env = environmentSpecToEnvironment(dustGrain.environment);
const params = projectileSpecToParams(dustGrain.projectile);
const ctx = createEvalContext(env, params);
const ic = dustGrain.initialConditions;
const y0 = new Float64Array([ic.x0, ic.y0, ic.vx0, ic.vy0]);

const stepSizes = new StepSizeRecorder();
const stepper = createDormandPrince54Stepper();
const cfg = {
  stepper: "dopri5",
  maxSteps: dustGrain.solver.maxSteps,
  rtol: dustGrain.solver.rtol,
  atol: dustGrain.solver.atol,
  controller: dustGrain.solver.controller,
};
const report = integrate(model, ctx, y0, [0, 1], cfg, stepper, [stepSizes]);
if (report.status !== "ok") {
  console.error(`dust-grain integration did not complete: status=${report.status}`);
  process.exit(1);
}

const t = Array.from(stepSizes.trace.t);
const h = Array.from(stepSizes.trace.h);

const WIDTH = 900;
const HEIGHT = 420;
const MARGIN = { top: 40, right: 30, bottom: 56, left: 76 };
const plotW = WIDTH - MARGIN.left - MARGIN.right;
const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

// t[0] > 0 always (it's the time *after* the first accepted step), so log10 is safe.
const logT = t.map((v) => Math.log10(v));
const logH = h.map((v) => Math.log10(v));
const tMin = Math.min(...logT);
const tMax = Math.max(...logT);
const hMin = Math.min(...logH);
const hMax = Math.max(...logH);

function x(logTVal) {
  return MARGIN.left + ((logTVal - tMin) / (tMax - tMin)) * plotW;
}
function y(logHVal) {
  return MARGIN.top + (1 - (logHVal - hMin) / (hMax - hMin)) * plotH;
}

const points = logT.map((lt, i) => `${x(lt).toFixed(2)},${y(logH[i]).toFixed(2)}`).join(" ");

const minHIdx = h.indexOf(Math.min(...h));
const markerX = x(logT[minHIdx]);
const markerY = y(logH[minHIdx]);

function tickLabel(decade) {
  const v = 10 ** decade;
  return v >= 1 ? v.toFixed(0) : v.toExponential(0);
}

function decadeTicks(min, max) {
  const ticks = [];
  for (let d = Math.floor(min); d <= Math.ceil(max); d++) ticks.push(d);
  return ticks;
}

const tTicks = decadeTicks(tMin, tMax)
  .map(
    (d) =>
      `<line x1="${x(d).toFixed(2)}" y1="${MARGIN.top}" x2="${x(d).toFixed(2)}" y2="${MARGIN.top + plotH}" stroke="#e2e2e2" stroke-width="1"/>` +
      `<text x="${x(d).toFixed(2)}" y="${MARGIN.top + plotH + 20}" font-size="12" text-anchor="middle" fill="#333">1e${d}</text>`,
  )
  .join("\n  ");

const hTicks = decadeTicks(hMin, hMax)
  .map(
    (d) =>
      `<line x1="${MARGIN.left}" y1="${y(d).toFixed(2)}" x2="${MARGIN.left + plotW}" y2="${y(d).toFixed(2)}" stroke="#e2e2e2" stroke-width="1"/>` +
      `<text x="${MARGIN.left - 10}" y="${(y(d) + 4).toFixed(2)}" font-size="12" text-anchor="end" fill="#333">${tickLabel(d)}</text>`,
  )
  .join("\n  ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="sans-serif">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="white"/>
  <text x="${WIDTH / 2}" y="22" font-size="16" text-anchor="middle" fill="#111">Dust-grain preset (P1.36): adaptive step size h(t), log-log (P2.46)</text>
  ${tTicks}
  ${hTicks}
  <rect x="${MARGIN.left}" y="${MARGIN.top}" width="${plotW}" height="${plotH}" fill="none" stroke="#333" stroke-width="1"/>
  <polyline points="${points}" fill="none" stroke="#2166ac" stroke-width="1.5"/>
  <circle cx="${markerX.toFixed(2)}" cy="${markerY.toFixed(2)}" r="4" fill="#b2182b"/>
  <text x="${(markerX + 10).toFixed(2)}" y="${(markerY - 8).toFixed(2)}" font-size="12" text-anchor="start" fill="#b2182b">min h (still near launch speed)</text>
  <text x="${WIDTH / 2}" y="${HEIGHT - 12}" font-size="13" text-anchor="middle" fill="#111">t (s)</text>
  <text x="18" y="${HEIGHT / 2}" font-size="13" text-anchor="middle" fill="#111" transform="rotate(-90 18 ${HEIGHT / 2})">h (s)</text>
</svg>
`;

writeFileSync(outPath, svg);
console.log(`Wrote ${outPath}`);
console.log(
  `nSteps=${h.length}, h min=${Math.min(...h).toExponential(3)} at t=${t[minHIdx].toExponential(3)}, ` +
    `h max=${Math.max(...h).toExponential(3)}, collapse ratio (max/min)=${(Math.max(...h) / Math.min(...h)).toFixed(1)}x`,
);
