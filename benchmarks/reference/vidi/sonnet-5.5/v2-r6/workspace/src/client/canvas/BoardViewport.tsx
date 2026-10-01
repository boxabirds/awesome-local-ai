import {
  useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode,
} from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { MarqueeRect, useMarquee } from '../board/Marquee';
import {
  canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Camera, type Point, type Size,
} from './camera';
import { NavigationHint } from './NavigationHint';
import { installTestHooks } from './testHooks';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';

const WHEEL_LINE_PIXELS = 16;
const WHEEL_PAGE_PIXELS = 800;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const GRID_DOT_RADIUS_PX = 1;
const GRID_DOT_COLOR = 'rgba(0, 0, 0, 0.22)';
const HALF = 2;
const PRIMARY_BUTTON = 0;

interface GestureEvent extends Event { scale: number; clientX?: number; clientY?: number }

function positiveMod(v: number, m: number): number {
  return ((v % m) + m) % m;
}

export interface BoardContext {
  camera: Camera;
  size: Size;
  /** World point at the centre of the visible board area. */
  centreWorld(): Point;
}

export interface BoardViewportProps {
  /** World-layer content; a function receives the current camera. */
  children?: ReactNode | ((ctx: BoardContext) => ReactNode);
  /** Screen-space content (toolbars) rendered above the board. */
  overlay?: (ctx: BoardContext) => ReactNode;
  /** Double-click on empty board space, with the world point. */
  onEmptyDoubleClick?(world: Point): void;
  /** Click (press and release without dragging) on empty board space. */
  onEmptyClick?(): void;
  /** Objects for Shift+drag selection; with onMarqueeSelect enables the marquee. */
  snapshot?: readonly ObjectSnapshot[];
  /** Ids fully inside a finished Shift+drag rectangle (never called with an empty list). */
  onMarqueeSelect?(ids: string[]): void;
  /** Kept up to date with the current camera so gestures outside the viewport can read the zoom. */
  cameraRef?: { current: Camera };
  /** Active tool; with 'text' the board neither pans nor selects and a click reports a world point. */
  tool?: 'select' | 'text';
  /** A click on the board (also on top of objects) while the Text tool is active. */
  onTextToolClick?(world: Point): void;
}

const NO_OBJECTS: readonly ObjectSnapshot[] = [];

export function BoardViewport(props: BoardViewportProps) {
  const { children, overlay, onEmptyDoubleClick, onEmptyClick, cameraRef } = props;
  const textTool = props.tool === 'text';
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<Point | null>(null);
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth, height: window.innerHeight,
  }));
  const cam = useCamera(size);
  const { camera } = cam;
  if (cameraRef) cameraRef.current = camera;
  const marquee = useMarquee(camera, props.snapshot ?? NO_OBJECTS, (ids) => props.onMarqueeSelect?.(ids));
  const marqueeActive = marquee.rect !== null;
  const { beginPan, panMove, endPan, wheel, zoomAtPoint, zoomStep, reset, setCamera } = cam;

  // Viewport size from a ResizeObserver; camera x,y (top-left) is intentionally unchanged.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => installTestHooks({ setCamera }), [setCamera]);

  // Non-passive wheel + Safari gesture listeners (React's onWheel is passive).
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const toPoint = (clientX: number, clientY: number): Point => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === DOM_DELTA_LINE ? WHEEL_LINE_PIXELS
        : e.deltaMode === DOM_DELTA_PAGE ? WHEEL_PAGE_PIXELS : 1;
      wheel({
        deltaX: e.deltaX * unit,
        deltaY: e.deltaY * unit,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toPoint(e.clientX, e.clientY),
      });
    };
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      if (!(g.scale > 0)) return;
      const ratio = g.scale / lastScale;
      lastScale = g.scale;
      const point = g.clientX === undefined || g.clientY === undefined
        ? { x: el.clientWidth / HALF, y: el.clientHeight / HALF }
        : toPoint(g.clientX, g.clientY);
      zoomAtPoint(point, ratio);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [wheel, zoomAtPoint]);

  // Ctrl/Cmd + = / - / 0.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  // Escape abandons a marquee in progress without touching the selection (and without clearing it).
  useEffect(() => {
    if (!marqueeActive) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      marquee.cancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [marqueeActive, marquee]);

  const surfacePoint = (e: PointerEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const marqueeRef = useRef(false);

  const isSurface = (e: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) =>
    e.target === e.currentTarget || (e.target as HTMLElement).dataset?.boardSurface !== undefined;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== PRIMARY_BUTTON || !isSurface(e)) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (e.shiftKey && props.onMarqueeSelect) {
      marqueeRef.current = true;
      marquee.begin(surfacePoint(e));
      return;
    }
    pressRef.current = { x: e.clientX, y: e.clientY };
    beginPan({ x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (marqueeRef.current) {
      marquee.move(surfacePoint(e));
      return;
    }
    panMove({ x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (marqueeRef.current) {
      marqueeRef.current = false;
      marquee.move(surfacePoint(e));
      marquee.end();
      return;
    }
    const press = pressRef.current;
    pressRef.current = null;
    endPan();
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD_PX) onEmptyClick?.();
  };
  const onPointerEnd = () => {
    if (marqueeRef.current) {
      marqueeRef.current = false;
      marquee.cancel();
    }
    pressRef.current = null;
    endPan();
  };
  // With the Text tool nothing on the board reacts to the press (no pan, marquee, selection or drag);
  // the click that follows places the text, so the new editor keeps focus.
  const onTextToolPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!textTool || e.button !== PRIMARY_BUTTON) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const onTextToolClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!textTool || e.button !== PRIMARY_BUTTON) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    props.onTextToolClick?.(screenToWorld(camera, { x: e.clientX - r.left, y: e.clientY - r.top }));
  };
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!isSurface(e)) return;
    const r = e.currentTarget.getBoundingClientRect();
    onEmptyDoubleClick?.(screenToWorld(camera, { x: e.clientX - r.left, y: e.clientY - r.top }));
  };
  const ctx: BoardContext = {
    camera,
    size,
    centreWorld: () => screenToWorld(camera, { x: size.width / HALF, y: size.height / HALF }),
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at the centre of each tile, so shift by half a tile to land on world multiples of the spacing.
  const surfaceStyle: CSSProperties = {
    backgroundImage: `radial-gradient(circle, ${GRID_DOT_COLOR} ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${positiveMod(-camera.x * camera.zoom - spacing / HALF, spacing)}px ${positiveMod(-camera.y * camera.zoom - spacing / HALF, spacing)}px`,
    cursor: textTool ? 'text' : cam.isPanning ? 'grabbing' : 'grab',
  };

  return (
    <div className="board-root">
      <div
        ref={surfaceRef}
        className="board-viewport"
        data-testid="board-viewport"
        data-pan-state={cam.isPanning ? 'panning' : 'idle'}
        data-tool={textTool ? 'text' : 'select'}
        onPointerDownCapture={onTextToolPointerDown}
        onClickCapture={onTextToolClick}
        data-board-surface=""
        style={surfaceStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
      >
        <div
          className="board-world"
          data-testid="board-world"
          data-board-surface=""
          style={{
            transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
            transformOrigin: '0 0',
          }}
        >
          <div className="board-origin-marker" data-testid="origin-marker" />
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
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
    </div>
  );
}
