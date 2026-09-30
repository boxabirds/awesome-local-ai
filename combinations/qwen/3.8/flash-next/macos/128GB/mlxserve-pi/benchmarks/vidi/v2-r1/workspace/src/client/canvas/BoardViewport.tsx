import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { worldToScreen, type Point, type Size } from './camera';
import { useCamera, type UseCameraResult } from './useCamera';

/** Pixels per wheel `deltaMode === LINE` unit (Firefox reports lines). */
const WHEEL_LINE_PIXELS = 16;
/** Pixels per wheel `deltaMode === PAGE` unit. */
const WHEEL_PAGE_PIXELS = 800;
/** Dot-grid dot radius in screen pixels (radial-gradient stop). */
const DOT_RADIUS_PX = 1.5;
const DOT_COLOR = '#c8ced6';
/** Size of the origin crosshair in screen pixels (it does not scale with zoom). */
const ORIGIN_MARKER_PX = 24;
const ORIGIN_MARKER_COLOR = '#e05d38';

/** Safari (WebKit) GestureEvent, which is not in the DOM TypeScript lib. */
interface SafariGestureEventLike extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

/** Wheel deltas arrive in pixels, lines or pages; convert to pixels. */
export function wheelPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PIXELS;
  if (deltaMode === 2) return delta * WHEEL_PAGE_PIXELS;
  return delta;
}

const mod = (value: number, period: number): number =>
  ((value % period) + period) % period;

const measureWindow = (): Size => ({
  width: typeof window === 'undefined' ? 1280 : window.innerWidth,
  height: typeof window === 'undefined' ? 800 : window.innerHeight,
});

/**
 * Camera context provided by <BoardViewport>. UI chrome rendered inside
 * <BoardViewport chrome={...}> reads the camera and its handlers from here
 * (design: ZoomControls is wired to useCamera in App.tsx, while the camera
 * itself is owned by the viewport that measures itself).
 */
export const BoardCameraContext = createContext<UseCameraResult | null>(null);

export function useBoardCamera(): UseCameraResult {
  const value = useContext(BoardCameraContext);
  if (!value) throw new Error('useBoardCamera must be used inside <BoardViewport>');
  return value;
}

interface BoardViewportProps {
  /** Board content, rendered in world coordinates (sticky notes arrive in story 2). */
  children?: ReactNode;
  /** Screen-space UI chrome (zoom controls, hint) rendered above the board. */
  chrome?: ReactNode;
  /** A press+release on empty board space that did not pan (clears selection). */
  onEmptyClick?(point: Point): void;
  /** A double-click on empty board space (creates a note at that point). */
  onEmptyDoubleClick?(point: Point): void;
  /**
   * Marquee selection (story 7). Shift held on a press on empty space draws a
   * selection box instead of panning; without Shift, nothing here changes.
   */
  marquee?: MarqueeHandlers;
}

/** The four moments of a marquee drag, driven by the viewport's own pointer events. */
export interface MarqueeHandlers {
  begin(point: Point): void;
  move(point: Point): void;
  /** Release: whatever the box caught is selected. */
  end(point: Point): void;
  /** Interrupted: the box goes away and the selection stays as it was. */
  cancel(): void;
}

/**
 * The board's input surface: an effectively unbounded board drawn as a dot grid
 * with a world layer positioned by CSS transforms. It owns pan (pointer drag,
 * plain scroll), zoom at the pointer (pinch, Ctrl/Cmd + wheel, Safari gesture)
 * and the keyboard shortcuts, and never lets the browser zoom the page.
 */
