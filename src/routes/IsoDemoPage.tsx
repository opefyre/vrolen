/**
 * /iso-demo — sandbox route for the PixiJS isometric renderer (VROL-852).
 *
 * Mounts <IsoCanvas /> at full page size, ships a hardcoded demo scene
 * (7 stations + 6 edges) so we can verify the renderer is alive end-to-end
 * before VROL-195 (sprite atlas) builds on top.
 *
 * Includes:
 *   • Dev-only FPS overlay (1 Hz from the worker)
 *   • Ready-state pill (animates while the worker is initialising)
 *   • Camera controls (pan via drag, zoom via wheel) so VROL-217 has a
 *     concrete starting point.
 *   • Capability-fallback message inherited from <IsoCanvas /> when
 *     OffscreenCanvas isn't available.
 */

import { Loader2, MousePointer2, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IsoCanvas, type IsoCanvasHandle } from "@/render/iso-canvas";
import type { RenderEdge, RenderStation } from "@/render/protocol";

const DEMO_STATIONS: readonly RenderStation[] = [
  { id: "input", x: 0, y: 0, z: 0, label: "Input", state: "running", isBottleneck: false },
  { id: "filler-a", x: 2, y: -1, z: 0, label: "Filler A", state: "running", isBottleneck: false },
  { id: "filler-b", x: 2, y: 1, z: 0, label: "Filler B", state: "running", isBottleneck: false },
  { id: "capper", x: 4, y: 0, z: 0, label: "Capper", state: "blocked", isBottleneck: true },
  { id: "qc", x: 6, y: 0, z: 0, label: "QC", state: "starved", isBottleneck: false },
  { id: "labeler", x: 8, y: 0, z: 0, label: "Labeler", state: "starved", isBottleneck: false },
  { id: "packer", x: 10, y: 0, z: 0, label: "Packer", state: "starved", isBottleneck: false },
];

const DEMO_EDGES: readonly RenderEdge[] = [
  { id: "e-input-filler-a", sourceId: "input", targetId: "filler-a", flowRate: 0.01 },
  { id: "e-input-filler-b", sourceId: "input", targetId: "filler-b", flowRate: 0.01 },
  { id: "e-filler-a-capper", sourceId: "filler-a", targetId: "capper", flowRate: 0.01 },
  { id: "e-filler-b-capper", sourceId: "filler-b", targetId: "capper", flowRate: 0.01 },
  { id: "e-capper-qc", sourceId: "capper", targetId: "qc", flowRate: 0.008 },
  { id: "e-qc-labeler", sourceId: "qc", targetId: "labeler", flowRate: 0.008 },
  { id: "e-labeler-packer", sourceId: "labeler", targetId: "packer", flowRate: 0.008 },
];

export default function IsoDemoPage() {
  const canvasRef = useRef<IsoCanvasHandle>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState<boolean>(false);
  const [pixiVersion, setPixiVersion] = useState<string>("");
  const [fps, setFps] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });

  // Centre the demo scene on first ready event so the user lands on
  // something instead of an empty canvas with the action far off-screen.
  useEffect(() => {
    if (!ready) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const initialCam = { x: rect.width / 2 - 200, y: rect.height / 2, zoom: 1 };
    cameraRef.current = initialCam;
    canvasRef.current?.setScene(DEMO_STATIONS, DEMO_EDGES);
    canvasRef.current?.setCamera(initialCam);
  }, [ready]);

  // Pan via left-drag, zoom via wheel. These are placeholder controls so
  // VROL-217 (real camera implementation) has a concrete starting point.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !ready) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      wrapper.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const cam = cameraRef.current;
      const next = { x: cam.x + dx, y: cam.y + dy, zoom: cam.zoom };
      cameraRef.current = next;
      canvasRef.current?.setCamera(next);
    };
    const onUp = (e: PointerEvent): void => {
      dragging = false;
      try {
        wrapper.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer may already be released */
      }
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const cam = cameraRef.current;
      // VROL-1237 — mirror the IsoPlaybackView smoothing: scale by
      // deltaY magnitude (deltaMode-normalised) with an exp() curve
      // so trackpad micro-scrolls step small and mouse-wheel clicks
      // still move noticeably. Fixed 1.1 factor felt jumpy.
      const deltaPx =
        e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      const clampedDelta = Math.max(-120, Math.min(120, deltaPx));
      const factor = Math.exp(-clampedDelta * 0.0025);
      const zoom = Math.max(0.25, Math.min(4, cam.zoom * factor));
      // Zoom around the cursor: translate so the world point under the
      // cursor stays under the cursor.
      const rect = wrapper.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const wx = (px - cam.x) / cam.zoom;
      const wy = (py - cam.y) / cam.zoom;
      const next = { x: px - wx * zoom, y: py - wy * zoom, zoom };
      cameraRef.current = next;
      canvasRef.current?.setCamera(next);
    };
    wrapper.addEventListener("pointerdown", onDown);
    wrapper.addEventListener("pointermove", onMove);
    wrapper.addEventListener("pointerup", onUp);
    wrapper.addEventListener("pointercancel", onUp);
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      wrapper.removeEventListener("pointerdown", onDown);
      wrapper.removeEventListener("pointermove", onMove);
      wrapper.removeEventListener("pointerup", onUp);
      wrapper.removeEventListener("pointercancel", onUp);
      wrapper.removeEventListener("wheel", onWheel);
    };
  }, [ready]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-3 p-6">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Iso view sandbox</h1>
          <p className="text-muted-foreground text-sm">
            The isometric renderer running on a canned scenario. Drag to pan, scroll to zoom.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {error ? (
            <span className="bg-sim-down/10 text-sim-down border-sim-down/30 rounded-full border px-2 py-0.5">
              {error}
            </span>
          ) : ready ? (
            <span className="bg-sim-running/10 text-sim-running border-sim-running/30 rounded-full border px-2 py-0.5">
              ready · pixi v{pixiVersion}
            </span>
          ) : (
            <span className="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2 py-0.5">
              <Loader2 className="h-3 w-3 animate-spin" /> booting
            </span>
          )}
          <span className="bg-card border-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono">
            <Zap className="text-sim-running h-3 w-3" /> {fps} fps
          </span>
          <span className="text-muted-foreground inline-flex items-center gap-1">
            <MousePointer2 className="h-3 w-3" /> drag · wheel
          </span>
        </div>
      </header>
      <div
        ref={wrapperRef}
        className="border-border bg-background flex-1 overflow-hidden rounded-md border"
        style={{ touchAction: "none" }}
      >
        <IsoCanvas
          ref={canvasRef}
          className="h-full w-full"
          onReady={(info) => {
            setPixiVersion(info.pixiVersion);
            setReady(true);
          }}
          onFps={(value) => setFps(value)}
          onError={(info) => setError(`${info.stage}: ${info.message}`)}
        />
      </div>
    </div>
  );
}
