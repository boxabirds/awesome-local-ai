import {
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  DRAG_THRESHOLD_PX,
  GRID_SPACING_WORLD,
  WHEEL_LINE_DELTA_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import { CameraContext } from './useCamera';
import type { Point } from './camera';

// Wheel event deltaMode values (DOM spec).
const WHEEL_DELTA_PIXELS = 0;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

// Dot grid appearance (screen-space: dots keep a constant size while the
// spacing scales with zoom so the grid appears attached to the board).
const GRID_DOT_COLOR = '#c4c4ba';
const GRID_DOT_RADIUS_PX = 1;

/**
 * The input surface of the board: dot grid background, world layer (scaled
 * and translated with the camera transform) and all board input handling —
 * pointer drag, wheel (pan and zoom), Safari pinch gestures and the
 * Ctrl/Cmd + =/−/0 keyboard shortcuts.
 *
 * Children render in world coordinates inside the world layer.
 */
interface BoardViewportProps {
  children?: ReactNode;
  /** Double-click on empty board space: create an object at this point. */
  onDoubleClickEmpty?: (p: Point) => void;
  /** Single click (no drag) on empty board space: clear the selection. */
  onEmptyClick?: () => void;
}

export function BoardViewport(props: BoardViewportProps): JSX.Element {
  const { onDoubleClickEmpty, onEmptyClick } = props;
  const controller = useContext(CameraContext);
  if (controller === null) {
    throw new Error('BoardViewport must be rendered inside a CameraContext provider');
  }
  const { camera, beginPan, panMove, endPan, wheel, zoomStep, reset } = controller;

  const viewportRef = useRef<HTMLDivElement>(null);
  const panStartLocalRef = useRef<Point | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const toLocalPoint = (clientX: number, clientY: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // Non-passive wheel listener: React's onWheel is passive, so a native
  // listener is required to preventDefault (stop page scroll and page zoom).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const toPixels = (delta: number): number => {
        if (e.deltaMode === WHEEL_DELTA_LINE) {
          return delta * WHEEL_LINE_DELTA_PX;
        }
        if (e.deltaMode === WHEEL_DELTA_PAGE) {
          return delta * el.clientHeight;
        }
        return delta; // WHEEL_DELTA_PIXELS
      };
      wheel({
        deltaX: toPixels(e.deltaX),
        deltaY: toPixels(e.deltaY),
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toLocalPoint(e.clientX, e.clientY),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // `wheel` is stable (useCallback in useCamera).
  }, [wheel]);

  // Safari pinch: gesturestart/gesturechange with preventDefault so the page
  // never zooms; zoom by the scale ratio around the pointer.
  useEffect(() => {
    // Minimal shape of Safari's GestureEvent (not in the standard DOM lib).
    const gestureOf = (e: Event): { scale: number; clientX: number; clientY: number } =>
      e as unknown as { scale: number; clientX: number; clientY: number };
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    let lastScale = 1;
    const onGestureStart = (e: Event): void => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event): void => {
      e.preventDefault();
      const gesture = gestureOf(e);
      const scale = Number(gesture.scale);
      if (!Number.isFinite(scale) || scale <= 0) {
        return;
      }
      const ratio = scale / lastScale;
      lastScale = scale;
      if (ratio === 1) {
        return;
      }
      // Express the scale ratio as the equivalent ctrl-wheel delta so the
      // same zoom path (zoomAt around the pointer) is used.
      const deltaY = -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY;
      wheel({
        deltaX: 0,
        deltaY,
        ctrlOrMeta: true,
        point: toLocalPoint(gesture.clientX, gesture.clientY),
      });
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
    // `wheel` is stable (useCallback in useCamera).
  }, [wheel]);

  // Ctrl/Cmd + = / - / 0: zoom step in/out and reset view, without letting
  // the browser change its page zoom.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) {
        return;
      }
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

  // --- Pointer drag: Idle -> Panning -> Idle --------------------------------
  const onPointerDown = (e: ReactPointerEvent): void => {
    // Start a pan only on empty board space (the viewport/grid itself) so
    // later object stories can stopPropagation from their own elements.
    if (e.target !== viewportRef.current) {
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    // Keep pointer events flowing to the viewport even if the pointer
    // leaves the window mid-drag. (All supported browsers implement this;
    // the guard keeps jsdom component tests working.)
    const el = viewportRef.current;
    if (el && typeof el.setPointerCapture === 'function') {
      el.setPointerCapture(e.pointerId);
    }
    beginPan(toLocalPoint(e.clientX, e.clientY));
    panStartLocalRef.current = toLocalPoint(e.clientX, e.clientY);
    setIsPanning(true);
  };

  const onPointerMove = (e: ReactPointerEvent): void => {
    panMove(toLocalPoint(e.clientX, e.clientY)); // no-op unless a drag is active
  };

  const endDrag = (): void => {
    endPan();
    setIsPanning(false);
  };

  const onPointerUp = (e: ReactPointerEvent): void => {
    endDrag();
    // A click on empty space (pointer did not travel) clears the selection.
    const down = panStartLocalRef.current;
    panStartLocalRef.current = null;
    if (down !== null && e.target === viewportRef.current) {
      const up = toLocalPoint(e.clientX, e.clientY);
      if (Math.hypot(up.x - down.x, up.y - down.y) < DRAG_THRESHOLD_PX) {
        onEmptyClick?.();
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Only a double-click on empty board space creates an object; double-clicks
    // on a note (or the toolbars) are handled by their own elements.
    if (e.target !== viewportRef.current) {
      return;
    }
    onDoubleClickEmpty?.(toLocalPoint(e.clientX, e.clientY));
  };

  // --- Rendering -------------------------------------------------------------
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at the tile centre; offset the tile so a dot lands on every
  // world multiple of GRID_SPACING_WORLD (i.e. the grid is attached to the board).
  const dotOffset = (screenAnchor: number): number => {
    const mod = ((screenAnchor % spacing) + spacing) % spacing;
    return mod - spacing / 2;
  };
  const backgroundPosition = `${dotOffset(-camera.x * camera.zoom)}px ${dotOffset(
    -camera.y * camera.zoom,
  )}px`;

  return (
    <div
      ref={viewportRef}
      data-testid="board-viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : 'grab',
        touchAction: 'none',
        backgroundImage: `radial-gradient(circle, ${GRID_DOT_COLOR} ${GRID_DOT_RADIUS_PX}px, transparent ${
          GRID_DOT_RADIUS_PX + 0.75
        }px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition,
      }}
    >
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
