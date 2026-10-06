import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  DRAG_THRESHOLD_PX,
  GRID_DOT_COLOR,
  GRID_DOT_RADIUS_SCREEN,
  GRID_SPACING_WORLD,
  ORIGIN_MARKER_SIZE_WORLD,
} from "../../shared/config";
import type { MarqueeApi } from "../board/Marquee";
import type { Camera, Point } from "./camera";
import { useCamera, useWindowSize, wheelDeltaToPixels, type CameraApi } from "./useCamera";

/**
 * The camera the board uses. `App` provides it (the zoom controls and the
 * navigation hint are wired to the same instance); a bare `BoardViewport` with
 * no provider manages its own camera.
 */
export const CameraApiContext = createContext<CameraApi | null>(null);

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * A double-click on empty board space, reported as a screen point
   * (story 2 creates a sticky note centred there). A double-click on a board
   * object is handled by that object instead.
   */
  onCreateAtPoint?(point: Point): void;
  /** A press and release on empty board space without dragging. */
  onEmptyClick?(point: Point): void;
  /**
   * The Shift+drag selection rectangle (story 7). When given, pressing Shift on
   * empty board space drags a marquee instead of panning, and the viewport
   * reports the press, the movement and the release to it. A marquee never
   * pans the board and never clears the selection.
   */
  marquee?: MarqueeApi | null;
  /**
   * Screen-space furniture drawn over the board (the selection overlay and the
   * selection bar): children of the viewport, but outside the world layer, so
   * they keep their size at any zoom.
   */
  overlay?: ReactNode;
}

/** Safari trackpad pinch, which Firefox/Chromium deliver as a Ctrl+wheel. */
interface GestureEventLike extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

