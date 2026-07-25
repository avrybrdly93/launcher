import { render } from "preact";
import { App } from "./app.js";
import { SolverLabRoute } from "./solver-lab-route.js";

/**
 * Minimal hash-based routing (P3.41): the only route beyond the default
 * simulator is `#/solver-lab`, so a full router is unwarranted -- this
 * dispatches on `location.hash` and re-renders on `hashchange`, mirroring
 * the granularity of the rest of `main.tsx`'s bootstrap responsibility.
 */
function renderRoute(root: HTMLElement): void {
  render(window.location.hash === "#/solver-lab" ? <SolverLabRoute /> : <App />, root);
}

const root = document.getElementById("app");
if (root) {
  renderRoute(root);
  window.addEventListener("hashchange", () => renderRoute(root));
}
