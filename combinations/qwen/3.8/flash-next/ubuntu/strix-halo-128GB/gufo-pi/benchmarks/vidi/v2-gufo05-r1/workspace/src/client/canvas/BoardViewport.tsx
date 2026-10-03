/**
 * The board's input surface: an infinite, pannable, zoomable area drawn with
 * CSS transforms.
 *
 * Rendering is two numbers wide: the dot grid is a repeating radial gradient
 * whose size and offset come from the camera, and the world layer is a single
 * `scale(zoom) translate(-x, -y)` transform, so anything rendered inside it (the
 * origin marker now, sticky notes in story 2) sits in world coordinates.
 *
 * Input the board owns: pointer drag (pan), wheel/trackpad scroll (pan),
 * Ctrl/Cmd + wheel and Safari `gesture*` (zoom at the pointer), and
 * Ctrl/Cmd + `=`, `-`, `0`. Every one of these calls `preventDefault`, so the
 * browser never zooms or scrolls the page instead of the board.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import {
  DRAG_THRESHOLD_PX,
  GRID_SPACING_WORLD,
  WHEEL_LINE_DELTA_PX,
  WHEEL_PAGE_DELTA_PX,
} from '../../shared/config';
import { takesTextKeys } from '../dom/textTarget';
import { useCameraContext } from './CameraContext';
import type { Camera } from './camera';
import { IS_TEST_MODE, installTestHooks, isValidCamera } from './testHooks';

/** How long a second press counts as the same double-click, in milliseconds. */
const DOUBLE_PRESS_GUARD_MS = 500;
/** How close two presses have to be to be the same place, in CSS pixels. */
const DOUBLE_PRESS_SLOP_PX = 8;

/**
 * Is this the second press of one double-click?
 *
 * Close in time *and* close on the board. Time alone would make two deliberate clicks at
 * different places into one gesture, which is a person writing two headings in a row and
 * getting one.
 */
function isSecondTextPress(
  placed: { x: number; y: number; at: number } | null,
  timeStamp: number,
  point: { x: number; y: number },
): boolean {
  return (
    placed !== null &&
    timeStamp - placed.at < DOUBLE_PRESS_GUARD_MS &&
    Math.abs(point.x - placed.x) <= DOUBLE_PRESS_SLOP_PX &&
    Math.abs(point.y - placed.y) <= DOUBLE_PRESS_SLOP_PX
  );
}

/** `WheelEvent.deltaMode` values. */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

/** Wheel events report lines/pages; the board works in CSS pixels. */
function wheelPixels(delta: number, deltaMode: number): number {
  if (deltaMode === DELTA_MODE_LINE) return delta * WHEEL_LINE_DELTA_PX;
  if (deltaMode === DELTA_MODE_PAGE) return delta * WHEEL_PAGE_DELTA_PX;
  return delta;
}

/** Always-positive remainder, for tiling the grid background. */
function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** Dot radius and how strong the dots look, kept subtle when zoomed far out. */
const GRID_DOT_RADIUS_PX = 1;
const GRID_DOT_MIN_ALPHA = 0.15;
const GRID_DOT_MAX_ALPHA = 0.5;

function gridDotAlpha(spacingPx: number): number {
  const ratio = Math.min(1, Math.max(0, spacingPx / GRID_SPACING_WORLD));
  return GRID_DOT_MIN_ALPHA + (GRID_DOT_MAX_ALPHA - GRID_DOT_MIN_ALPHA) * ratio;
}

/**
 * Dot grid attached to the board: tile size is `GRID_SPACING_WORLD * zoom` and
 * the offset is the camera position folded into one tile, so a dot always sits
 * exactly on every world multiple of the grid spacing - including the origin.
 */
export function gridBackgroundStyle(camera: Camera): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
} {
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const alpha = gridDotAlpha(spacing);
  // The gradient centres a dot in its tile, so shift by half a tile to line the
  // dot up with world coordinates that are multiples of the spacing.
  const offset = (screenPositionOfOrigin: number) =>
    mod(screenPositionOfOrigin - spacing / 2, spacing);
  return {
    backgroundImage: `radial-gradient(circle, rgb(var(--board-dot) / ${alpha}) 0 ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${offset(-camera.x * camera.zoom)}px ${offset(-camera.y * camera.zoom)}px`,
  };
}

/** World layer: `scale` then `translate` puts world point (x, y) at the origin. */
export function worldLayerStyle(camera: Camera): { transform: string; transformOrigin: string } {
  return {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
    transformOrigin: '0 0',
  };
}

interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly rotation?: number;
}

/** Pointer capture is best effort: engines refuse unknown pointer ids. */
function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Ignored: the drag still works from events on the viewport itself.
  }
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // Ignored.
  }
}

/**
 * The selection rectangle, as the viewport sees it: a drag on empty space that
 * selects instead of panning. `App` builds it from `useMarquee`.
 */
export interface BoardViewportMarquee {
  begin(point: { x: number; y: number }): void;
  move(point: { x: number; y: number }): void;
  end(): void;
  cancel(): void;
}

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * Double-click on empty board space (never on an object), with the point in
   * screen coordinates relative to the viewport.
   */
  onEmptyDoubleClick?(point: { x: number; y: number }): void;
  /**
   * A press on empty board space that ended without panning: the board was
   * clicked, not dragged.
   */
  onEmptyClick?(): void;
  /**
   * Shift + drag on empty space draws a selection rectangle instead of panning
   * (`sel.marquee`). Without it, Shift+drag pans, as it did before story 7.
   */
  marquee?: BoardViewportMarquee;
  /**
   * The Text tool is armed (`text.tool_ui`).
   *
   * While it is, the next press anywhere on the board — empty space or on top of an
   * object — places text there instead of panning, marquee-ing or dragging: the
   * person said where they wanted to write. `onTextPointClick` is what happens, and
   * the viewport only says where.
   */
  textMode?: boolean;
  /** A press with the Text tool armed, at a point relative to the viewport. */
  onTextPointClick?(point: { x: number; y: number }): void;
  /**
   * The Pen tool is armed (`pen.tool_ui`): the surface becomes a drawing surface, and the
   * pointer is a pen tip rather than a grab. It only changes the cursor; the routing itself is
   * the `screenOverlay`, whose own pointer events are not the viewport, so a press draws rather
   * than pans or drags an object.
   */
  penMode?: boolean;
  /**
   * A screen-space overlay rendered inside the viewport, above the world layer.
   *
   * A child of the viewport on purpose: a wheel gesture over it still bubbles to the viewport's
   * pan and zoom, so arming the Pen never freezes the view. Pointer events on it are screen-space
   * and are not the viewport itself, so they never start a pan.
   */
  screenOverlay?: ReactNode;
  /**
   * Files are being dragged over the board (`image.drop`).
   *
   * Three optional handlers rather than a listener the viewport installs itself, because
   * whether a drag is a file drag — and what to do with one — belongs to the board, not to the
   * surface: a page that passes nothing keeps the browser's own behaviour, which is to open the
   * picture instead of adding it.
   *
   * Typed as React's own drag event because that is what the element hands them. What the board
   * passes in reads a smaller shape — the same handful of fields, whichever kind of event object
   * it is holding (`DragGesture`).
   */
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void;
  /**
   * Files are hovering over the board right now.
   *
   * Rendered as an attribute as well as drawn by the caller's overlay, so an end-to-end test can
   * wait for the board to have noticed the drag without depending on what the highlight looks
   * like (`image.drop`).
   */
  dragOver?: boolean;
}

