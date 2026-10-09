import type { ReactElement } from 'react';
import {
  useEffect,
  useRef,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  type Camera,
  type Point,
  type Size,
  screenToWorld,
} from './camera';
import { GRID_SPACING_WORLD, DRAG_THRESHOLD_PX } from '../../shared/config';
import type { WheelInput } from './useCamera';

export interface BoardViewportProps {
  camera: Camera;
  size: Size;
  onBeginPan(p: Point): void;
  onPanMove(p: Point): void;
  onEndPan(): void;
  onWheel(e: WheelInput): void;
  onDblClickEmpty(worldPoint: Point): void;
  onEmptyClick(): void;
  children?: ReactNode;
}

/**
 * Input surface: dot grid + world layer (CSS-transformed). Drag on empty
 * space pans; double-click on empty space creates; a click without movement
 * on empty space clears the selection. Notes stopPropagation so the board
 * never pans or creates under them.
 */
export function BoardViewport(props: BoardViewportProps): ReactElement {
  const { camera, size, children } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const handlersRef = useRef(props);
  handlersRef.current = props;

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.target !== rootRef.current) return; // notes stop propagation too
    rootRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = toLocal(e);
    handlersRef.current.onBeginPan(dragRef.current);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    handlersRef.current.onPanMove(toLocal(e));
  };

  const finishDrag = (e: ReactPointerEvent, wasClick: boolean) => {
    if (!dragRef.current) return;
    const start = dragRef.current;
    dragRef.current = null;
    try {
      rootRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be released
    }
    if (wasClick) {
      const now = toLocal(e);
      if (Math.hypot(now.x - start.x, now.y - start.y) <= DRAG_THRESHOLD_PX) {
        handlersRef.current.onEmptyClick();
      }
    }
    handlersRef.current.onEndPan();
  };

  const onPointerUp = (e: ReactPointerEvent) => finishDrag(e, true);
  const onPointerCancel = (e: ReactPointerEvent) => finishDrag(e, false);

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (e.target !== rootRef.current) return;
    handlersRef.current.onDblClickEmpty(screenToWorld(camera, toLocal(e)));
  };

  // Non-passive wheel: prevent page scroll/zoom for every wheel over the board.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const h = handlersRef.current;
      const rect = el.getBoundingClientRect();
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        // DOM_DELTA_LINE
        dx *= 16;
        dy *= 16;
      } else if (e.deltaMode === 2) {
        dx *= el.clientHeight;
        dy *= el.clientHeight;
      }
      h.onWheel({ deltaX: dx, deltaY: dy, ctrlOrMeta: e.ctrlKey || e.metaKey, point: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
    };
    const onGesture = (e: Event) => {
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGesture as EventListener, { passive: false });
    el.addEventListener('gesturechange', onGesture as EventListener, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGesture as EventListener);
      el.removeEventListener('gesturechange', onGesture as EventListener);
    };
  }, []);

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  const bgX = mod(-camera.x * camera.zoom, spacing);
  const bgY = mod(-camera.y * camera.zoom, spacing);

  return (
    <div
      ref={rootRef}
      className="board-viewport"
      style={{
        width: size.width,
        height: size.height,
        backgroundImage: 'radial-gradient(circle, #b8bcc4 1px, transparent 1.5px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        cursor: dragRef.current ? 'grabbing' : 'default',
        overflow: 'hidden',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="world-layer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </div>
  );
}
