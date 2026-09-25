import { useEffect, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Camera, type Point, type Size } from './camera';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';
import { NavigationHint } from './NavigationHint';
import { installTestHooks } from './testHooks';
import { WorldOverlayContext } from './worldOverlay';
import { MarqueeRect, useMarquee } from '../board/Marquee';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  GRID_DOT_RADIUS_PX,
  GRID_FADE_BELOW_SPACING_PX,
  GRID_SPACING_WORLD,
  WHEEL_LINE_HEIGHT_PX,
} from '../../shared/config';

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const GRID_DOT_RGB = '120, 120, 140';

/** Screen-space dot grid for a camera. Dots sit on world multiples of GRID_SPACING_WORLD. */
export function gridBackground(cam: Camera) {
  const spacing = GRID_SPACING_WORLD * cam.zoom;
  // Each tile is centred on its dot, so the tile starts half a spacing before the world grid line.
  const mod = (v: number) => ((v % spacing) + spacing) % spacing;
  const offsetX = mod(-cam.x * cam.zoom - spacing / 2);
  const offsetY = mod(-cam.y * cam.zoom - spacing / 2);
  const alpha = Math.min(1, spacing / GRID_FADE_BELOW_SPACING_PX);
  return {
    spacing,
    offsetX,
    offsetY,
    backgroundImage: `radial-gradient(circle, rgba(${GRID_DOT_RGB}, ${alpha}) ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX + 0.5}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${offsetX}px ${offsetY}px`,
  };
}

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

interface GestureEventLike extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

/** What board content needs to know about the current view. */
export interface BoardView {
  camera: Camera;
  /** Viewport size in screen px. */
  size: Size;
  /** The world point under a pointer's client coordinates, with the camera as it is now. */
  toWorld(clientX: number, clientY: number): Point;
}

export interface BoardViewportProps {
  /** Objects, rendered in the world layer (world coordinates). */
  children?: ReactNode | ((view: BoardView) => ReactNode);
  /** Fixed screen-space UI (toolbars), rendered above the world layer. */
  overlay?: (view: BoardView) => ReactNode;
  /** Double-click on empty board space, at that world point. */
  onDoubleClickEmpty?(world: Point): void;
  /** Press and release on empty board space without dragging. */
  onEmptyClick?(): void;
  /**
   * Shift+drag on empty board space draws a selection rectangle over these objects; on release the ids lying
   * entirely inside go to `onSelect`. Without this prop Shift+drag pans like a plain drag.
   */
  marquee?: { snapshot: readonly ObjectSnapshot[]; onSelect(ids: string[]): void };
  /**
   * A placing tool is active (story 9 Text tool): the pointer is a text cursor over the board, and a primary click
   * anywhere on the board, on top of objects too, calls this with the pressed world point instead of panning,
   * drawing a marquee or reaching the objects.
   */
  onPlace?(world: Point): void;
  /** Drag-and-drop of files onto the board (story 12 images). */
  dropTarget?: {
    onDragEnter(e: ReactDragEvent): void;
    onDragOver(e: ReactDragEvent): void;
    onDragLeave(e: ReactDragEvent): void;
    onDrop(e: ReactDragEvent): void;
  };
}

const NO_OBJECTS: readonly ObjectSnapshot[] = [];

