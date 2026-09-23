/**
 * Story 1 · task 3 — the board input surface (design "viewport.input").
 *
 * Everything the board owns lives here: pointer-drag panning, the non-passive
 * wheel listener (React's `onWheel` is passive and cannot stop the page from
 * scrolling or zooming), Safari's `gesturestart`/`gesturechange` pinch, the
 * Ctrl/Cmd keyboard shortcuts, the dot grid and the world layer.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { GRID_SPACING_WORLD } from '../../shared/config';
import { worldToScreen } from './camera';
import { useCameraApi } from './useCamera';
import { useNavigationTestHooks } from './testHooks';

/** Pixels for one `deltaMode === LINE` wheel step. */
const WHEEL_LINE_PIXELS = 16;
/** Pixels for one `deltaMode === PAGE` wheel step. */
const WHEEL_PAGE_PIXELS = 400;

/** Dot radius in world units, so the dots stay attached to the board. */
const GRID_DOT_RADIUS_WORLD = 1.5;
const GRID_DOT_MIN_PX = 0.75;
const GRID_DOT_MAX_PX = 3;

/** Size of the origin crosshair, used as a stable pixel target in e2e. */
const MARKER_SIZE = 12;

const GRID_DOT_COLOR = '#b7bfcc';

export interface BoardViewportProps {
  children?: ReactNode;
}

function mod(value: number, range: number): number {
  return ((value % range) + range) % range;
}

function toWheelPixels(event: WheelEvent): { deltaX: number; deltaY: number } {
  const factor =
    event.deltaMode === 1
      ? WHEEL_LINE_PIXELS // DOM_DELTA_LINE
      : event.deltaMode === 2
        ? WHEEL_PAGE_PIXELS // DOM_DELTA_PAGE
        : 1;
  return { deltaX: event.deltaX * factor, deltaY: event.deltaY * factor };
}

/**
 * Only the board surface itself starts a drag. Objects added by later stories
 * sit in the world layer and can stop propagation without breaking panning.
 */
function isBoardSurface(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && el.dataset.boardSurface === 'true';
}

interface ScaleEvent extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

export function BoardViewport({ children }: BoardViewportProps) {
  const api = useCameraApi();
  useNavigationTestHooks();

  const { camera } = api;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef(api);
  const panningRef = useRef(false);
  const gestureScaleRef = useRef(1);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const relativePoint = (event: { clientX: number; clientY: number }) => {
      const rect = surface.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onWheel = (event: WheelEvent) => {
      // Board-owned gesture: the page must never scroll or zoom instead.
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        // Zoom: raw deltaY drives the exponential factor; deltaMode is for
        // scroll distances, not zoom amounts.
        apiRef.current.wheel({
          deltaX: 0,
          deltaY: event.deltaY,
          ctrlOrMeta: true,
          point: relativePoint(event),
        });
        return;
      }
      const { deltaX, deltaY } = toWheelPixels(event);
      apiRef.current.wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: false,
        point: relativePoint(event),
      });
    };

    const readScale = (event: Event): number | null => {
      const scale = (event as ScaleEvent).scale;
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return null;
      return scale;
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureScaleRef.current = readScale(event) ?? 1;
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault(); // Safari: gesturechange zooms the page otherwise
      const scale = readScale(event);
      if (scale === null) return;
      const factor = scale / gestureScaleRef.current;
      gestureScaleRef.current = scale;
      const gesture = event as ScaleEvent;
      // Safari supplies the pinch midpoint; without it, zoom around the
      // centre of the board area.
      const rect = surface.getBoundingClientRect();
      const gx = gesture.clientX;
      const gy = gesture.clientY;
      const point =
        typeof gx === 'number' && typeof gy === 'number'
          ? { x: gx - rect.left, y: gy - rect.top }
          : { x: rect.width / 2, y: rect.height / 2 };
      apiRef.current.pinch({ point, factor });
    };

    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('gesturestart', onGestureStart, { passive: false });
    surface.addEventListener('gesturechange', onGestureChange, { passive: false });
    return () => {
      surface.removeEventListener('wheel', onWheel);
      surface.removeEventListener('gesturestart', onGestureStart);
      surface.removeEventListener('gesturechange', onGestureChange);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        apiRef.current.zoomStep('in');
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        apiRef.current.zoomStep('out');
      } else if (event.key === '0') {
        event.preventDefault();
        apiRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!isBoardSurface(event.target)) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // jsdom (and any engine without pointer capture) just skips it.
    }
    panningRef.current = true;
    setPanning(true);
    const rect = surface.getBoundingClientRect();
    api.beginPan({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    api.panMove({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (surface && surface.hasPointerCapture?.(event.pointerId)) {
      try {
        surface.releasePointerCapture(event.pointerId);
      } catch {
        // ignore: capture may already be gone
      }
    }
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    api.endPan();
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const dotRadius = Math.min(
    GRID_DOT_MAX_PX,
    Math.max(GRID_DOT_MIN_PX, GRID_DOT_RADIUS_WORLD * camera.zoom),
  );
  const surfaceStyle: CSSProperties = {
    backgroundImage: `radial-gradient(circle at 0 0, ${GRID_DOT_COLOR} ${dotRadius}px, rgba(0, 0, 0, 0) ${dotRadius}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${mod(-camera.x * camera.zoom, spacing)}px ${mod(
      -camera.y * camera.zoom,
      spacing,
    )}px`,
    cursor: panning ? 'grabbing' : 'default',
  };

  const origin = worldToScreen(camera, { x: 0, y: 0 });

  return (
    <div
      ref={surfaceRef}
      data-board-surface="true"
      data-testid="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      className="board-viewport"
      style={surfaceStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      <div
        data-testid="world-layer"
        data-camera={`${camera.x},${camera.y},${camera.zoom}`}
        className="world-layer"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
        }}
      >
        {children}
      </div>
      <div
        data-testid="origin-marker"
        data-marker="origin"
        aria-hidden="true"
        className="origin-marker"
        style={{
          left: `${origin.x - MARKER_SIZE / 2}px`,
          top: `${origin.y - MARKER_SIZE / 2}px`,
        }}
      />
    </div>
  );
}