import { describe, expect, it } from "vitest";
import { App } from "./app.js";
import { AppShell } from "./app-shell.js";

describe("App", () => {
  it("renders the AppShell (canvas/dock/drawer layout: see app-shell.test.tsx) without touching the DOM", () => {
    const vnode = App();
    expect(vnode.type).toBe(AppShell);
  });
});