export function BoardViewport({ children, onCreateAtPoint, onEmptyClick, marquee, overlay }: BoardViewportProps) {
  const provided = useContext(CameraApiContext);
  const windowSize = useWindowSize();
  const ownApi = useCamera(windowSize, { testHooks: provided === null });
  const api = provided ?? ownApi;
  const camera = api.camera;

  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  const marqueeActiveRef = useRef(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  /** A pointer event's position relative to the viewport element. */
  const viewportPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const pressRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const gestureRef = useRef<{ prevScale: number } | null>(null);

  // ---- wheel (non-passive) and Safari pinch gestures -------------------
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      // Always prevent the browser's own page scroll/zoom over the board.
      event.preventDefault();
      apiRef.current.wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: { x: event.clientX, y: event.clientY },
      });
    };

    const gesturePoint = (event: GestureEventLike): Point => {
      const rect = el.getBoundingClientRect();
      const x = finiteNumber(event.clientX, rect.left + rect.width / 2);
      const y = finiteNumber(event.clientY, rect.top + rect.height / 2);
      return { x: x - rect.left, y: y - rect.top };
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      const scale = finiteNumber((event as GestureEventLike).scale, 1);
      gestureRef.current = { prevScale: scale > 0 ? scale : 1 };
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const state = gestureRef.current;
      const scale = finiteNumber((event as GestureEventLike).scale, 1);
      if (!state || scale <= 0) return;
      const factor = scale / state.prevScale;
      state.prevScale = scale;
      if (factor !== 1) apiRef.current.zoomAtPoint(gesturePoint(event as GestureEventLike), factor);
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureRef.current = null;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    el.addEventListener("gestureend", onGestureEnd, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, []);

  // ---- Ctrl/Cmd + = / - / 0 --------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = navShortcut(event);
      if (!action) return;
      // Stops the browser zooming the page instead of the board.
      event.preventDefault();
      if (action === "reset") apiRef.current.reset();
      else apiRef.current.zoomStep(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---- drag to pan ------------------------------------------------------
  /** Empty board space: the viewport itself, the grid or the world layer. */
  const isBoardSpace = (target: HTMLElement | null): boolean => {
    const viewport = viewportRef.current;
    if (!viewport || !target) return false;
    if (target === viewport || target === gridRef.current || target === worldRef.current) return true;
    // Anything else inside the board is board space too (the origin marker, for
    // example), as long as it is not a board object or a control: story 2's
    // notes, note toolbars and text fields handle their own gestures.
    return (
      viewport.contains(target) &&
      target.closest("[data-testid='sticky-note'], [data-testid='note-toolbar'], textarea, button") === null
    );
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (!el) return;
    const target = event.target as HTMLElement;
    // Only empty board space starts a pan; board objects (story 2+) can stop
    // propagation and be dragged instead.
    if (!isBoardSpace(target)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    // Shift + drag on empty board space draws the selection rectangle instead of
    // panning, and clears nothing on release.
    const activeMarquee = marqueeRef.current;
    if (event.shiftKey && activeMarquee) {
      event.preventDefault();
      event.stopPropagation();
      pressRef.current = null;
      marqueeActiveRef.current = true;
      activeMarquee.begin(viewportPoint(event));
      const onMarqueeMove = (moveEvent: PointerEvent) => {
        if (!marqueeActiveRef.current) return;
        activeMarquee.move(viewportPoint(moveEvent));
      };
      const finishMarquee = (kind: "end" | "cancel") => {
        if (!marqueeActiveRef.current) return;
        marqueeActiveRef.current = false;
        window.removeEventListener("pointermove", onMarqueeMove);
        window.removeEventListener("pointerup", onMarqueeUp);
        window.removeEventListener("pointercancel", onMarqueeCancel);
        if (kind === "end") activeMarquee.end();
        else activeMarquee.cancel();
      };
      const onMarqueeUp = () => finishMarquee("end");
      const onMarqueeCancel = () => finishMarquee("cancel");
      window.addEventListener("pointermove", onMarqueeMove);
      window.addEventListener("pointerup", onMarqueeUp);
      window.addEventListener("pointercancel", onMarqueeCancel);
      return;
    }

    event.preventDefault();
    el.setPointerCapture?.(event.pointerId);
    panningRef.current = true;
    setPanning(true);
    pressRef.current = { startX: event.clientX, startY: event.clientY, moved: false };
    apiRef.current.beginPan({ x: event.clientX, y: event.clientY });
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    const press = pressRef.current;
    if (press) {
      const dx = event.clientX - press.startX;
      const dy = event.clientY - press.startY;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) press.moved = true;
    }
    apiRef.current.panMove({ x: event.clientX, y: event.clientY });
  };

  const finishPan = (event: ReactPointerEvent<HTMLDivElement>, allowClick: boolean) => {
    panningRef.current = false;
    setPanning(false);
    apiRef.current.endPan();

    const press = pressRef.current;
    pressRef.current = null;
    // A press and release without movement is a click on empty board space:
    // story 2 uses it to clear the selection.
    if (allowClick && press && !press.moved) {
      onEmptyClick?.({ x: event.clientX, y: event.clientY });
    }
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isBoardSpace(event.target as HTMLElement)) return;
    onCreateAtPoint?.({ x: event.clientX, y: event.clientY });
  };

  const grid = gridStyle(camera);
  const markerHalf = ORIGIN_MARKER_SIZE_WORLD / 2;

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-panning={panning ? "true" : "false"}
      role="application"
      aria-label="Board"
      tabIndex={0}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={(event) => finishPan(event, true)}
      onPointerCancel={(event) => finishPan(event, false)}
      onLostPointerCapture={(event) => finishPan(event, false)}
      onDoubleClick={onDoubleClick}
    >
      <div ref={gridRef} className="board-grid" data-testid="board-grid" style={grid} />
      <div
        ref={worldRef}
        className="board-world"
        data-testid="board-world"
        style={{
          transform: `scale(${round6(camera.zoom)}) translate(${px(-camera.x)}, ${px(-camera.y)})`,
          transformOrigin: "0 0",
        }}
      >
        <div
          className="origin-marker"
          data-testid="origin-marker"
          aria-hidden="true"
          style={{
            left: px(-markerHalf),
            top: px(-markerHalf),
            width: px(ORIGIN_MARKER_SIZE_WORLD),
            height: px(ORIGIN_MARKER_SIZE_WORLD),
          }}
        />
        {children}
      </div>
      {overlay}
    </div>
  );
}

// ---- rendering helpers ----------------------------------------------------

function gridStyle(camera: Camera) {
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const offsetX = positiveMod(-camera.x * camera.zoom, spacing);
  const offsetY = positiveMod(-camera.y * camera.zoom, spacing);
  return {
    backgroundImage: `radial-gradient(circle at 50% 50%, ${GRID_DOT_COLOR} ${GRID_DOT_RADIUS_SCREEN}px, transparent ${GRID_DOT_RADIUS_SCREEN}px)`,
    backgroundSize: `${px(spacing)} ${px(spacing)}`,
    backgroundPosition: `${px(offsetX)} ${px(offsetY)}`,
    backgroundRepeat: "repeat",
  };
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveMod(value: number, modulus: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(modulus) || modulus <= 0) return 0;
  return ((value % modulus) + modulus) % modulus;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function px(value: number): string {
  return `${round6(value).toFixed(6)}px`;
}

/** Ctrl/Cmd + = (zoom in), Ctrl/Cmd + - (zoom out), Ctrl/Cmd + 0 (reset). */
function navShortcut(event: KeyboardEvent): "in" | "out" | "reset" | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  if (isEditableTarget(event.target)) return null;

  const { key, code } = event;
  if (key === "=" || key === "+" || code === "Equal" || code === "NumpadAdd") return "in";
  if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") return "out";
  if (key === "0" || code === "Digit0" || code === "Numpad0") return "reset";
  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
