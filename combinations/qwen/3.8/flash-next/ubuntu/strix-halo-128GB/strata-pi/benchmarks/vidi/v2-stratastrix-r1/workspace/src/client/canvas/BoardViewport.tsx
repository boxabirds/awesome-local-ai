import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import {
  GRID_DOT_RADIUS_PX,
  GRID_SPACING_WORLD,
  WHEEL_DELTA_MODE_LINE,
  WHEEL_DELTA_MODE_PAGE,
  WHEEL_LINE_PIXELS,
  WHEEL_PAGE_PIXELS,
} from '../../shared/config';
import { zoomAt as zoomAtCamera, type Camera } from './camera';
import { useBoard } from './Board';

/** The viewport's interaction mode (see the story's state diagram). */
export type InteractionMode = 'idle' | 'panning';

/** Safari's non-standard pinch gesture events. */
interface SafariGestureEvent extends Event {
  readonly scale?: number;
  readonly rotation?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

const GESTURE_START = 'gesturestart';
const GESTURE_CHANGE = 'gesturechange';
const GESTURE_END = 'gestureend';

/** A remainder in [0, period), so grid positions never go negative. */
const positiveModulo = (value: number, period: number): number =>
  ((value % period) + period) % period;

/** Convert a wheel delta of the given mode into CSS pixels. */
const deltaToPixels = (delta: number, deltaMode: number): number => {
  if (deltaMode === WHEEL_DELTA_MODE_LINE) return delta * WHEEL_LINE_PIXELS;
  if (deltaMode === WHEEL_DELTA_MODE_PAGE) return delta * WHEEL_PAGE_PIXELS;
  return delta;
};

/** The dot grid, drawn from the camera so it looks attached to the board. */
const gridStyle = (camera: Camera): CSSProperties => {
  const cell = GRID_SPACING_WORLD * camera.zoom;
  const dot = `${GRID_DOT_RADIUS_PX}px`;
  return {
    backgroundImage: `radial-gradient(circle at center, var(--vidi6-grid-color) 0 ${dot}, transparent calc(${dot} + 0.5px))`,
    backgroundSize: `${cell}px ${cell}px`,
    // Put a dot exactly where the world origin is drawn, and repeat from there.
    backgroundPosition: `${positiveModulo(-camera.x * camera.zoom, cell) - cell / 2}px ${
      positiveModulo(-camera.y * camera.zoom, cell) - cell / 2
    }px`,
  };
};

const worldStyle = (camera: Camera): CSSProperties => ({
  transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
});

/**
 * The board surface: it owns pointer, wheel, gesture and keyboard input, draws
 * the dot grid and the world layer, and renders board content in world
 * coordinates as children.
 */
export function BoardViewport({ children }: { children?: ReactNode }): JSX.Element {
  const board = useBoard();
  const { camera, viewportRef } = board;
  const [mode, setMode] = useState<InteractionMode>('idle');

  // Event handlers are attached outside React's render cycle, so they read the
  // board through a ref to always see the latest camera.
  const boardRef = useRef(board);
  boardRef.current = board;

  const pointerIdRef = useRef<number | null>(null);
  const gestureRef = useRef<{ startScale: number; camera: Camera } | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const pointOf = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    // Registered by hand because React's onWheel is passive, and preventDefault
    // here is what stops the browser zooming or scrolling the page.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      boardRef.current.wheel({
        deltaX: deltaToPixels(event.deltaX, event.deltaMode),
        deltaY: deltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: pointOf(event.clientX, event.clientY),
      });
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      gestureRef.current = {
        startScale: gesture.scale ?? 1,
        camera: boardRef.current.camera,
      };
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      const scale = gesture.scale ?? 1;
      const started = gestureRef.current;
      const from = started?.camera ?? boardRef.current.camera;
      const startScale = started?.startScale ?? 1;
      const factor = scale / startScale;
      if (!Number.isFinite(factor) || factor <= 0) return;

      const clientX = gesture.clientX ?? element.getBoundingClientRect().left + element.clientWidth / 2;
      const clientY = gesture.clientY ?? element.getBoundingClientRect().top + element.clientHeight / 2;
      // Zoom relative to the camera as it was when the gesture started, so the
      // gesture tracks the fingers instead of compounding each event.
      boardRef.current.setCamera(zoomAtCamera(from, pointOf(clientX, clientY), factor));
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureRef.current = null;
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener(GESTURE_START, onGestureStart as EventListener, { passive: false });
    element.addEventListener(GESTURE_CHANGE, onGestureChange as EventListener, { passive: false });
    element.addEventListener(GESTURE_END, onGestureEnd as EventListener, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener(GESTURE_START, onGestureStart as EventListener);
      element.removeEventListener(GESTURE_CHANGE, onGestureChange as EventListener);
      element.removeEventListener(GESTURE_END, onGestureEnd as EventListener);
    };
  }, [viewportRef]);

  // Ctrl/Cmd + =, - and 0 zoom the board instead of the browser page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const code = event.code;
      if (event.key === '=' || event.key === '+' || code === 'Equal' || code === 'NumpadAdd') {
        event.preventDefault();
        boardRef.current.zoomStep('in');
      } else if (
        event.key === '-' ||
        event.key === '_' ||
        code === 'Minus' ||
        code === 'NumpadSubtract'
      ) {
        event.preventDefault();
        boardRef.current.zoomStep('out');
      } else if (event.key === '0' || code === 'Digit0' || code === 'Numpad0') {
        event.preventDefault();
        boardRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const isBoardSurface = (target: EventTarget | null): boolean =>
    target !== null && target === viewportRef.current;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Only empty board space starts a pan; board objects stop propagation.
    if (!isBoardSurface(event.target)) return;

    pointerIdRef.current = event.pointerId;
    setMode('panning');
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a convenience: without it the drag still works while
      // the pointer is over the board.
    }
    boardRef.current.beginPan({ x: event.clientX, y: event.clientY });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    boardRef.current.panMove({ x: event.clientX, y: event.clientY });
  };

  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    setMode('idle');
    // The board simply stays where it was at the moment the drag ended.
    boardRef.current.endPan();
  };

  return (
    <div
      ref={viewportRef}
      data-testid="viewport"
      data-interaction-mode={mode}
      className={`board-viewport${mode === 'panning' ? ' is-panning' : ''}`}
      style={gridStyle(camera)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
      onLostPointerCapture={finishPan}
    >
      <div data-testid="world" className="board-world" style={worldStyle(camera)}>
        <div data-testid="origin-marker" className="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
