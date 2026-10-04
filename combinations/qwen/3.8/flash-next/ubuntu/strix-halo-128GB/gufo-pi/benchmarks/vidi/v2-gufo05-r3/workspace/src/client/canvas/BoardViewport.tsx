import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, worldToScreen, type Point, type Size } from './camera';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';
import { NavigationHint } from './NavigationHint';
import { installTestHook } from './testHooks';
import { createSticky } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';

/** Pixels per LINE deltaMode unit (mouse wheel notch). */
const LINE_HEIGHT_PX = 16;

function mod(a: number, n: number): number {
  if (n === 0) return 0;
  return ((a % n) + n) % n;
}

function isControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[data-zoom-controls]') != null
  );
}

/** Imperative geometry handle, handed to the owner of the viewport. */
export interface BoardViewportApi {
  /** World point at the centre of the visible board area. */
  viewportCentreWorld(): Point;
  /** Viewport-relative screen point to world point. */
  screenPointToWorld(point: Point): Point;
  /** Current zoom (screen pixels per board unit). */
  getZoom(): number;
}

/** What a render-prop `children` receives. */
export interface BoardViewportRenderContext {
  zoom: number;
}

export interface BoardViewportProps {
  /**
   * Board objects, rendered inside the scaled world layer. A render function is
   * supported so the owner can position objects at the camera's zoom.
   */
  children?: React.ReactNode | ((ctx: BoardViewportRenderContext) => React.ReactNode);
  /** Board document: enables double-click-on-empty-space to create a note. */
  doc?: Y.Doc;
  /** Filled with a geometry handle while mounted. */
  viewportApi?: { current: BoardViewportApi | null };
  /** Called after a note was created by double-click, so it can be edited. */
  onStickyCreated?(id: string): void;
  /** Called when the user clicks empty board space without panning. */
  onClearSelection?(): void;
}

/**
 * The input surface for the infinite board. Owns viewport sizing, the camera,
 * all navigation gestures (drag, wheel, Safari gesture, keyboard) and the
 * overlay controls + first-use hint. Renders the dot grid and the world layer.
 *
 * Story 2 adds board content wiring: a double-click on empty board space (not
 * on a note, control or toolbar) creates a sticky note centred on that point,
 * and a click on empty space without panning clears the local selection.
 */
