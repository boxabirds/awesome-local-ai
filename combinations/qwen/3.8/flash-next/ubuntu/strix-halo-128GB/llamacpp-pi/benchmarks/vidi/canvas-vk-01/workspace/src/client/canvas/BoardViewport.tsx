import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import type { Point, Size } from './camera';
import { screenToWorld as cameraScreenToWorld } from './camera';
import { useCamera } from './useCamera';

/** Wheel `deltaMode` conversions to CSS pixels. */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;
const WHEEL_LINE_HEIGHT_PX = 16;

/** Safari trackpad pinch (GestureEvent is not in the DOM type library). */
interface SafariGestureEvent extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

const DOT_RADIUS_PX = 1.5;
const DOT_COLOR = 'rgba(15, 23, 42, 0.22)';

/** Non-negative modulo, for tiling the dot grid background. */
function mod(value: number, period: number): number {
  if (!(period > 0)) return 0;
  return ((value % period) + period) % period;
}

function deltaToPixels(delta: number, deltaMode: number, pageSize: number): number {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  switch (deltaMode) {
    case DELTA_MODE_LINE:
      return delta * WHEEL_LINE_HEIGHT_PX;
    case DELTA_MODE_PAGE:
      return delta * pageSize;
    default:
      return delta;
  }
}

