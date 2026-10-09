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
import type { Tool } from '../board/useTool';

export interface BoardViewportProps {
  camera: Camera;
  size: Size;
  /** The active tool (story 9): 'text' shows the text-tool click layer. */
  tool: Tool;
  /** Text tool: create a text object with its top-left at `world`. */
  onCreateTextAt(world: Point): void;
  onBeginPan(p: Point): void;
  onPanMove(p: Point): void;
  onEndPan(): void;
  onWheel(e: WheelInput): void;
  onDblClickEmpty(worldPoint: Point): void;
  onEmptyClick(): void;
  /** Shift+drag marquee (screen-space points). */
  onMarqueeStart(screen: Point): void;
  onMarqueeMove(screen: Point): void;
  onMarqueeEnd(): void;
  onMarqueeCancel(): void;
  children?: ReactNode;
}

function capture(el: Element | null, pointerId: number): void {
  try {
    if (el && typeof el.setPointerCapture === 'function') el.setPointerCapture(pointerId);
  } catch {
    // capture is best-effort (jsdom lacks it)
  }
}
function release(el: Element | null, pointerId: number): void {
  try {
    if (el && typeof el.releasePointerCapture === 'function') el.releasePointerCapture(pointerId);
  } catch {
    // pointer capture may already be released
  }
}

/**
 * Input surface: dot grid + world layer (CSS-transformed). Drag on empty space
 * pans; Shift+drag on empty space marquee-selects; double-click on empty space
 * creates; a click without movement on empty space clears the selection.
 * Notes, resize handles and the selection bar stop propagation so the board
 * never pans or creates under them.
 */
export function BoardViewport(props: BoardViewportProps): ReactElement {
  const { camera, size, children } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ local: Point; shift: boolean } | null>(null);

  const handlersRef = useRef(props);
  handlersRef.current = props;

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const toScreen = (e: { clientX: number; clientY: number }): Point => ({
    x: e.clientX,
    y: e.clientY,
  });

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.target !== rootRef.current) return; // notes / handles stop propagation too
    capture(rootRef.current, e.pointerId);
    const shift = e.shiftKey;
    dragRef.current = { local: toLocal(e), shift };
    if (shift) {
      handlersRef.current.onMarqueeStart(toScreen(e));
    } else {
      handlersRef.current.onBeginPan(dragRef.current.local);
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.shift) {
      handlersRef.current.onMarqueeMove(toScreen(e));
    } else {
      handlersRef.current.onPanMove(toLocal(e));
    }
  };

  const finishDrag = (e: ReactPointerEvent, wasClick: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    release(rootRef.current, e.pointerId);
    if (drag.shift) {
      if (wasClick) handlersRef.current.onMarqueeEnd();
      else handlersRef.current.onMarqueeCancel();
      return;
    }
    if (wasClick) {
      const now = toLocal(e);
      if (Math.hypot(now.x - drag.local.x, now.y - drag.local.y) <= DRAG_THRESHOLD_PX) {
        handlersRef.current.onEmptyClick();
      }
    }
    handlersRef.current.onEndPan();
  };

  const onPointerUp = (e: ReactPointerEvent) => finishDrag(e, true);
  const onPointerCancel = (e: ReactPointerEvent) => finishDrag(e, false);
  const onLostPointerCapture = () => {
    if (dragRef.current?.shift) {
      dragRef.current = null;
      handlersRef.current.onMarqueeCancel();
    }
  };

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
        overflow: 'hidden',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
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
      {props.tool === 'text' && (
        <div
          data-text-tool-layer="true"
          style={{ position: 'absolute', inset: 0, cursor: 'text', zIndex: 15 }}
          onClick={(e) => {
            handlersRef.current.onCreateTextAt(screenToWorld(camera, toLocal(e)));
          }}
        />
      )}
    </div>
  );
}
