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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';
import type * as Y from 'yjs';
import { createSticky } from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  GRID_DOT_RADIUS_PX,
  GRID_SPACING_WORLD,
  ORIGIN_MARKER_SIZE_PX,
  WHEEL_DELTA_LINE_PX,
  WHEEL_DELTA_PAGE_PX
} from '../../shared/config';
import { screenToWorld, worldToScreen, type Point } from './camera';
import { installTestHooks, IS_TEST_MODE } from './testHooks';
import { useCameraContext, type CameraController } from './useCamera';

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * The board document, needed for the one thing the empty board does with the
   * pointer: create a sticky note where the user double-clicked (story 2).
   */
  doc?: Y.Doc;
  /** Called with the id of a note created by a double-click, so it can be edited. */
  onStickyCreated?(id: string): void;
  /** A press on empty board space that never turned into a pan. */
  onEmptyClick?(): void;
  /**
   * The Text tool is being held (`text.tool`). The pointer belongs to the tool then: it
   * shows as a text cursor, and a click places text instead of selecting — over an object
   * just as over bare board. While this is true the world layer is switched off to the
   * pointer by `styles.css`, so nothing under the click can answer for itself.
   */
  textTool?: boolean;
  /**
   * The click the Text tool was waiting for, at the board point its top-left goes to.
   * Called only while `textTool` is true; the tool is spent after it, and the caller puts
   * the pointer back to Select.
   */
  onTextPlace?(world: Point): void;
  /**
   * Shift held on a press on empty board space: draw a selection box instead of panning
   * (story 7, `sel.marquee`). The point is in viewport coordinates.
   */
  onMarqueeStart?(screen: Point): void;
  /** The pointer travelling with the box open. */
  onMarqueeMove?(screen: Point): void;
  /**
   * The box is over. `screen` is where the pointer was released, or null when the pointer
   * was taken away (cancel) — in which case whatever the box covered stays as it was.
   */
  onMarqueeEnd?(screen: Point | null): void;
  /**
   * False while the board cannot be written to (story 4): a double-click on empty
   * space does nothing at all, rather than making a note that cannot be saved.
   */
  canCreateSticky?: boolean;
  /**
   * Which tool the pointer is holding, reported on the viewport (`tools.active_tool`).
   *
   * The viewport does not act on it beyond `textTool` above — the tools that need a surface
   * of their own render it — but what the pointer means has to be readable from the screen
   * for the tests that assert a key press picked a tool up. Defaults to `select`.
   */
  activeTool?: string;
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
  // Where a press on empty space began, so a click can be told from a pan.
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // This press is drawing a selection box rather than panning (`sel.marquee`).
  const marqueeRef = useRef(false);
  // The last click placed text (`text.tool`), so the double-click that follows it is the
  // tail of a gesture already answered.
  const textPlacedRef = useRef(false);

  // Keep the latest controller reachable from listeners that are attached once.
  const controllerRef = useRef<CameraController>(controller);
  controllerRef.current = controller;

  const localPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  /**
   * Is this press on the board itself rather than on an object? Drag and pan start only
   * here, so the objects above can own their own pointer.
   *
   * Holding the Text tool is the deliberate exception, and the other way round: every
   * point on the board is then a place to put text, a point on top of an object included
   * (`text.tool`). In a browser the world layer does not receive pointer events while the
   * tool is held, so the press never reaches the object; this is the same rule stated
   * where the code can see it, and the half that holds in a test with no CSS cascade.
   */
  const isBoardSurface = useCallback(
    (target: EventTarget | null): boolean => {
      const viewport = viewportRef.current;
      if (!viewport || !(target instanceof HTMLElement)) return false;
      if (target === viewport || target.dataset.vidi6 === 'grid') return true;
      return props.textTool === true && viewport.contains(target);
    },
    [props.textTool]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (!isBoardSurface(event.target)) return;
      const viewport = viewportRef.current;
      if (viewport && typeof viewport.setPointerCapture === 'function') {
        viewport.setPointerCapture(event.pointerId);
      }
      const point = localPoint(event.clientX, event.clientY);
      if (event.shiftKey && props.onMarqueeStart) {
        // Shift is the box key: the camera does not move, the rectangle does.
        pressRef.current = null;
        marqueeRef.current = true;
        props.onMarqueeStart(point);
        return;
      }
      textPlacedRef.current = false;
      pressRef.current = { x: point.x, y: point.y, moved: false };
      beginPan(point);
      setPanning(true);
    },
    [beginPan, isBoardSurface, localPoint, props]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const point = localPoint(event.clientX, event.clientY);
      if (marqueeRef.current) {
        props.onMarqueeMove?.(point);
        return;
      }
      if (!panning) return;
      const press = pressRef.current;
      // Past the drag threshold this press is a pan, not a click.
      if (press && !press.moved && Math.hypot(point.x - press.x, point.y - press.y) >= DRAG_THRESHOLD_PX) {
        press.moved = true;
      }
      panMove(point);
    },
    [localPoint, panMove, panning, props]
  );

  const stopPan = useCallback(
    (event?: ReactPointerEvent<HTMLDivElement>) => {
      if (marqueeRef.current) {
        // The box is handed back where it was released; a cancelled pointer is null, and a
        // cancelled marquee selects nothing and changes nothing.
        marqueeRef.current = false;
        props.onMarqueeEnd?.(event && event.type === 'pointerup' ? localPoint(event.clientX, event.clientY) : null);
        return;
      }
      // A press on empty board space that never moved is a click: it clears the
      // selection. A pan, and a cancelled drag, leave it alone.
      const press = pressRef.current;
      const wasClick = !!press && !press.moved && (!event || event.type === 'pointerup');
      pressRef.current = null;
      endPan();
      setPanning(false);
      if (!wasClick || !event) return;
      if (props.textTool && props.doc && props.canCreateSticky !== false && props.onTextPlace) {
        // The click the Text tool was waiting for. The point that was pressed, not the one
        // that was released: that is the spot the user aimed at.
        textPlacedRef.current = true;
        props.onTextPlace(screenToWorld(getCamera(), { x: press!.x, y: press!.y }));
        return;
      }
      props.onEmptyClick?.();
    },
    [endPan, getCamera, localPoint, props]
  );

  /**
   * A double-click on empty board space creates a sticky note centred on that
   * spot. A double-click on a note is handled by the note (which edits it) and
   * never reaches here.
   */
  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!props.doc || props.canCreateSticky === false) return;
      if (textPlacedRef.current) {
        // The second click of this double-click already placed text, and the tool went
        // back to Select in between. Making a note here would answer one gesture twice.
        textPlacedRef.current = false;
        return;
      }
      if (!isBoardSurface(event.target)) return;
      const world = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      const id = createSticky(props.doc, world);
      // A note rejected for a reason the user cannot see is simply not created.
      if (id) props.onStickyCreated?.(id);
    },
    [camera, isBoardSurface, localPoint, props]
  );

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
      data-tool={props.activeTool ?? (props.textTool ? 'text' : 'select')}
      style={viewportStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopPan}
      onPointerCancel={stopPan}
      onLostPointerCapture={stopPan}
      onDoubleClick={handleDoubleClick}
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