export function BoardViewport({
  children,
  chrome,
  onEmptyClick,
  onEmptyDoubleClick,
  marquee,
}: BoardViewportProps): ReactNode {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>(measureWindow);
  const gestureBaseScaleRef = useRef<number | null>(null);
  // Tracks a press that started on empty space so we can tell a click (clear
  // selection) from a pan.
  const emptyDownRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // A press that began the selection box rather than a pan.
  const marqueeDownRef = useRef<boolean>(false);

  const {
    camera,
    hasNavigated,
    mode,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPointer,
    zoomStep,
    reset,
  } = useCamera(size);

  // Viewport size from a ResizeObserver. Resizing changes only the viewport
  // size: the camera (world point at the top-left) is top-left anchored, so
  // content does not move relative to the top-left corner (TC-07).
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const read = (): void => {
      const rect = element.getBoundingClientRect();
      const width = rect.width || window.innerWidth;
      const height = rect.height || window.innerHeight;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) {
        const { width, height } = entry.contentRect;
        setSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      } else {
        read();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Wheel: attached non-passively so preventDefault can stop the browser from
  // zooming or scrolling the page (React's onWheel is passive).
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      wheel({
        deltaX: wheelPixels(event.deltaX, event.deltaMode),
        deltaY: wheelPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: { x: event.clientX, y: event.clientY },
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [wheel]);

  // Safari pinch arrives as gesturestart/gesturechange; preventDefault keeps
  // the browser from page-zooming, and the scale ratio zooms the board.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const onGestureStart = (event: Event): void => {
      event.preventDefault();
      gestureBaseScaleRef.current = (event as SafariGestureEventLike).scale ?? 1;
    };
    const onGestureChange = (event: Event): void => {
      event.preventDefault();
      const gesture = event as SafariGestureEventLike;
      const scale = gesture.scale;
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return;
      const base = gestureBaseScaleRef.current ?? 1;
      const ratio = scale / base;
      gestureBaseScaleRef.current = scale;
      if (ratio === 1) return;
      zoomAtPointer(
        {
          x: gesture.clientX ?? window.innerWidth / 2,
          y: gesture.clientY ?? window.innerHeight / 2,
        },
        ratio,
      );
    };
    const onGestureEnd = (event: Event): void => {
      gestureBaseScaleRef.current = null;
      event.preventDefault?.();
    };
    element.addEventListener('gesturestart', onGestureStart as EventListener);
    element.addEventListener('gesturechange', onGestureChange as EventListener);
    element.addEventListener('gestureend', onGestureEnd as EventListener);
    return () => {
      element.removeEventListener('gesturestart', onGestureStart as EventListener);
      element.removeEventListener('gesturechange', onGestureChange as EventListener);
      element.removeEventListener('gestureend', onGestureEnd as EventListener);
    };
  }, [zoomAtPointer]);

  // Keyboard: Ctrl/Cmd + = / - / 0 zoom one step or reset, and the browser's
  // own page zoom is prevented.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key;
      const code = event.code;
      const zoomIn = key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd';
      const zoomOut = key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract';
      const resetView = key === '0' || code === 'Digit0' || code === 'Numpad0';
      if (zoomIn) {
        event.preventDefault();
        zoomStep('in');
      } else if (zoomOut) {
        event.preventDefault();
        zoomStep('out');
      } else if (resetView) {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Panning starts only on empty board space (the viewport/grid itself), so
      // board objects can stop propagation from story 2 onwards.
      if (event.target !== event.currentTarget) return;
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      // Shift on empty space is the selection box; without it, exactly the story 1 pan.
      if (event.shiftKey && marquee) {
        marqueeDownRef.current = true;
        marquee.begin(point);
        return;
      }
      emptyDownRef.current = { x: event.clientX, y: event.clientY, moved: false };
      beginPan(point);
    },
    [beginPan, marquee],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (marqueeDownRef.current) {
        marquee?.move({ x: event.clientX, y: event.clientY });
        return;
      }
      const down = emptyDownRef.current;
      if (down) {
        const dx = event.clientX - down.x;
        const dy = event.clientY - down.y;
        if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) down.moved = true;
      }
      panMove({ x: event.clientX, y: event.clientY });
    },
    [panMove, marquee],
  );

  const onPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (marqueeDownRef.current) {
        marqueeDownRef.current = false;
        // The box selects on release, however short the drag was.
        marquee?.end({ x: event.clientX, y: event.clientY });
        return;
      }
      endPan();
      const down = emptyDownRef.current;
      emptyDownRef.current = null;
      // A press+release on empty space that never panned clears the selection.
      if (down && !down.moved) onEmptyClick?.({ x: event.clientX, y: event.clientY });
    },
    [endPan, onEmptyClick, marquee],
  );

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // Only a double-click on empty board space creates a note; a note stops
      // propagation and edits itself instead.
      if (event.target !== event.currentTarget) return;
      onEmptyDoubleClick?.({ x: event.clientX, y: event.clientY });
    },
    [onEmptyDoubleClick],
  );


  const onPointerCancel = useCallback(() => {
    // A system interruption ends the drag; the board stays where it was. A marquee
    // that is interrupted selects nothing (TC-22).
    if (marqueeDownRef.current) {
      marqueeDownRef.current = false;
      marquee?.cancel();
      return;
    }
    endPan();
  }, [endPan, marquee]);

  const onLostPointerCapture = useCallback(() => {
    endPan();
  }, [endPan]);

  // --- Render ----------------------------------------------------------------

  const { x, y, zoom } = camera;
  const spacingScreen = GRID_SPACING_WORLD * zoom;
  // Put a grid dot exactly on the screen position of the board's starting
  // point so the dot grid appears attached to the board (it moves with pan and
  // scales with zoom, and repeats with `mod` so it never runs out).
  const originScreen = worldToScreen(camera, { x: 0, y: 0 });
  const backgroundPositionX = mod(originScreen.x, spacingScreen) - spacingScreen / 2;
  const backgroundPositionY = mod(originScreen.y, spacingScreen) - spacingScreen / 2;

  const viewportStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    overflow: 'hidden',
    touchAction: 'none',
    cursor: mode === 'panning' ? 'grabbing' : 'grab',
    backgroundColor: '#fbfbf9',
    backgroundImage: `radial-gradient(circle, ${DOT_COLOR} ${DOT_RADIUS_PX - 1}px, transparent ${DOT_RADIUS_PX}px)`,
    backgroundSize: `${spacingScreen}px ${spacingScreen}px`,
    backgroundPosition: `${backgroundPositionX}px ${backgroundPositionY}px`,
  };

  const worldStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    transformOrigin: '0 0',
    transform: `scale(${zoom}) translate(${-x}px, ${-y}px)`,
    willChange: 'transform',
    pointerEvents: 'none',
  };

  return (
    <BoardCameraContext.Provider value={{ camera, hasNavigated, mode, beginPan, panMove, endPan, wheel, zoomAtPointer, zoomStep, reset }}>
      <div
        ref={elementRef}
        data-testid="board-viewport"
        data-state={mode}
        role="application"
        aria-label="Board"
        aria-roledescription="infinite canvas"
        style={viewportStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onDoubleClick={onDoubleClick}
      >
        <div data-testid="board-world" style={worldStyle}>
          <div
            data-testid="origin-marker"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 0,
              height: 0,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: ORIGIN_MARKER_PX,
                height: ORIGIN_MARKER_PX,
                transformOrigin: '50% 50%',
                transform: `translate(-50%, -50%) scale(${1 / zoom})`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 0,
                  bottom: 0,
                  width: 2,
                  marginLeft: -1,
                  backgroundColor: ORIGIN_MARKER_COLOR,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: 0,
                  right: 0,
                  height: 2,
                  marginTop: -1,
                  backgroundColor: ORIGIN_MARKER_COLOR,
                }}
              />
            </div>
          </div>
          {children}
        </div>
      </div>
      {chrome}
    </BoardCameraContext.Provider>
  );
}
