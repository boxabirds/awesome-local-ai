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
import { screenToWorld, type Camera, type Point } from './camera';
import { registerTestHooks } from './testHooks';
import { useBoard } from './useCamera';

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * Called on a double-click of empty board space with the world point under
   * the pointer. When omitted, double-click does nothing (story 1).
   */
  onCreateStickyAt?(world: Point): void;
  /** Called on a click (no drag) of empty board space, to clear selection. */
  onClearSelection?(): void;
}

/** Safari's pinch gestures, which are not part of the standard DOM types. */
interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** Dot radius on screen; small dots blur into a wash when densely packed. */
const GRID_DOT_RADIUS_PX = 1;
const GRID_DOT_RADIUS_DENSE_PX = 0.5;
const GRID_DENSE_SPACING_PX = 8;

/** Left mouse button / primary pointer. */
const PRIMARY_MOUSE_BUTTON = 0;

export function BoardViewport({ children, onCreateStickyAt, onClearSelection }: BoardViewportProps) {
  const board = useBoard();
  const boardRef = useRef(board);
  boardRef.current = board;

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const downRef = useRef<Point | null>(null);
  const movedRef = useRef(false);
  const camera = board.camera;

  // Non-passive listeners: the board owns wheel and pinch gestures over itself
  // so the browser never scrolls or zooms the page instead (zoom.no_page_zoom).
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      boardRef.current.wheel({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: clientPoint(surface, event),
      });
    };
    const onGestureStart = (event: Event) => {
      const gesture = event as SafariGestureEvent;
      gesture.preventDefault();
      boardRef.current.gestureStart(clientPoint(surface, gesture));
    };
    const onGestureChange = (event: Event) => {
      const gesture = event as SafariGestureEvent;
      gesture.preventDefault();
      boardRef.current.gestureZoom(clientPoint(surface, gesture), gesture.scale);
    };

    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('gesturestart', onGestureStart as EventListener, {
      passive: false,
    });
    surface.addEventListener('gesturechange', onGestureChange as EventListener, {
      passive: false,
    });
    return () => {
      surface.removeEventListener('wheel', onWheel);
      surface.removeEventListener('gesturestart', onGestureStart as EventListener);
      surface.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, []);

  // Ctrl/Cmd + = / - / 0 zoom and reset the board instead of the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const code = boardKeyCommand(event);
      if (!code) return;
      event.preventDefault();
      const controller = boardRef.current;
      if (code === 'in') controller.zoomStep('in');
      else if (code === 'out') controller.zoomStep('out');
      else controller.reset();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Test-only hook used by e2e to jump across the board.
  useEffect(() => {
    registerTestHooks({
      setCamera: (next: Camera) => boardRef.current.setCamera(next),
    });
  }, []);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Only the board surface itself starts a pan; objects added in later
    // stories handle (or stop) their own pointer events.
    if (event.target !== surfaceRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    panningRef.current = true;
    setPanning(true);
    const point = clientPoint(surfaceRef.current!, event);
    downRef.current = point;
    movedRef.current = false;
    try {
      surfaceRef.current?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can fail for synthetic events; dragging still works.
    }
    boardRef.current.beginPan(point);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    const point = clientPoint(surfaceRef.current!, event);
    const down = downRef.current;
    if (down && Math.hypot(point.x - down.x, point.y - down.y) >= DRAG_THRESHOLD_PX) {
      movedRef.current = true;
    }
    boardRef.current.panMove(point);
  };

  const endPan = () => {
    panningRef.current = false;
    setPanning(false);
    boardRef.current.endPan();
  };

  // A click (no drag) on empty board space clears the note selection.
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasClick = !movedRef.current && event.target === surfaceRef.current;
    endPan();
    if (wasClick) onClearSelection?.();
  };

  // A double-click on empty board space creates a note at that world point.
  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== surfaceRef.current) return; // notes handle their own
    if (!onCreateStickyAt) return;
    const point = clientPoint(surfaceRef.current, event);
    onCreateStickyAt(screenToWorld(boardRef.current.camera, point));
  };

  return (
    <div
      ref={surfaceRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      style={gridStyle(camera)}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
      onPointerCancel={endPan}
      onLostPointerCapture={endPan}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="board-world"
        data-testid="board-world"
        style={{ transform: worldLayerTransform(camera) }}
      >
        <div className="origin-marker" aria-hidden="true">
          <div
            className="origin-marker__shape"
            data-testid="origin-marker"
            style={{ transform: `scale(${1 / camera.zoom})` }}
          />
        </div>
        {children}
      </div>
    </div>
  );
}

/** CSS that makes the dot grid look attached to the board (pans and zooms). */
export function gridStyle(camera: Camera): CSSProperties {
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const radius = spacing < GRID_DENSE_SPACING_PX ? GRID_DOT_RADIUS_DENSE_PX : GRID_DOT_RADIUS_PX;
  return {
    backgroundImage: `radial-gradient(circle, var(--grid-dot) ${radius}px, transparent ${radius + 0.5}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${mod(-camera.x * camera.zoom, spacing)}px ${mod(
      -camera.y * camera.zoom,
      spacing,
    )}px`,
  };
}

/** Places world coordinates on screen: scale around the origin, then pan. */
export function worldLayerTransform(camera: Camera): string {
  return `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
}

function clientPoint(surface: Element, event: { clientX: number; clientY: number }): Point {
  const rect = surface.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function mod(value: number, period: number): number {
  if (period <= 0) return 0;
  return ((value % period) + period) % period;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}

function boardKeyCommand(event: KeyboardEvent): 'in' | 'out' | 'reset' | null {
  switch (boardKey(event)) {
    case '=':
    case '+':
      return 'in';
    case '-':
    case '_':
      return 'out';
    case '0':
      return 'reset';
    default:
      return null;
  }
}

function boardKey(event: KeyboardEvent): string | null {
  if (event.key.length === 1) return event.key;
  switch (event.code) {
    case 'Equal':
      return '=';
    case 'Minus':
      return '-';
    case 'Digit0':
    case 'Numpad0':
      return '0';
    case 'NumpadAdd':
      return '+';
    case 'NumpadSubtract':
      return '-';
    default:
      return null;
  }
}
