import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useCamera, wheelDeltaToPixels, type CameraApi } from './useCamera';
import { GRID_SPACING_WORLD, DRAG_THRESHOLD_PX } from '../../shared/config';
import type { Camera, Size } from './camera';

function mod(v: number, s: number): number {
  return ((v % s) + s) % s;
}

function measure(el: HTMLElement): Size {
  const w = el.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const h = el.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 800);
  return { width: w, height: h };
}

/** Style derived purely from the camera: dot grid background + world transform.
 * Exported so component tests can assert the DOM matches the camera. */
export function viewportStyle(cam: Camera): {
  backgroundSize: string;
  backgroundPosition: string;
  transform: string;
} {
  const spacing = GRID_SPACING_WORLD * cam.zoom;
  return {
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${mod(-cam.x * cam.zoom, spacing)}px ${mod(-cam.y * cam.zoom, spacing)}px`,
    transform: `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`,
  };
}

export interface BoardViewportProps {
  children?: ReactNode;
  /** Fixed board size (component tests). Omit to measure via ResizeObserver. */
  size?: Size;
  /** Injected camera (App wiring). Omit to create a self-contained camera. */
  api?: CameraApi;
  /** Reports measured size so an injected camera can track the viewport. */
  onSize?: (size: Size) => void;
  /** A pointerup on empty space with no drag: clears the selection. */
  onEmptyClick?(): void;
  /** A double-click on empty space, given the screen point (viewport-relative). */
  onEmptyDblClick?(point: { x: number; y: number }): void;
}

/**
 * The infinite-board input surface: dot grid background, a world layer whose
 * CSS transform is driven by the camera, and the input handlers (drag, wheel,
 * Safari gesture, keyboard) that turn raw events into camera changes.
 */
export function BoardViewport({ children, size, api: apiProp, onSize, onEmptyClick, onEmptyDblClick }: BoardViewportProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Size>(() => ({ width: 1280, height: 800 }));
  // Tracks a press that began on empty space so a later pointerup can tell a
  // click (clear selection) from a drag (pan).
  const emptyPress = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // Always call the hook (rules of hooks); the injected api wins when present.
  const localApi = useCamera(size ?? measured);
  const api = apiProp ?? localApi;

  const apiRef = useRef<CameraApi>(api);
  apiRef.current = api;
  const gestureScale = useRef(1);

  // Track viewport size. Camera x/y are intentionally NOT changed on resize.
  useEffect(() => {
    if (size) return; // fixed size supplied by a test: skip observation
    const el = elRef.current;
    if (!el) return;
    const update = () => {
      const next = measure(el);
      setMeasured(next);
      onSize?.(next);
    };
    update();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // Non-passive wheel (page zoom suppression), Safari gesture, keyboard.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode);
      const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode);
      apiRef.current.wheel({ deltaX: dx, deltaY: dy, ctrlOrMeta, point });
      // Over the board we always own the scroll/zoom gesture.
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale.current = (e as unknown as { scale?: number }).scale ?? 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as { scale?: number; clientX?: number; clientY?: number };
      const scale = ge.scale ?? 1;
      const rect = el.getBoundingClientRect();
      const point = { x: (ge.clientX ?? 0) - rect.left, y: (ge.clientY ?? 0) - rect.top };
      const factor = scale / gestureScale.current;
      gestureScale.current = scale;
      apiRef.current.zoomAtPoint(point, factor);
    };
    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);

    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        apiRef.current.zoomStep('in');
        e.preventDefault();
      } else if (e.key === '-' || e.key === '_') {
        apiRef.current.zoomStep('out');
        e.preventDefault();
      } else if (e.key === '0') {
        apiRef.current.reset();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Test-only camera hook. Excluded from production builds (MODE !== 'test').
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    const w = window as unknown as { __vidi6?: Record<string, unknown> };
    w.__vidi6 = {
      getCamera: () => apiRef.current.getCamera(),
      setCamera: (c: Camera) => apiRef.current.setCamera(c),
      reset: () => apiRef.current.reset(),
      zoomStep: (d: 'in' | 'out') => apiRef.current.zoomStep(d),
    };
  }, []);

  const cam = api.camera;
  const style = viewportStyle(cam);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Drag only begins on empty space: the target must be the viewport itself,
    // so later object layers can stopPropagation and win their own gestures.
    if (e.target !== e.currentTarget) return;
    emptyPress.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    api.beginPan({ x: e.clientX, y: e.clientY });
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (emptyPress.current) {
      const dx = e.clientX - emptyPress.current.x;
      const dy = e.clientY - emptyPress.current.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) emptyPress.current.moved = true;
    }
    // panMove is a no-op unless a pan is active (guarded inside the hook), so
    // it is safe to call for every move without a stale-mode check.
    api.panMove({ x: e.clientX, y: e.clientY });
  };

  const handleEndPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    // A click on empty space with no drag clears the selection.
    if (emptyPress.current && !emptyPress.current.moved) onEmptyClick?.();
    emptyPress.current = null;
    api.endPan();
  };

  const handleDoubleClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only the empty board creates a note; a note (or toolbar) handles its own
    // double-click and stops propagation before it reaches here.
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onEmptyDblClick?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={elRef}
      data-testid="board-viewport"
      data-mode={api.mode}
      className="board-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        touchAction: 'none',
        cursor: api.mode === 'panning' ? 'grabbing' : 'grab',
        backgroundColor: '#fafafa',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(17,17,17,0.22) 1px, rgba(0,0,0,0) 1.5px)',
        backgroundSize: style.backgroundSize,
        backgroundPosition: style.backgroundPosition,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handleEndPan}
      onPointerCancel={handleEndPan}
      onLostPointerCapture={() => api.endPan()}
      onDoubleClick={handleDoubleClick}
    >
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transformOrigin: '0 0',
          transform: style.transform,
          pointerEvents: 'none',
        }}
      >
        <div
          data-testid="origin-marker"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '-8px',
            top: '-8px',
            width: '16px',
            height: '16px',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: '7px',
              width: '16px',
              height: '2px',
              background: '#e0457b',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '7px',
              top: 0,
              width: '2px',
              height: '16px',
              background: '#e0457b',
            }}
          />
        </div>
        {children}
      </div>
    </div>
  );
}