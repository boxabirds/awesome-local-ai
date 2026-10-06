import { useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { screenToWorld } from './camera';
import type { Point } from './camera';
import type { CameraController } from './useCamera';
import type { Marquee } from '../board/Marquee';
import type { ToolId } from '../tools/useActiveTool';

/** Wheel `deltaMode === LINE`: pixels per line. */
const WHEEL_DELTA_LINE_PX = 16;
/** Wheel `deltaMode === PAGE`: fraction of the board height per page. */
const WHEEL_DELTA_PAGE_FRACTION = 0.9;
/** Safari's non-standard pinch events. */
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/**
 * How long a second click at the same place is still the same person's double-click.
 *
 * The number every browser uses for the same question, and it is here for a reason: the Text tool
 * places text on the *first* click and hands the pointer back to Select, so a person who double-clicks
 * — which is what every other story on this board has taught people to do when they want to write
 * something — would otherwise get a sticky note out of the second click, on top of the text they just
 * placed. The second click of that pair is swallowed for this long, and for no longer: a click half a
 * second later at a different place is a click somebody meant.
 */
const DOUBLE_CLICK_WINDOW_MS = 500;

interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly prevScale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

/** Dot grid: one dot on every world grid intersection. */
const GRID_IMAGE = 'radial-gradient(circle at 0 0, var(--grid-dot) 1px, transparent 1.5px)';

const mod = (value: number, period: number): number => ((value % period) + period) % period;

/** CSS pixels without exponential notation, rounded to sub-pixel precision. */
const px = (value: number): string => `${Number(value.toFixed(6))}px`;

const positive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

export interface BoardViewportProps {
  children?: ReactNode;
  /** Camera state and handlers, from `useCamera` in App. */
  controller: CameraController;
  /**
   * A double-click on empty board space, with the point converted to world
   * coordinates. Objects stop propagation, so a double-click on one never
   * reaches this handler.
   */
  /**
   * Shift + drag on empty board space, which selects instead of panning. Given by the board, which
   * owns the selection the rectangle adds to; left out, Shift + drag pans like any other drag.
   */
  marquee?: Marquee;
  /**
   * A double-click on empty board space, with the point converted to world
   * coordinates. Objects stop propagation, so a double-click on one never
   * reaches this handler.
   */
  onCreateSticky?(world: Point): void;
  /**
   * A press on empty board space. The selection is dropped by the press and not by the release: the
   * press is what a person means, and a release is something they can still take back by dragging the
   * board somewhere else — which is why panning the board with something selected loses it, and why a
   * story 2 press on the background closes a note's editor and takes its selection with it.
   */
  onClearSelection?(): void;
  /**
   * The tool the pointer is in.
   *
   * `'text'` takes the pointer away from everything the board normally does with it: no pan, no marquee,
   * no pressing the object underneath — a click means "write here" and nothing else. `'shape'` and
   * `'connector'` take the pointer the same way, but by their own hands: those two tools hold the pointer
   * themselves, on the document, and this prop is how the board knows not to answer what they already
   * answered. Left out, the board has one tool and behaves as it did before story 9.
   */
  tool?: ToolId;
  /**
   * A click with the Text tool, with the point converted to world coordinates.
   *
   * Given together with `tool`, because a tool that is drawn but leads nowhere is worse than no tool: a
   * person would press T, click, and get nothing at all.
   */
  onCreateText?(world: Point): void;
}

/**
 * The board's input surface: dot grid, world layer and the pointer / wheel /
 * gesture / keyboard handlers that navigate the camera.
 *
 * Wheel and gesture listeners are attached with `{ passive: false }` and always
 * `preventDefault()`, which is what stops the browser from zooming or scrolling
 * the page while the board is being navigated. Keydown shortcuts are attached to
 * `window`. Drag only starts on the board surface itself (the viewport or the
 * grid), so objects added by later stories can stop propagation.
 */
export function BoardViewport({
  children,
  controller,
  marquee,
  onCreateSticky,
  onClearSelection,
  tool,
  onCreateText,
}: BoardViewportProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef(controller);
  const gestureScaleRef = useRef(1);
  /**
   * The pointer that is down on the board surface, and what it is being used for: a pan, or the
   * rectangle that selects. In a ref rather than read back from the marquee's own state, because the
   * very next pointermove has to be routed by what the press said and not by whoever re-rendered last.
   */
  const dragRef = useRef<{ pointerId: number; kind: 'pan' | 'marquee' } | null>(null);
  controllerRef.current = controller;
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const createTextRef = useRef(onCreateText);
  createTextRef.current = onCreateText;
  /** Where and when the Text tool last placed something, in client pixels. */
  const placedRef = useRef<{ x: number; y: number; at: number } | null>(null);

  const { camera, isPanning } = controller;

  /** Screen point relative to the top-left of the board area. */
  const localPoint = (clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    const rect = el?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  // wheel (non-passive), Safari gesture events and the keyboard shortcuts.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const toPixels = (delta: number, deltaMode: number): number => {
      if (!Number.isFinite(delta) || delta === 0) return 0;
      if (deltaMode === 1) return delta * WHEEL_DELTA_LINE_PX;
      if (deltaMode === 2) return delta * el.clientHeight * WHEEL_DELTA_PAGE_FRACTION;
      return delta;
    };

    const onWheel = (event: WheelEvent) => {
      // Always preventDefault over the board: the board owns the gesture, so the
      // page never scrolls and never zooms.
      event.preventDefault();
      const c = controllerRef.current;
      c.wheel({
        deltaX: toPixels(event.deltaX, event.deltaMode),
        deltaY: toPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: localPoint(event.clientX, event.clientY),
      });
    };

    const onGesture = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEventLike;
      const scale = positive(gesture.scale ?? 1, 1);
      if (event.type === 'gesturestart' || event.type === 'gestureend') {
        gestureScaleRef.current = scale;
        return;
      }
      const previous = positive(gesture.prevScale ?? gestureScaleRef.current, 1);
      const ratio = scale / previous;
      gestureScaleRef.current = scale;
      const clientX = gesture.clientX ?? el.clientWidth / 2;
      const clientY = gesture.clientY ?? el.clientHeight / 2;
      if (ratio !== 1) controllerRef.current.zoomBy(ratio, localPoint(clientX, clientY));
    };

    const isEditable = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditable(event.target)) return;
      const c = controllerRef.current;
      if (event.key === '0' && (event.ctrlKey || event.metaKey)) {
        // Ctrl/Cmd + 0: reset view (prevented so the browser zoom stays put).
        event.preventDefault();
        c.reset();
        return;
      }
      if (event.altKey || event.shiftKey) return;
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === '=' || event.key === '+' || event.key === 'Add') {
        event.preventDefault();
        c.zoomStep('in');
      } else if (event.key === '-' || event.key === '_' || event.key === 'Subtract') {
        event.preventDefault();
        c.zoomStep('out');
      }
    };

    const endDrag = () => controllerRef.current.endPan();

    el.addEventListener('wheel', onWheel, { passive: false });
    // A drag interrupted by the system ends here too (pointerup/pointercancel
    // are handled as React props on the board surface).
    el.addEventListener('lostpointercapture', endDrag);
    for (const name of GESTURE_EVENTS) {
      el.addEventListener(name, onGesture, { passive: false });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('lostpointercapture', endDrag);
      for (const name of GESTURE_EVENTS) {
        el.removeEventListener(name, onGesture);
      }
      window.removeEventListener('keydown', onKeyDown);
    };
    // Handlers read the controller through a ref, so they are attached once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBoardSurface = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement && target.dataset['boardSurface'] !== undefined;

  /**
   * The Text tool's hold on the pointer, taken first in the capture phase on the document.
   *
   * Capture, and on the document rather than on the board element, for one reason: the click that places
   * text has to be taken off everything underneath it — the pan, the marquee, and the object the pointer
   * happened to land on, which is the case the design asks for and the one a bubble-phase handler cannot
   * reach. React binds the board's own handlers at the root of what it renders, which sits above the
   * board element and so would hear the event before a listener on the board itself: a listener on the
   * board could stop the board's click and double-click handlers but not its pointer-down-capture one,
   * which is the one that starts a pan. Stopped here, the event reaches none of them, and the object
   * underneath is neither selected nor dragged: text goes on top of it, which is what a person writing a
   * heading over a pile of notes means.
   *
   * Controls keep their own clicks. A board covered in buttons that swallowed them all would be a board
   * whose tools had stopped working, and the toolbar, the note's palette and an open text field are all
   * things a person clicks while the Text tool is lit.
   *
   * Attached once, for as long as the board is on screen: whether a pointer belongs to the tool is asked
   * at the pointer, from refs, because the tool changes in the middle of the click that places the text —
   * the first click puts text down and hands the pointer back to Select, and the second click of the same
   * double-click still belongs to the tool that made the first.
   */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let press: { pointerId: number; x: number; y: number; moved: boolean; second: boolean } | null =
      null;

    const writing = (): boolean => toolRef.current === 'text' && createTextRef.current !== undefined;

    /** The second click of a double-click: same place, still inside the window browsers allow. */
    const again = (x: number, y: number): boolean => {
      const placed = placedRef.current;
      return (
        placed !== null &&
        Date.now() - placed.at <= DOUBLE_CLICK_WINDOW_MS &&
        Math.abs(x - placed.x) <= DRAG_THRESHOLD_PX &&
        Math.abs(y - placed.y) <= DRAG_THRESHOLD_PX
      );
    };

    const owns = (x: number, y: number): boolean => writing() || again(x, y);

    const isControl = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      target.closest('button, textarea, input, select, [role="toolbar"]') !== null;

    /** The event is on this board: the document is where this listens, not what it listens for. */
    const onBoard = (target: EventTarget | null): boolean =>
      target instanceof Node && el.contains(target);

    const mine = (target: EventTarget | null): boolean => onBoard(target) && !isControl(target);

    /**
     * Takes the event, and says how thoroughly.
     *
     * While the tool is lit, the event is stopped on its way down and everybody further in — the board,
     * the objects on it — is denied it, but the other handlers standing on the document itself keep
     * theirs. One of those handlers is the open text editor's, which commits what was typed on a press
     * outside the object: a person who writes a heading over the note they were still typing into needs
     * that commit to happen, and it is the reason this hold is not simply taken with a heavier hand.
     *
     * The one event that belongs to nobody is the second click of a double-click. It is not a press
     * outside the object the first click just placed, however the geometry looks: it is the same click,
     * made twice, and it must not reach the editor's handler either — which would commit an empty text
     * object, take the rule that an empty text object does not stay, and delete the text half a second
     * after the person placed it. So the tail of a double-click is stopped where it stands, in front of
     * every other handler on the document, and the editor stays open with the caret in it.
     */
    const claim = (event: Event, guard: boolean): void => {
      if (guard) event.stopImmediatePropagation();
      else event.stopPropagation();
    };

    const local = (clientX: number, clientY: number): Point => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!mine(event.target) || !owns(event.clientX, event.clientY)) return;
      // Only the left button: the right one opens the browser's menu, and the middle one is a scroll.
      if (event.button !== 0) return;
      const guard = !writing();
      claim(event, guard);
      press = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        // A press that only this hold accounts for — the second click of the pair — writes nothing.
        second: guard,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!mine(event.target)) return;
      if (!press && !owns(event.clientX, event.clientY)) return;
      claim(event, !writing());
      if (!press || press.pointerId !== event.pointerId) return;
      if (
        Math.abs(event.clientX - press.x) > DRAG_THRESHOLD_PX ||
        Math.abs(event.clientY - press.y) > DRAG_THRESHOLD_PX
      ) {
        press.moved = true;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!mine(event.target) || !owns(event.clientX, event.clientY)) return;
      const pressed = press;
      const guard = !writing();
      press = null;
      claim(event, guard);
      // A pointer the system took back is not a click somebody made, and writes nothing.
      if (event.type !== 'pointerup') return;
      // A drag is not a click: with the Text tool lit the pointer either writes or does nothing, and a
      // person who wanted to pan the board will press T first. Same for a second click, which is the
      // tail of a double-click and not a request for a second piece of text.
      if (!pressed || pressed.second || pressed.moved || pressed.pointerId !== event.pointerId) return;
      const camera = controllerRef.current.camera;
      placedRef.current = { x: event.clientX, y: event.clientY, at: Date.now() };
      createTextRef.current?.(screenToWorld(camera, local(event.clientX, event.clientY)));
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (!mine(event.target) || !owns(event.clientX, event.clientY)) return;
      claim(event, !writing());
    };

    /**
     * The click that follows the release, which is not the same event and so is not stopped by stopping
     * the release.
     *
     * It has to be stopped too, because the board reads a click on empty space as "select nothing" — and
     * the click that has just placed a piece of text is a click on empty space as far as that handler is
     * concerned. Without this the text is created, selected and opened for typing, and then deselected and
     * closed in the same click, which is a tool that appears to work for one frame.
     */
    const onClick = (event: MouseEvent) => {
      if (!mine(event.target) || !owns(event.clientX, event.clientY)) return;
      claim(event, !writing());
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDoubleClick, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dblclick', onDoubleClick, true);
    };
    // Everything this reads arrives through a ref, so it is attached once for the life of the board.
    // The board element is read here rather than captured at mount: React remounts the board's own
    // element when the document it draws changes, and the tool holds on to whatever is on screen.
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
    if (!isBoardSurface(event.target)) return;
    // The pen holds its own pointer, on the document and before this handler is reached, so a stroke drawn
    // over the board never becomes a pan and a stroke drawn over a note never becomes a move of that note.
    // This line is not what makes that true; it is here so that the board is on record as knowing it. The
    // one case it does decide is a press that reaches this handler by a route the tool's own listener did
    // not take — a pointer the tool was not listening for — and the answer to that is still "the pen has
    // this pointer", rather than a board that starts to move under a drawing.
    if (tool === 'pen') return;
    const point = localPoint(event.clientX, event.clientY);
    const el = viewportRef.current;
    try {
      el?.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom and some embedded browsers do not implement pointer capture.
    }
    // Shift is the one gesture on the board that *adds* to a selection instead of replacing it, and
    // panning must not claim it. Nothing else about the drag changes: same pointer, same capture, same
    // pointerup. The only difference is which of the two things the pointer's movement is measured
    // against, which is why a shift-drag over the objects and a shift-drag over empty space are the
    // same gesture and why one of them pans and the other selects.
    if (event.shiftKey && marqueeRef.current) {
      dragRef.current = { pointerId: event.pointerId, kind: 'marquee' };
      marqueeRef.current.begin(point);
      return;
    }
    // Nothing under the pointer is nothing selected, and this is where the board says so.
    onClearSelection?.();
    dragRef.current = { pointerId: event.pointerId, kind: 'pan' };
    controllerRef.current.beginPan(point);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = localPoint(event.clientX, event.clientY);
    // The rectangle is measured in world units by the marquee itself, so that a pinch in the middle of
    // drawing one moves with the board instead of being left behind by it.
    if (drag.kind === 'marquee') marqueeRef.current?.move(point);
    // The hook ignores moves while it is Idle, so a move that never began as a drag pans nothing.
    else controllerRef.current.panMove(point);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    try {
      if (el?.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
    } catch {
      // ignore: capture may already be gone
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && drag.pointerId !== event.pointerId) return;
    if (drag?.kind === 'marquee') {
      // Only a pointer that came up is a rectangle somebody meant to finish. One the system took away
      // is a rectangle that was abandoned, and the selection stays exactly as it was.
      if (event.type === 'pointerup') marqueeRef.current?.end();
      else marqueeRef.current?.cancel();
      return;
    }
    controllerRef.current.endPan();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Only empty board space: a note stops propagation and edits itself.
    if (!isBoardSurface(event.target)) return;
    // A drawing tool answers its own double-click. Stopping the press does not stop the browser from
    // putting a `dblclick` on the wire afterwards, so without this a person who double-clicks to draw a
    // rectangle gets a sticky note under it — the second click of the pair is not a request for a note,
    // any more than it is one for the Text tool, whose double-click is held further up this file. The pen
    // is in the list for the plainest reason of the three: a dot is a stroke somebody made on purpose, and
    // a dot that also spawned a note would mean a dot could not be made at all.
    if (tool === 'shape' || tool === 'connector' || tool === 'pen') return;
    const camera = controllerRef.current.camera;
    onCreateSticky?.(screenToWorld(camera, localPoint(event.clientX, event.clientY)));
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const offsetX = mod(-camera.x * camera.zoom, spacing);
  const offsetY = mod(-camera.y * camera.zoom, spacing);
  const worldTransform = `scale(${camera.zoom}) translate(${px(-camera.x)}, ${px(-camera.y)})`;

  return (
    <div
      aria-label="Board"
      className="board-viewport"
      data-board-surface="viewport"
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
      data-panning={isPanning ? 'true' : 'false'}
      data-tool={tool ?? 'select'}
      data-testid="board-viewport"
      ref={viewportRef}
      role="application"
      style={{
        backgroundImage: GRID_IMAGE,
        backgroundSize: `${px(spacing)} ${px(spacing)}`,
        backgroundPosition: `${px(offsetX)} ${px(offsetY)}`,
      }}
      onLostPointerCapture={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onDoubleClick={onDoubleClick}
    >
      <div aria-hidden="true" className="board-grid" data-board-surface="grid" data-testid="board-grid" />
      <div
        className="board-world"
        data-testid="world-layer"
        data-transform={worldTransform}
        style={{ transform: worldTransform, '--inv-zoom': String(1 / camera.zoom) } as React.CSSProperties}
      >
        <div aria-hidden="true" className="origin-marker" data-testid="origin-marker" />
        {children}
      </div>
    </div>
  );
}
