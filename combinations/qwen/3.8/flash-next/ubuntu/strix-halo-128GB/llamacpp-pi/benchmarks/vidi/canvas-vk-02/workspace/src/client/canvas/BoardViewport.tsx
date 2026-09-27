import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { GRID_DOT_RADIUS_PX, GRID_SPACING_WORLD, WHEEL_DELTA_MODE_LINE_PX } from '../../shared/config';
import type { Point } from './camera';
import { useCameraContext } from './useCamera';

export interface BoardViewportProps {
  /** Board content, rendered in world coordinates (story 2 onwards). */
  children?: ReactNode;
  /**
   * A double-click on empty board space, in board-local screen coordinates
   * (relative to the board's top-left). Objects stop propagation so this only
   * fires for empty space. Story 2 creates a note here.
   */
  onEmptyDblClick?(point: Point): void;
  /** A click on empty board space (a press with no pan). Clears the selection. */
  onEmptyClick?(): void;
}

/** Safari pinch-to-zoom events (not in the web standards types). */
interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

const GESTURE_START = 'gesturestart';
const GESTURE_CHANGE = 'gesturechange';
const GESTURE_END = 'gestureend';

/**
 * The infinite board: an input surface with a dot grid that moves with the
 * camera, plus a world layer holding board content.
 *
 * Everything is one CSS transform away: the world layer is scaled and
 * translated from the camera, the grid is a repeating background sized and
 * positioned from the camera. There are no edges — the board is unbounded.
 */
export function BoardViewport({ children, onEmptyDblClick, onEmptyClick }: BoardViewportProps) {
  const { camera, beginPan, panMove, endPan, wheel, pinch, zoomStep, reset } = useCameraContext();
  const elementRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);

  // --- wheel: non-passive, so the page never zooms or scrolls (TC-31) --------
  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return;
    const handler = (event: WheelEvent) => {
      // Always swallowed over the board: Ctrl/Cmd + wheel and trackpad pinch
      // must not zoom the page, and a plain wheel must not scroll the page.
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const deltas = wheelPixels(event, rect.width, rect.height);
      wheel({
        deltaX: deltas.deltaX,
        deltaY: deltas.deltaY,
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      });
    };
    element.addEventListener('wheel', handler, { passive: false });
    return () => element.removeEventListener('wheel', handler);
  }, [wheel]);

  // --- Safari pinch gestures -------------------------------------------------
  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return;
    let previousScale = 1;

    const pointOf = (event: SafariGestureEvent): Point => {
      const rect = element.getBoundingClientRect();
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        return { x: rect.width / 2, y: rect.height / 2 };
      }
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const scaleOf = (event: SafariGestureEvent): number =>
      Number.isFinite(event.scale) && event.scale > 0 ? event.scale : 1;

    const onStart = (event: Event) => {
      event.preventDefault();
      previousScale = scaleOf(event as SafariGestureEvent);
    };
    const onChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      const scale = scaleOf(gesture);
      const factor = scale / previousScale;
      previousScale = scale;
      if (factor !== 1) pinch(factor, pointOf(gesture));
    };
    const onEnd = (event: Event) => {
      event.preventDefault();
      previousScale = 1;
    };

    const listeners: Array<readonly [string, (event: Event) => void]> = [
      [GESTURE_START, onStart],
      [GESTURE_CHANGE, onChange],
      [GESTURE_END, onEnd],
    ];
    for (const [name, listener] of listeners) element.addEventListener(name, listener);
    return () => {
      for (const [name, listener] of listeners) element.removeEventListener(name, listener);
    };
  }, [pinch]);

  // --- keyboard: Ctrl/Cmd + = - 0, never the browser's own zoom shortcuts ----
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key === '=' || event.key === '+' || event.code === 'Equal') {
        event.preventDefault();
        zoomStep('in');
      } else if (event.key === '-' || event.key === '_' || event.code === 'Minus') {
        event.preventDefault();
        zoomStep('out');
      } else if (event.key === '0' || event.code === 'Digit0') {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomStep, reset]);

  // --- drag to pan ----------------------------------------------------------
  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = (elementRef.current as HTMLDivElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const stopPanning = () => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    setIsPanning(false);
    endPan();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = elementRef.current;
    if (element === null) return;
    // Only presses on the empty board: objects added by later stories stop
    // propagation or opt in with data-board-surface.
    if (!isBoardSurface(event.target, element)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    isPanningRef.current = true;
    setIsPanning(true);
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // No pointer capture in this environment (jsdom); the drag still works.
    }
    beginPan(localPoint(event));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) return;
    panMove(localPoint(event));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) return;
    try {
      (elementRef.current as HTMLDivElement).releasePointerCapture(event.pointerId);
    } catch {
      // Capture already released.
    }
    stopPanning();
    // The press began on empty board space, so a click there clears the
    // selection (a note's own click stops propagation and never reaches here).
    onEmptyClick?.();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const element = elementRef.current;
    if (element === null) return;
    if (!isBoardSurface(event.target, element)) return;
    onEmptyDblClick?.(localPoint(event));
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const dotDiameter = GRID_DOT_RADIUS_PX * 2;

  return (
    <div
      ref={elementRef}
      className="board"
      data-testid="board"
      data-panning={isPanning ? 'true' : 'false'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={stopPanning}
      onLostPointerCapture={stopPanning}
      onDoubleClick={onDoubleClick}
      style={{
        backgroundImage: `radial-gradient(circle at center, var(--grid-dot) 0 ${dotDiameter}px, transparent ${dotDiameter}px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${modulo(-camera.x * camera.zoom, spacing)}px ${modulo(-camera.y * camera.zoom, spacing)}px`,
      }}
    >
      <div
        className="board-world"
        data-testid="board-world"
        style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      >
        <span className="board-origin" data-testid="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

function isBoardSurface(target: EventTarget | null, element: HTMLDivElement): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target === element || target.hasAttribute('data-board-surface');
}

/** Wheel deltas come in lines or pages for some devices; convert to pixels. */
function wheelPixels(event: WheelEvent, width: number, height: number): { deltaX: number; deltaY: number } {
  const lineFactor = event.deltaMode === 1 ? WHEEL_DELTA_MODE_LINE_PX : 1;
  const pageFactorX = event.deltaMode === 2 ? width : 1;
  const pageFactorY = event.deltaMode === 2 ? height : 1;
  return {
    deltaX: event.deltaX * lineFactor * pageFactorX,
    deltaY: event.deltaY * lineFactor * pageFactorY,
  };
}

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
