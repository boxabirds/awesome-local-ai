// The board's input surface: dot grid, world layer, and every navigation gesture
// (pointer drag, wheel/trackpad scroll, Safari pinch gesture, keyboard shortcuts).
// See design.md "Viewport input and rendering".
import type {
  CSSProperties,
  JSX,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useEffect, useRef, useState } from "react";

import {
  GRID_DOT_COLOR,
  GRID_DOT_RADIUS_PX,
  GRID_SPACING_WORLD,
  WHEEL_DELTA_MODE_LINE,
  WHEEL_DELTA_MODE_PAGE,
  WHEEL_LINE_PX,
  WHEEL_PAGE_PX,
} from "../../shared/config";
import { BoardCameraContext, BoardOverlay } from "./BoardOverlay";
import type { Camera, Point, Size } from "./camera";
import { installTestHooks, uninstallTestHooks } from "./testHooks";
import { useCamera, type CameraApi } from "./useCamera";

const ZERO_SIZE: Size = { width: 0, height: 0 };

/** Safari's pinch gestures are not in the DOM spec, so type them locally. */
interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

/** `deltaMode` LINE/PAGE deltas count lines and pages, not pixels. */
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (deltaMode === WHEEL_DELTA_MODE_LINE) return delta * WHEEL_LINE_PX;
  if (deltaMode === WHEEL_DELTA_MODE_PAGE) return delta * WHEEL_PAGE_PX;
  return delta;
}

/** Non-negative remainder, so a CSS background position never goes negative. */
export function mod(value: number, period: number): number {
  if (!(period > 0)) return 0;
  return ((value % period) + period) % period;
}

/** The CSS that makes the dot grid look attached to the board at this camera. */
export function gridBackgroundStyle(camera: Camera): CSSProperties {
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  return {
    backgroundImage: `radial-gradient(circle at center, ${GRID_DOT_COLOR} 0 ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    // Dots ride with the board: shift the tiled pattern by the camera offset.
    backgroundPosition: `${mod(-camera.x * camera.zoom, spacing)}px ${mod(
      -camera.y * camera.zoom,
      spacing,
    )}px`,
  };
}

export interface BoardViewportProps {
  children?: ReactNode;
}

export function BoardViewport(props: BoardViewportProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>(ZERO_SIZE);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);

  const api = useCamera(viewport);
  // The DOM listeners below are attached once; reading the newest api through a
  // ref keeps them out of stale closures without re-binding on every render.
  const apiRef = useRef<CameraApi>(api);
  apiRef.current = api;

  /** Pointer coordinates relative to the board area, in CSS pixels. */
  const localPoint = (clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  // ---- Measure the board area -------------------------------------------------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---- Pointer drag: pan by dragging ------------------------------------------

  /** Only empty board space starts a pan, so later stories' objects own their drags. */
  const isBoardSurface = (target: EventTarget | null): boolean => {
    const el = rootRef.current;
    if (!el || !(target instanceof Element)) return false;
    return target === el || target.getAttribute("data-board-part") === "grid";
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!isBoardSurface(event.target)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const el = rootRef.current;
    if (!el) return;
    panningRef.current = true;
    setPanning(true);
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // A browser that refuses capture still delivers pointerup to the board.
    }
    apiRef.current.beginPan(localPoint(event.clientX, event.clientY));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!panningRef.current) return;
    apiRef.current.panMove(localPoint(event.clientX, event.clientY));
  };

  // pointerup, pointercancel and lostpointercapture all end the drag; the board
  // stays where it was at the moment of interruption.
  const onPointerEnd = (): void => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    apiRef.current.endPan();
  };

  // ---- Wheel: scroll pans, Ctrl/Cmd + wheel zooms, always board-owned ----------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // React's onWheel is passive and cannot preventDefault, which is needed so a
    // pinch never zooms the web page; attach natively instead.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      apiRef.current.wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- Safari trackpad pinch: gesturestart / gesturechange / gestureend -------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let previousScale = 1;
    const gesturePoint = (event: GestureEventLike): Point => {
      const rect = el.getBoundingClientRect();
      return {
        x: (event.clientX ?? rect.left + rect.width / 2) - rect.left,
        y: (event.clientY ?? rect.top + rect.height / 2) - rect.top,
      };
    };
    const onStart = (event: Event): void => {
      event.preventDefault();
      previousScale = (event as GestureEventLike).scale ?? 1;
    };
    const onChange = (event: Event): void => {
      // Board-owned gesture: never let the page zoom.
      event.preventDefault();
      const gesture = event as GestureEventLike;
      const scale = gesture.scale ?? 1;
      if (!Number.isFinite(scale) || scale <= 0 || previousScale <= 0) return;
      apiRef.current.zoomAtPoint(gesturePoint(gesture), scale / previousScale);
      previousScale = scale;
    };
    const onEnd = (event: Event): void => {
      event.preventDefault();
      previousScale = 1;
    };
    const options: AddEventListenerOptions = { passive: false };
    // Safari-only, non-standard events: absent everywhere else, harmless here.
    el.addEventListener("gesturestart", onStart, options);
    el.addEventListener("gesturechange", onChange, options);
    el.addEventListener("gestureend", onEnd, options);
    return () => {
      el.removeEventListener("gesturestart", onStart);
      el.removeEventListener("gesturechange", onChange);
      el.removeEventListener("gestureend", onEnd);
    };
  }, []);

  // ---- Keyboard shortcuts: Ctrl/Cmd + = , - , 0 -------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const { key, code } = event;
      if (
        key === "=" ||
        key === "+" ||
        code === "Equal" ||
        code === "NumpadAdd"
      ) {
        event.preventDefault(); // stop the browser zooming the page
        apiRef.current.zoomStep("in");
        return;
      }
      if (
        key === "-" ||
        key === "_" ||
        code === "Minus" ||
        code === "NumpadSubtract"
      ) {
        event.preventDefault();
        apiRef.current.zoomStep("out");
        return;
      }
      if (key === "0" || code === "Digit0" || code === "Numpad0") {
        event.preventDefault();
        apiRef.current.reset();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---- Test-only hook (window.__vidi6), stripped from production builds -------
  useEffect(() => {
    installTestHooks({
      setCamera: (cam: Camera) => apiRef.current.setCamera(cam),
      getCamera: () => apiRef.current.camera,
    });
    return uninstallTestHooks;
  }, []);

  // ---- Rendering --------------------------------------------------------------
  const { camera } = api;
  return (
    <BoardCameraContext.Provider value={api}>
      <div
        ref={rootRef}
        className="vidi6-viewport"
        data-board-part="viewport"
        data-testid="board-viewport"
        data-pan-state={panning ? "panning" : "idle"}
        data-camera-x={camera.x}
        data-camera-y={camera.y}
        data-camera-zoom={camera.zoom}
        style={gridBackgroundStyle(camera)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
      >
        <div data-board-part="grid" className="vidi6-grid" aria-hidden="true" />
        <div
          className="vidi6-world"
          data-board-part="world"
          data-testid="world-layer"
          data-camera-x={camera.x}
          data-camera-y={camera.y}
          data-camera-zoom={camera.zoom}
          style={{
            transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          }}
        >
          <div
            className="vidi6-origin-marker"
            data-board-part="origin"
            data-testid="origin-marker"
          />
          {props.children}
        </div>
      </div>
      <BoardOverlay />
    </BoardCameraContext.Provider>
  );
}
