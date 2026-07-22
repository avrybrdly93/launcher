import { bootstrapCanvas } from "@ballista/viz";
import { useEffect, useRef } from "preact/hooks";
import "./canvas-viewport.css";

/**
 * Mounts the world-rendering `<canvas>` (§6.1 Scene/WorldLayer host) and
 * wires it up for DPR-aware sizing (P3.05): bootstrapped once on mount,
 * kept in sync with its own CSS box via `ResizeObserver`, disposed on
 * unmount. Nothing is drawn onto it yet -- that starts with TerrainLayer/
 * TrajectoryLayer in later Phase 3 tasks.
 */
export function CanvasViewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bootstrap = bootstrapCanvas(canvas);
    return () => bootstrap.dispose();
  }, []);

  return <canvas class="canvas-viewport" ref={canvasRef} data-testid="world-canvas" />;
}
