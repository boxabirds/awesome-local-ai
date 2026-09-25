import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CameraApi } from './useCamera';
import type { Point } from './camera';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD, SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type { MarqueeApi } from '../board/Marquee';
import type { Tool } from '../board/useTool';
import type { Rect } from '../../shared/geometry';

/** Pixel sizes used to convert wheel deltaMode LINE/PAGE values to pixels. */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 100;
/** WheelEvent deltaMode values (named locally: jsdom does not expose the statics). */
const DELTA_MODE_PIXEL = 0;
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

export interface BoardViewportProps {
  children?: ReactNode;
  /** Camera API from `useCamera`; App owns the single camera instance. */
  api: CameraApi;
  /** Double-click on empty board space: create an object centred on the point. */
  onCreateStickyAt?: (p: Point) => void;
  /** A click (press without movement) on empty board space: clear the selection. */
  onEmptyClick?: () => void;
  /**
   * Shift+drag on empty board space starts the marquee (story 7) instead of
   * panning. Without it, Shift+drag pans like any other drag.
   */
  marquee?: MarqueeApi;
  /** Current tool (story 9/10). */
  tool?: Tool;
  /**
   * Click on empty board space with the text tool active: create a text
   * object at the screen point (story 9).
   */
  onCreateTextAt?: (p: Point) => void;
  /**
   * Shape tool (story 10): drag on empty board space creates a shape.
   * `rect` is null for a click (default size).
   */
  onCreateShapeAt?: (rect: Rect | null, at: Point, square: boolean) => void;
  /**
   * Connector tool (story 10): drag on empty board space starts a connector.
   * Called with the start and end world points on pointer up.
   */
  onConnectorDragEnd?: (from: Point, to: Point) => void;
  /**
   * Story 12: drag handlers for image file drops.
   */
  onDragEnter?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
}

/**
 * Full-window input surface for the board: dot grid background, world layer
 * (CSS transform) and the origin marker.
 *
 * Drag starts only on empty board space (the viewport or world layer
 * element); objects stopPropagation on their elements. A double-click on
 * empty space creates a sticky note at that point; a click (press without
 * movement) on empty space clears the selection.
 */