export function BoardViewport(props: BoardViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const viewportRef = useRef(viewport);
  const camera = useCamera(viewport);
  const apiRef = useRef(camera);
  apiRef.current = camera;

  const {
    camera: cam,
    hasNavigated,
    panning,
    zoomPercent,
    canZoomIn,
    canZoomOut,
    beginPan,
    panMove,
    endPan,
  } = camera;

  const panStartRef = useRef<Point | null>(null);
  const panMovedRef = useRef(false);

  // --- Geometry handle for the owner (toolbar creation, tests) --------------
  const viewportApi = props.viewportApi;
  useLayoutEffect(() => {
    if (!viewportApi) return;
    viewportApi.current = {
      viewportCentreWorld: () =>
        screenToWorld(apiRef.current.camera, {
          x: viewportRef.current.width / 2,
          y: viewportRef.current.height / 2,
        }),
      screenPointToWorld: (point: Point) => screenToWorld(apiRef.current.camera, point),
      getZoom: () => apiRef.current.camera.zoom,
    };
    return () => {
      viewportApi.current = null;
    };
  }, [viewportApi]);

  // --- Viewport measurement (ResizeObserver) --------------------------------
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = { width: rect.width, height: rect.height };
      if (next.width !== viewportRef.current.width || next.height !== viewportRef.current.height) {
        viewportRef.current = next;
        setViewport(next);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pointFromEvent = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // --- Wheel (non-passive) --------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Wheel over the zoom controls must not move the board, and must not
      // suppress the browser default there (TC-30).
      if (isControlTarget(e.target)) return;
      e.preventDefault();
      const factor =
        e.deltaMode === 1
          ? LINE_HEIGHT_PX
          : e.deltaMode === 2
            ? viewportRef.current.height || 1
            : 1;
      apiRef.current.wheel({
        deltaX: e.deltaX * factor,
        deltaY: e.deltaY * factor,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: pointFromEvent(e.clientX, e.clientY),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pointFromEvent]);

  // --- Safari gesture (pinch) ----------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastScale = 1;
    const onStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number };
      const scale = ge.scale ?? 1;
      const ratio = scale / (lastScale || 1);
      lastScale = scale;
      apiRef.current.zoomAtPoint(pointFromEvent(ge.clientX ?? 0, ge.clientY ?? 0), ratio);
    };
    const onEnd = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    el.addEventListener('gesturestart', onStart as EventListener);
    el.addEventListener('gesturechange', onChange as EventListener);
    el.addEventListener('gestureend', onEnd as EventListener);
    return () => {
      el.removeEventListener('gesturestart', onStart as EventListener);
      el.removeEventListener('gesturechange', onChange as EventListener);
      el.removeEventListener('gestureend', onEnd as EventListener);
    };
  }, [pointFromEvent]);

  // --- Keyboard shortcuts (window) -----------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
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

  // --- Test hook ------------------------------------------------------------
  useEffect(() => {
    installTestHook((next) => apiRef.current.setCamera(next));
  }, []);

  // --- Pointer drag ---------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (isControlTarget(e.target)) return;
    const el = e.currentTarget;
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* not supported (e.g. jsdom) */
    }
    panStartRef.current = pointFromEvent(e.clientX, e.clientY);
    panMovedRef.current = false;
    beginPan(panStartRef.current);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panning) return;
    const point = pointFromEvent(e.clientX, e.clientY);
    const start = panStartRef.current;
    if (start && Math.hypot(point.x - start.x, point.y - start.y) >= DRAG_THRESHOLD_PX) {
      panMovedRef.current = true;
    }
    panMove(point);
  };

  // --- Double-click on empty board space creates a sticky note -------------
  const isBoardSpace = (target: EventTarget | null): boolean =>
    !(target instanceof Element && target.closest('[data-sticky-note], [data-zoom-controls], [data-toolbar], [data-note-toolbar]') != null);

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!props.doc || !isBoardSpace(e.target)) return;
    e.preventDefault();
    const world = screenToWorld(apiRef.current.camera, pointFromEvent(e.clientX, e.clientY));
    const id = createSticky(props.doc, world);
    if (id) props.onStickyCreated?.(id);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    endPan();
    // A click on empty board space (no pan) clears the local selection. Notes
    // stop propagation, so selecting a note never gets here.
    if (!panMovedRef.current && isBoardSpace(e.target)) props.onClearSelection?.();
    panMovedRef.current = false;
  };
  const onPointerCancel = () => {
    endPan();
    panMovedRef.current = false;
  };
  const onLostPointerCapture = () => endPan();

  // --- Derived styles -------------------------------------------------------
  const size = GRID_SPACING_WORLD * cam.zoom;
  const offsetX = mod(-cam.x * cam.zoom, size);
  const offsetY = mod(-cam.y * cam.zoom, size);
  const origin = worldToScreen(cam, { x: 0, y: 0 });

  return (
    <div
      ref={containerRef}
      className="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      style={{ cursor: panning ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
    >
      {/* Dot grid surface: pointer target for panning. */}
      <div
        className="board-surface"
        data-board-surface=""
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, #c3c9d6 1.5px, transparent 1.5px)',
          backgroundSize: `${size}px ${size}px`,
          backgroundPosition: `${offsetX}px ${offsetY}px`,
          backgroundRepeat: 'repeat',
        }}
      />

      {/* World layer: children are positioned in world coordinates. */}
      <div
        className="world-layer"
        style={{
          transform: `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {typeof props.children === 'function'
          ? props.children({ zoom: cam.zoom })
          : props.children}
      </div>

      {/* Origin marker: stable pixel target for tests, world (0,0). */}
      <div
        className="origin-marker"
        data-origin-marker=""
        aria-hidden="true"
        style={{ left: `${origin.x}px`, top: `${origin.y}px` }}
      />

      <ZoomControls
        zoomPercent={zoomPercent}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={() => camera.zoomStep('in')}
        onZoomOut={() => camera.zoomStep('out')}
        onReset={camera.reset}
      />

      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
