import { useEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  DRAG_THRESHOLD_PX,
  GRID_SPACING_WORLD,
  WHEEL_DELTA_LINE_PX,
  WHEEL_DELTA_PAGE_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import type { Point } from './camera';
import { screenToWorld } from './camera';
import { useCamera, useElementSize } from './useCamera';

/**
 * The board's input surface. Renders the dot grid (as the viewport's
 * background) and the world layer (CSS-transformed children), and wires
 * pointer drag, wheel, Safari pinch and keyboard navigation into the camera.
 *
 * Story 2: a double-click on empty space creates a note there, and a press
 * on empty space without movement clears the selection. Children (notes) stop
 * pointer propagation to opt out of both.
 */
export function BoardViewport(props: {
  children?: ReactNode;
  /** Create a sticky at a world point (double-click on empty space). */
  onCreateStickyAt?: (worldPoint: Point) => void;
  /** Clear the selection (press on empty space without a drag). */
  onClearSelection?: () => void;
  /** Shift+press on empty space begins a marquee (viewport-local point). */
  onMarqueeBegin?: (screen: Point) => void;
  onMarqueeMove?: (screen: Point) => void;
  onMarqueeEnd?: () => void;
  onMarqueeCancel?: () => void;
  /**
   * Story 9: true while the Text tool is active. The viewport shows a text
   * cursor, a click (no drag) creates text at the world point, and presses
   * neither pan nor marquee. The world layer gets pointer-events: none so
   * clicks on existing objects fall through to the board surface (text.create:
   * a click on top of an object creates text on top at that point).
   */
  textToolActive?: boolean;
  /** Story 9: create text at a world point (click while the Text tool is active). */
  onTextCreateAt?: (worldPoint: Point) => void;
  /**
   * Story 10: true while the Shape or Connector tool is active. Presses
   * neither pan, marquee nor double-click (the tools own the pointer via
   * window listeners), the viewport shows a crosshair, and every object in
   * the world layer ignores the pointer so a press on top of an object still
   * starts the draw (shapes.create / connector.attach).
   */
  drawingToolActive?: boolean;
  /**
   * Story 11: true while the Pen tool is active. The OS cursor is hidden
   * (the PenTool renders a round cursor sized to the thickness instead);
   * the viewport still does not pan/marquee (that is drawingToolActive).
   */
  penToolActive?: boolean;
}): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const size = useElementSize(viewportRef);
  const { camera, beginPan, panMove, endPan, wheel, zoomStep, reset } = useCamera(size);
  const [panning, setPanning] = useState(false);
  const gestureScale = useRef(1);
  const pressPoint = useRef<Point | null>(null);
  const marqueePointer = useRef<number | null>(null);

  const toLocal = (clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // --- pointer drag (pan) -------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = viewportRef.current;
    if (!el || panning || marqueePointer.current !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Story 10: while a drawing tool is active the tools own the pointer
    // (window listeners); the viewport does not pan/marquee and does not
    // even capture.
    if (props.drawingToolActive === true) return;
    // Only start a pan/marquee when pressing the board surface itself.
    // Children live in the world layer with pointer-events: none, so a press
    // on empty space lands on the viewport; objects stopPropagation to opt out.
    if (e.target !== el) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is unavailable (e.g. jsdom); the drag still works
      // because events are dispatched on the viewport element.
    }
    const local = toLocal(e.clientX, e.clientY);
    // Story 9: with the Text tool active a press neither pans nor marquees;
    // a press that does not travel creates text at the point (stopPanning).
    if (props.textToolActive === true) {
      pressPoint.current = local;
      return;
    }
    // Shift + press on empty space marquee-selects (sel.marquee_ui); without
    // Shift the story 1 pan path is unchanged.
    if (e.shiftKey) {
      marqueePointer.current = e.pointerId;
      props.onMarqueeBegin?.(local);
      return;
    }
    pressPoint.current = local;
    setPanning(true);
    beginPan(local);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (marqueePointer.current === e.pointerId) {
      props.onMarqueeMove?.(toLocal(e.clientX, e.clientY));
      return;
    }
    if (props.drawingToolActive === true) return; // the drawing tools own the pointer
    if (props.textToolActive === true) return; // no pan while the Text tool is active
    if (!panning) return;
    panMove(toLocal(e.clientX, e.clientY));
  };

  const stopPanning = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (props.drawingToolActive === true) return; // the tools handle their own releases
    const el = viewportRef.current;
    if (el) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // Capture may already be released (pointercancel).
      }
    }
    // A marquee press that ends commits its rect (objectsInRect -> setMany).
    if (marqueePointer.current === e.pointerId) {
      marqueePointer.current = null;
      props.onMarqueeEnd?.();
      return;
    }
    // Story 9: a Text-tool press that did not travel creates text at the
    // world point (text.create). A travel is a plain drag: nothing happens.
    if (props.textToolActive === true) {
      const start = pressPoint.current;
      pressPoint.current = null;
      if (start !== null) {
        const now = toLocal(e.clientX, e.clientY);
        if (Math.hypot(now.x - start.x, now.y - start.y) <= DRAG_THRESHOLD_PX) {
          props.onTextCreateAt?.(screenToWorld(camera, now));
        }
      }
      return;
    }
    setPanning(false);
    // The last committed camera is kept: an interrupted drag leaves the
    // board exactly where it was.
    endPan();
    // A press that did not travel is a click on empty space: it clears the
    // selection (PRD sticky.select).
    const start = pressPoint.current;
    pressPoint.current = null;
    if (start !== null) {
      const now = toLocal(e.clientX, e.clientY);
      if (Math.hypot(now.x - start.x, now.y - start.y) <= DRAG_THRESHOLD_PX) {
        props.onClearSelection?.();
      }
    }
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (marqueePointer.current === e.pointerId) {
      marqueePointer.current = null;
      props.onMarqueeCancel?.();
      return;
    }
    if (props.textToolActive === true) {
      pressPoint.current = null;
      return;
    }
    setPanning(false);
    endPan();
  };

  // A double-click on empty space creates a note centred on the point
  // (PRD sticky.create_dblclick). Notes stop propagation, so this only fires
  // for the board surface itself. Shift+double-click is a no-op. With the
  // Text tool active double-click is suppressed (the first click already
  // created the text).
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const el = viewportRef.current;
    if (el === null || e.target !== el) return;
    if (e.shiftKey) return;
    if (props.textToolActive === true) return;
    if (props.drawingToolActive === true) return; // the tools own clicks
    props.onCreateStickyAt?.(screenToWorld(camera, toLocal(e.clientX, e.clientY)));
  };

  const onLostPointerCapture = (): void => {
    if (props.drawingToolActive === true) return;
    setPanning(false);
    endPan();
  };

  // --- wheel: plain scroll pans, Ctrl/Cmd scroll zooms ---------------------
  // React's onWheel is passive and cannot prevent the page from zooming
  // scrolling, so the listener is attached natively with { passive: false }.

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      wheel({
        deltaX: toPixelDelta(e.deltaX, e.deltaMode),
        deltaY: toPixelDelta(e.deltaY, e.deltaMode),
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toLocal(e.clientX, e.clientY),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // `wheel` is a stable module-level function; toLocal only reads a ref.
  }, [wheel]);

  // --- Safari pinch (gesture events) ---------------------------------------

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onGestureStart = (e: Event): void => {
      e.preventDefault();
      gestureScale.current = 1;
    };
    const onGestureChange = (e: Event): void => {
      e.preventDefault();
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number };
      if (typeof ge.scale !== 'number' || !Number.isFinite(ge.scale) || ge.scale <= 0) return;
      const ratio = ge.scale / gestureScale.current;
      gestureScale.current = ge.scale;
      // The hook's wheel() zooms by exp(-deltaY * S); derive the deltaY that
      // yields exactly this scale ratio.
      wheel({
        deltaX: 0,
        deltaY: -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY,
        ctrlOrMeta: true,
        point: toLocal(ge.clientX ?? 0, ge.clientY ?? 0),
      });
    };
    const onGestureEnd = (e: Event): void => {
      e.preventDefault();
      gestureScale.current = 1;
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [wheel]);

  // --- keyboard: Ctrl/Cmd + = / - / 0 ---------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      switch (e.key) {
        case '=':
        case '+':
          e.preventDefault(); // stop the browser's page zoom
          zoomStep('in');
          break;
        case '-':
        case '_':
          e.preventDefault();
          zoomStep('out');
          break;
        case '0':
          e.preventDefault();
          reset();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  // --- rendering -------------------------------------------------------------
  // The dot grid is the viewport's tiled background; its size and position
  // derive from the camera so it appears attached to the board.

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const dotX = mod(-camera.x * camera.zoom, spacing);
  const dotY = mod(-camera.y * camera.zoom, spacing);

  return (
    <div
      ref={viewportRef}
      className={`board-viewport${panning ? ' is-panning' : ''}${
        props.textToolActive ? ' is-text-tool' : ''
      }${props.drawingToolActive ? ' is-drawing-tool' : ''}${
        props.penToolActive ? ' is-pen-tool' : ''
      }`}
      data-testid="board-viewport"
      style={{
        backgroundImage:
          'radial-gradient(circle at 0 0, var(--grid-dot-color) 1.5px, transparent 2px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${dotX}px ${dotY}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopPanning}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="world-layer"
        data-testid="world-layer"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
        }}
      >
        {/* Origin marker: a stable pixel target at world (0,0). */}
        <svg
          className="origin-marker"
          data-testid="origin-marker"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
          focusable="false"
        >
          <line x1="6" y1="0" x2="6" y2="12" stroke="currentColor" strokeWidth="1" />
          <line x1="0" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1" />
        </svg>
        {props.children}
      </div>
    </div>
  );
}

/** Convert a wheel delta to pixels for LINE and PAGE deltaModes. */
function toPixelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * WHEEL_DELTA_LINE_PX;
  if (deltaMode === 2) return delta * WHEEL_DELTA_PAGE_PX;
  return delta;
}

/** Non-negative modulo (for wrapping the grid position into one tile). */
function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}
