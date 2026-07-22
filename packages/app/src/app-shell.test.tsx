import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell.js";

describe("AppShell", () => {
  it("composes a <main class=app-shell> root with canvas/dock/drawer regions in a fixed order", () => {
    const vnode = AppShell({
      canvas: "canvas-content",
      controlDock: "dock-content",
      analysisDrawer: "drawer-content",
    });

    expect(vnode.type).toBe("main");
    expect(vnode.props.class).toBe("app-shell");

    const [canvasRegion, dockRegion, drawerRegion] = vnode.props.children;

    expect(canvasRegion.props.class).toBe("app-shell__canvas");
    expect(canvasRegion.props["data-testid"]).toBe("app-shell-canvas");
    expect(canvasRegion.props.children).toBe("canvas-content");

    expect(dockRegion.props.class).toBe("app-shell__dock");
    expect(dockRegion.props["data-testid"]).toBe("app-shell-dock");
    expect(dockRegion.props.children).toBe("dock-content");

    expect(drawerRegion.props.class).toBe("app-shell__drawer");
    expect(drawerRegion.props["data-testid"]).toBe("app-shell-drawer");
    expect(drawerRegion.props.children).toBe("drawer-content");
  });
});