export function BoardViewport({
  children,
  onEmptyDoubleClick,
  onEmptyClick,
  marquee,
  textMode,
  onTextPointClick,
  penMode,
  screenOverlay,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOver,
}: BoardViewportProps) {
  const nav = useCameraContext();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  /** Latest nav, so native listeners are attached once and never go stale. */
  const navRef = useRef(nav);
  navRef.current = nav;
  /** Latest empty-click behaviour, for the same reason. */
  const emptyClickRef = useRef(onEmptyClick);
  emptyClickRef.current = onEmptyClick;
  /** Baseline of the current Safari pinch, so scale deltas compound correctly. */
  const gestureScaleRef = useRef(1);
  /** Latest marquee behaviour, for the same reason. */
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  /** Latest Text-tool state, for the same reason: one listener, never stale. */
  const textModeRef = useRef(textMode);
  textModeRef.current = textMode;
  const textPointRef = useRef(onTextPointClick);
  textPointRef.current = onTextPointClick;
  /**
   * When the last Text-tool press happened, in the same clock as `event.timeStamp`.
   *
   * A double-click is two presses and a `dblclick`, and the tool is only armed for the
   * first of them. Without this, a person who double-clicks while Text is armed gets a
   * second box of text on top of the first, and — because the second press can arrive
   * before the tool has been put away — an empty double-click could still fall through
   * to the board's own "double-click makes a note" behaviour.
   */
  const placedTextRef = useRef<{ x: number; y: number; at: number } | null>(null);
  /**
   * The press the Text tool has claimed, and where it started; `null` when this press is
   * not the Text tool's.
   *
   * The claim is made on pointerdown — that is the moment the object under the pointer
   * would otherwise start dragging — but the text is placed on the `click` that follows.
   * Not on pointerdown: a browser moves focus as the default action of a mousedown, which
   * happens after the React state update, so an editor opened on pointerdown is blurred
   * again before a person could type into it (`text.create`). The point of the press is
   * what is remembered, because that is where the person said "here".
   */
  const claimedPressRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * Where the current press on empty space started, whether it moved, and what it is
   * doing: panning the board, or drawing a selection rectangle. A press is one or the
   * other, decided at pointerdown by Shift, and never both — a drag that panned and
   * selected at once would be unusable.
   */
  const pressRef = useRef<
    { x: number; y: number; moved: boolean; mode: 'pan' | 'marquee' } | null
  >(null);

  const localPoint = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  // --- The Text tool: the next press writes, and does nothing else ------
  //
  // Capture phase, on the viewport itself: an object's own pointerdown is what would
  // start dragging it, and that is exactly what must not happen when the person has
  // said "write here" (`text.tool_ui`). Stopping propagation also keeps the pan and the
  // marquee out of it, so one press means one thing.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!textModeRef.current || event.button !== 0) return;
      const rect = element.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      // The second press of a double-click is not a placement: it is the same gesture, and
      // what it belongs to is the editor the first press opened.
      if (isSecondTextPress(placedTextRef.current, event.timeStamp, point)) {
        claimedPressRef.current = null;
        return;
      }
      claimedPressRef.current = point;
      event.stopPropagation();
    };

    // Placed on the click, not the press — see `claimedPressRef`.
    const onClick = (event: MouseEvent) => {
      const press = claimedPressRef.current;
      claimedPressRef.current = null;
      if (press === null || !textModeRef.current || event.button !== 0) return;
      if (isSecondTextPress(placedTextRef.current, event.timeStamp, press)) return;
      placedTextRef.current = { x: press.x, y: press.y, at: event.timeStamp };
      textPointRef.current?.(press);
    };

    element.addEventListener('pointerdown', onPointerDown, true);
    element.addEventListener('click', onClick, true);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown, true);
      element.removeEventListener('click', onClick, true);
    };
  }, []);

  // --- Drag to pan, or Shift+drag to select ------------------------------
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Only empty board space starts a pan; objects (story 2) stop propagation.
    if (event.target !== viewportRef.current) return;
    const point = localPoint(event.clientX, event.clientY);
    capturePointer(event.currentTarget, event.pointerId);
    if (event.shiftKey && marqueeRef.current) {
      // Shift turns a drag on empty space into a selection rectangle, and the board
      // stays exactly where it is: selecting a region must not move it.
      pressRef.current = { x: point.x, y: point.y, moved: false, mode: 'marquee' };
      marqueeRef.current.begin(point);
      return;
    }
    pressRef.current = { x: point.x, y: point.y, moved: false, mode: 'pan' };
    nav.beginPan(point);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (press?.mode === 'marquee') {
      // The rectangle follows the pointer with no threshold: from the moment the
      // person Shift-presses, the box is what they are drawing.
      marqueeRef.current?.move(localPoint(event.clientX, event.clientY));
      return;
    }
    if (!nav.isPanning) return;
    const point = localPoint(event.clientX, event.clientY);
    if (press && !press.moved) {
      const distance = Math.hypot(point.x - press.x, point.y - press.y);
      // Below the threshold the camera does not move, so a click on empty space
      // never nudges the board (the same threshold notes use for their drags).
      if (distance < DRAG_THRESHOLD_PX) return;
      press.moved = true;
    }
    nav.panMove(point);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const press = pressRef.current;
    if (press?.mode === 'marquee') {
      releasePointer(event.currentTarget, event.pointerId);
      pressRef.current = null;
      // Released: what is inside the box joins the selection. Interrupted: the box
      // goes away and the selection is left exactly as it was.
      if (cancelled) marqueeRef.current?.cancel();
      else marqueeRef.current?.end();
      return;
    }
    if (!nav.isPanning) return;
    releasePointer(event.currentTarget, event.pointerId);
    // The board stays where it was when the drag ended or was interrupted.
    nav.endPan();
    pressRef.current = null;
    // A press on empty space that never became a pan deselects everything — but an
    // interrupted one is not a click, and leaves the selection alone.
    if (press && !press.moved && !cancelled) emptyClickRef.current?.();
  };

  // --- Wheel, trackpad and Safari gesture --------------------------------
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      // The board owns this gesture: never let the page scroll or zoom.
      event.preventDefault();
      navRef.current.wheel({
        deltaX: wheelPixels(event.deltaX, event.deltaMode),
        deltaY: wheelPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: localPoint(event.clientX, event.clientY),
      });
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureScaleRef.current = (event as GestureEventLike).scale ?? 1;
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const scale = (event as GestureEventLike).scale ?? 1;
      const previous = gestureScaleRef.current || 1;
      gestureScaleRef.current = scale;
      const withCoordinates = event as unknown as { clientX?: number; clientY?: number };
      const point =
        typeof withCoordinates.clientX === 'number' && typeof withCoordinates.clientY === 'number'
          ? localPoint(withCoordinates.clientX, withCoordinates.clientY)
          : { x: element.clientWidth / 2, y: element.clientHeight / 2 };
      navRef.current.gestureZoom(point, scale / previous);
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureScaleRef.current = 1;
    };

    // React's onWheel is passive, so the board's listener is attached directly.
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onGestureStart as EventListener, { passive: false });
    element.addEventListener('gesturechange', onGestureChange as EventListener, { passive: false });
    element.addEventListener('gestureend', onGestureEnd as EventListener, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart as EventListener);
      element.removeEventListener('gesturechange', onGestureChange as EventListener);
      element.removeEventListener('gestureend', onGestureEnd as EventListener);
    };
  }, [localPoint]);

  // --- Keyboard shortcuts ------------------------------------------------
  useEffect(() => {
    // One answer to "is something taking text here", shared with the shortcuts and the paste.
    const isTextEntry = takesTextKeys;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (isTextEntry(event.target)) return;
      switch (event.key) {
        case '=':
        case '+':
          event.preventDefault(); // stop the browser's own zoom-in
          navRef.current.zoomStep('in');
          break;
        case '-':
        case '_':
          event.preventDefault();
          navRef.current.zoomStep('out');
          break;
        case '0':
          event.preventDefault();
          navRef.current.reset();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // --- Test hook (test builds only; removed from production bundles) ------
  useEffect(() => {
    if (!IS_TEST_MODE) return;
    installTestHooks({
      setCamera: (partial) => {
        if (isValidCamera(partial)) navRef.current.setCamera(partial);
      },
      getCamera: () => navRef.current.camera,
    });
  }, []);

  const { camera } = nav;

  return (
    <div
      ref={viewportRef}
      data-testid="board-viewport"
      data-mode={nav.isPanning ? 'panning' : 'idle'}
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
      data-grid-spacing={GRID_SPACING_WORLD * camera.zoom}
      className={`board-viewport${nav.isPanning ? ' board-viewport--panning' : ''}${
        textMode ? ' board-viewport--text' : ''
      }${penMode ? ' board-viewport--pen' : ''}`}
      style={gridBackgroundStyle(camera)}
      data-drag-over={dragOver ? 'true' : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => handlePointerEnd(event)}
      // An interrupted drag never selects: the rectangle is put away and the
      // selection it was about to change is left alone.
      onPointerCancel={(event) => handlePointerEnd(event, true)}
      onLostPointerCapture={(event) => handlePointerEnd(event, true)}
      onDoubleClick={(event) => {
        // Only empty board space: an object stops the event before it gets here.
        if (event.target !== viewportRef.current) return;
        // The second press of a Text-tool double-click: the text is already there, and
        // making a note as well would be two things from one gesture.
        const placed = placedTextRef.current;
        if (
          placed !== null &&
          isSecondTextPress(placed, event.timeStamp, localPoint(event.clientX, event.clientY))
        ) {
          return;
        }
        onEmptyDoubleClick?.(localPoint(event.clientX, event.clientY));
      }}
    >
      <div data-testid="world-layer" className="board-world" style={worldLayerStyle(camera)}>
        <div data-testid="origin-marker" className="board-origin" aria-hidden="true">
          <span
            className="board-origin__mark"
            style={{ transform: `scale(${1 / camera.zoom})` }}
          />
        </div>
        {children}
      </div>
      {screenOverlay}
    </div>
  );
}
