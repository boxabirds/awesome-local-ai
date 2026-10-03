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
import {
  DRAG_THRESHOLD_PX,
  GRID_SPACING_WORLD,
  WHEEL_LINE_DELTA_PX,
  WHEEL_PAGE_DELTA_PX,
} from '../../shared/config';
import type { CameraApi } from './useCamera';
import type { MarqueeApi } from '../board/Marquee';
import type { Tool } from '../board/useTool';

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
  /** Marquee (shift+drag) selection; omit to disable. */
  marquee?: MarqueeApi;
  /** Active tool (story 9). With 'text', empty-space clicks create text. */
  tool?: Tool;
  /** Create a text object at a screen point (Text tool, story 9). */
  onTextCreate?: (screenPoint: { x: number; y: number }) => void;
}) {
  const api = useCameraContext();
  const { camera, isPanning, beginPan, panMove, endPan } = api;
  const wheelCb = api.wheel;
  const zoomByFactorCb = api.zoomByFactor;
  const zoomStepCb = api.zoomStep;
  const resetCb = api.reset;

  const ref = useRef<HTMLDivElement>(null);
  const lastScaleRef = useRef(1);
  const marqueeRef = useRef<MarqueeApi | undefined>(props.marquee);
  marqueeRef.current = props.marquee;
  // True while a marquee drag is in progress (pointer captured on the
  // viewport, no panning).
  const marqueeActiveRef = useRef(false);
  // Suppress the click event that follows a real drag, so panning or a
  // marquee drag does not clear the selection.
  const suppressClickRef = useRef(false);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);

  // Escape cancels an in-progress marquee.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && marqueeActiveRef.current) {
        marqueeActiveRef.current = false;
        marqueeRef.current?.cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    downPosRef.current = { x: e.clientX, y: e.clientY };

    // Text tool (story 9): no panning or marquee on empty space; a click
    // (handled in onClick) creates a text object.
    if (props.tool === 'text') return;

    // Shift+drag on empty space → marquee selection (story 7).
    if (e.shiftKey && marqueeRef.current) {
      marqueeActiveRef.current = true;
      const rect = e.currentTarget.getBoundingClientRect();
      marqueeRef.current.begin({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      return;
    }
    beginPan({ x: e.clientX, y: e.clientY });
  };

  // Double-click on empty space → create sticky note (not while Text is active)
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (props.tool === 'text') return;
    const rect = e.currentTarget.getBoundingClientRect();
    props.onDblClickEmpty?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Click on empty space (pointerup without drag).
  const onClickEmpty = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    // Text tool (story 9): create a text object at the click point.
    if (props.tool === 'text') {
      const rect = e.currentTarget.getBoundingClientRect();
      props.onTextCreate?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      return;
    }
    props.onClickEmpty?.();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeActiveRef.current) {
      if (marqueeRef.current) {
        const rect = e.currentTarget.getBoundingClientRect();
        marqueeRef.current.move({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
      return;
    }
    panMove({ x: e.clientX, y: e.clientY });
  };

  const finishPointer = (cancel: boolean, e: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeActiveRef.current) {
      marqueeActiveRef.current = false;
      suppressClickRef.current = true;
      if (cancel) marqueeRef.current?.cancel();
      else marqueeRef.current?.end();
      downPosRef.current = null;
      return;
    }
    // Suppress the trailing click after a real pan drag so the selection
    // is only cleared by a genuine click (no drag).
    const down = downPosRef.current;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= DRAG_THRESHOLD_PX) {
      suppressClickRef.current = true;
    }
    downPosRef.current = null;
    endPan();
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;

  return (
    <div
      ref={ref}
      data-testid="board-viewport"
      data-state={isPanning ? 'panning' : 'idle'}
      className="board-viewport"
      style={{
        cursor: isPanning ? 'grabbing' : props.tool === 'text' ? 'text' : 'grab',
        backgroundImage: 'radial-gradient(circle, var(--grid-dot-color) 1.5px, transparent 1.5px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${mod(-camera.x * camera.zoom, spacing)}px ${mod(
          -camera.y * camera.zoom,
          spacing,
        )}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finishPointer(false, e)}
      onPointerCancel={(e) => finishPointer(true, e)}
      onLostPointerCapture={(e) => finishPointer(true, e)}
      onDoubleClick={onDoubleClick}
      onClick={(e) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onClickEmpty(e);
      }}
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
        {/* While the Text tool is active, object clicks fall through to the
            viewport so a click on an object creates text on top at that point. */}
        <div style={{ pointerEvents: props.tool === 'text' ? 'none' : 'auto' }}>
          {props.children}
        </div>
      </div>
    </div>
  );
}