/** Viewport-relative coordinates of a client point. */
function pointInViewport(element: HTMLElement, clientX: number, clientY: number): Point {
  const rect = element.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

/** The board area's size in CSS pixels, tracked with a ResizeObserver. */
function useViewportSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const apply = (next: Size) => {
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };

    const rect = element.getBoundingClientRect();
    apply({ width: rect.width, height: rect.height });

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const { width, height } = entry.contentRect;

      apply({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export interface BoardViewportProps {
  /** Board content, rendered in world coordinates. */
  children?: ReactNode;
  /** Called on double-click of empty board space with world coordinates. */
  onDblClickEmpty?(worldPoint: Point): void;
  /** Called on single click of empty board space (to clear selection). */
  onEmptyClick?(): void;
}

/**
 * The input surface of the infinite board: it owns pointer-drag panning,
 * wheel/trackpad scrolling, pinch (Safari gesture) zoom, the keyboard zoom
 * shortcuts, the dot grid and the world layer transform.
 */
export function BoardViewport({ children, onDblClickEmpty, onEmptyClick }: BoardViewportProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const panPointerIdRef = useRef<number | null>(null);
  const panStartedRef = useRef(false);
  const didPanRef = useRef(false);

  const size = useViewportSize(viewportRef);
  const sizeRef = useRef<Size>(size);
  sizeRef.current = size;
  const { camera, panning, beginPan, panMove, endPan, wheel, zoomStep, reset } = useCamera(size);

  // Latest actions for listeners that are attached once (wheel, keys, gestures).
  const actionsRef = useRef({ wheel, zoomStep, reset });
  useEffect(() => {
    actionsRef.current = { wheel, zoomStep, reset };
  });

  // Latest callbacks for stable event handlers
  const callbacksRef = useRef({ onDblClickEmpty, onEmptyClick });
  useEffect(() => {
    callbacksRef.current = { onDblClickEmpty, onEmptyClick };
  });

  // Wheel must be non-passive so the page never scrolls or zooms over the board.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const measured = sizeRef.current;
      const pageSizeX = measured.width || element.clientWidth;
      const pageSizeY = measured.height || element.clientHeight;
      actionsRef.current.wheel({
        deltaX: deltaToPixels(event.deltaX, event.deltaMode, pageSizeX),
        deltaY: deltaToPixels(event.deltaY, event.deltaMode, pageSizeY),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: pointInViewport(element, event.clientX, event.clientY),
      });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  // Safari reports trackpad pinch as gesturestart/gesturechange/gestureend.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    let baseScale = 1;
    const scaleOf = (event: Event): number => {
      const scale = (event as SafariGestureEvent).scale;
      return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
    };
    const gesturePoint = (event: Event): Point => {
      const gesture = event as SafariGestureEvent;
      if (typeof gesture.clientX !== 'number' || typeof gesture.clientY !== 'number') {
        const rect = element.getBoundingClientRect();
        return { x: rect.width / 2, y: rect.height / 2 };
      }
      return pointInViewport(element, gesture.clientX, gesture.clientY);
    };

    const onStart = (event: Event) => {
      event.preventDefault();
      baseScale = scaleOf(event);
    };
    const onChange = (event: Event) => {
      event.preventDefault();
      const scale = scaleOf(event);
      if (baseScale <= 0 || scale === baseScale) return;
      const ratio = scale / baseScale;
      baseScale = scale;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      const deltaY = -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY;
      actionsRef.current.wheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point: gesturePoint(event) });
    };
    const onEnd = (event: Event) => {
      event.preventDefault();
      baseScale = 1;
    };

    element.addEventListener('gesturestart', onStart);
    element.addEventListener('gesturechange', onChange);
    element.addEventListener('gestureend', onEnd);
    return () => {
      element.removeEventListener('gesturestart', onStart);
      element.removeEventListener('gesturechange', onChange);
      element.removeEventListener('gestureend', onEnd);
    };
  }, []);

  // Ctrl/Cmd + = / - / 0 zoom one step and reset, without touching page zoom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || !(event.ctrlKey || event.metaKey)) return;
      if (isEditableTarget(event.target)) return;
      const zoomIn =
        event.key === '=' || event.key === '+' || event.code === 'Equal' || event.code === 'NumpadAdd';
      const zoomOut =
        event.key === '-' ||
        event.key === '_' ||
        event.code === 'Minus' ||
        event.code === 'NumpadSubtract';
      const resetView =
        event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0';
      if (!zoomIn && !zoomOut && !resetView) return;
      event.preventDefault();
      if (zoomIn) actionsRef.current.zoomStep('in');
      else if (zoomOut) actionsRef.current.zoomStep('out');
      else actionsRef.current.reset();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const isEmptyTarget = (target: HTMLElement | EventTarget | null): boolean => {
    const el = viewportRef.current;
    const wl = worldRef.current;
    return target === el || target === wl;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const element = viewportRef.current;
    if (!element) return;
    // Only empty board space starts a pan; board objects stop propagation.
    const target = event.target as HTMLElement | null;
    if (!isEmptyTarget(target)) return;

    panStartedRef.current = true;
    didPanRef.current = false;
    panPointerIdRef.current = event.pointerId ?? -1;
    if (typeof element.setPointerCapture === 'function') {
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort (not implemented in jsdom).
      }
    }
    beginPan(pointInViewport(element, event.clientX, event.clientY));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panPointerIdRef.current === null || panPointerIdRef.current !== (event.pointerId ?? -1)) return;
    const element = viewportRef.current;
    if (!element) return;
    didPanRef.current = true;
    panMove(pointInViewport(element, event.clientX, event.clientY));
  };

  const onPanEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panPointerIdRef.current === null || panPointerIdRef.current !== (event.pointerId ?? -1)) return;
    panPointerIdRef.current = null;
    // Whatever the camera reached when the gesture was interrupted is kept.
    endPan();
    // If we didn't actually pan (no move happened), this was a click on empty space
    if (!didPanRef.current && panStartedRef.current) {
      callbacksRef.current.onEmptyClick?.();
    }
    panStartedRef.current = false;
    didPanRef.current = false;
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement | EventTarget | null;
    if (!isEmptyTarget(target)) return;
    const element = viewportRef.current;
    if (!element) return;
    event.stopPropagation();
    event.preventDefault();
    const viewportPoint = pointInViewport(element, event.clientX, event.clientY);
    const worldPoint = cameraScreenToWorld(camera, viewportPoint);
    callbacksRef.current.onDblClickEmpty?.(worldPoint);
  };

  const tile = GRID_SPACING_WORLD * camera.zoom;
  const gridOffsetX = mod(-camera.x * camera.zoom, tile);
  const gridOffsetY = mod(-camera.y * camera.zoom, tile);

  return (
    <div
      ref={viewportRef}
      data-testid="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      className="board-viewport"
      style={{
        backgroundImage: `radial-gradient(${DOT_COLOR} ${DOT_RADIUS_PX}px, transparent ${DOT_RADIUS_PX + 0.5}px)`,
        backgroundSize: `${tile}px ${tile}px`,
        backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
        cursor: panning ? 'grabbing' : 'grab',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPanEnd}
      onPointerCancel={onPanEnd}
      onLostPointerCapture={onPanEnd}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={worldRef}
        data-testid="world-layer"
        className="board-world"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
