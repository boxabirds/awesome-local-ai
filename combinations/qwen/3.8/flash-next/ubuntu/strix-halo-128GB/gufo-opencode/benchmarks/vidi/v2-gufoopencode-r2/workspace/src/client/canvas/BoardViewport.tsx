import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useCamera } from './useCamera';
import { type Camera, type Size, type Point, worldToScreen, screenToWorld, canZoomIn, canZoomOut, zoomPercent } from './camera';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { ZoomControls } from './ZoomControls';
import { NavigationHint } from './NavigationHint';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import type { ObjectSnapshot } from '../../shared/board-model';

const DOT_COLOR = '#c8cdd4';
const DOT_RADIUS_PX = 1.5;
// Wheel deltaMode conversions to CSS pixels (0 = pixels, 1 = lines, 2 = pages).
const DELTA_MODE_LINE_PX = 16;
const GESTURE_EVENT = 'gesturechange';
const GESTURE_START_EVENT = 'gesturestart';

interface SafariGestureEventLike extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

// Imperative view of the camera for siblings rendered by App (the note
// toolbar and the Sticky note button need world <-> screen conversions).
export interface ViewportHandle {
  camera: Camera;
  screenToWorld(p: Point): Point;
  worldToScreen(p: Point): Point;
  centerWorld(): Point;
}

export interface BoardViewportProps {
  children?: ReactNode;
  // A double-click landed on empty board space, in world coordinates.
  onCreateStickyAtWorld?(world: Point): void;
  // A click without dragging landed on empty board space.
  onClearSelection?(): void;
  onViewportHandle?(handle: ViewportHandle): void;
  // Story 7: Shift+drag on empty space draws a marquee and selects the fully
  // enclosed objects instead of panning.
  snapshot?: readonly ObjectSnapshot[];
  onMarqueeSelect?(ids: string[]): void;
  // Screen-space layer (selection overlay) rendered above the world layer.
  overlay?: ReactNode;
}

