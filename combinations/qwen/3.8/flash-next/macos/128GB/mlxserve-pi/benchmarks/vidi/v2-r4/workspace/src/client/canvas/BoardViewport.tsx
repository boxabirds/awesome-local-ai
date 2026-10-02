import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';

import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import type { Camera, Point } from './camera';
import type { CameraControls } from './useCamera';

/** Screen pixels for one "line" wheel delta (WheelEvent.DOM_DELTA_LINE). */
const DELTA_LINE_TO_PIXELS = 16;
/** Screen pixels for one "page" wheel delta (WheelEvent.DOM_DELTA_PAGE). */
const DELTA_PAGE_TO_PIXELS = 100;
/** Radius of a dot-grid dot in screen pixels. */
const GRID_DOT_RADIUS_PX = 1;
/** Size of the origin crosshair in screen pixels (kept constant at any zoom). */
const ORIGIN_MARKER_PX = 20;

/** Positive remainder, so a background offset always lands inside one tile. */
function wrap(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  return element.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

export interface BoardViewportProps {
  /** The camera to render. Input is reported through `controls`. */
  camera: Camera;
  controls: CameraControls;
  /** Ref to the board area element (used to measure it). */
  rootRef?: Ref<HTMLDivElement>;
  /** Board objects (story 2 onwards) render here, in world coordinates. */
  children?: ReactNode;
  /**
   * Called with the viewport coordinate when a double-click on board space has
   * nothing under it. Optional: with no handler the viewport behaves exactly as
   * the camera tests created it (`sticky.create_dbclick`).
   */
  onEmptyDoubleClick?: (screenPoint: Point) => void;
  /**
   * Called with the viewport coordinate of a primary-button press on board
   * space, before any panning starts. The board uses it to drop the selection,
   * so clicking empty space never leaves a board object selected.
   */
  onEmptyPointerDown?: (screenPoint: Point) => void;
}

/**
 * The input surface and rendering of the infinite board: a full-window area
 * with a dot grid background that pans and zooms with the camera, a world layer
 * positioned with a CSS transform, and the origin crosshair that gives tests and
 * users a fixed reference to the board's starting point.
 *
 * Side effects, all deliberate so the browser's page zoom and page scroll never
 * change (zoom.no_page_zoom): the wheel listener is non-passive and always
 * preventDefaults over the board, Safari gesture events are cancelled, and
 * Ctrl/Cmd + `=`, `-`, `0` are cancelled on window keydown.
 */
export function BoardViewport({
  camera,
  controls,
  rootRef,
  children,
  onEmptyDoubleClick,
  onEmptyPointerDown,
}: BoardViewportProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  // Listeners are attached once; they read the newest controls through a ref so
  // a re-render never re-attaches (and never drops a gesture mid-gesture).
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  // So are the board handlers: adding one later never re-subscribes an in-flight
  // gesture.
  const handlersRef = useRef({ onEmptyDoubleClick, onEmptyPointerDown });
  handlersRef.current = { onEmptyDoubleClick, onEmptyPointerDown };

  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const gestureScaleRef = useRef(1);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      elRef.current = node;
      if (typeof rootRef === 'function') rootRef(node);
      else if (rootRef) (rootRef as RefObject<HTMLDivElement | null>).current = node;
    },
    [rootRef],
  );

  /** Pointer position relative to the top-left of the board area. */
  const localPoint = useCallback((clientX: number, clientY: number): Point => {
    const el = elRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // --- Pan by dragging (Idle -> Panning -> Idle) ------------------------------

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // Only the bare board (viewport or grid) starts a pan; board objects
      // handle their own pointerdown and stop propagation.
      if ((event.target as HTMLElement).dataset.boardSurface !== 'true') return;
      // Board space was pressed, whether or not a pan follows: the board drops
      // its selection here, so a press on empty space is never also a way of
      // keeping a note selected.
      handlersRef.current.onEmptyPointerDown?.(localPoint(event.clientX, event.clientY));
      const el = elRef.current;
      if (!el || panningRef.current) return;
      if (typeof el.setPointerCapture === 'function') el.setPointerCapture(event.pointerId);
      panningRef.current = true;
      setPanning(true);
      controlsRef.current.beginPan(localPoint(event.clientX, event.clientY));
    },
    [localPoint],
  );

  const moveDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Moves after the drag ended (e.g. after pointercancel) are ignored.
      if (!panningRef.current) return;
      controlsRef.current.panMove(localPoint(event.clientX, event.clientY));
    },
    [localPoint],
  );

  const endDrag = useCallback(() => {
    if (!panningRef.current) return;
    panningRef.current = false;
    // The board simply stays where it was at the moment of interruption.
    controlsRef.current.endPan();
    setPanning(false);
  }, []);

  /**
   * A double-click on board space has nothing under it, because board objects
   * stop the event. The board's use of it is given to `onEmptyDoubleClick`; the
   * default text selection that a double-click would make is not wanted here.
   */
  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).dataset.boardSurface !== 'true') return;
      event.preventDefault();
      handlersRef.current.onEmptyDoubleClick?.(localPoint(event.clientX, event.clientY));
    },
    [localPoint],
  );

  // --- Pan by scrolling, zoom around the pointer (wheel, pinch) --------------

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      // The board owns every wheel event over it: no page scroll, no page zoom.
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const scale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? DELTA_LINE_TO_PIXELS
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? DELTA_PAGE_TO_PIXELS
            : 1;
      controlsRef.current.wheel({
        deltaX: event.deltaX * scale,
        deltaY: event.deltaY * scale,
        ctrlOrMeta: event.ctrlKey === true || event.metaKey === true,
        point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Safari delivers trackpad pinch as gesturestart/gesturechange, where `scale`
  // is absolute since the start of the gesture: feed the ratio since the last
  // event through the same path as a Ctrl/Cmd wheel.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const asGesture = (event: Event) => event as Event & { scale?: unknown; clientX?: number; clientY?: number };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureScaleRef.current = 1;
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = asGesture(event);
      const scale = gesture.scale;
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return;
      const factor = scale / gestureScaleRef.current;
      gestureScaleRef.current = scale;
      if (factor === 1) return;
      const rect = el.getBoundingClientRect();
      controlsRef.current.wheel({
        deltaX: 0,
        // The wheel delta that would produce this zoom factor.
        deltaY: -Math.log(factor) / WHEEL_ZOOM_SENSITIVITY,
        ctrlOrMeta: true,
        point: {
          x: (typeof gesture.clientX === 'number' ? gesture.clientX : rect.left + rect.width / 2) - rect.left,
          y: (typeof gesture.clientY === 'number' ? gesture.clientY : rect.top + rect.height / 2) - rect.top,
        },
      });
    };

    const onGestureEnd = (event: Event) => {
      gestureScaleRef.current = 1;
      event.preventDefault();
    };

    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // --- Keyboard zoom shortcuts ------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (isEditableTarget(event.target)) return;
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        controlsRef.current.zoomStep('in');
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        controlsRef.current.zoomStep('out');
      } else if (event.key === '0') {
        event.preventDefault();
        controlsRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // --- Rendering -------------------------------------------------------------

  const spacingPx = GRID_SPACING_WORLD * camera.zoom;
  const viewportStyle: CSSProperties = {
    backgroundColor: 'var(--vidi6-board-background)',
    backgroundImage: `radial-gradient(circle, var(--vidi6-grid-dot) ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX}px)`,
    backgroundSize: `${spacingPx}px ${spacingPx}px`,
    backgroundPosition: `${wrap(-camera.x * camera.zoom, spacingPx)}px ${wrap(
      -camera.y * camera.zoom,
      spacingPx,
    )}px`,
    cursor: panning ? 'grabbing' : 'grab',
    touchAction: 'none',
  };

  const worldStyle: CSSProperties = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
    transformOrigin: '0 0',
    // Notes counter-scale their own toolbars with this, so a toolbar stays the
    // same size on screen at any zoom.
    '--vidi6-zoom': `${camera.zoom}`,
  } as CSSProperties;

  // The crosshair is counter-scaled, so it stays the same size on screen and its
  // centre sits exactly on the board's starting point (world 0,0).
  const markerStyle: CSSProperties = {
    width: `${ORIGIN_MARKER_PX}px`,
    height: `${ORIGIN_MARKER_PX}px`,
    transform: `scale(${1 / camera.zoom}) translate(-50%, -50%)`,
    transformOrigin: '0 0',
  };

  return (
    <div
      ref={setRefs}
      className="board-viewport"
      data-testid="board-viewport"
      data-board-surface="true"
      data-panning={panning ? 'true' : 'false'}
      style={viewportStyle}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={handleDoubleClick}
    >
      <div className="board-world" data-testid="world-layer" data-board-surface="true" style={worldStyle}>
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" style={markerStyle} />
        {children}
      </div>
    </div>
  );
}
