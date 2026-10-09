/**
 * The board viewport: full-window input surface with the dot grid background
 * (attached to the board, moving with pan and zoom) and the world layer
 * (CSS-transformed container for world-coordinate content; the origin marker
 * sits at world 0,0).
 *
 * Input:
 *  - Pointer drag on empty board space pans the board (pointer capture; the
 *    drag ends on pointerup, pointercancel or lost capture, leaving the board
 *    where it was).
 *  - Wheel (non-passive listener, always preventDefault so the page never
 *    scrolls or zooms): plain wheel pans, Ctrl/Cmd wheel zooms around the
 *    pointer.
 *  - Safari gesturestart/gesturechange: preventDefault, zoom by the scale
 *    ratio around the pointer.
 *  - Window keydown: Ctrl/Cmd + = / - / 0 zoom one step or reset.
 */
import type {
  ReactNode,
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useEffect, useRef } from "react";
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from "../../shared/config";
import { screenToWorld, type Point } from "./camera";
import { useCameraContext } from "./useCamera";

/** Wheel deltaMode constants (DOM spec values). */
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;
/** Pixels per line when the browser reports deltaMode LINE. */
const WHEEL_LINE_DELTA_PIXELS = 16;
/** Pixels per page when the browser reports deltaMode PAGE. */
const WHEEL_PAGE_DELTA_PIXELS = 100;

/** Positive remainder for the grid background offset. */
function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

interface GestureEventLike {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

export function BoardViewport(props: {
  children?: ReactNode;
  /** Double-click on empty board space; receives the world point of the click. */
  onCreateAt?: (world: Point) => void;
  /** A short click (no movement) on empty board space. */
  onEmptyClick?: () => void;
}) {
  const api = useCameraContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const { camera, panning } = api;
  const { x, y, zoom } = camera;

  const gridSpacing = GRID_SPACING_WORLD * zoom;

  /** Screen point (viewport-local) of the last empty-space pointerdown. */
  const clickStartRef = useRef<Point | null>(null);

  // Pointer drag to pan. Only empty board space starts a drag so later
  // object stories can stopPropagation from their own elements.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== rootRef.current) return;
    if (event.button !== 0) return;
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    clickStartRef.current = point;
    api.beginPan(point);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!api.panning) return;
    const rect = event.currentTarget.getBoundingClientRect();
    api.panMove({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = clickStartRef.current;
    clickStartRef.current = null;
    api.endPan();
    // A press on empty space that barely moved was a click: clear selection.
    if (start !== null && event.button === 0) {
      const rect = event.currentTarget.getBoundingClientRect();
      const dx = event.clientX - rect.left - start.x;
      const dy = event.clientY - rect.top - start.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        props.onEmptyClick?.();
      }
    }
  };

  const endPan = () => {
    clickStartRef.current = null;
    api.endPan();
  };

  // Double-click on empty board space creates a note centred at the click.
  // A double-click on an object is stopped by that object's own handler.
  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== rootRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    props.onCreateAt?.(screenToWorld(camera, point));
  };

  // Wheel: non-passive so preventDefault can stop page scroll and page zoom.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      let { deltaX, deltaY } = event;
      if (event.deltaMode === WHEEL_DELTA_LINE) {
        deltaX *= WHEEL_LINE_DELTA_PIXELS;
        deltaY *= WHEEL_LINE_DELTA_PIXELS;
      } else if (event.deltaMode === WHEEL_DELTA_PAGE) {
        deltaX *= WHEEL_PAGE_DELTA_PIXELS;
        deltaY *= WHEEL_PAGE_DELTA_PIXELS;
      }
      const rect = el.getBoundingClientRect();
      api.wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [api.wheel]);

  // Safari pinch (gesture events are not standard; other browsers never fire
  // them, so this is a no-op there).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let lastScale = 1;
    const onStart = (event: Event) => {
      event.preventDefault();
      lastScale = (event as GestureEventLike).scale ?? 1;
    };
    const onChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEventLike;
      const scale = gesture.scale ?? 1;
      if (!Number.isFinite(scale) || scale <= 0 || lastScale <= 0) return;
      const ratio = scale / lastScale;
      lastScale = scale;
      const rect = el.getBoundingClientRect();
      api.gestureZoom(
        { x: (gesture.clientX ?? 0) - rect.left, y: (gesture.clientY ?? 0) - rect.top },
        ratio,
      );
    };
    const onEnd = (event: Event) => {
      event.preventDefault();
      lastScale = 1;
    };
    el.addEventListener("gesturestart", onStart);
    el.addEventListener("gesturechange", onChange);
    el.addEventListener("gestureend", onEnd);
    return () => {
      el.removeEventListener("gesturestart", onStart);
      el.removeEventListener("gesturechange", onChange);
      el.removeEventListener("gestureend", onEnd);
    };
  }, [api.gestureZoom]);

  // Keyboard shortcuts: Ctrl/Cmd + = / - / 0. preventDefault stops the
  // browser's own page zoom on these combinations.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        api.zoomStep("in");
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        api.zoomStep("out");
      } else if (event.key === "0") {
        event.preventDefault();
        api.reset();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api.zoomStep, api.reset]);

  return (
    <div
      ref={rootRef}
      data-testid="board-viewport"
      data-mode={panning ? "panning" : "idle"}
      className="board-viewport"
      style={{
        backgroundImage: "radial-gradient(circle, #c8c8c2 1px, transparent 1.5px)",
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${mod(-x * zoom, gridSpacing)}px ${mod(
          -y * zoom,
          gridSpacing,
        )}px`,
        cursor: panning ? "grabbing" : "grab",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endPan}
      onLostPointerCapture={endPan}
      onDoubleClick={onDoubleClick}
    >
      <div
        data-testid="board-world"
        className="board-world"
        style={{
          transform: `scale(${zoom}) translate(${-x}px, ${-y}px)`,
          transformOrigin: "0 0",
        }}
      >
        {/* Origin marker at world (0,0): a stable pixel target for tests. */}
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {props.children}
      </div>
    </div>
  );
}
