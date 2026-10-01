import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GRID_SPACING_WORLD } from '../../shared/config';
import type { Size } from './camera';
import type { CameraApi } from './useCamera';

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LINE_HEIGHT_PX = 16;
const GRID_DOT_RADIUS_PX = 1;
const GRID_DOT_COLOR = '#c4c8d0';
const BOARD_BACKGROUND = '#fafbfc';

interface Props {
  controller: CameraApi;
  /** Reports the measured size of the board area. */
  onResize?(size: Size): void;
  children?: ReactNode;
}

type GestureLike = Event & { scale?: number; clientX?: number; clientY?: number };

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function BoardViewport({ controller, onResize, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);

  // Handlers are read through a ref so native listeners are attached once.
  const api = useRef(controller);
  api.current = controller;

  const { camera } = controller;

  const pointOf = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  // Non-passive wheel + Safari gesture listeners (React's onWheel is passive).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const point = (cx: number, cy: number) => {
      const rect = el.getBoundingClientRect();
      return { x: cx - rect.left, y: cy - rect.top };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let unit = 1;
      if (e.deltaMode === DOM_DELTA_LINE) unit = LINE_HEIGHT_PX;
      else if (e.deltaMode === DOM_DELTA_PAGE) unit = el.clientHeight;
      api.current.wheel({
        deltaX: e.deltaX * unit,
        deltaY: e.deltaY * unit,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: point(e.clientX, e.clientY),
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
      const scale = g.scale;
      if (typeof scale !== 'number' || !(scale > 0)) return;
      const rect = el.getBoundingClientRect();
      const p = typeof g.clientX === 'number' && typeof g.clientY === 'number'
        ? point(g.clientX, g.clientY)
        : { x: rect.width / 2, y: rect.height / 2 };
      api.current.zoomAtPoint(p, scale / lastScale);
      lastScale = scale;
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

  // Keyboard zoom shortcuts; preventDefault stops the browser's page zoom.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        api.current.zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        api.current.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        api.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Board area size.
  useEffect(() => {
    const el = ref.current;
    if (!el || !onResize || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      onResize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onResize]);

  const endPan = () => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    api.current.endPan();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget && target.dataset.panSurface === undefined) return;
    panningRef.current = true;
    setPanning(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    api.current.beginPan(pointOf(e.clientX, e.clientY));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    api.current.panMove(pointOf(e.clientX, e.clientY));
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at multiples of the world spacing; the tile's dot is at its centre.
  const offsetX = mod(-camera.x - GRID_SPACING_WORLD / 2, GRID_SPACING_WORLD) * camera.zoom;
  const offsetY = mod(-camera.y - GRID_SPACING_WORLD / 2, GRID_SPACING_WORLD) * camera.zoom;

  return (
    <div
      ref={ref}
      data-testid="board-viewport"
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onLostPointerCapture={endPan}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
        outline: 'none',
        cursor: panning ? 'grabbing' : 'grab',
        backgroundColor: BOARD_BACKGROUND,
        backgroundImage: `radial-gradient(circle, ${GRID_DOT_COLOR} ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX}px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      }}
    >
      <div
        data-testid="world-layer"
        data-pan-surface=""
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
        }}
      >
        <OriginMarker />
        {children}
      </div>
    </div>
  );
}

const MARKER_SIZE = 16;

function OriginMarker() {
  const line = '#9aa3b2';
  return (
    <div
      data-testid="origin-marker"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: -MARKER_SIZE / 2,
        top: -MARKER_SIZE / 2,
        width: MARKER_SIZE,
        height: MARKER_SIZE,
        pointerEvents: 'none',
        backgroundImage: `linear-gradient(${line}, ${line}), linear-gradient(${line}, ${line})`,
        backgroundSize: '1px 100%, 100% 1px',
        backgroundPosition: 'center, center',
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}