export function BoardViewport({ children, api, onCreateStickyAt, onEmptyClick, marquee, tool, onCreateTextAt, onCreateShapeAt, onConnectorDragEnd, onDragEnter, onDragOver, onDragLeave, onDrop }: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const marqueeRef = useRef(false);
  const gestureScaleRef = useRef(1);
  const emptyPressRef = useRef<Point | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const marqueeApiRef = useRef(marquee);
  marqueeApiRef.current = marquee;

  // Tool drag state (story 10).
  const shapeDragRef = useRef<{ start: Point; current: Point; shift: boolean } | null>(null);
  const connectorDragRef = useRef<{ start: Point; current: Point } | null>(null);
  const [shapePreview, setShapePreview] = useState<Rect | null>(null);
  const [connectorPreview, setConnectorPreview] = useState<{ from: Point; to: Point } | null>(null);

  const toPoint = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const toWorld = (clientX: number, clientY: number): Point => {
    const screen = toPoint(clientX, clientY);
    const cam = apiRef.current.camera;
    return { x: screen.x / cam.zoom + cam.x, y: screen.y / cam.zoom + cam.y };
  };

  /** Compute the shape drag rect from start and current world points. */
  const shapeDragRect = (s: Point, c: Point, shift: boolean): Rect => {
    let x = Math.min(s.x, c.x);
    let y = Math.min(s.y, c.y);
    let w = Math.abs(c.x - s.x);
    let h = Math.abs(c.y - s.y);
    if (shift) {
      const size = Math.max(w, h);
      // Anchor at the start corner (top-left of the drag direction).
      x = c.x > s.x ? s.x : s.x - size;
      y = c.y > s.y ? s.y : s.y - size;
      w = size;
      h = size;
    }
    return { x, y, width: w, height: h };
  };

  // ----- pointer drag (Idle -> Panning -> Idle) -----

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Node;
    if (target !== viewportRef.current && target !== worldRef.current) return;
    // Pen tool (story 11): pointerdowns are routed to the Pen tool (which
    // intercepts them at the window capture phase, including over objects);
    // they never start a pan here.
    if (tool === 'pen') return;
    viewportRef.current?.setPointerCapture?.(e.pointerId);
    const point = toPoint(e.clientX, e.clientY);

    // Shape tool (story 10): drag on empty space creates a shape.
    if (tool === 'shape') {
      const world = toWorld(e.clientX, e.clientY);
      shapeDragRef.current = { start: world, current: world, shift: e.shiftKey };
      setShapePreview({ x: world.x, y: world.y, width: 0, height: 0 });
      return;
    }

    // Connector tool (story 10): drag on empty space starts a connector.
    if (tool === 'connector') {
      const world = toWorld(e.clientX, e.clientY);
      connectorDragRef.current = { start: world, current: world };
      setConnectorPreview({ from: world, to: world });
      return;
    }

    // Shift+drag on empty space: marquee selection (story 7) instead of pan.
    if (e.shiftKey && marqueeApiRef.current) {
      marqueeRef.current = true;
      marqueeApiRef.current.begin(point);
      return;
    }
    panningRef.current = true;
    setPanning(true);
    emptyPressRef.current = { x: e.clientX, y: e.clientY };
    apiRef.current.beginPan(point);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (marqueeRef.current) {
      marqueeApiRef.current?.move(toPoint(e.clientX, e.clientY));
      return;
    }

    // Shape tool drag (story 10).
    if (shapeDragRef.current) {
      const world = toWorld(e.clientX, e.clientY);
      shapeDragRef.current = { ...shapeDragRef.current, current: world, shift: e.shiftKey };
      setShapePreview(shapeDragRect(shapeDragRef.current.start, world, e.shiftKey));
      return;
    }

    // Connector tool drag (story 10).
    if (connectorDragRef.current) {
      const world = toWorld(e.clientX, e.clientY);
      connectorDragRef.current = { ...connectorDragRef.current, current: world };
      setConnectorPreview({ from: connectorDragRef.current.start, to: world });
      return;
    }

    if (!panningRef.current) return;
    apiRef.current.panMove(toPoint(e.clientX, e.clientY));
  };

  const stopMarquee = (cancelled: boolean): void => {
    if (!marqueeRef.current) return;
    marqueeRef.current = false;
    if (cancelled) marqueeApiRef.current?.cancel();
    else marqueeApiRef.current?.end();
  };

  const stopPan = (e?: React.PointerEvent) => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    const pressStart = emptyPressRef.current;
    emptyPressRef.current = null;
    // A press on empty space that never moved is a click.
    if (
      pressStart !== null &&
      e !== undefined &&
      Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) < DRAG_THRESHOLD_PX
    ) {
      if (tool === 'text') {
        // Text tool: create a text at the click point (story 9).
        onCreateTextAt?.(toPoint(e.clientX, e.clientY));
      } else {
        onEmptyClick?.();
      }
    }
    if (e?.pointerId !== undefined) {
      try {
        viewportRef.current?.releasePointerCapture?.(e.pointerId);
      } catch {
        // capture may already be gone; the drag ends either way
      }
    }
    apiRef.current.endPan();
  };

  /** End the shape tool drag (story 10). */
  const endShapeDrag = (e?: React.PointerEvent) => {
    if (!shapeDragRef.current) return;
    const { start, current, shift } = shapeDragRef.current;
    shapeDragRef.current = null;
    setShapePreview(null);
    if (e?.pointerId !== undefined) {
      try { viewportRef.current?.releasePointerCapture?.(e.pointerId); } catch { /* */ }
    }
    // A click (no movement) creates a default-size shape.
    const zoom = apiRef.current.camera.zoom;
    const dist = Math.hypot(current.x - start.x, current.y - start.y) * zoom;
    if (dist < DRAG_THRESHOLD_PX) {
      onCreateShapeAt?.(null, start, false);
    } else {
      const rect = shapeDragRect(start, current, shift);
      onCreateShapeAt?.(rect, start, shift);
    }
  };

  /** End the connector tool drag (story 10). */
  const endConnectorDrag = (e?: React.PointerEvent) => {
    if (!connectorDragRef.current) return;
    const { start, current } = connectorDragRef.current;
    connectorDragRef.current = null;
    setConnectorPreview(null);
    if (e?.pointerId !== undefined) {
      try { viewportRef.current?.releasePointerCapture?.(e.pointerId); } catch { /* */ }
    }
    onConnectorDragEnd?.(start, current);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // Only a genuine double-click on empty space creates a note; notes and
    // toolbars stopPropagation (and their elements are never the target).
    const target = e.target as Node;
    if (target !== viewportRef.current && target !== worldRef.current) return;
    // Pen tool (story 11): a double-click while drawing just adds dots; it
    // never creates a sticky note.
    if (tool === 'pen') return;
    onCreateStickyAt?.(toPoint(e.clientX, e.clientY));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (marqueeRef.current) {
      stopMarquee(false);
      viewportRef.current?.releasePointerCapture?.(e.pointerId);
      return;
    }
    if (shapeDragRef.current) { endShapeDrag(e); return; }
    if (connectorDragRef.current) { endConnectorDrag(e); return; }
    stopPan(e);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    if (marqueeRef.current) {
      stopMarquee(true);
      viewportRef.current?.releasePointerCapture?.(e.pointerId);
      return;
    }
    if (shapeDragRef.current) { endShapeDrag(e); return; }
    if (connectorDragRef.current) { endConnectorDrag(e); return; }
    stopPan(e);
  };

  const onLostPointerCapture = () => {
    if (marqueeRef.current) stopMarquee(true);
    else if (shapeDragRef.current) endShapeDrag();
    else if (connectorDragRef.current) endConnectorDrag();
    else stopPan();
  };

  // ----- wheel (non-passive so the page never scrolls/zooms) -----

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Always over the board: suppress the browser default (page scroll/zoom).
      e.preventDefault();
      let { deltaX, deltaY } = e;
      if (e.deltaMode === DELTA_MODE_LINE) {
        deltaX *= WHEEL_LINE_PX;
        deltaY *= WHEEL_LINE_PX;
      } else if (e.deltaMode === DELTA_MODE_PAGE) {
        deltaX *= WHEEL_PAGE_PX;
        deltaY *= WHEEL_PAGE_PX;
      }
      apiRef.current.wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toPoint(e.clientX, e.clientY),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Safari pinch (gesture events) -----

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as Event & { scale?: number; clientX?: number; clientY?: number };
      const scale = gesture.scale;
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return;
      const ratio = scale / gestureScaleRef.current;
      gestureScaleRef.current = scale;
      if (gesture.clientX === undefined || gesture.clientY === undefined) return;
      apiRef.current.zoomAtPoint(toPoint(gesture.clientX, gesture.clientY), ratio);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = 1;
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- keyboard: Ctrl/Cmd + = / - / 0 (window level; stops page zoom) -----

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        apiRef.current.zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        apiRef.current.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        apiRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ----- rendering -----

  const { camera } = api;
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at world multiples of GRID_SPACING_WORLD; anchoring the tile at
  // -camera.xy*zoom keeps the grid attached to the board under pan and zoom.
  const bgPosX = -camera.x * camera.zoom;
  const bgPosY = -camera.y * camera.zoom;

  // Tool-specific cursor (story 10).
  const toolCursor = tool === 'text' ? 'text' : tool === 'shape' ? 'crosshair' : tool === 'connector' ? 'crosshair' : undefined;

  return (
    <div
      ref={viewportRef}
      className={panning ? 'vidi6-viewport vidi6-viewport--panning' : 'vidi6-viewport'}
      style={{
        backgroundImage: 'radial-gradient(circle, #c7cdd6 1.1px, transparent 1.1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgPosX}px ${bgPosY}px`,
        cursor: toolCursor,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        ref={worldRef}
        className="vidi6-world"
        style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      >
        <OriginMarker />
        {children}
        {/* Shape tool drag preview (story 10). */}
        {shapePreview && shapePreview.width > 0 && shapePreview.height > 0 && (
          <div
            data-testid="shape-drag-preview"
            style={{
              position: 'absolute',
              left: shapePreview.x,
              top: shapePreview.y,
              width: shapePreview.width,
              height: shapePreview.height,
              border: '2px dashed #4285F4',
              borderRadius: 2,
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
        )}
        {/* Connector tool drag preview (story 10). */}
        {connectorPreview && (
          <svg
            data-testid="connector-drag-preview"
            style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 9999 }}
          >
            <line
              x1={connectorPreview.from.x}
              y1={connectorPreview.from.y}
              x2={connectorPreview.to.x}
              y2={connectorPreview.to.y}
              stroke="#4285F4"
              strokeWidth={2}
              strokeDasharray="6 3"
            />
            <circle cx={connectorPreview.from.x} cy={connectorPreview.from.y} r={4} fill="#4285F4" />
            <circle cx={connectorPreview.to.x} cy={connectorPreview.to.y} r={4} fill="#4285F4" />
          </svg>
        )}
      </div>
    </div>
  );
}

/** Small crosshair at world (0,0): the board's starting point, also the e2e target. */
function OriginMarker() {
  return (
    <div className="vidi6-origin-marker" data-testid="origin-marker" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <line x1="8" y1="0" x2="8" y2="16" stroke="#9aa4b2" strokeWidth="1" />
        <line x1="0" y1="8" x2="16" y2="8" stroke="#9aa4b2" strokeWidth="1" />
      </svg>
    </div>
  );
}
