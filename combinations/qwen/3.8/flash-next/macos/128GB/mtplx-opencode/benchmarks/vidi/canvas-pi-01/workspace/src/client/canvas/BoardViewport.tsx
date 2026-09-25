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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { screenToWorld, worldToScreen } from './camera';
import type { Point } from './camera';
import { useCameraApi } from './useCamera';
import { useNavigationTestHooks } from './testHooks';
import { MarqueeRect, type Marquee } from '../board/Marquee';
import type { Tool } from '../board/useTool';
import type { ObjectSnapshot } from '../../shared/board-model';

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
  /**
   * A pointer-up on empty board space with no drag: clears the selection (and
   * ends any note editing). Story 2.
   */
  onEmptyClick?(): void;
  /**
   * A double-click on empty board space. Given the world point under the
   * cursor so the parent can create a note centred there. Story 2.
   */
  onEmptyDoubleClick?(world: Point): void;
  /**
   * The board-wide marquee controller (Story 7). When supplied, a drag that
   * starts on empty space while Shift is held boxes-select instead of panning.
   */
  marquee?: Marquee;
  /** The live object snapshot, read only when a marquee is released. */
  getSnapshot?(): readonly ObjectSnapshot[];
  /** Called when a marquee is released, with the ids entirely inside the box. */
  onMarquee?(ids: readonly string[]): void;
  /**
   * The active tool (story 9, widened by story 10). While a creating tool is
   * active the surface shows its cursor and the `toolOverlay` below owns every
   * pointer gesture, so nothing under it can be picked up.
   */
  tool?: Tool;
  /**
   * Story 10: a screen-space layer rendered above the world layer while a
   * creating tool is active (the Shape / Connector tools).
   */
  toolOverlay?: ReactNode;
  /** A click (pointer-down then up, no drag) while the Text tool is active. */
  onTextClick?(world: Point): void;
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

export function BoardViewport({
  children,
  onEmptyClick,
  onEmptyDoubleClick,
  marquee,
  getSnapshot,
  onMarquee,
  tool = 'select',
  toolOverlay,
  onTextClick,
}: BoardViewportProps) {
  const api = useCameraApi();
  useNavigationTestHooks();

  const { camera } = api;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef(api);
  const panningRef = useRef(false);
  const marqueeRef = useRef(false);
  const dragMovedRef = useRef(false);
  const textClickRef = useRef(false);
  const downPointRef = useRef<Point>({ x: 0, y: 0 });
  const gestureScaleRef = useRef(1);
  const [panning, setPanning] = useState(false);
  // A counter bumped on every marquee move so the rectangle re-renders; the
  // controller keeps the rect itself (no React state in it).
  const [, forceTick] = useState(0);

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

    // The Text tool owns an empty-space press: no pan and no marquee. The click
    // is resolved on pointer-up (so a drag never drops a stray text box). The
    // pointer still captures so the follow-up events reach this surface.
    if (tool === 'text') {
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        // jsdom: capture is skipped.
      }
      const rect = surface.getBoundingClientRect();
      downPointRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      dragMovedRef.current = false;
      textClickRef.current = true;
      return;
    }

    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // jsdom (and any engine without pointer capture) just skips it.
    }
    const rect = surface.getBoundingClientRect();
    downPointRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    dragMovedRef.current = false;

    // Shift held on a box-drag over empty space: this is a marquee, not a pan
    // (design "Marquee selection"). An ordinary drag still pans, unchanged.
    if (event.shiftKey && marquee && marqueeRef.current === false) {
      marqueeRef.current = true;
      marquee.begin(downPointRef.current);
      forceTick((n) => n + 1);
      return;
    }

    panningRef.current = true;
    setPanning(true);
    api.beginPan({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    if (marqueeRef.current && marquee) {
      if (
        Math.hypot(point.x - downPointRef.current.x, point.y - downPointRef.current.y) >=
        DRAG_THRESHOLD_PX
      ) {
        dragMovedRef.current = true;
      }
      // The controller converts both corners to world with the live camera, so
      // zooming mid-drag cannot distort the box.
      marquee.move(point);
      forceTick((n) => n + 1);
      return;
    }

    // A Text-tool press tracks travel so a drag (not a click) creates nothing.
    if (textClickRef.current) {
      if (
        Math.hypot(point.x - downPointRef.current.x, point.y - downPointRef.current.y) >=
        DRAG_THRESHOLD_PX
      ) {
        dragMovedRef.current = true;
      }
      return;
    }

    if (!panningRef.current) return;
    if (
      Math.hypot(point.x - downPointRef.current.x, point.y - downPointRef.current.y) >=
      DRAG_THRESHOLD_PX
    ) {
      dragMovedRef.current = true;
    }
    api.panMove(point);
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

    // A released Text-tool click creates a text object at the pointer, but only
    // if the pointer did not travel (a drag over empty space is ignored, so a
    // near-miss click never drops a stray box). This is checked before the
    // marquee / pan branches because the Text tool started neither.
    if (textClickRef.current) {
      textClickRef.current = false;
      const cancelled = event.type === 'pointercancel' || event.type === 'lostpointercapture';
      if (!cancelled && !dragMovedRef.current && isBoardSurface(event.target) && onTextClick) {
        const rect = surface!.getBoundingClientRect();
        const world = screenToWorld(camera, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
        onTextClick(world);
      }
      dragMovedRef.current = false;
      return;
    }

    // A released marquee selects whatever lies entirely inside the box; the
    // board decides what to do with those ids.
    if (marqueeRef.current) {
      marqueeRef.current = false;
      dragMovedRef.current = false;
      const cancelled = event.type === 'pointercancel' || event.type === 'lostpointercapture';
      const ids = cancelled || !marquee ? [] : marquee.end(getSnapshot?.() ?? []);
      if (!cancelled) onMarquee?.(ids);
      forceTick((n) => n + 1);
      return;
    }

    const wasPanning = panningRef.current;
    const wasClick = wasPanning && !dragMovedRef.current;
    panningRef.current = false;
    dragMovedRef.current = false;
    setPanning(false);
    api.endPan();
    // A click on empty space with no drag clears the selection (story 2).
    if (wasClick && isBoardSurface(event.target)) {
      onEmptyClick?.();
    }
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Only the empty board surface creates a note; a double-click on a note is
    // handled (and stopped) by the note itself.
    if (!isBoardSurface(event.target)) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const world = screenToWorld(camera, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    onEmptyDoubleClick?.(world);
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
    cursor:
      panning
        ? 'grabbing'
        : tool === 'text'
          ? 'text'
          : tool === 'shape' || tool === 'connector' || tool === 'pen'
            ? 'crosshair'
            : 'default',
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
      onDoubleClick={onDoubleClick}
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
        <MarqueeRect rect={marquee ? marquee.rect : null} />
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
      {tool !== 'select' && toolOverlay
        ? // Screen-space tool layer, above the world layer: it captures every
          // pointer gesture while a creating tool is active (TC-28).
          toolOverlay
        : null}
    </div>
  );
}