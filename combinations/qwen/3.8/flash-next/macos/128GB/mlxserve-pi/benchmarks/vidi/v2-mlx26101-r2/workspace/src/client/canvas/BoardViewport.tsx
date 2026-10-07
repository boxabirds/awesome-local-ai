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
import { createText } from '../../shared/objects/text.js';
import { GRID_SPACING_WORLD, DRAG_THRESHOLD_PX, DOUBLE_CLICK_WINDOW_MS } from '../../shared/config.js';
import { screenToWorld, type Point } from './camera.js';
import type { Tool } from '../board/useTool.js';
import { useCameraContext } from './useCamera.js';
import { MarqueeRect, type MarqueeController } from './Marquee.js';

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
  /**
   * False while the board takes no content (see `canEdit`). Only the double-click
   * that would create a note is affected: panning, zooming and clicking away a
   * selection are how a person gets around a board, and a board that has stopped
   * answering them looks frozen rather than read-only.
   */
  canEdit?: boolean;
  /**
   * The Shift+drag marquee (`sel.marquee`). A drag on empty space with Shift held
   * draws a selection box instead of panning; the box's state and release live in
   * the board surface, which owns the selection.
   */
  marquee?: MarqueeController;
  /**
   * The active tool (story 9). While it is `text`, the surface stops being a pan
   * surface and becomes a place to write: a pointerdown here is the setting-down of
   * a cursor and nothing else - it does not pan, does not marquee, and does not pick
   * up the object under it - the cursor says `text`, and the click puts a text object
   * down at the point that was clicked, on top of an object if that is what is there,
   * because the person is saying "words go *here*", not "select that".
   *
   * Absent means the board has no tools, which is what every board was before
   * story 9 and what a component test of one object still is.
   */
  tool?: Tool;
  /** The Text tool's click placed a text object: switch back to Select, edit it. */
  onTextCreated?(id: string): void;
  /**
   * Whose id is written on a new object as its creator. This build has no
   * identities yet - nobody on the board knows who the person behind it is, and
   * story 14 is the story that finds out - so a board passes nothing and a text
   * object is created without attribution rather than with an invented name.
   */
  identityId?: string;
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
  canEdit = true,
  marquee,
  tool,
  onTextCreated,
  identityId,
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
  // The pointer currently drawing a marquee (Shift held), if any.
  const marqueeingRef = useRef<number | null>(null);
  // A click in Text mode placed text, and when. Kept outside React state on purpose:
  // it is read by the double-click handler, which runs after it and would otherwise
  // read the tool as it was *before* that click - Text mode switches itself back to
  // Select as it places, so by the double-click the tool is already Select again.
  // It carries the moment rather than a flag because the thing it remembers is one
  // gesture, and gestures expire: a double-click a minute later is somebody wanting
  // a note, and must not be eaten by a text object placed since.
  const textPlacedAtRef = useRef(0);
  /**
   * The Text tool's own record of the pointer being held on the board, and whether
   * it travelled far enough afterwards to count as a drag. The ordinary path has
   * `draggedRef` for that, set by the pan it is in; in Text mode no pan is ever
   * begun, so the tool keeps its own - otherwise a drag, which a browser finishes
   * with a `click` anyway, would write text at the place it happened to end.
   */
  const textPointerRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
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

  /**
   * The Text tool takes the press before anything on the board can have it.
   *
   * While the tool is up a pointerdown is the setting-down of a cursor and nothing
   * else: not a pan, not a marquee, and - which is what this capture phase is for -
   * not a note being picked up. A note that began its own drag would finish it with
   * a `click`, like every drag a browser makes, and a board that read that click as
   * an intention to write would leave text where the pointer happened to let go. So
   * the press stops here, on its way down to the object, and the board is not
   * rearranged in a mode whose whole job is to put words down. Rearranging is what
   * the other tool is for, and `Escape` or any click goes back to it.
   */
  const handlePointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== 'text') return;
    if (event.button !== PRIMARY_BUTTON) return;
    // Touch-screen navigation is out of scope for the board (see PRD).
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const down = toBoardPoint(event);
    textPointerRef.current = { x: down.x, y: down.y, moved: false };
    event.stopPropagation();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== PRIMARY_BUTTON) return;
    // Touch-screen navigation is out of scope for the board (see PRD).
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    // Text mode took its press above; this is the same question asked again because a
    // press on the board surface itself is handled by both handlers on this element.
    if (tool === 'text') return;
    if (!isEmptyBoardSpace(event.target)) return;
    // Shift held on empty space is the marquee, not a pan (`sel.marquee`).
    if (event.shiftKey && marquee) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      marqueeingRef.current = event.pointerId;
      downPointRef.current = toBoardPoint(event);
      draggedRef.current = false;
      marquee.begin(downPointRef.current);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activePointerRef.current = event.pointerId;
    draggedRef.current = false;
    downPointRef.current = toBoardPoint(event);
    setPanning(true);
    beginPan(downPointRef.current);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The Text tool's own drag watch: it has to run whatever the pointer is over,
    // because the drag that must not write text is usually over an object.
    const textPointer = textPointerRef.current;
    if (textPointer !== null && !textPointer.moved) {
      const here = toBoardPoint(event);
      if (
        (here.x - textPointer.x) ** 2 + (here.y - textPointer.y) ** 2 >=
        DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
      ) {
        textPointer.moved = true;
      }
    }
    const marqueing = marqueeingRef.current === event.pointerId;
    if (!marqueing && activePointerRef.current !== event.pointerId) return;
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
    if (marqueing) {
      marquee?.move(point);
      return;
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

  /** Release: a marquee in flight selects what is fully inside it. */
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeingRef.current === event.pointerId) {
      marqueeingRef.current = null;
      marquee?.end();
      return;
    }
    finishDrag(event);
  };

  /**
   * A cancelled gesture abandons a marquee without touching the selection
   * (TC-22) - the opposite of a release, which selects.
   */
  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeingRef.current === event.pointerId) {
      marqueeingRef.current = null;
      marquee?.cancel();
      return;
    }
    finishDrag(event);
  };

  /**
   * A double-click on empty board space creates a sticky note centred on the
   * pointer (the same gesture as the toolbar button). The screen point is turned
   * into a world point first, so a note created while zoomed out or panned away
   * lands where the user looked.
   */
  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A click that placed text is never also a double-click that creates a note:
    // the two clicks of a double-click arrive as two clicks first, and the first of
    // them already put a text object on the board - as long as they are the same
    // gesture, which is what the window says.
    if (Date.now() - textPlacedAtRef.current <= DOUBLE_CLICK_WINDOW_MS) {
      textPlacedAtRef.current = 0;
      return;
    }
    if (!isEmptyBoardSpace(event.target)) return;
    // A note created here would go into the document and nowhere else: the room
    // has said it cannot open this board. The gesture does nothing at all rather
    // than something that looks like it worked.
    if (!canEdit) return;
    const world = screenToWorld(camera, toBoardPoint(event));
    const id = createSticky(doc, world);
    if (typeof id === 'string') onStickyCreated(id);
  };

  /**
   * A click on empty space selects nothing; a click that was a pan does not; and a
   * click while the Text tool is active writes text at that point instead of
   * either (`text.tool_ui`). That last one is deliberately not limited to empty
   * space: the point is where the words go, whatever happens to be underneath.
   */
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (tool === 'text' && canEdit) {
      const pointer = textPointerRef.current;
      textPointerRef.current = null;
      // A drag is not an intention to write, whatever the browser calls the last
      // event of one. The Text tool never begins a pan, a marquee or an object's
      // gesture, so the only movement it can be asked about is this: a press held
      // down, carried somewhere, and let go. That writes nothing.
      if (pointer?.moved) return;
      // The world point, not the screen point: text placed while zoomed out or
      // panned away belongs where the person looked, and must stay there when they
      // zoom in.
      const world = screenToWorld(camera, toBoardPoint(event));
      const id = createText(doc, world, identityId ?? '');
      if (typeof id !== 'string') return;
      textPlacedAtRef.current = Date.now();
      onTextCreated?.(id);
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
      data-text-tool={tool === 'text' ? 'true' : 'false'}
      aria-label="Board"
      role="application"
      style={{
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
        // A text cursor where text is what a click does. The objects over the
        // board say the same thing in CSS (`.board-viewport[data-text-tool]`).
        ...(tool === 'text' ? { cursor: 'text' } : null),
      }}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
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
        {marquee?.rect ? <MarqueeRect rect={marquee.rect} camera={camera} /> : null}
        {children}
      </div>
    </div>
  );
}
