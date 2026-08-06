import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXHIBIT_IDS, SCENARIO_LIBRARY } from "@ballista/engine";
import { describe, expect, it } from "vitest";
import { EXHIBIT_ROUTE_HASHES, ROUTE_HASHES, exhibitHref } from "./routes.js";

/**
 * The "each note links exhibit" half of P4.36's validation criterion.
 *
 * `main.tsx` cannot be imported here -- it bootstraps the app at module
 * scope (`render`, a `hashchange` listener) -- so its switch is read as
 * source instead. That is the same "assert against the real artifact rather
 * than a copy of it" approach `solver-lab-route.test.tsx` already takes with
 * the derivation markdown, and it is what makes `routes.ts` a mirror that
 * cannot silently drift from the router it describes.
 */
const MAIN_TSX = readFileSync(fileURLToPath(new URL("./main.tsx", import.meta.url)), "utf8");

describe("exhibit routes", () => {
  it("declares a route hash for every exhibit id the scenario library can name", () => {
    for (const exhibit of EXHIBIT_IDS) {
      expect(EXHIBIT_ROUTE_HASHES, exhibit).toHaveProperty(exhibit);
    }
    expect(Object.keys(EXHIBIT_ROUTE_HASHES).sort()).toEqual([...EXHIBIT_IDS].sort());
  });

  it("maps every non-default exhibit to a hash main.tsx actually dispatches on", () => {
    for (const [exhibit, hash] of Object.entries(EXHIBIT_ROUTE_HASHES)) {
      if (hash === "") continue; // the simulator is main.tsx's default branch
      expect(MAIN_TSX, `${exhibit} -> ${hash}`).toContain(`case "${hash}":`);
    }
  });

  it("declares every hash main.tsx dispatches on, so a new route cannot be missed", () => {
    const casesInRouter = [...MAIN_TSX.matchAll(/case "(#\/[^"]+)":/g)].map((m) => m[1]!);
    expect(casesInRouter.length).toBeGreaterThan(0);
    expect([...ROUTE_HASHES].sort()).toEqual([...casesInRouter].sort());
  });

  it("routes the simulator exhibit to the default route", () => {
    expect(EXHIBIT_ROUTE_HASHES.simulator).toBe("");
    expect(exhibitHref("simulator")).toBe("#/");
    // main.tsx's default branch renders <App/>, so an unrecognised hash is
    // the simulator -- which is what makes "" a valid destination.
    expect(MAIN_TSX).toContain("default:");
    expect(MAIN_TSX).toContain("<App />");
  });

  it("gives every curated scenario a resolvable exhibit href", () => {
    expect(SCENARIO_LIBRARY.length).toBeGreaterThan(0);

    for (const entry of SCENARIO_LIBRARY) {
      const href = exhibitHref(entry.exhibit);
      expect(href.startsWith("#/"), `${entry.id} -> ${href}`).toBe(true);

      if (entry.exhibit !== "simulator") {
        expect(ROUTE_HASHES, entry.id).toContain(href);
      }
    }
  });
});
