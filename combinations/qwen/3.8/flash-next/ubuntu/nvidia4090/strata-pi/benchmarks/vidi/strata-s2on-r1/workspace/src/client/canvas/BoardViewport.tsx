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
import type * as Y from "yjs";
import {
  DRAG_THRESHOLD_PX,
  GRID_DOT_COLOR,
  GRID_DOT_RADIUS_SCREEN,
  GRID_SPACING_WORLD,
  ORIGIN_MARKER_SIZE_WORLD,
} from "../../shared/config";
import { createSticky } from "../../shared/board-model";
import type { SelectionApi } from "../board/useSelection";
import { screenToWorld, type Camera, type Point } from "./camera";
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
   * Board document. Without one the viewport is the plain story 1 canvas: no
   * double-click creation and no selection to clear.
   */
  doc?: Y.Doc;
  /** Local selection/editing state, cleared by a click on empty board space. */
  selection?: SelectionApi;
}

/** Safari trackpad pinch, which Firefox/Chromium deliver as a Ctrl+wheel. */
interface GestureEventLike extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

export function BoardViewport({ children, doc, selection }: BoardViewportProps) {
  const provided = useContext(CameraApiContext);
  const windowSize = useWindowSize();
  const ownApi = useCamera(windowSize, { testHooks: provided === null });
  const api = provided ?? ownApi;
  const camera = api.camera;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const docRef = useRef(doc);
  docRef.current = doc;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const pressRef = useRef<{ start: Point; empty: boolean; moved: number } | null>(null);
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

  // ---- drag to pan, empty-space click, double-click create --------------
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (!el) return;
    const target = event.target as HTMLElement;
    // Only empty board space pans; board objects stop propagation and handle
    // their own pointer interaction.
    const empty = target === el || target === gridRef.current;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    pressRef.current = {
      start: { x: event.clientX, y: event.clientY },
      empty,
      moved: 0,
    };
    if (!empty) return;

    event.preventDefault();
    el.setPointerCapture?.(event.pointerId);
    panningRef.current = true;
    setPanning(true);
    apiRef.current.beginPan({ x: event.clientX, y: event.clientY });
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (press) {
      press.moved = Math.max(
        press.moved,
        Math.hypot(event.clientX - press.start.x, event.clientY - press.start.y),
      );
    }
    if (!panningRef.current) return;
    apiRef.current.panMove({ x: event.clientX, y: event.clientY });
  };

  const finishPan = () => {
    const press = pressRef.current;
    pressRef.current = null;
    // A press on empty board space that never became a drag clears the selection.
    if (press?.empty && press.moved < DRAG_THRESHOLD_PX) selectionRef.current?.select(null);

    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    apiRef.current.endPan();
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (!el) return;
    const target = event.target as HTMLElement;
    // Only double-clicks on empty board space create a note: a note handles its
    // own double-click as "start editing".
    if (target !== el && target !== gridRef.current) return;

    const boardDoc = docRef.current;
    const boardSelection = selectionRef.current;
    if (!boardDoc || !boardSelection) return;

    const rect = el.getBoundingClientRect();
    const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    // The world point under the pointer becomes the note's centre.
    const world = screenToWorld(apiRef.current.camera, screenPoint);
    const id = createSticky(boardDoc, world);
    if (id === false) return;
    boardSelection.select(id);
    boardSelection.startEdit(id);
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
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
      onLostPointerCapture={finishPan}
      onDoubleClick={handleDoubleClick}
    >
      <div ref={gridRef} className="board-grid" data-testid="board-grid" style={grid} />
      <div
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
