import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { GRID_SPACING_WORLD } from '../../shared/config';
import type { Point } from './camera';
import { useBoardCamera } from './cameraContext';

/** Pixels per wheel "line" tick (deltaMode === 1). */
const WHEEL_DELTA_MODE_LINE_PX = 40;
/** Pixels per wheel "page" tick (deltaMode === 2). */
const WHEEL_DELTA_MODE_PAGE_PX = 800;

/** Movement (screen px) that turns a press on the empty board into a pan. */
const CLICK_DRAG_LIMIT_PX = 3;

const DELTA_MODE_PIXELS = 0;
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

/** Safari's non-standard pinch gesture events. */
interface GestureEventLike extends Event {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** Pixels per wheel tick for the event's delta mode. */
function deltaModeFactor(deltaMode: number): number {
  switch (deltaMode) {
    case DELTA_MODE_LINE:
      return WHEEL_DELTA_MODE_LINE_PX;
    case DELTA_MODE_PAGE:
      return WHEEL_DELTA_MODE_PAGE_PX;
    case DELTA_MODE_PIXELS:
    default:
      return 1;
  }
}

/** Convert a wheel event's delta to CSS pixels. */
export function wheelDeltaPixels(e: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}): { x: number; y: number } {
  const factor = deltaModeFactor(e.deltaMode);
  return { x: e.deltaX * factor, y: e.deltaY * factor };
}

/** Always-positive modulo, for wrapping the dot grid. */
function mod(value: number, modulus: number): number {
  if (modulus <= 0 || !Number.isFinite(value)) return 0;
  return ((value % modulus) + modulus) % modulus;
}

/** True when the pointerdown happened on the empty board, not on an object. */
function isBoardSurface(target: EventTarget | null): boolean {
  return target instanceof Element && target.hasAttribute('data-board-surface');
}

/** True when typing belongs to a text field rather than the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * Double-click on empty board space (never on an object): the point is in
   * screen coordinates. Story 2 creates a sticky note centred here.
   */
  onCreateAtPoint?(point: Point): void;
  /**
   * A press on empty board space that did not move: clears the selection.
   */
  onClearSelection?(): void;
}

/**
 * The infinite board: an input surface (drag, wheel, pinch, keyboard) with a
 * dot grid that moves with the camera, and a world layer holding board objects
 * in world coordinates.
 */
export function BoardViewport({
  children,
  onCreateAtPoint,
  onClearSelection,
}: BoardViewportProps) {
  const { camera, beginPan, panMove, endPan, wheel, zoomBy, zoomStep, reset } =
    useBoardCamera();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const gestureRef = useRef<{ lastScale: number } | null>(null);
  // Press on empty space: remembered so a click without movement can clear the
  // selection while a drag stays a pan.
  const clickRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);

  const startPan = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (!isBoardSurface(e.target)) return;
      const surface = surfaceRef.current;
      if (surface) {
        try {
          surface.setPointerCapture?.(e.pointerId);
        } catch {
          // Pointer capture can fail if the pointer vanished; ignore.
        }
      }
      activePointerRef.current = e.pointerId;
      clickRef.current = { x: e.clientX, y: e.clientY, moved: false };
      setPanning(true);
      beginPan({ x: e.clientX, y: e.clientY });
    },
    [beginPan],
  );

  const movePan = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current !== e.pointerId) return;
      const click = clickRef.current;
      if (click && !click.moved) {
        const dx = e.clientX - click.x;
        const dy = e.clientY - click.y;
        if (Math.hypot(dx, dy) >= CLICK_DRAG_LIMIT_PX) click.moved = true;
      }
      panMove({ x: e.clientX, y: e.clientY });
    },
    [panMove],
  );

  const finishPan = useCallback(
    (e?: ReactPointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current === null) return;
      if (e && activePointerRef.current !== e.pointerId) return;
      const surface = surfaceRef.current;
      const pointerId = activePointerRef.current;
      activePointerRef.current = null;
      const click = clickRef.current;
      clickRef.current = null;
      // A press on the empty board that never moved is a click: deselect.
      if (click && !click.moved) onClearSelection?.();
      if (surface) {
        try {
          surface.releasePointerCapture?.(pointerId);
        } catch {
          // Already released.
        }
      }
      // The board stays where it was at the moment of interruption.
      endPan();
      setPanning(false);
    },
    [endPan, onClearSelection],
  );

  // Wheel: a non-passive native listener, because React's onWheel is passive
  // and cannot stop the browser from zooming or scrolling the page.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const onWheel = (e: WheelEvent) => {
      // The board owns scroll and zoom gestures over the board.
      e.preventDefault();
      const delta = wheelDeltaPixels(e);
      wheel({
        deltaX: delta.x,
        deltaY: delta.y,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX, y: e.clientY },
      });
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [wheel]);

  // Safari pinch: gesturestart/gesturechange/gestureend with a scale ratio.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureRef.current = { lastScale: (e as GestureEventLike).scale || 1 };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as GestureEventLike;
      const state = gestureRef.current ?? { lastScale: gesture.scale || 1 };
      const lastScale = state.lastScale || 1;
      const scale = gesture.scale || 1;
      state.lastScale = scale;
      gestureRef.current = state;
      const point: Point = { x: gesture.clientX, y: gesture.clientY };
      zoomBy(scale / lastScale, point);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureRef.current = null;
    };
    surface.addEventListener('gesturestart', onGestureStart as EventListener);
    surface.addEventListener('gesturechange', onGestureChange as EventListener);
    surface.addEventListener('gestureend', onGestureEnd as EventListener);
    return () => {
      surface.removeEventListener('gesturestart', onGestureStart as EventListener);
      surface.removeEventListener('gesturechange', onGestureChange as EventListener);
      surface.removeEventListener('gestureend', onGestureEnd as EventListener);
    };
  }, [zoomBy]);

  // Keyboard: Ctrl/Cmd + = / - zoom one step, Ctrl/Cmd + 0 resets. All three
  // call preventDefault so the browser does not zoom the page instead.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isTextEntry(e.target)) return;
      const key = e.key;
      if (key === '=' || key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        zoomStep('in');
      } else if (
        key === '-' ||
        key === '_' ||
        e.code === 'Minus' ||
        e.code === 'NumpadSubtract'
      ) {
        e.preventDefault();
        zoomStep('out');
      } else if (key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const gridOffsetX = mod(-camera.x * camera.zoom, gridSpacing);
  const gridOffsetY = mod(-camera.y * camera.zoom, gridSpacing);

  const surfaceStyle: CSSProperties = {
    backgroundImage:
      'radial-gradient(circle at center, var(--grid-dot) 1px, transparent 1.5px)',
    backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
    backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
  };

  const worldStyle: CSSProperties = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
    transformOrigin: '0 0',
  };

  return (
    <div
      ref={surfaceRef}
      data-testid="viewport"
      data-board-surface="true"
      data-panning={panning ? 'true' : 'false'}
      className="board-viewport"
      style={surfaceStyle}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={(e) => finishPan(e)}
      onPointerCancel={(e) => finishPan(e)}
      onLostPointerCapture={(e) => finishPan(e)}
      onDoubleClick={(e) => {
        // Only a double-click on the empty board creates something; a note
        // stops propagation and starts editing instead.
        if (!isBoardSurface(e.target)) return;
        onCreateAtPoint?.({ x: e.clientX, y: e.clientY });
      }}
    >
      <div
        data-testid="world-layer"
        className="board-world"
        style={worldStyle}
        data-camera-x={camera.x}
        data-camera-y={camera.y}
        data-camera-zoom={camera.zoom}
      >
        <div data-testid="origin-marker" className="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
