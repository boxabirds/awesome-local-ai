import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import * as Y from 'yjs';

import { createSticky } from '../../shared/board-model.js';
import { GRID_SPACING_WORLD, DRAG_THRESHOLD_PX } from '../../shared/config.js';
import { screenToWorld, type Point } from './camera.js';
import { useCameraContext } from './useCamera.js';

/**
 * The input surface: an unbounded board drawn with a dot grid, plus a world
 * layer that objects (story 2 onwards) are rendered into.
 *
 * The dot grid and the world layer are positioned with CSS transforms derived
 * from the camera, so panning and zooming cost no re-layout: the grid is a CSS
 * background whose size and position come from the camera, and the world layer
 * is `scale(zoom) translate(-x, -y)` with `transform-origin: 0 0`.
 */
export interface BoardViewportProps {
  /** Rendered in world coordinates. */
  children?: ReactNode;
  /** The board document a double-click on empty space adds a note to. */
  doc: Y.Doc;
  /** A note was created by a double-click: the app selects it and opens it. */
  onStickyCreated(id: string): void;
  /** A single click landed on empty board space: the app clears the selection. */
  onEmptyClick(): void;
}

type GestureEventLike = Event & {
  scale?: number;
  clientX?: number;
  clientY?: number;
};

/** Positive modulo, so grid offsets stay small however far the camera travels. */
const mod = (value: number, period: number): number => {
  const wrapped = value % period;
  return wrapped < 0 ? wrapped + period : wrapped;
};

/** Only this pointer button starts a pan (right/middle click are ignored). */
const PRIMARY_BUTTON = 0;

export function BoardViewport({
  children,
  doc,
  onStickyCreated,
  onEmptyClick,
}: BoardViewportProps): JSX.Element {
  const {
    camera,
    viewport,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureStart,
    gestureChange,
    gestureEnd,
  } = useCameraContext();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const activePointerRef = useRef<number | null>(null);
  // A drag of the board is not a click: after panning, the click that the
  // browser still reports must not clear the selection.
  const draggedRef = useRef(false);
  const downPointRef = useRef<Point | null>(null);
  const [panning, setPanning] = useState(false);

  /** Viewport-client coordinates -> coordinates inside the board area. */
  const toBoardPoint = useCallback(
    (event: { clientX?: number; clientY?: number }): Point => {
      // Safari's GestureEvent and jsdom's synthetic events both carry clientX/Y;
      // without them a gesture is treated as happening at the board centre.
      const clientX = Number.isFinite(event.clientX) ? (event.clientX as number) : viewport.width / 2;
      const clientY = Number.isFinite(event.clientY) ? (event.clientY as number) : viewport.height / 2;
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
        return { x: clientX, y: clientY };
      }
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [viewport.width, viewport.height],
  );

  /**
   * A pan only starts on empty board space (the surface itself or the grid);
   * objects in later stories stop propagation instead.
   */
  const isEmptyBoardSpace = (target: EventTarget | null): boolean => {
    const surface = surfaceRef.current;
    const element = target as HTMLElement | null;
    if (!surface || !element) return false;
    return element === surface || element.dataset?.boardSurface === 'true';
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== PRIMARY_BUTTON) return;
    // Touch-screen navigation is out of scope for the board (see PRD).
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    if (!isEmptyBoardSpace(event.target)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activePointerRef.current = event.pointerId;
    draggedRef.current = false;
    downPointRef.current = toBoardPoint(event);
    setPanning(true);
    beginPan(downPointRef.current);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    const point = toBoardPoint(event);
    const from = downPointRef.current;
    // Past the drag threshold this pointer gesture is a pan, not a click, even
    // though the browser will still report a click at the end of it.
    if (
      from !== null &&
      (point.x - from.x) ** 2 + (point.y - from.y) ** 2 >=
        DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
    ) {
      draggedRef.current = true;
    }
    panMove(point);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    // pointerup, pointercancel and lostpointercapture all end the drag and keep
    // the board exactly where it was at the moment of interruption.
    activePointerRef.current = null;
    setPanning(false);
    endPan();
  };

  /**
   * A double-click on empty board space creates a sticky note centred on the
   * pointer (the same gesture as the toolbar button). The screen point is turned
   * into a world point first, so a note created while zoomed out or panned away
   * lands where the user looked.
   */
  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isEmptyBoardSpace(event.target)) return;
    const world = screenToWorld(camera, toBoardPoint(event));
    const id = createSticky(doc, world);
    if (typeof id === 'string') onStickyCreated(id);
  };

  /** A click on empty space selects nothing; a click that was a pan does not. */
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (!isEmptyBoardSpace(event.target)) return;
    onEmptyClick();
  };

  // Wheel and Safari gesture listeners must be non-passive to prevent the
  // browser's own page scroll / page zoom; React's onWheel is passive.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      wheel({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: toBoardPoint(event),
      });
    };

    const cancel = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const onGestureStart = (event: Event) => {
      cancel(event);
      gestureStart(toBoardPoint(event as GestureEventLike));
    };
    const onGestureChange = (event: Event) => {
      cancel(event);
      const gesture = event as GestureEventLike;
      gestureChange(toBoardPoint(gesture), typeof gesture.scale === 'number' ? gesture.scale : 1);
    };
    const onGestureEnd = (event: Event) => {
      cancel(event);
      gestureEnd();
    };

    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('gesturestart', onGestureStart, { passive: false });
    surface.addEventListener('gesturechange', onGestureChange, { passive: false });
    surface.addEventListener('gestureend', onGestureEnd, { passive: false });

    return () => {
      surface.removeEventListener('wheel', onWheel);
      surface.removeEventListener('gesturestart', onGestureStart);
      surface.removeEventListener('gesturechange', onGestureChange);
      surface.removeEventListener('gestureend', onGestureEnd);
    };
  }, [wheel, gestureStart, gestureChange, gestureEnd, toBoardPoint]);

  // Dot grid: spacing and position move with the board so it looks attached.
  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const gridOffsetX = mod(-camera.x * camera.zoom, gridSpacing);
  const gridOffsetY = mod(-camera.y * camera.zoom, gridSpacing);

  return (
    <div
      ref={surfaceRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      aria-label="Board"
      role="application"
      style={{
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onDoubleClick={handleDoubleClick}
      onClick={handleClick}
    >
      <div
        className="board-world"
        data-testid="world-layer"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
        }}
      >
        <div
          className="origin-marker-anchor"
          data-testid="origin-marker-anchor"
          aria-hidden="true"
          style={{ transform: `scale(${1 / camera.zoom})` }}
        >
          <div className="origin-marker" data-testid="origin-marker" />
        </div>
        {children}
      </div>
    </div>
  );
}
