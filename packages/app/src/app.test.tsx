import { describe, expect, it } from "vitest";
import { App } from "./app.js";

describe("App", () => {
  it("builds a <main> root vnode without touching the DOM", () => {
    const vnode = App();
    expect(vnode.type).toBe("main");
  });
});