export function BoardViewport({
  children,
  onCreateStickyAtWorld,
  onClearSelection,
  onViewportHandle,
  snapshot,
  onMarqueeSelect,
  overlay,
}: BoardViewportProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const api = useCamera(viewport);
  const { camera } = api;
  const { x, y, zoom } = camera;

  // Viewport size from a ResizeObserver. Camera x,y (top-left) are deliberately
  // untouched on resize, so content does not move relative to the top-left corner.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Wheel: attached non-passive so it never page-zooms or page-scrolls.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factorX = e.deltaMode === 1 ? DELTA_MODE_LINE_PX : e.deltaMode === 2 ? rect.width : 1;
      const factorY = e.deltaMode === 1 ? DELTA_MODE_LINE_PX : e.deltaMode === 2 ? rect.height : 1;
      api.wheel({
        deltaX: e.deltaX * factorX,
        deltaY: e.deltaY * factorY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [api.wheel]);

  // Safari trackpad pinch arrives as gesturestart/gesturechange.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let gestureScale = 1;
    const pointOf = (e: SafariGestureEventLike): Point => {
      const rect = el.getBoundingClientRect();
      return {
        x: (e.clientX ?? rect.width / 2) - rect.left,
        y: (e.clientY ?? rect.height / 2) - rect.top,
      };
    };
    const onStart = (e: Event) => {
      e.preventDefault();
      gestureScale = (e as SafariGestureEventLike).scale ?? 1;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as SafariGestureEventLike).scale ?? gestureScale;
      const ratio = scale / (gestureScale || 1);
      gestureScale = scale;
      if (ratio !== 1) api.zoomBy(ratio, pointOf(e as SafariGestureEventLike));
    };
    el.addEventListener(GESTURE_START_EVENT, onStart);
    el.addEventListener(GESTURE_EVENT, onChange);
    return () => {
      el.removeEventListener(GESTURE_START_EVENT, onStart);
      el.removeEventListener(GESTURE_EVENT, onChange);
    };
  }, [api.zoomBy]);

  // Keyboard: Ctrl/Cmd + =, -, 0 (board is always present; prevents page zoom).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        api.zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        api.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        api.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api.zoomStep, api.reset]);

  // A press on bare board space that releases without moving past the drag
  // threshold counts as a click on empty space (clears selection in App).
  const emptyPressRef = useRef<{ x: number; y: number } | null>(null);

  // Story 7: Shift+drag on empty space selects instead of panning.
  const marquee = useMarquee(camera, snapshot ?? [], (ids) => onMarqueeSelect?.(ids));
  const marqueeActiveRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && marqueeActiveRef.current) {
        marqueeActiveRef.current = false;
        marquee.cancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [marquee.cancel]);

  // Drag pans only when it starts on bare board surface (viewport or grid),
  // so future board objects can stop propagation.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (!el) return;
    if (e.target !== el && e.target !== gridRef.current) return;
    if (e.shiftKey && onMarqueeSelect) {
      if (typeof el.setPointerCapture === 'function') {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Pointer capture unsupported (e.g. jsdom): moves on the element still work.
        }
      }
      const rect = el.getBoundingClientRect();
      marqueeActiveRef.current = true;
      marquee.begin({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      return;
    }
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture unsupported (e.g. jsdom): moves on the element still work.
      }
    }
    const rect = el.getBoundingClientRect();
    emptyPressRef.current = { x: e.clientX, y: e.clientY };
    api.beginPan({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setPanning(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (marqueeActiveRef.current) {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      marquee.move({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      return;
    }
    if (!panning) return;
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    api.panMove({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const endPanning = () => {
    emptyPressRef.current = null;
    api.endPan();
    setPanning(false);
  };

  const endMarquee = (finish: boolean) => {
    if (!marqueeActiveRef.current) return;
    marqueeActiveRef.current = false;
    if (finish) marquee.end();
    else marquee.cancel();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (marqueeActiveRef.current) {
      endMarquee(true);
      return;
    }
    const press = emptyPressRef.current;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD_PX) {
      onClearSelection?.();
    }
    endPanning();
  };

  // Double-click on empty board creates a sticky note centred on the point.
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (!el) return;
    if (e.target !== el && e.target !== gridRef.current) return;
    const rect = el.getBoundingClientRect();
    const world = screenToWorld(camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    onCreateStickyAtWorld?.(world);
  };

  // Expose an imperative viewport handle for App-rendered siblings.
  useEffect(() => {
    onViewportHandle?.({
      camera,
      screenToWorld: (p: Point) => screenToWorld(camera, p),
      worldToScreen: (p: Point) => worldToScreen(camera, p),
      centerWorld: () =>
        screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }),
    });
  }, [camera, viewport, onViewportHandle]);

  const spacingPx = GRID_SPACING_WORLD * zoom;
  const originScreen = worldToScreen(camera, { x: 0, y: 0 });
  const gridPositionX = mod(originScreen.x - spacingPx / 2, spacingPx);
  const gridPositionY = mod(originScreen.y - spacingPx / 2, spacingPx);

  return (
    <div
      ref={viewportRef}
      data-testid="board-viewport"
      data-interaction={panning ? 'panning' : 'idle'}
      className="board-viewport"
      style={{ cursor: panning ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        endMarquee(false);
        endPanning();
      }}
      onLostPointerCapture={() => {
        if (marqueeActiveRef.current) endMarquee(true);
        else endPanning();
      }}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={gridRef}
        data-testid="board-grid"
        className="board-grid"
        style={{
          backgroundImage: `radial-gradient(circle at center, ${DOT_COLOR} 0 ${DOT_RADIUS_PX}px, transparent ${DOT_RADIUS_PX + 0.5}px)`,
          backgroundSize: `${spacingPx}px ${spacingPx}px`,
          backgroundPosition: `${gridPositionX}px ${gridPositionY}px`,
        }}
      />
      <div
        data-testid="world-layer"
        className="world-layer"
        data-camera={`${x},${y},${zoom}`}
        style={
          {
            transform: `scale(${zoom}) translate(${-x}px, ${-y}px)`,
            transformOrigin: '0 0',
            '--board-zoom': zoom,
          } as React.CSSProperties
        }
      >
        <div data-testid="origin-marker" className="origin-marker" aria-hidden="true" />
        {children}
        <MarqueeRect rect={marquee.rect} camera={camera} />
      </div>
      {overlay}
      <div className="board-ui" data-board-ui="true">
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => api.zoomStep('in')}
          onZoomOut={() => api.zoomStep('out')}
          onReset={api.reset}
        />
        <NavigationHint visible={!api.hasNavigated} />
      </div>
    </div>
  );
}
