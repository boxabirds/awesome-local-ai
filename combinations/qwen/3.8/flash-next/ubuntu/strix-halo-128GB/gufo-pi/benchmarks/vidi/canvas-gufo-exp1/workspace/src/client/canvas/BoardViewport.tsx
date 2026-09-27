/**
 * The board's input surface: full-area div with a dot grid that moves with the
 * camera, a world layer positioned by a CSS transform, and the navigation input
 * (pointer drag, wheel, Safari gesture, Ctrl/Cmd keyboard shortcuts).
 *
 * Board gestures always `preventDefault()` so the web page never zooms or scrolls
 * when the gesture happens over the board.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  GRID_SPACING_WORLD,
  WHEEL_LINE_PIXELS,
  WHEEL_PAGE_PIXELS,
  DRAG_THRESHOLD_PX,
} from '../../shared/config';
import type { Camera, Point } from './camera';
import type { CameraControls } from './useCamera';

export interface BoardViewportProps {
  camera: Camera;
  controls: CameraControls;
  children?: ReactNode;
  /**
   * Double-click on bare board space (never on a note, which stops
   * propagation): the app creates a sticky note at the world point.
   */
  onEmptyDblClick?(point: Point): void;
  /** A bare-board pointer press-and-release without panning (clears selection). */
  onEmptyClick?(point: Point): void;
}

/** `WheelEvent.deltaMode` values (spelled out so they also exist in jsdom). */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

/** Safari-only pinch gesture events; not in the standard DOM typings. */
interface GestureEventLike extends Event {
  readonly scale: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

const modulo = (value: number, period: number): number => ((value % period) + period) % period;

const wheelToPixels = (delta: number, deltaMode: number): number => {
  if (deltaMode === DELTA_MODE_LINE) return delta * WHEEL_LINE_PIXELS;
  if (deltaMode === DELTA_MODE_PAGE) return delta * WHEEL_PAGE_PIXELS;
  return delta;
};

/** Only the bare board (viewport or grid) starts a pan, so later object stories can stop propagation. */
const isBareBoard = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.dataset.boardSurface === 'viewport' || target.dataset.boardSurface === 'grid';
};

/** A keyboard shortcut must not steal typing from a form field. */
const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
};

export function BoardViewport({
  camera,
  controls,
  children,
  onEmptyDblClick,
  onEmptyClick,
}: BoardViewportProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'idle' | 'panning'>('idle');
  const panStartRef = useRef<Point | null>(null);

  // Keep the latest controls reachable from listeners installed once.
  const controlsRef = useRef(controls);
  useLayoutEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  const pointOf = (event: { clientX: number; clientY: number }): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  // Wheel must be a non-passive native listener: React's onWheel is passive and
  // cannot preventDefault, which is what stops the page from zooming/scrolling.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      controlsRef.current.wheel({
        deltaX: wheelToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: pointOf(event),
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  // Safari trackpad pinch fires gesturestart/gesturechange/gestureend.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let gestureScale = 1;
    const onGestureStart = (event: Event): void => {
      event.preventDefault();
      gestureScale = (event as GestureEventLike).scale || 1;
    };
    const onGestureChange = (event: Event): void => {
      event.preventDefault();
      const gesture = event as GestureEventLike;
      const scale = gesture.scale || 1;
      const factor = gestureScale === 0 ? 1 : scale / gestureScale;
      gestureScale = scale;
      if (factor !== 1) {
        controlsRef.current.zoomAtPoint(
          { x: gesture.clientX ?? 0, y: gesture.clientY ?? 0 },
          factor,
        );
      }
    };
    const onGestureEnd = (event: Event): void => {
      event.preventDefault();
      gestureScale = 1;
    };
    element.addEventListener('gesturestart', onGestureStart);
    element.addEventListener('gesturechange', onGestureChange);
    element.addEventListener('gestureend', onGestureEnd);
    return () => {
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
      element.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // Ctrl/Cmd + = / - / 0: zoom one step or reset, without touching page zoom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isTextEntry(event.target)) return;
      const key = event.key;
      const code = event.code;
      if (key === '=' || key === '+' || code === 'Equal') {
        event.preventDefault();
        controlsRef.current.zoomStep('in');
      } else if (key === '-' || key === '_' || code === 'Minus') {
        event.preventDefault();
        controlsRef.current.zoomStep('out');
      } else if (key === '0' || code === 'Digit0') {
        event.preventDefault();
        controlsRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 && event.button !== 1) return;
    if (!isBareBoard(event.target)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panStartRef.current = pointOf(event);
    controlsRef.current.beginPan(pointOf(event));
    setMode('panning');
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (mode !== 'panning') return;
    controlsRef.current.panMove(pointOf(event));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (mode !== 'panning') return;
    // The board stays where it was at the moment of interruption.
    controlsRef.current.endPan();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    // A press-and-release without any movement is a click, not a pan: the app
    // clears the selection over the bare board.
    const start = panStartRef.current;
    panStartRef.current = null;
    const point = pointOf(event);
    if (start && Math.hypot(point.x - start.x, point.y - start.y) < DRAG_THRESHOLD_PX) {
      onEmptyClick?.(point);
    }
    setMode('idle');
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!isBareBoard(event.target)) return;
    onEmptyDblClick?.(pointOf(event));
  };

  const spacingPx = GRID_SPACING_WORLD * camera.zoom;
  const gridStyle: CSSProperties = {
    backgroundSize: `${spacingPx}px ${spacingPx}px`,
    backgroundPosition: `${modulo(-camera.x * camera.zoom, spacingPx)}px ${modulo(
      -camera.y * camera.zoom,
      spacingPx,
    )}px`,
  };
  const worldStyle: CSSProperties = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
    transformOrigin: '0 0',
  };

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-mode={mode}
      data-board-surface="viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onDoubleClick}
    >
      <div className="board-grid" data-testid="board-grid" data-board-surface="grid" style={gridStyle} />
      <div className="board-world" data-testid="board-world" style={worldStyle}>
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
