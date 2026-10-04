import { useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  JSX,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import {
  DRAG_THRESHOLD_PX,
  GRID_DOT_RADIUS_PX,
  GRID_SPACING_WORLD,
  WHEEL_DELTA_MODE_LINE,
  WHEEL_DELTA_MODE_PAGE,
  WHEEL_LINE_HEIGHT_PX,
} from '../../shared/config';
import type { Camera, Point, Size } from './camera';
import type { ToolId } from '../tools/useActiveTool';
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
  /**
   * Double-click on empty board space - never on a note or a toolbar - with the point
   * relative to the top-left of the board area. This is where sticky notes are born.
   */
  onEmptyDoubleClick?(point: Point): void;
  /** A press on empty board space that did not turn into a pan: clears the selection. */
  onEmptyClick?(): void;
  /**
   * The selection rectangle gesture. Given, a shift+drag on empty board space draws a marquee
   * instead of panning the board; not given, shift+drag pans like any other drag.
   */
  marquee?: MarqueeHandlers;
  /**
   * Which tool the board is in, which decides what a press on the board's own space is *for*.
   *
   * `'text'` takes the board's pointer over completely: the cursor says text, and a press - on
   * empty space or on top of something already there - writes a text object at that point instead
   * of panning, drawing a marquee or dragging anything. It is taken over rather than added to the
   * handlers because the two cannot be asked the same question: a press that is about to become a
   * word is not a press that is about to become a movement, and the tool is what knows which.
   */
  tool?: BoardTool;
  /** The board was pointed at while the Text tool was up, and the press did not travel: put a text
   * object here. The point is relative to the top-left of the board area, in world units at zoom 1. */
  onTextPlace?(point: Point): void;
}

/** What a press on the board is for. Every tool the board has, in one list: the viewport takes the
 * pointer over for the ones that place something, and the rest are drawn by their own tool. */
export type BoardTool = ToolId;

/**
 * The rectangle a person drags across empty board space to select what is inside it.
 * Points are relative to the top-left of the board area; who they are given to is the board's
 * business - this component only knows that shift+drag is a rectangle and not a pan.
 */
export interface MarqueeHandlers {
  begin(point: Point): void;
  move(point: Point): void;
  /** Let go: whatever the box contains is the caller's to select. */
  end(point: Point): void;
  /** Interrupted: the box is thrown away, and nothing else is touched. */
  cancel(): void;
}

