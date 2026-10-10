import { useCallback, useEffect, useRef, useState } from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { useCamera, wheelDeltaToPixels, wheelZoomFactor, type CameraApi } from './useCamera';
import { NavigationHint } from './NavigationHint';
import { ZoomControls } from './ZoomControls';

/** Safari (and legacy) pinch gestures are delivered as GestureEvent. */
interface GestureEventLike extends Event {
  readonly scale: number;
  readonly rotation?: number;
}

const mod = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

/** Viewport size from a ResizeObserver, falling back to window dimensions. */
function useViewportSize(ref: React.RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        const box = entry?.contentRect;
        if (box) {
          setSize((previous) =>
            previous.width === box.width && previous.height === box.height
              ? previous
              : { width: box.width, height: box.height },
          );
        }
      });
      observer.observe(element);
      return () => observer.disconnect();
    }
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [ref]);

  return size;
}

/** Is this event coming from the board surface (not from board chrome)? */
function isBoardSurface(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-board-chrome]') === null;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

/**
 * The board surface as seen from the outside: the camera plus the size of the
 * surface element. Story 2 uses it to turn the centre of the visible board into
 * a world point (creating a sticky note from the toolbar).
 */
export interface BoardSurface {
  readonly camera: Camera;
  readonly viewport: Size;
  readonly width: number;
  readonly height: number;
}

/** The centre of the visible board area, in surface coordinates. */
export function viewportCentre(surface: BoardSurface): Point {
  return { x: surface.width / 2, y: surface.height / 2 };
}

export interface BoardViewportProps {
  children?: React.ReactNode;
  /** Empty board double-clicked: the world point under the pointer. */
  onEmptyDoubleClick?: (world: Point) => void;
  /** Empty board clicked without panning: the world point under the pointer. */
  onEmptyClick?: (world: Point) => void;
  /**
   * Shift+drag on empty board space (`sel.marquee_ui`): the board selects with a
   * rectangle instead of panning. The phase is the marquee's own lifecycle -
   * `begin` on the press, `move` while it grows, `end` on release (select),
   * `cancel` on pointercancel (selection unchanged).
   */
  onEmptyDrag?: (phase: 'begin' | 'move' | 'end' | 'cancel', screen: Point, world: Point) => void;
  /** Called whenever the camera or the surface size changes. */
  onSurfaceChange?: (surface: BoardSurface) => void;
}

/**
 * The board input surface: dot grid, world layer (world coordinates), and the
 * board chrome (zoom controls, first-use hint). Pan by dragging, pan by
 * scrolling, zoom at the pointer (Ctrl/Cmd wheel or Safari gesture) and the
 * Ctrl/Cmd + = / - / 0 shortcuts all prevent the browser's own behaviour.
 *
 * Board objects (sticky notes) are passed as children and rendered inside the
 * world layer, so they pan and zoom with the board.
 */
