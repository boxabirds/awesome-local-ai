import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Size, canZoomIn, canZoomOut, zoomPercent } from "./camera";
import { useCamera, type CameraApi } from "./useCamera";
import { ZoomControls } from "./ZoomControls";
import { NavigationHint } from "./NavigationHint";
import { GRID_SPACING_WORLD } from "@shared/config";
import { registerTestHook } from "./testHooks";

/**
 * Full-window board. Owns camera state via {@link useCamera}; translates raw DOM
 * input (pointer drag, non-passive wheel, Safari gesture, keyboard) into camera
 * updates. The interactive *surface* carries the wheel/gesture listeners; the zoom
 * controls and hint are rendered as siblings so a wheel over the controls never
 * bubbles into the board's zoom handler (TC-30).
 */
export function BoardViewport({ children }: { children?: React.ReactNode }) {
  const viewportRef = useRef<Size>({ width: 1280, height: 800 });
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const panningRef = useRef(false);
  const apiRef = useRef<CameraApi | null>(null);
  const [, forceRender] = useState(0);

  const api = useCamera(viewportRef);
  apiRef.current = api;
  const cam = api.camera;

  const relPoint = useCallback((clientX: number, clientY: number) => {
    const el = surfaceRef.current;
    if (!el) return { x: clientX, y: clientY };
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

  const isPannableTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return el.dataset.vidiSurface === "" || el.dataset.vidiGrid === "";
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Primary button only; jsdom leaves .button undefined for synthetic pointer events.
      if (e.button !== undefined && e.button !== 0) return;
      if (!isPannableTarget(e.target)) return;
      const el = surfaceRef.current;
      panningRef.current = true;
      try {
        el?.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom may not implement pointer capture */
      }
      apiRef.current?.beginPan(relPoint(e.clientX, e.clientY));
      forceRender((n) => n + 1);
    },
    [relPoint],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!panningRef.current) return;
      apiRef.current?.panMove(relPoint(e.clientX, e.clientY));
    },
    [relPoint],
  );

  const endPan = useCallback(() => {
    if (!panningRef.current) return;
    panningRef.current = false;
    apiRef.current?.endPan();
    forceRender((n) => n + 1);
  }, []);

  // Non-passive wheel listener (React onWheel is passive and cannot suppress page zoom).
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault(); // stops page scroll; with a modifier, stops page zoom
      apiRef.current?.wheel({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: relPoint(e.clientX, e.clientY),
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [relPoint]);

  // Safari gesture events.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const start = (e: Event) => e.preventDefault();
    const change = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number };
      const scale = typeof ge.scale === "number" ? ge.scale : 1;
      const x = typeof ge.clientX === "number" ? ge.clientX : 0;
      const y = typeof ge.clientY === "number" ? ge.clientY : 0;
      apiRef.current?.gesture(scale, relPoint(x, y));
    };
    el.addEventListener("gesturestart", start as EventListener);
    el.addEventListener("gesturechange", change as EventListener);
    return () => {
      el.removeEventListener("gesturestart", start as EventListener);
      el.removeEventListener("gesturechange", change as EventListener);
    };
  }, [relPoint]);

  // Keyboard shortcuts on window (board owned; page zoom suppressed via preventDefault).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        apiRef.current?.zoomStep("in");
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        apiRef.current?.zoomStep("out");
      } else if (e.key === "0") {
        e.preventDefault();
        apiRef.current?.reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ResizeObserver: keep viewport size fresh; camera x, y, zoom unchanged on resize.
  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return; // jsdom reports 0x0
      viewportRef.current = { width: r.width, height: r.height };
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => forceRender((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Test hook (test builds only; excluded from the production build).
  useEffect(() => {
    if (import.meta.env.MODE === "production") return;
    return registerTestHook(apiRef, surfaceRef, viewportRef);
  }, []);

  const spacingPx = GRID_SPACING_WORLD * cam.zoom;
  const gridStyle: React.CSSProperties = {
    backgroundImage: "radial-gradient(circle, var(--grid-dot) 1px, transparent 1.6px)",
    backgroundSize: `${spacingPx}px ${spacingPx}px`,
    backgroundPosition: `${-cam.x * cam.zoom}px ${-cam.y * cam.zoom}px`,
  };
  const worldTransform = `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;

  return (
    <div data-testid="board-root" style={{ position: "fixed", inset: 0 }}>
      <div
        ref={surfaceRef}
        data-vidi-surface=""
        data-testid="board-surface"
        data-mode={panningRef.current ? "panning" : "idle"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          background: "var(--board-bg)",
          cursor: panningRef.current ? "grabbing" : "grab",
          touchAction: "none",
          ...gridStyle,
        }}
      >
        <div data-vidi-grid="" data-testid="board-grid" style={{ position: "absolute", inset: 0, ...gridStyle }} />
        <div
          data-testid="world-layer"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            transformOrigin: "0 0",
            transform: worldTransform,
          }}
        >
          <div
            data-testid="origin-marker"
            data-role="origin"
            style={{ position: "absolute", top: -8, left: -8, width: 16, height: 16, pointerEvents: "none" }}
          >
            <div style={{ position: "absolute", top: 7, left: 0, width: 16, height: 2, background: "red" }} />
            <div style={{ position: "absolute", top: 0, left: 7, width: 2, height: 16, background: "red" }} />
          </div>
          {children}
        </div>
      </div>

      <ZoomControls
        zoomPercent={zoomPercent(cam)}
        canZoomIn={canZoomIn(cam)}
        canZoomOut={canZoomOut(cam)}
        onZoomIn={() => api.zoomStep("in")}
        onZoomOut={() => api.zoomStep("out")}
        onReset={() => api.reset()}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </div>
  );
}
