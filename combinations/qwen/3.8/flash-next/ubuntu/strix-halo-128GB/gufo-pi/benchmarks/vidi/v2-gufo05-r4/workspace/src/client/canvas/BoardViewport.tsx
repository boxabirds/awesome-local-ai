/**
 * The board's input surface: an infinite canvas drawn as a dot grid background
 * plus a "world layer" that is positioned with a CSS transform.
 *
 * Everything the user does to navigate starts here:
 *  - press on empty space and drag to pan (pointer capture),
 *  - wheel / two-finger scroll to pan, Ctrl/Cmd + wheel (and trackpad pinch,
 *    which browsers deliver as a Ctrl wheel) to zoom around the pointer,
 *  - Safari `gesturestart`/`gesturechange` to zoom around the pointer,
 *  - Ctrl/Cmd + `=`, `-` and `0` to step the zoom and reset the view.
 *
 * All of those call `preventDefault`, so the gestures belong to the board and
 * never zoom or scroll the browser page.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';
import {
  GRID_DOT_RADIUS_PX,
  GRID_SPACING_WORLD,
  ORIGIN_MARKER_SIZE_PX,
  WHEEL_DELTA_LINE_PX,
  WHEEL_DELTA_PAGE_PX
} from '../../shared/config';
import { worldToScreen, type Point } from './camera';
import { installTestHooks, IS_TEST_MODE } from './testHooks';
import { useCameraContext, type CameraController } from './useCamera';

export interface BoardViewportProps {
  children?: ReactNode;
}

/** WheelEvent.deltaMode values. */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

/** Convert a wheel delta in the event's units to CSS pixels. */
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (deltaMode === DELTA_MODE_LINE) return delta * WHEEL_DELTA_LINE_PX;
  if (deltaMode === DELTA_MODE_PAGE) return delta * WHEEL_DELTA_PAGE_PX;
  return delta;
}

/** Non-negative modulo, so a background offset always lands inside one tile. */
function mod(value: number, period: number): number {
  if (!(period > 0)) return 0;
  return ((value % period) + period) % period;
}

/** Which zoom action a Ctrl/Cmd key combination asks for. */
function zoomActionForKey(key: string): 'in' | 'out' | 'reset' | null {
  if (key === '=' || key === '+' || key === 'Add') return 'in';
  if (key === '-' || key === '_' || key === 'Subtract') return 'out';
  if (key === '0') return 'reset';
  return null;
}

/** Shape of Safari's non-standard GestureEvent. */
interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

export function BoardViewport(props: BoardViewportProps = {}): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const controller = useCameraContext();
  const { camera, beginPan, panMove, endPan, setCamera, getCamera } = controller;
  const [panning, setPanning] = useState(false);

  // Keep the latest controller reachable from listeners that are attached once.
  const controllerRef = useRef<CameraController>(controller);
  controllerRef.current = controller;

  const localPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  /** Drag starts only on empty board space, so later stories can own objects. */
  const isEmptyBoardSpace = useCallback((target: EventTarget | null): boolean => {
    const viewport = viewportRef.current;
    if (!viewport || !(target instanceof HTMLElement)) return false;
    return target === viewport || target.dataset.vidi6 === 'grid';
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (!isEmptyBoardSpace(event.target)) return;
      const viewport = viewportRef.current;
      if (viewport && typeof viewport.setPointerCapture === 'function') {
        viewport.setPointerCapture(event.pointerId);
      }
      beginPan(localPoint(event.clientX, event.clientY));
      setPanning(true);
    },
    [beginPan, isEmptyBoardSpace, localPoint]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!panning) return;
      panMove(localPoint(event.clientX, event.clientY));
    },
    [localPoint, panMove, panning]
  );

  const stopPan = useCallback(() => {
    endPan();
    setPanning(false);
  }, [endPan]);

  // Wheel: attached manually because React's onWheel is passive, and
  // preventDefault is required so the page never scrolls or zooms.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      controllerRef.current.wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: localPoint(event.clientX, event.clientY)
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [localPoint]);

  // Safari pinch-to-zoom fires gesture* events instead of a Ctrl wheel.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let previousScale = 1;
    const gesturePoint = (event: SafariGestureEvent): Point => {
      if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        return localPoint(event.clientX, event.clientY);
      }
      const rect = viewport.getBoundingClientRect();
      return { x: rect.width / 2, y: rect.height / 2 };
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      const scale = (event as SafariGestureEvent).scale;
      previousScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const scale = (event as SafariGestureEvent).scale;
      if (!Number.isFinite(scale) || scale <= 0) return;
      const factor = previousScale > 0 ? scale / previousScale : 1;
      previousScale = scale;
      controllerRef.current.zoomAtPoint(gesturePoint(event as SafariGestureEvent), factor);
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      previousScale = 1;
    };
    const options: AddEventListenerOptions = { passive: false };
    viewport.addEventListener('gesturestart', onGestureStart, options);
    viewport.addEventListener('gesturechange', onGestureChange, options);
    viewport.addEventListener('gestureend', onGestureEnd, options);
    return () => {
      viewport.removeEventListener('gesturestart', onGestureStart);
      viewport.removeEventListener('gesturechange', onGestureChange);
      viewport.removeEventListener('gestureend', onGestureEnd);
    };
  }, [localPoint]);

  // Keyboard zoom shortcuts, prevented so the browser page zoom is untouched.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const action = zoomActionForKey(event.key);
      if (!action) return;
      event.preventDefault();
      if (action === 'reset') controllerRef.current.reset();
      else controllerRef.current.zoomStep(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Test-only camera teleport (never present in production builds).
  useEffect(() => {
    if (!IS_TEST_MODE) return;
    return installTestHooks({ setCamera, getCamera });
  }, [getCamera, setCamera]);

  const spacingScreen = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit on multiples of GRID_SPACING_WORLD in board coordinates, so the
  // grid scrolls and scales with the camera and looks attached to the board.
  const gridOffsetX = mod(-camera.x * camera.zoom - spacingScreen / 2, spacingScreen);
  const gridOffsetY = mod(-camera.y * camera.zoom - spacingScreen / 2, spacingScreen);
  const origin = worldToScreen(camera, { x: 0, y: 0 });

  const viewportStyle: CSSProperties = {
    backgroundImage: `radial-gradient(circle at center, var(--grid-dot) ${GRID_DOT_RADIUS_PX}px, transparent ${
      GRID_DOT_RADIUS_PX + 0.5
    }px)`,
    backgroundSize: `${spacingScreen}px ${spacingScreen}px`,
    backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`
  };

  const worldStyle: CSSProperties = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
    transformOrigin: '0 0'
  };

  const markerStyle: CSSProperties = {
    left: origin.x - ORIGIN_MARKER_SIZE_PX / 2,
    top: origin.y - ORIGIN_MARKER_SIZE_PX / 2
  };

  return (
    <div
      className="vidi6-viewport"
      ref={viewportRef}
      data-vidi6="viewport"
      data-interaction={panning ? 'panning' : 'idle'}
      style={viewportStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopPan}
      onPointerCancel={stopPan}
      onLostPointerCapture={stopPan}
    >
      <div className="vidi6-world" data-vidi6="world" style={worldStyle}>
        {props.children}
      </div>
      {/* The board's starting point: a stable pixel target for tests, drawn in
          screen space so it keeps a constant size at every zoom. */}
      <div className="vidi6-origin-marker" data-testid="origin-marker" aria-hidden="true" style={markerStyle} />
    </div>
  );
}