/** Full-window board: input surface, dot grid and world layer, plus zoom controls and hint overlays. */
export function BoardViewport(props: BoardViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(windowSize);
  const api = useCamera(size);
  const { camera, hasNavigated } = api;
  const apiRef = useRef(api);
  apiRef.current = api;
  const panningPointerRef = useRef<number | null>(null);
  const [panning, setPanning] = useState(false);
  // Where the current press on empty space started (client px), and whether it has become a drag.
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  // A press being placed by the active tool: pointer id and pressed point (viewport px).
  const placeRef = useRef<{ pointerId: number; at: Point } | null>(null);
  const marqueePointerRef = useRef<number | null>(null);
  const onMarqueeSelect = props.marquee?.onSelect;
  const marquee = useMarquee(camera, props.marquee?.snapshot ?? NO_OBJECTS, (ids) => onMarqueeSelect?.(ids));

  const toLocal = (clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };
  const toLocalRef = useRef(toLocal);
  toLocalRef.current = toLocal;

  // Viewport size. The camera is anchored at the top-left, so resizing never moves content.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Non-passive wheel and Safari gesture listeners (React's onWheel is passive).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit =
        e.deltaMode === DOM_DELTA_LINE
          ? WHEEL_LINE_HEIGHT_PX
          : e.deltaMode === DOM_DELTA_PAGE
            ? el.clientHeight || window.innerHeight
            : 1;
      apiRef.current.wheel({
        deltaX: e.deltaX * unit,
        deltaY: e.deltaY * unit,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toLocalRef.current(e.clientX, e.clientY),
      });
    };
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEventLike;
      const scale = Number(g.scale);
      if (!Number.isFinite(scale) || scale <= 0) return;
      const factor = scale / lastScale;
      lastScale = scale;
      const point = Number.isFinite(g.clientX) && Number.isFinite(g.clientY)
        ? toLocalRef.current(g.clientX, g.clientY)
        : { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      apiRef.current.zoomBy(point, factor);
    };
    const onGestureEnd = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // Ctrl/Cmd + = / - / 0 zoom the board instead of the page.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault();
        apiRef.current.zoomStep('in');
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        apiRef.current.zoomStep('out');
      } else if (e.key === '0' || e.code === 'Numpad0') {
        e.preventDefault();
        apiRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(
    () =>
      installTestHooks({
        setCamera: (cam) => apiRef.current.setCamera(cam),
        getCamera: () => apiRef.current.camera,
      }),
    [],
  );

  const endPan = () => {
    if (panningPointerRef.current === null) return;
    panningPointerRef.current = null;
    pressRef.current = null;
    setPanning(false);
    api.endPan();
  };

  const cancelMarquee = () => {
    marqueePointerRef.current = null;
    marquee.cancel();
  };

  const grid = gridBackground(camera);
  const view: BoardView = {
    camera,
    size,
    toWorld: (clientX, clientY) => screenToWorld(apiRef.current.camera, toLocalRef.current(clientX, clientY)),
  };

  /** Board space: empty space or the objects in the world layer, not toolbars or other overlays. */
  const isBoardTarget = (t: EventTarget | null) =>
    t === rootRef.current ||
    (t instanceof Node && !!worldRef.current?.contains(t) && !(overlayEl?.contains(t) ?? false));

  const className = ['board-viewport'];
  if (panning) className.push('board-viewport--panning');
  if (props.onPlace) className.push('board-viewport--placing');

  return (
    <div
      ref={rootRef}
      className={className.join(' ')}
      data-testid="board-viewport"
      data-state={panning ? 'panning' : marquee.rect ? 'marquee' : 'idle'}
      tabIndex={0}
      aria-label="Board"
      style={{
        backgroundImage: grid.backgroundImage,
        backgroundSize: grid.backgroundSize,
        backgroundPosition: grid.backgroundPosition,
      }}
      onDragEnter={props.dropTarget?.onDragEnter}
      onDragOver={props.dropTarget?.onDragOver}
      onDragLeave={props.dropTarget?.onDragLeave}
      onDrop={props.dropTarget?.onDrop}
      onPointerDownCapture={(e) => {
        if (!props.onPlace || e.button !== 0 || !isBoardTarget(e.target)) return;
        // The placing tool owns this press: nothing below (objects, pan, marquee) sees it.
        e.stopPropagation();
        e.preventDefault();
        placeRef.current = { pointerId: e.pointerId, at: toLocal(e.clientX, e.clientY) };
      }}
      onPointerUpCapture={(e) => {
        const press = placeRef.current;
        if (!press || press.pointerId !== e.pointerId) return;
        placeRef.current = null;
        e.stopPropagation();
        props.onPlace?.(screenToWorld(camera, press.at));
      }}
      onPointerDown={(e) => {
        // Only empty board space starts a pan; objects (later stories) handle their own pointers.
        if (e.target !== e.currentTarget) return;
        if (e.button !== 0 && e.button !== 1) return;
        if (panningPointerRef.current !== null || marqueePointerRef.current !== null) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        if (e.shiftKey && e.button === 0 && props.marquee) {
          marqueePointerRef.current = e.pointerId;
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            // Synthetic pointer: moves still arrive while over the board.
          }
          marquee.begin(toLocal(e.clientX, e.clientY));
          return;
        }
        panningPointerRef.current = e.pointerId;
        pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setPanning(true);
        api.beginPan(toLocal(e.clientX, e.clientY));
      }}
      onPointerMove={(e) => {
        if (e.pointerId === marqueePointerRef.current) {
          marquee.move(toLocal(e.clientX, e.clientY));
          return;
        }
        if (e.pointerId !== panningPointerRef.current) return;
        const press = pressRef.current;
        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= DRAG_THRESHOLD_PX) press.moved = true;
        api.panMove(toLocal(e.clientX, e.clientY));
      }}
      onPointerUp={(e) => {
        if (e.pointerId === marqueePointerRef.current) {
          marqueePointerRef.current = null;
          marquee.move(toLocal(e.clientX, e.clientY));
          marquee.end();
          return;
        }
        if (e.pointerId !== panningPointerRef.current) return;
        const clicked = pressRef.current !== null && !pressRef.current.moved;
        endPan();
        if (clicked) props.onEmptyClick?.();
      }}
      onDoubleClick={(e) => {
        // Only empty board space creates; objects handle their own double-clicks.
        if (e.target !== e.currentTarget || !props.onDoubleClickEmpty) return;
        e.preventDefault();
        props.onDoubleClickEmpty(screenToWorld(camera, toLocal(e.clientX, e.clientY)));
      }}
      onPointerCancel={(e) => {
        if (e.pointerId === panningPointerRef.current) endPan();
        if (e.pointerId === marqueePointerRef.current) cancelMarquee();
      }}
      onLostPointerCapture={(e) => {
        if (e.pointerId === panningPointerRef.current) endPan();
        if (e.pointerId === marqueePointerRef.current) cancelMarquee();
      }}
    >
      <div
        ref={worldRef}
        className="board-world"
        data-testid="board-world"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        <div className="board-origin-marker" data-testid="origin-marker" aria-hidden="true" />
        <WorldOverlayContext.Provider value={overlayEl}>
          {typeof props.children === 'function' ? props.children(view) : props.children}
        </WorldOverlayContext.Provider>
        <div ref={setOverlayEl} className="board-world-overlay" data-testid="board-world-overlay" />
      </div>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      {props.overlay?.(view)}
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={() => api.reset()}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
