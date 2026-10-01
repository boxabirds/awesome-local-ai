import { useEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import { MarqueeRect, useMarquee } from '../board/Marquee';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './camera';
import type { Camera, Point, Size } from './camera';
import { NavigationHint } from './NavigationHint';
import { installTestHooks } from './testHooks';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';

const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_FALLBACK_PX = 800;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const GRID_DOT_RADIUS_PX = 1;
const GRID_DOT_COLOR = 'rgba(30, 41, 59, 0.28)';
const HALF = 2;
const NO_OBJECTS: readonly ObjectSnapshot[] = [];

type GestureEventLike = Event & { scale: number; clientX?: number; clientY?: number };
type Mode = 'idle' | 'panning';

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function gridStyle(cam: Camera): { backgroundSize: string; backgroundPosition: string } {
  const size = GRID_SPACING_WORLD * cam.zoom;
  // Dot sits in the tile centre, so shift by half a tile to land on world multiples of the spacing.
  const px = modulo(-cam.x * cam.zoom - size / HALF, size);
  const py = modulo(-cam.y * cam.zoom - size / HALF, size);
  return { backgroundSize: `${size}px ${size}px`, backgroundPosition: `${px}px ${py}px` };
}

export interface BoardContext {
  camera: Camera;
  zoom: number;
  /** World point at the centre of the visible board area. */
  centerWorld(): Point;
}

export function BoardViewport(props: {
  children?: ReactNode | ((ctx: BoardContext) => ReactNode);
  /** Screen-space layers (toolbars) drawn above the board. */
  overlay?: (ctx: BoardContext) => ReactNode;
  onCreateAt?(world: Point): void;
  /** While the Text tool is active, a press on the board (also on top of objects) places text at this world point. */
  textToolActive?: boolean;
  onPlaceText?(world: Point): void;
  onEmptyClick?(): void;
  /** Objects a Shift+drag rectangle can select, and what to do with the ones fully inside it. */
  snapshot?: readonly ObjectSnapshot[];
  onMarqueeSelect?(ids: string[]): void;
  /** Active tool id, exposed as `data-tool` (the Text tool keeps its own prop). */
  tool?: string;
  /** A full-board layer that owns the pointer while a drawing tool is active. */
  toolLayer?: ReactNode;
  /** File drag-and-drop on the board (images), and the highlight drawn while files are dragged over it. */
  fileDrop?: {
    onDragEnter(e: ReactDragEvent<HTMLDivElement>): void;
    onDragLeave(e: ReactDragEvent<HTMLDivElement>): void;
    onDragOver(e: ReactDragEvent<HTMLDivElement>): void;
    onDrop(e: ReactDragEvent<HTMLDivElement>): void;
  };
  dropHighlight?: ReactNode;
  /** Called after the camera changes (the transform gesture converts pointer movement with it). */
  onCameraChange?(camera: Camera): void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const downPoint = useRef<Point | null>(null);
  const [size, setSize] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const nav = useCamera(size);
  const { camera } = nav;
  const [mode, setMode] = useState<Mode>('idle');
  const modeRef = useRef<Mode>('idle');

  // Always call the latest controller from long-lived listeners.
  const navRef = useRef(nav);
  navRef.current = nav;

  const marquee = useMarquee(camera, props.snapshot ?? NO_OBJECTS, (ids) => props.onMarqueeSelect?.(ids));
  const marqueeActive = useRef(false);
  const onCameraChange = props.onCameraChange;
  useEffect(() => onCameraChange?.(camera), [camera, onCameraChange]);

  // Escape abandons a rectangle in progress, leaving the selection as it was.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && marqueeActive.current) {
        marqueeActive.current = false;
        marquee.cancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [marquee.cancel]);

  useEffect(() => installTestHooks(nav.setCamera, nav.getCamera), [nav.setCamera, nav.getCamera]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = rect.width || window.innerWidth;
      const height = rect.height || window.innerHeight;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const localPoint = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let { deltaX, deltaY } = e;
      if (e.deltaMode === DOM_DELTA_LINE) {
        deltaX *= LINE_HEIGHT_PX;
        deltaY *= LINE_HEIGHT_PX;
      } else if (e.deltaMode === DOM_DELTA_PAGE) {
        const pageHeight = el.clientHeight || PAGE_HEIGHT_FALLBACK_PX;
        deltaX *= pageHeight;
        deltaY *= pageHeight;
      }
      navRef.current.wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: localPoint(e.clientX, e.clientY),
      });
    };

    let lastGestureScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastGestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEventLike;
      if (!Number.isFinite(g.scale) || g.scale <= 0) return;
      const rect = el.getBoundingClientRect();
      const point =
        typeof g.clientX === 'number' && typeof g.clientY === 'number'
          ? localPoint(g.clientX, g.clientY)
          : { x: rect.width / HALF, y: rect.height / HALF };
      navRef.current.zoomBy(point, g.scale / lastGestureScale);
      lastGestureScale = g.scale;
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
        navRef.current.zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        navRef.current.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        navRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const endPan = () => {
    if (modeRef.current === 'idle') return;
    modeRef.current = 'idle';
    setMode('idle');
    nav.endPan();
  };

  const placedByPointer = useRef(false);

  const placeText = (e: { clientX: number; clientY: number; currentTarget: HTMLDivElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    props.onPlaceText?.(screenToWorld(nav.getCamera(), { x: e.clientX - rect.left, y: e.clientY - rect.top }));
  };

  // Capture phase: with the Text tool active no object, pan or marquee may see the press.
  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!props.textToolActive || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault(); // keeps focus where the new editor puts it
    placedByPointer.current = true;
    placeText(e);
  };

  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (placedByPointer.current) {
      placedByPointer.current = false;
      e.stopPropagation();
      return;
    }
    if (!props.textToolActive || e.button !== 0) return;
    e.stopPropagation();
    placeText(e);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Only empty board space starts a drag; later object stories can intercept their own targets.
    if (e.target !== e.currentTarget) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (e.shiftKey) {
      marqueeActive.current = true;
      marquee.begin(viewportPoint(e));
      return;
    }
    downPoint.current = { x: e.clientX, y: e.clientY };
    modeRef.current = 'panning';
    setMode('panning');
    nav.beginPan({ x: e.clientX, y: e.clientY });
  };

  const viewportPoint = (e: ReactPointerEvent<HTMLDivElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeActive.current) {
      marquee.move(viewportPoint(e));
      return;
    }
    if (modeRef.current !== 'panning') return;
    nav.panMove({ x: e.clientX, y: e.clientY });
  };

  const onInterrupted = () => {
    if (marqueeActive.current) {
      marqueeActive.current = false;
      marquee.cancel();
    }
    endPan();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (marqueeActive.current) {
      marqueeActive.current = false;
      marquee.move(viewportPoint(e));
      marquee.end();
      return;
    }
    const down = downPoint.current;
    downPoint.current = null;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_THRESHOLD_PX) props.onEmptyClick?.();
    endPan();
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    props.onCreateAt?.(screenToWorld(nav.getCamera(), { x: e.clientX - rect.left, y: e.clientY - rect.top }));
  };

  const ctx: BoardContext = {
    camera,
    zoom: camera.zoom,
    centerWorld: () => screenToWorld(navRef.current.getCamera(), { x: size.width / HALF, y: size.height / HALF }),
  };

  return (
    <>
      <div
        ref={viewportRef}
        className="board-viewport"
        data-testid="board-viewport"
        data-mode={mode}
        data-tool={props.textToolActive ? 'text' : (props.tool ?? 'select')}
        tabIndex={0}
        style={{
          cursor: props.textToolActive ? 'text' : mode === 'panning' ? 'grabbing' : 'grab',
          backgroundImage: `radial-gradient(circle at center, ${GRID_DOT_COLOR} ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX + 0.5}px)`,
          ...gridStyle(camera),
        }}
        onPointerDownCapture={onPointerDownCapture}
        onClickCapture={onClickCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onDragEnter={props.fileDrop?.onDragEnter}
        onDragLeave={props.fileDrop?.onDragLeave}
        onDragOver={props.fileDrop?.onDragOver}
        onDrop={props.fileDrop?.onDrop}
        onPointerCancel={onInterrupted}
        onLostPointerCapture={onInterrupted}
      >
        <div
          className="board-world"
          data-testid="board-world"
          style={{
            transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
            transformOrigin: '0 0',
          }}
        >
          <div className="origin-marker" data-testid="origin-marker" />
          {typeof props.children === 'function' ? props.children(ctx) : props.children}
          <MarqueeRect rect={marquee.rect} camera={camera} />
        </div>
        {props.toolLayer}
        {props.dropHighlight}
      </div>
      {props.overlay?.(ctx)}
      <NavigationHint visible={!nav.hasNavigated} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => nav.zoomStep('in')}
        onZoomOut={() => nav.zoomStep('out')}
        onReset={nav.reset}
      />
    </>
  );
}
