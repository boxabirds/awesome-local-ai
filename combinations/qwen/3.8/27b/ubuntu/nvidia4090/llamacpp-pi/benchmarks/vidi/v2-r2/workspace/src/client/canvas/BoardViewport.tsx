import {
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  DRAG_THRESHOLD_PX,
  GRID_SPACING_WORLD,
  WHEEL_LINE_DELTA_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import { CameraContext } from './useCamera';
import type { Point } from './camera';
import type { ToolId } from '../tools/useActiveTool';
import type { GesturePointerEvent } from '../objects/registry';

// Wheel event deltaMode values (DOM spec).
const WHEEL_DELTA_PIXELS = 0;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

// Dot grid appearance (screen-space: dots keep a constant size while the
// spacing scales with zoom so the grid appears attached to the board).
const GRID_DOT_COLOR = '#c4c4ba';
const GRID_DOT_RADIUS_PX = 1;

/**
 * The input surface of the board: dot grid background, world layer (scaled
 * and translated with the camera transform) and all board input handling —
 * pointer drag, wheel (pan and zoom), Safari pinch gestures and the
 * Ctrl/Cmd + =/−/0 keyboard shortcuts.
 *
 * Children render in world coordinates inside the world layer.
 */
interface BoardViewportProps {
  children?: ReactNode;
  /** Double-click on empty board space: create an object at this point. */
  onDoubleClickEmpty?: (p: Point) => void;
  /** Single click (no drag) on empty board space: clear the selection. */
  onEmptyClick?: () => void;
  /**
   * Screen-space overlay (selection outline, resize handles, marquee rect,
   * selection bar): rendered above the world layer, outside its transform.
   */
  overlay?: ReactNode;
  /** Shift+pointerdown on empty space: begin a marquee at this point. */
  onMarqueeBegin?: (p: Point) => void;
  /** Pointer movement during a marquee (viewport-local point). */
  onMarqueeMove?: (p: Point) => void;
  /** Clean marquee end (pointerup on empty space). */
  onMarqueeEnd?: () => void;
  /** Marquee cancelled (pointercancel / lost capture). */
  onMarqueeCancel?: () => void;
  /**
   * Story 9 (text.tool_ui): the active tool. While 'text', a primary-button
   * press on empty space does NOT pan or marquee; a click (pointerup within
   * the tolerance, no travel) fires `onTextToolClick` with the viewport-
   * local point so the board can create a text object there. Objects are
   * inert under the Text tool, so a press over an object also lands here
   * and creates text on top. Story 10: the full ToolId union (the Shape
   * and Connector tools own the board through their own tool layers, so
   * this component only distinguishes 'text' and 'select').
   */
  tool?: ToolId;
  /** Text-tool click: create a text object at this viewport-local point. */
  onTextToolClick?: (p: Point) => void;
  /**
   * Story 10 (connector.select): with the Select tool, a primary-button
   * press on empty space first lets the board hit-test connector lines;
   * returning true means a connector was selected (the press is consumed
   * and no pan/marquee starts). Shift-presses (marquee) skip it.
   */
  onEmptyPointerDown?: (e: GesturePointerEvent, p: Point) => boolean;
}

export function BoardViewport(props: BoardViewportProps): JSX.Element {
  const { onDoubleClickEmpty, onEmptyClick, overlay, onMarqueeBegin, onMarqueeMove, onMarqueeEnd, onMarqueeCancel, tool = 'select', onTextToolClick, onEmptyPointerDown } = props;
  const controller = useContext(CameraContext);
  if (controller === null) {
    throw new Error('BoardViewport must be rendered inside a CameraContext provider');
  }
  const { camera, beginPan, panMove, endPan, wheel, zoomStep, reset } = controller;

  const viewportRef = useRef<HTMLDivElement>(null);
  const panStartLocalRef = useRef<Point | null>(null);
  /** The pointer id driving the marquee (null when no marquee is active). */
  const marqueePointerRef = useRef<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // Story 9: while the Text tool is armed, the primary-button down point on
  // empty space (null when no Text-tool click is in flight). A pointerup
  // within the tolerance creates a text object; movement cancels it.
  const textClickRef = useRef<Point | null>(null);
  const textToolActive = tool === 'text';

  const toLocalPoint = (clientX: number, clientY: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // Non-passive wheel listener: React's onWheel is passive, so a native
  // listener is required to preventDefault (stop page scroll and page zoom).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const toPixels = (delta: number): number => {
        if (e.deltaMode === WHEEL_DELTA_LINE) {
          return delta * WHEEL_LINE_DELTA_PX;
        }
        if (e.deltaMode === WHEEL_DELTA_PAGE) {
          return delta * el.clientHeight;
        }
        return delta; // WHEEL_DELTA_PIXELS
      };
      wheel({
        deltaX: toPixels(e.deltaX),
        deltaY: toPixels(e.deltaY),
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toLocalPoint(e.clientX, e.clientY),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // `wheel` is stable (useCallback in useCamera).
  }, [wheel]);

  // Safari pinch: gesturestart/gesturechange with preventDefault so the page
  // never zooms; zoom by the scale ratio around the pointer.
  useEffect(() => {
    // Minimal shape of Safari's GestureEvent (not in the standard DOM lib).
    const gestureOf = (e: Event): { scale: number; clientX: number; clientY: number } =>
      e as unknown as { scale: number; clientX: number; clientY: number };
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    let lastScale = 1;
    const onGestureStart = (e: Event): void => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event): void => {
      e.preventDefault();
      const gesture = gestureOf(e);
      const scale = Number(gesture.scale);
      if (!Number.isFinite(scale) || scale <= 0) {
        return;
      }
      const ratio = scale / lastScale;
      lastScale = scale;
      if (ratio === 1) {
        return;
      }
      // Express the scale ratio as the equivalent ctrl-wheel delta so the
      // same zoom path (zoomAt around the pointer) is used.
      const deltaY = -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY;
      wheel({
        deltaX: 0,
        deltaY,
        ctrlOrMeta: true,
        point: toLocalPoint(gesture.clientX, gesture.clientY),
      });
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
    // `wheel` is stable (useCallback in useCamera).
  }, [wheel]);

  // Ctrl/Cmd + = / - / 0: zoom step in/out and reset view, without letting
  // the browser change its page zoom.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) {
        return;
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  // --- Pointer drag: Idle -> Panning -> Idle --------------------------------
  const onPointerDown = (e: ReactPointerEvent): void => {
    // Start a pan only on empty board space (the viewport/grid itself) so
    // later object stories can stopPropagation from their own elements.
    if (e.target !== viewportRef.current) {
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    // Story 10 (connector.select): a Select-tool press on empty space may
    // land on a connector line (inside its tolerance): the board selects
    // it and the press is consumed (no pan, no marquee).
    if (tool === 'select' && !e.shiftKey && onEmptyPointerDown !== undefined) {
      if (onEmptyPointerDown(e, toLocalPoint(e.clientX, e.clientY))) {
        return;
      }
    }
    // Story 9 (text.tool_ui): the Text tool arms a click-to-create on empty
    // space; it does not pan or marquee.
    if (textToolActive) {
      const el = viewportRef.current;
      if (el && typeof el.setPointerCapture === 'function') {
        el.setPointerCapture(e.pointerId);
      }
      textClickRef.current = toLocalPoint(e.clientX, e.clientY);
      return;
    }
    // Keep pointer events flowing to the viewport even if the pointer
    // leaves the window mid-drag. (All supported browsers implement this;
    // the guard keeps jsdom component tests working.)
    const el = viewportRef.current;
    if (el && typeof el.setPointerCapture === 'function') {
      el.setPointerCapture(e.pointerId);
    }
    // Shift+drag on empty space marquee-selects (story 7); a plain drag
    // pans (story 1, unchanged).
    if (e.shiftKey) {
      marqueePointerRef.current = e.pointerId;
      onMarqueeBegin?.(toLocalPoint(e.clientX, e.clientY));
      return;
    }
    beginPan(toLocalPoint(e.clientX, e.clientY));
    panStartLocalRef.current = toLocalPoint(e.clientX, e.clientY);
    setIsPanning(true);
  };

  const onPointerMove = (e: ReactPointerEvent): void => {
    if (marqueePointerRef.current !== null && e.pointerId === marqueePointerRef.current) {
      onMarqueeMove?.(toLocalPoint(e.clientX, e.clientY));
      return;
    }
    panMove(toLocalPoint(e.clientX, e.clientY)); // no-op unless a drag is active
  };

  const endDrag = (): void => {
    endPan();
    setIsPanning(false);
  };

  const onPointerUp = (e: ReactPointerEvent): void => {
    if (marqueePointerRef.current !== null) {
      if (e.pointerId === marqueePointerRef.current) {
        marqueePointerRef.current = null;
        onMarqueeEnd?.();
      }
      return;
    }
    // Story 9: finish an armed Text-tool click. Within the tolerance ->
    // create a text object; travel beyond it -> ignore (no pan happened).
    if (textClickRef.current !== null) {
      const down = textClickRef.current;
      textClickRef.current = null;
      if (e.target === viewportRef.current) {
        const up = toLocalPoint(e.clientX, e.clientY);
        if (Math.hypot(up.x - down.x, up.y - down.y) < DRAG_THRESHOLD_PX) {
          onTextToolClick?.(up);
        }
      }
      return;
    }
    endDrag();
    // A click on empty space (pointer did not travel) clears the selection.
    const down = panStartLocalRef.current;
    panStartLocalRef.current = null;
    if (down !== null && e.target === viewportRef.current) {
      const up = toLocalPoint(e.clientX, e.clientY);
      if (Math.hypot(up.x - down.x, up.y - down.y) < DRAG_THRESHOLD_PX) {
        onEmptyClick?.();
      }
    }
  };

  const onPointerCancel = (e: ReactPointerEvent): void => {
    if (marqueePointerRef.current !== null) {
      if (e.pointerId === marqueePointerRef.current) {
        marqueePointerRef.current = null;
        onMarqueeCancel?.();
      }
      return;
    }
    endDrag();
  };

  const onLostPointerCapture = (e: ReactPointerEvent): void => {
    if (marqueePointerRef.current !== null) {
      if (e.pointerId === marqueePointerRef.current) {
        marqueePointerRef.current = null;
        onMarqueeCancel?.();
      }
      return;
    }
    endDrag();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Only a double-click on empty board space creates an object; double-clicks
    // on a note (or the toolbars) are handled by their own elements.
    if (e.target !== viewportRef.current) {
      return;
    }
    onDoubleClickEmpty?.(toLocalPoint(e.clientX, e.clientY));
  };

  // --- Rendering -------------------------------------------------------------
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at the tile centre; offset the tile so a dot lands on every
  // world multiple of GRID_SPACING_WORLD (i.e. the grid is attached to the board).
  const dotOffset = (screenAnchor: number): number => {
    const mod = ((screenAnchor % spacing) + spacing) % spacing;
    return mod - spacing / 2;
  };
  const backgroundPosition = `${dotOffset(-camera.x * camera.zoom)}px ${dotOffset(
    -camera.y * camera.zoom,
  )}px`;

  return (
    <div
      ref={viewportRef}
      data-testid="board-viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        // Story 9: the Text tool shows a text caret over empty space.
        cursor: textToolActive ? 'text' : isPanning ? 'grabbing' : 'grab',
        touchAction: 'none',
        backgroundImage: `radial-gradient(circle, ${GRID_DOT_COLOR} ${GRID_DOT_RADIUS_PX}px, transparent ${
          GRID_DOT_RADIUS_PX + 0.75
        }px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition,
      }}
    >
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      >
        {props.children}
      </div>
      {overlay}
    </div>
  );
}
