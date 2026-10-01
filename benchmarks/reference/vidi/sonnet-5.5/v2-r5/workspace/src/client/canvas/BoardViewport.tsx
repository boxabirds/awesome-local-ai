import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { screenToWorld, type Point, type Size } from './camera';
import { installTestHooks } from './testHooks';
import { useCamera, type CameraApi } from './useCamera';

const LINE_HEIGHT_PX = 16;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const HALF = 2;
const PRIMARY_BUTTON = 0;

interface GestureLikeEvent extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export type BoardApi = CameraApi & { size: Size };

export function BoardViewport(props: {
  children?: ReactNode | ((api: BoardApi) => ReactNode);
  overlay?: (api: BoardApi) => ReactNode;
  onDoubleClickEmpty?: (world: Point) => void;
  onEmptyClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const api = useCamera(size);
  const apiRef = useRef(api);
  apiRef.current = api;
  const emptyPress = useRef<Point | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // Viewport size from ResizeObserver; camera x,y are untouched so content keeps its top-left anchor.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = el;
      if (width === 0 && height === 0) return;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => installTestHooks({
      setCamera: (c) => apiRef.current.setCamera(c),
      getCamera: () => apiRef.current.getCamera(),
    }),
    [],
  );

  // Non-passive wheel and Safari gesture listeners; keyboard shortcuts on window.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const toPoint = (clientX: number | undefined, clientY: number | undefined) => {
      const r = el.getBoundingClientRect();
      return {
        x: (clientX ?? r.left + sizeRef.current.width / HALF) - r.left,
        y: (clientY ?? r.top + sizeRef.current.height / HALF) - r.top,
      };
    };
    const toPixels = (delta: number, mode: number) => {
      if (mode === DOM_DELTA_LINE) return delta * LINE_HEIGHT_PX;
      if (mode === DOM_DELTA_PAGE) return delta * sizeRef.current.height;
      return delta;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      apiRef.current.wheel({
        deltaX: toPixels(e.deltaX, e.deltaMode),
        deltaY: toPixels(e.deltaY, e.deltaMode),
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toPoint(e.clientX, e.clientY),
      });
    };

    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = (e as GestureLikeEvent).scale ?? 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureLikeEvent;
      const scale = g.scale ?? 1;
      apiRef.current.zoomByFactor(scale / lastScale, toPoint(g.clientX, g.clientY));
      lastScale = scale;
    };

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

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const { camera, panning } = api;
  const boardApi: BoardApi = { ...api, size };
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at the centre of each tile, so shift by half a tile to put them on world multiples.
  const gridX = mod(-camera.x * camera.zoom - spacing / HALF, spacing);
  const gridY = mod(-camera.y * camera.zoom - spacing / HALF, spacing);

  return (
    <>
      <div
        ref={ref}
        className="board-viewport"
        data-testid="board-viewport"
        data-state={panning ? 'panning' : 'idle'}
        tabIndex={-1}
        style={{
          cursor: panning ? 'grabbing' : 'grab',
          backgroundSize: `${spacing}px ${spacing}px`,
          backgroundPosition: `${gridX}px ${gridY}px`,
        }}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget || (e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          emptyPress.current = { x: e.clientX, y: e.clientY };
          api.beginPan({ x: e.clientX, y: e.clientY });
        }}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const r = e.currentTarget.getBoundingClientRect();
          props.onDoubleClickEmpty?.(
            screenToWorld(apiRef.current.getCamera(), { x: e.clientX - r.left, y: e.clientY - r.top }),
          );
        }}
        onPointerMove={(e) => api.panMove({ x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const start = emptyPress.current;
          emptyPress.current = null;
          api.endPan();
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) {
            props.onEmptyClick?.();
          }
        }}
        onPointerCancel={() => { emptyPress.current = null; api.endPan(); }}
        onLostPointerCapture={api.endPan}
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
          {typeof props.children === 'function' ? props.children(boardApi) : props.children}
        </div>
      </div>
      {props.overlay?.(boardApi)}
    </>
  );
}