/** Which gesture the board area is in the middle of. */
type Gesture = 'none' | 'pan' | 'marquee';

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
  onEmptyDoubleClick,
  onEmptyClick,
  marquee,
  tool = 'select',
  onTextPlace,
}: BoardViewportProps): JSX.Element {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [gesture, setGesture] = useState<Gesture>('none');
  const gestureRef = useRef<Gesture>('none');
  const pointerIdRef = useRef<number | null>(null);
  // Where the current press went down, and whether it travelled far enough to be a pan.
  // A press that stayed put is a click on the board, which deselects.
  const pressOriginRef = useRef<Point | null>(null);
  const movedRef = useRef(false);
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

  // The two callbacks above are optional; refs keep the handlers above stable.
  const emptyDoubleClickRef = useRef(onEmptyDoubleClick);
  const emptyClickRef = useRef(onEmptyClick);
  const marqueeHandlerRef = useRef(marquee);
  const textPlaceRef = useRef(onTextPlace);
  useEffect(() => {
    emptyDoubleClickRef.current = onEmptyDoubleClick;
    emptyClickRef.current = onEmptyClick;
    marqueeHandlerRef.current = marquee;
    textPlaceRef.current = onTextPlace;
  });

  // The Text tool's claim on the pointer, remembered between the press and its release: where on
  // the board the press went down (which is the point the text object is put at - where somebody
  // aimed, not where the finger happened to leave) and where it was on the screen, to tell a click
  // from a drag afterwards.
  const placingRef = useRef<{ pointerId: number; point: Point; clientX: number; clientY: number } | null>(
    null,
  );

  /**
   * While the Text tool is up, the board takes the pointer back in the *capture* phase, before any
   * of the handlers above - and before any object - get to see it.
   *
   * Capture rather than the component's own `onPointerDown`, because the press has to be taken from
   * under an object too: a text object placed on top of a sticky note is placed on top of a sticky
   * note, and a handler that only fires on empty space could not do that. The press is swallowed
   * outright, so the board neither pans nor draws a marquee nor drags the thing under the cursor,
   * and the double-click is swallowed with it - otherwise a double-click with the Text tool would
   * make a sticky note as well as a text object, which is two objects for one gesture and a note
   * nobody asked for.
   *
   * A press that travels is not a place: it is nothing at all. The Text tool has one action, and
   * dragging is not it, so a drag is dropped rather than turned into a pan the person did not ask
   * for while a text was half in their head.
   */
  useEffect(() => {
    const element = surfaceRef.current;
    if (element === null || tool !== 'text') {
      return;
    }
    const isBoardUi = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('[data-board-ui]') !== null;
    const claim = (event: PointerEvent): void => {
      if (isBoardUi(event.target)) {
        // The toolbars, the selection bar and the resize handles are still themselves: a press on
        // one of those changes a tool or a size, it does not write a text object behind them.
        return;
      }
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      placingRef.current = {
        pointerId: event.pointerId,
        point: boardPoint(element, event.clientX, event.clientY),
        clientX: event.clientX,
        clientY: event.clientY,
      };
      event.preventDefault();
      event.stopPropagation();
    };
    const release = (event: PointerEvent): void => {
      const placing = placingRef.current;
      if (placing === null || event.pointerId !== placing.pointerId) {
        return;
      }
      placingRef.current = null;
      if (Math.hypot(event.clientX - placing.clientX, event.clientY - placing.clientY) >= DRAG_THRESHOLD_PX) {
        return;
      }
      textPlaceRef.current?.(placing.point);
    };
    const swallowDoubleClick = (event: MouseEvent): void => {
      if (isBoardUi(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener('pointerdown', claim, true);
    element.addEventListener('dblclick', swallowDoubleClick, true);
    // The release is listened for on the window, because a press that went down on the board can be
    // let go anywhere, and the text is placed where it started either way.
    window.addEventListener('pointerup', release);
    return () => {
      element.removeEventListener('pointerdown', claim, true);
      element.removeEventListener('dblclick', swallowDoubleClick, true);
      window.removeEventListener('pointerup', release);
      placingRef.current = null;
    };
  }, [tool]);

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
    if (tool === 'pen') {
      // The Pen tool takes every drag on the board, including one that starts on top of something that
      // is already there: a press with the pen is a line being drawn, never a board being moved and
      // never a note being picked up. {@link PenTool} listens on the window in the capture phase and
      // swallows the press before it reaches this handler, so the line below is the rule rather than
      // the mechanism - and the rule is written here anyway, because a mechanism that lives in another
      // file is a thing a later story can undo by accident. The wheel, the trackpad and the pinch are
      // deliberately untouched: while the pen is up, scrolling still navigates (story 1 unchanged).
      return;
    }
    // Only empty board space starts a drag; board objects can stop propagation.
    if (!isBoardSurface(element, event.target)) {
      return;
    }
    const point = boardPoint(element, event.clientX, event.clientY);

    if (event.shiftKey && marqueeHandlerRef.current !== undefined) {
      // Shift + drag draws the selection rectangle instead of moving the board. Shift is borrowed
      // because the board has no tools and a drag is the only thing a pointer does on empty space
      // - and because it is what every design tool does, so nobody has to be told about it.
      capturePointer(element, event.pointerId);
      gestureRef.current = 'marquee';
      pointerIdRef.current = event.pointerId;
      pressOriginRef.current = point;
      movedRef.current = false;
      setGesture('marquee');
      marqueeHandlerRef.current.begin(point);
      return;
    }

    capturePointer(element, event.pointerId);
    gestureRef.current = 'pan';
    pointerIdRef.current = event.pointerId;
    pressOriginRef.current = point;
    movedRef.current = false;
    setGesture('pan');
    inputRef.current.beginPan(point);
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (gestureRef.current === 'none' || event.pointerId !== pointerIdRef.current) {
      return;
    }
    const element = surfaceRef.current;
    if (element === null) {
      return;
    }
    const point = boardPoint(element, event.clientX, event.clientY);
    if (gestureRef.current === 'marquee') {
      movedRef.current = true;
      marqueeHandlerRef.current?.move(point);
      return;
    }
    const origin = pressOriginRef.current;
    if (
      origin !== null &&
      Math.hypot(point.x - origin.x, point.y - origin.y) >= DRAG_THRESHOLD_PX
    ) {
      movedRef.current = true;
    }
    inputRef.current.panMove(point);
  };

  /**
   * `up` is the pointer being lifted, `cancel` the drag being interrupted (or the pointer
   * capture being released after the pointer went up). Only a press on empty board space
   * that never travelled counts as a click on the board, which clears the selection.
   */
  const stopPan = (event: ReactPointerEvent<HTMLDivElement>, reason: 'up' | 'cancel'): void => {
    // A press on a note is stopped by the note, so no pan was started: without this guard
    // every click on a note would also deselect it.
    if (gestureRef.current === 'none' || event.pointerId !== pointerIdRef.current) {
      return;
    }
    const element = surfaceRef.current;
    if (element === null) {
      return;
    }
    const rectangle = gestureRef.current === 'marquee';
    releasePointer(element, event.pointerId);
    gestureRef.current = 'none';
    pointerIdRef.current = null;
    pressOriginRef.current = null;
    setGesture('none');
    if (rectangle) {
      // A marquee ends by selecting what its box contains; an interrupted one selects nothing at
      // all, and leaves the selection that was there before it untouched. It is never a click on
      // the board, so it never clears the selection either.
      if (reason === 'cancel') {
        marqueeHandlerRef.current?.cancel();
      } else {
        marqueeHandlerRef.current?.end(boardPoint(element, event.clientX, event.clientY));
      }
      return;
    }
    inputRef.current.endPan();
    if (reason === 'up' && !movedRef.current) {
      emptyClickRef.current?.();
    }
  };

  /** Add an object where the board was double-clicked (notes stop the event themselves). */
  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const element = surfaceRef.current;
    if (element === null || !isBoardSurface(element, event.target)) {
      return;
    }
    emptyDoubleClickRef.current?.(boardPoint(element, event.clientX, event.clientY));
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
      data-tool={tool}
      data-panning={gesture === 'pan' ? 'true' : 'false'}
      data-marquee={gesture === 'marquee' ? 'true' : 'false'}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={(event) => {
        stopPan(event, 'up');
      }}
      onPointerCancel={(event) => {
        stopPan(event, 'cancel');
      }}
      onLostPointerCapture={(event) => {
        stopPan(event, 'cancel');
      }}
      onDoubleClick={handleDoubleClick}
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
