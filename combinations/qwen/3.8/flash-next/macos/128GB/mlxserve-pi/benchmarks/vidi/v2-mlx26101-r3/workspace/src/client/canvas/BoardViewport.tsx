import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  GRID_DOT_RADIUS_PX,
  GRID_SPACING_WORLD,
  WHEEL_DELTA_MODE_LINE,
  WHEEL_DELTA_MODE_PAGE,
  WHEEL_LINE_HEIGHT_PX,
} from '../../shared/config';
import type { Camera, Point, Size } from './camera';
import type { CameraInputHandlers } from './useCamera';

export interface BoardViewportProps {
  /** Board content, laid out in world coordinates inside the world layer. */
  children?: ReactNode;
  /** The camera to render (the state itself lives in useCamera). */
  camera: Camera;
  /** Size of the board area, used for page-mode wheel deltas. */
  viewport: Size;
  /** Camera handlers driven by the input events handled here. */
  input: CameraInputHandlers;
  /** Reports the measured size of the board area. */
  onViewportResize?(size: Size): void;
}

/** Safari's non-standard pinch gesture event (carries a `scale` and pointer position). */
interface SafariGestureEvent extends MouseEvent {
  readonly scale: number;
}

/**
 * The input surface and renderer for the infinite board: drag to pan, scroll to pan,
 * Ctrl/Cmd + scroll and Safari pinch to zoom around the pointer. Every board gesture
 * calls preventDefault so the browser never zooms or scrolls the page instead.
 *
 * Rendering: the dot grid is a CSS background on the grid layer, board content lives in a
 * world layer positioned with a CSS transform, so both move with the camera.
 */
