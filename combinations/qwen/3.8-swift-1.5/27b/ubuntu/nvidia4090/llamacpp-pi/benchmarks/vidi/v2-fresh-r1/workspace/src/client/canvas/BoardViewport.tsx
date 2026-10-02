// The board's input surface: dot grid, world layer and all navigation
// gestures (pointer drag, wheel, Safari pinch, keyboard shortcuts).

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { GRID_SPACING_WORLD, WHEEL_LINE_DELTA_PX, WHEEL_PAGE_DELTA_PX } from '../../shared/config';
import type { CameraApi } from './useCamera';

export const CameraContext = createContext<CameraApi | null>(null);

export function useCameraContext(): CameraApi {
  const ctx = useContext(CameraContext);
  if (!ctx) throw new Error('useCameraContext must be used within a CameraContext provider');
  return ctx;
}

/** Safari's GestureEvent (not in the standard TS DOM lib). */
interface GestureLikeEvent extends Event {
  readonly scale: number;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export function BoardViewport(props: {
  children?: ReactNode;
  onDblClickEmpty?: (screenPoint: { x: number; y: number }) => void;
  onClickEmpty?: () => void;
}) {
  const api = useCameraContext();
  const { camera, isPanning, beginPan, panMove, endPan } = api;
  const wheelCb = api.wheel;
  const zoomByFactorCb = api.zoomByFactor;
  const zoomStepCb = api.zoomStep;
  const resetCb = api.reset;

  const ref = useRef<HTMLDivElement>(null);
  const lastScaleRef = useRef(1);

  // Wheel: non-passive so preventDefault always works (React's onWheel is
  // passive). Plain wheel pans; Ctrl/Cmd wheel zooms around the pointer.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= WHEEL_LINE_DELTA_PX;
        dy *= WHEEL_LINE_DELTA_PX;
      } else if (e.deltaMode === 2) {
        dx *= WHEEL_PAGE_DELTA_PX;
        dy *= WHEEL_PAGE_DELTA_PX;
      }
      wheelCb({
        deltaX: dx,
        deltaY: dy,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheelCb]);

  // Safari pinch: gesturestart/gesturechange with the scale ratio.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScaleRef.current = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as GestureLikeEvent).scale;
      if (!Number.isFinite(scale) || scale <= 0) return;
      const rect = el.getBoundingClientRect();
      zoomByFactorCb(scale / lastScaleRef.current, { x: rect.width / 2, y: rect.height / 2 });
      lastScaleRef.current = scale;
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [zoomByFactorCb]);

  // Keyboard: Ctrl/Cmd + = / - / 0. preventDefault stops page zoom.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStepCb('in');
      } else if (e.key === '-') {
        e.preventDefault();
        zoomStepCb('out');
      } else if (e.key === '0') {
        e.preventDefault();
        resetCb();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStepCb, resetCb]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Drag starts only on empty board space (the viewport/grid itself), so
    // later object stories can stop propagation from their own elements.
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    beginPan({ x: e.clientX, y: e.clientY });
  };

  // Double-click on empty space → create sticky note
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    props.onDblClickEmpty?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Click on empty space (pointerup without drag) → clear selection
  const onClickEmpty = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    props.onClickEmpty?.();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    panMove({ x: e.clientX, y: e.clientY });
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;

  return (
    <div
      ref={ref}
      data-testid="board-viewport"
      data-state={isPanning ? 'panning' : 'idle'}
      className="board-viewport"
      style={{
        cursor: isPanning ? 'grabbing' : 'grab',
        backgroundImage: 'radial-gradient(circle, var(--grid-dot-color) 1.5px, transparent 1.5px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${mod(-camera.x * camera.zoom, spacing)}px ${mod(
          -camera.y * camera.zoom,
          spacing,
        )}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onLostPointerCapture={endPan}
      onDoubleClick={onDoubleClick}
      onClick={onClickEmpty}
    >
      <div
        data-testid="world-layer"
        className="world-layer"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        <div data-testid="origin-marker" className="origin-marker" />
        {props.children}
      </div>
    </div>
  );
}