export function BoardViewport(props: BoardViewportProps) {
  const { children, onEmptyDoubleClick, onEmptyClick, onEmptyDrag, onSurfaceChange } = props;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(surfaceRef);
  const api = useCamera(viewport);

  const { camera, isPanning } = api;
  const { beginPan, panMove, endPan: endPanAction, wheel, zoomAtPointer, zoomStep, reset } = api;
  const lastPointerRef = useRef({ x: viewport.width / 2, y: viewport.height / 2 });
  const gestureScaleRef = useRef(1);
  /** A pointerdown on empty board space that has not moved yet: a click. */
  const pendingClickRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** What the current empty-space press is doing: story 1's pan, or a marquee. */
  const dragModeRef = useRef<'pan' | 'marquee' | null>(null);

  const screenPointFromEvent = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const x = rect ? e.clientX - rect.left : e.clientX;
      const y = rect ? e.clientY - rect.top : e.clientY;
      lastPointerRef.current = { x, y };
      return { x, y };
    },
    [],
  );

  // --- dragging -------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target;
    if (!(target instanceof Element) || target.getAttribute('data-board-surface') !== 'true') {
      return; // only empty board space starts a pan or a marquee
    }
    if (e.button !== 0 && e.pointerType === 'mouse') {
      return;
    }
    const point = screenPointFromEvent(e);
    if (e.shiftKey && onEmptyDrag) {
      // Story 7: with Shift held, empty space is selected with a rectangle
      // instead of panned (TC-21: without Shift this stays story 1's pan).
      dragModeRef.current = 'marquee';
      onEmptyDrag('begin', point, screenToWorld(api.camera, point));
      try {
        surfaceRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // jsdom (and browsers that reject capture) still track the drag.
      }
      return;
    }
    dragModeRef.current = 'pan';
    pendingClickRef.current = { x: point.x, y: point.y, moved: false };
    beginPan(point);
    try {
      surfaceRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // jsdom (and browsers that reject capture) still pan via pointer events.
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = screenPointFromEvent(e);
    if (dragModeRef.current === 'marquee') {
      onEmptyDrag?.('move', point, screenToWorld(api.camera, point));
      return;
    }
    const pending = pendingClickRef.current;
    if (pending && !pending.moved) {
      const dx = point.x - pending.x;
      const dy = point.y - pending.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        pending.moved = true; // a pan, not a click
      }
    }
    if (!api.isPanning) {
      return;
    }
    panMove(point);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const mode = dragModeRef.current;
    dragModeRef.current = null;
    if (mode === 'marquee') {
      // Release selects what the rectangle holds; a cancel discards the
      // rectangle and leaves the selection as it was (TC-22).
      const point = screenPointFromEvent(e);
      onEmptyDrag?.(e.type === 'pointerup' ? 'end' : 'cancel', point, screenToWorld(api.camera, point));
      return;
    }
    const pending = pendingClickRef.current;
    pendingClickRef.current = null;
    if (pending && !pending.moved && onEmptyClick && e.type === 'pointerup') {
      onEmptyClick(screenToWorld(api.camera, screenPointFromEvent(e)));
    }
    if (api.isPanning) {
      endPanAction();
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target;
    if (!(target instanceof Element) || target.getAttribute('data-board-surface') !== 'true') {
      return; // double-clicking a board object is the object's own business
    }
    onEmptyDoubleClick?.(screenToWorld(api.camera, screenPointFromEvent(e)));
  };

  // Publish the surface (camera + size) so board objects and toolbars can map
  // screen points to world points without owning the camera.
  useEffect(() => {
    if (!onSurfaceChange) {
      return;
    }
    const rect = surfaceRef.current?.getBoundingClientRect();
    // Environments without layout (jsdom) report an empty rect: fall back to
    // the viewport size the surface itself was measured with.
    const width = rect && rect.width > 0 ? rect.width : viewport.width;
    const height = rect && rect.height > 0 ? rect.height : viewport.height;
    onSurfaceChange({ camera: api.camera, viewport, width, height });
  }, [api.camera, viewport, onSurfaceChange]);

  // --- wheel (non-passive so it never scrolls or zooms the page) ------------
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      if (!isBoardSurface(e.target)) {
        return; // over chrome: leave the browser default alone
      }
      e.preventDefault();
      e.stopPropagation();
      const point = screenPointFromEvent(e);
      const deltaY = wheelDeltaToPixels(e.deltaY, e.deltaMode);
      const deltaX = wheelDeltaToPixels(e.deltaX, e.deltaMode);
      if (e.ctrlKey || e.metaKey) {
        zoomAtPointer(point, wheelZoomFactor(deltaY));
        return;
      }
      wheel({ deltaX, deltaY, ctrlOrMeta: false, point });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [wheel, zoomAtPointer, screenPointFromEvent]);

  // --- Safari pinch gestures -------------------------------------------------
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) {
      return;
    }
    const onStart = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = (e as GestureEventLike).scale || 1;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as GestureEventLike;
      const scale = gesture.scale || 1;
      const ratio = gestureScaleRef.current === 0 ? 1 : scale / gestureScaleRef.current;
      gestureScaleRef.current = scale;
      zoomAtPointer(lastPointerRef.current, ratio);
    };
    const onEnd = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = 1;
    };
    element.addEventListener('gesturestart', onStart);
    element.addEventListener('gesturechange', onChange);
    element.addEventListener('gestureend', onEnd);
    return () => {
      element.removeEventListener('gesturestart', onStart);
      element.removeEventListener('gesturechange', onChange);
      element.removeEventListener('gestureend', onEnd);
    };
  }, [zoomAtPointer]);

  // --- keyboard shortcuts ----------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) {
        return;
      }
      // Keyboard shortcuts work whenever focus is not in a text field.
      if (isTextEntry(e.target) || isTextEntry(document.activeElement)) {
        return;
      }
      const key = e.key;
      if (key === '=' || key === '+' || key === '-' || key === '_' || key === '0') {
        // Stop the browser from zooming the page.
        e.preventDefault();
      }
      if (key === '=' || key === '+') {
        zoomStep('in');
      } else if (key === '-' || key === '_') {
        zoomStep('out');
      } else if (key === '0') {
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  const spacingPx = GRID_SPACING_WORLD * camera.zoom;

  return (
    <div
      ref={surfaceRef}
      className="board"
      data-testid="board"
      data-board-surface="true"
      data-panning={isPanning ? 'true' : 'false'}
      style={{
        backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, rgba(203, 213, 225, 0) 1.6px)',
        backgroundSize: `${spacingPx}px ${spacingPx}px`,
        // Each CSS tile paints its dot at the tile centre, so the offset is
        // pulled back by half a tile: that puts a dot exactly above every world
        // point that is a multiple of GRID_SPACING_WORLD (including 0,0).
        backgroundPosition: `${mod(-camera.x * camera.zoom - spacingPx / 2, spacingPx)}px ${mod(
          -camera.y * camera.zoom - spacingPx / 2,
          spacingPx,
        )}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onDoubleClick}
      onDragStart={(event) => {
        // Board objects are moved by the app's own gestures. Letting the browser
        // start a native drag (or a text-selection drag) on top of a pointer drag
        // hijacks the pointer events mid-gesture, so only text editing keeps the
        // browser's drag behaviour.
        const source = event.target;
        if (source instanceof Element && source.closest('textarea, input, [contenteditable="true"]')) {
          return;
        }
        event.preventDefault();
      }}
    >
      <div className="board__grid" data-board-surface="true" aria-hidden="true" />
      <div
        className="board__world"
        data-testid="world-layer"
        data-zoom={camera.zoom}
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        <div className="origin-marker" data-testid="origin-marker" data-world-x="0" data-world-y="0" aria-hidden="true">
          <span className="origin-marker__h" />
          <span className="origin-marker__v" />
        </div>
        <span style={{ position: 'absolute', left: 0, top: 0 }} data-testid="origin-point" />
        {import.meta.env.MODE === 'test' ? <FarAnchor /> : null}
        {children}
      </div>
      <BoardChrome api={api} />
    </div>
  );
}

/**
 * Test-only anchor at the tested far extent, so e2e can verify exact panning
 * 1,000,000 world units from the start without dragging a million pixels.
 * Tree-shaken out of production builds.
 */
function FarAnchor() {
  return (
    <div
      className="origin-marker origin-marker--far"
      data-testid="far-anchor"
      data-world-x="1000000"
      data-world-y="1000000"
      aria-hidden="true"
      style={{ transform: 'translate(1000000px, 1000000px)' }}
    >
      <span className="origin-marker__h" />
      <span className="origin-marker__v" />
    </div>
  );
}

/** Board chrome: zoom controls and the first-use hint, wired to the camera. */
function BoardChrome({ api }: { api: CameraApi }) {
  return (
    <>
      <NavigationHint visible={!api.hasNavigated} />
      <ZoomControls
        zoomPercent={zoomPercent(api.camera)}
        canZoomIn={canZoomIn(api.camera)}
        canZoomOut={canZoomOut(api.camera)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
    </>
  );
}
