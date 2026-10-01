import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { MarqueeRect, useMarquee } from '../board/Marquee';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Camera, type Point, type Size } from './camera';
import { NavigationHint } from './NavigationHint';
import { installTestHooks } from './testHooks';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';

const WHEEL_LINE_PIXELS = 16;
const WHEEL_PAGE_PIXELS = 800;
const DOT_RADIUS_PX = 1.2;
const GRID_DOT_COLOR = '#c4c9d2';
const MARKER_ARM_PX = 8;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

const NO_OBJECTS: readonly ObjectSnapshot[] = [];

function positiveMod(v: number, m: number): number {
  return ((v % m) + m) % m;
}

interface GestureLike extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

export interface ViewportContext {
  camera: Camera;
  /** World point at the centre of the visible board area. */
  viewCentre: Point;
}

export interface BoardViewportProps {
  /** World-layer content; a function receives the current camera. */
  children?: ReactNode | ((ctx: ViewportContext) => ReactNode);
  /** Screen-space content rendered above the board. */
  overlay?: (ctx: ViewportContext) => ReactNode;
  /** Double-click on empty board space, in world coordinates. */
  onDoubleClickEmpty?: (world: Point) => void;
  /** Click (press and release without dragging) on empty board space. */
  onClickEmpty?: () => void;
  /** Objects for Shift+drag selection and what to do with the ids fully inside the rectangle. */
  snapshot?: readonly ObjectSnapshot[];
  onMarqueeSelect?: (ids: string[]) => void;
  /** With the Text tool active a click anywhere on the board (also on top of objects) places text there. */
  textToolActive?: boolean;
  onTextClick?: (world: Point) => void;
}

export function BoardViewport({ children, overlay, onDoubleClickEmpty, onClickEmpty, snapshot = NO_OBJECTS, onMarqueeSelect, textToolActive = false, onTextClick }: BoardViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: window.innerWidth, height: window.innerHeight });
  const cam = useCamera(size);
  const [panning, setPanning] = useState(false);
  const downPoint = useRef<Point | null>(null);
  const marqueeActive = useRef(false);

  // Event handlers registered once read the latest api through a ref.
  const apiRef = useRef(cam);
  apiRef.current = cam;

  useEffect(() => installTestHooks((c) => apiRef.current.setCamera(c)), []);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const localPoint = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit =
        e.deltaMode === DOM_DELTA_LINE ? WHEEL_LINE_PIXELS : e.deltaMode === DOM_DELTA_PAGE ? WHEEL_PAGE_PIXELS : 1;
      apiRef.current.wheel({
        deltaX: e.deltaX * unit,
        deltaY: e.deltaY * unit,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: localPoint(e.clientX, e.clientY),
      });
    };

    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureLike;
      if (!(g.scale > 0)) return;
      apiRef.current.zoomBy(localPoint(g.clientX ?? 0, g.clientY ?? 0), g.scale / lastScale);
      lastScale = g.scale;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, []);

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

  const marquee = useMarquee(cam.camera, snapshot, (ids) => onMarqueeSelect?.(ids));
  const surfacePoint = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (e.shiftKey) {
      marqueeActive.current = true;
      marquee.begin(surfacePoint(e));
      return;
    }
    downPoint.current = { x: e.clientX, y: e.clientY };
    cam.beginPan({ x: e.clientX, y: e.clientY });
    setPanning(true);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeActive.current) {
      marqueeActive.current = false;
      marquee.end();
      return;
    }
    const down = downPoint.current;
    downPoint.current = null;
    if (down && e.target === e.currentTarget && Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_THRESHOLD_PX) {
      onClickEmpty?.();
    }
    endPan();
  };
  // While the Text tool is active the board neither pans, selects nor drags: the press is swallowed and the click places text.
  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (textToolActive && e.button === 0) e.stopPropagation();
  };
  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!textToolActive || e.button !== 0) return;
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    onTextClick?.(screenToWorld(apiRef.current.camera, { x: e.clientX - r.left, y: e.clientY - r.top }));
  };
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !onDoubleClickEmpty) return;
    const r = e.currentTarget.getBoundingClientRect();
    onDoubleClickEmpty(screenToWorld(apiRef.current.camera, { x: e.clientX - r.left, y: e.clientY - r.top }));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeActive.current) {
      marquee.move(surfacePoint(e));
      return;
    }
    cam.panMove({ x: e.clientX, y: e.clientY });
  };
  const endPan = () => {
    if (marqueeActive.current) {
      marqueeActive.current = false;
      marquee.cancel();
    }
    cam.endPan();
    setPanning(false);
  };

  const { camera } = cam;
  const ctx: ViewportContext = {
    camera,
    viewCentre: screenToWorld(camera, { x: size.width / 2, y: size.height / 2 }),
  };
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at multiples of GRID_SPACING_WORLD: each tile has its dot at the centre.
  const bgX = positiveMod(-camera.x * camera.zoom - spacing / 2, spacing);
  const bgY = positiveMod(-camera.y * camera.zoom - spacing / 2, spacing);

  return (
    <>
      <div
        ref={surfaceRef}
        data-testid="board-viewport"
        tabIndex={0}
        onPointerDownCapture={onPointerDownCapture}
        onClickCapture={onClickCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'hidden',
          background: '#fafafa',
          backgroundImage: `radial-gradient(circle at center, ${GRID_DOT_COLOR} ${DOT_RADIUS_PX}px, transparent ${DOT_RADIUS_PX + 0.5}px)`,
          backgroundSize: `${spacing}px ${spacing}px`,
          backgroundPosition: `${bgX}px ${bgY}px`,
          cursor: textToolActive ? 'text' : panning ? 'grabbing' : 'grab',
          touchAction: 'none',
          outline: 'none',
        }}
      >
        <div
          data-testid="world-layer"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transformOrigin: '0 0',
            transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          }}
        >
          <div
            data-testid="origin-marker"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: -MARKER_ARM_PX,
              top: -MARKER_ARM_PX,
              width: MARKER_ARM_PX * 2,
              height: MARKER_ARM_PX * 2,
              pointerEvents: 'none',
              background: `linear-gradient(#9aa3b2,#9aa3b2) center/1px 100% no-repeat, linear-gradient(#9aa3b2,#9aa3b2) center/100% 1px no-repeat`,
            }}
          />
          {typeof children === 'function' ? children(ctx) : children}
          <MarqueeRect rect={marquee.rect} camera={camera} />
        </div>
      </div>
      {overlay?.(ctx)}
      <NavigationHint visible={!cam.hasNavigated} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
    </>
  );
}