export function BoardViewport({
  children,
  camera,
  viewport,
  input,
  onViewportResize,
}: BoardViewportProps): JSX.Element {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const inputRef = useRef(input);
  const viewportRef = useRef(viewport);
  const cameraRef = useRef(camera);
  const gestureStartRef = useRef<number | null>(null);

  // Keep the latest props available to the listeners that are registered only once.
  useEffect(() => {
    inputRef.current = input;
    viewportRef.current = viewport;
    cameraRef.current = camera;
  });

  // Measure the board area; the camera's x/y are not changed by a resize.
  useEffect(() => {
    const element = surfaceRef.current;
    if (element === null || onViewportResize === undefined) {
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) {
        return;
      }
      onViewportResize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [onViewportResize]);

  // Wheel: registered directly so it can be non-passive (React's onWheel is passive).
  useEffect(() => {
    const element = surfaceRef.current;
    if (element === null) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      // The board owns the wheel over the board: the page never scrolls or zooms.
      event.preventDefault();
      const target = event.target;
      if (target instanceof Element && target.closest('[data-board-ui]') !== null) {
        return;
      }
      const scale = wheelPixelScale(event, viewportRef.current);
      inputRef.current.wheel({
        deltaX: event.deltaX * scale,
        deltaY: event.deltaY * scale,
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: boardPoint(surfaceRef.current, event.clientX, event.clientY),
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Safari pinch: gesturestart/gesturechange are prevented so the page never zooms.
  useEffect(() => {
    const element = surfaceRef.current;
    if (element === null) {
      return;
    }
    const onGestureStart = (event: Event): void => {
      event.preventDefault();
      gestureStartRef.current = asGesture(event).scale;
    };
    const onGestureChange = (event: Event): void => {
      event.preventDefault();
      const gesture = asGesture(event);
      const scale = gesture.scale;
      if (!Number.isFinite(scale) || scale <= 0) {
        return;
      }
      const startScale = gestureStartRef.current ?? 1;
      gestureStartRef.current = scale;
      inputRef.current.gesture({
        scale: scale / startScale,
        point: boardPoint(surfaceRef.current, gesture.clientX, gesture.clientY),
      });
    };
    const onGestureEnd = (event: Event): void => {
      event.preventDefault();
      gestureStartRef.current = null;
    };
    element.addEventListener('gesturestart', onGestureStart as EventListener);
    element.addEventListener('gesturechange', onGestureChange as EventListener);
    element.addEventListener('gestureend', onGestureEnd as EventListener);
    return () => {
      element.removeEventListener('gesturestart', onGestureStart as EventListener);
      element.removeEventListener('gesturechange', onGestureChange as EventListener);
      element.removeEventListener('gestureend', onGestureEnd as EventListener);
      gestureStartRef.current = null;
    };
  }, []);

  const startPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const element = surfaceRef.current;
    if (element === null) {
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    // Only empty board space starts a drag; board objects can stop propagation.
    if (!isBoardSurface(element, event.target)) {
      return;
    }
    capturePointer(element, event.pointerId);
    panningRef.current = true;
    setPanning(true);
    inputRef.current.beginPan(boardPoint(element, event.clientX, event.clientY));
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!panningRef.current) {
      return;
    }
    const element = surfaceRef.current;
    if (element === null) {
      return;
    }
    inputRef.current.panMove(boardPoint(element, event.clientX, event.clientY));
  };

  const stopPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const element = surfaceRef.current;
    if (element === null) {
      return;
    }
    releasePointer(element, event.pointerId);
    panningRef.current = false;
    setPanning(false);
    inputRef.current.endPan();
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const gridStyle: CSSProperties = {
    backgroundImage: `radial-gradient(circle at center, var(--grid-dot) 0 ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${gridOffset(-camera.x, spacing)}px ${gridOffset(-camera.y, spacing)}px`,
  };
  const worldStyle = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
    '--zoom': camera.zoom,
  } as CSSProperties;

  return (
    <div
      ref={surfaceRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-board-surface=""
      data-panning={panning ? 'true' : 'false'}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={stopPan}
      onPointerCancel={stopPan}
      onLostPointerCapture={stopPan}
    >
      <div
        className="board-grid"
        data-testid="grid-layer"
        data-board-surface=""
        style={gridStyle}
        aria-hidden="true"
      />
      <div className="board-world" data-testid="world-layer" data-camera={formatCamera(camera)} style={worldStyle}>
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

function isBoardSurface(surface: HTMLDivElement, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return target === surface || target.closest('[data-board-surface]') !== null;
}

/** Screen point relative to the top-left of the board area. */
function boardPoint(element: HTMLDivElement | null, clientX: number, clientY: number): Point {
  if (element === null) {
    return { x: clientX, y: clientY };
  }
  const rect = element.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function wheelPixelScale(event: WheelEvent, viewport: Size): number {
  if (event.deltaMode === WHEEL_DELTA_MODE_LINE) {
    return WHEEL_LINE_HEIGHT_PX;
  }
  if (event.deltaMode === WHEEL_DELTA_MODE_PAGE) {
    return viewport.height > 0 ? viewport.height : WHEEL_LINE_HEIGHT_PX;
  }
  return 1;
}

function asGesture(event: Event): SafariGestureEvent {
  return event as SafariGestureEvent;
}

/**
 * Screen offset that puts a dot grid dot on every world grid line.
 * `spacing` is the on-screen spacing (GRID_SPACING_WORLD * zoom); the dot sits in the
 * middle of its tile, hence the half-tile correction.
 */
function gridOffset(negativeCameraCoordinate: number, spacing: number): number {
  if (spacing <= 0) {
    return 0;
  }
  const screen = (negativeCameraCoordinate * spacing) / GRID_SPACING_WORLD;
  return positiveMod(screen, spacing) - spacing / 2;
}

function positiveMod(value: number, period: number): number {
  if (period <= 0 || !Number.isFinite(value)) {
    return 0;
  }
  return ((value % period) + period) % period;
}

function formatCamera(camera: Camera): string {
  return `${camera.x},${camera.y},${camera.zoom}`;
}

function capturePointer(element: HTMLDivElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Environments without pointer capture still drag via pointermove/pointerup.
  }
}

function releasePointer(element: HTMLDivElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture?.(pointerId) ?? false) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // The pointer capture is already gone.
  }
}
