import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  GRID_SPACING_WORLD,
  WHEEL_LINE_HEIGHT_PX,
  WHEEL_PAGE_HEIGHT_FRACTION,
} from '../../shared/config';
import { worldToScreen, type Camera, type Point, type Size } from './camera';
import { useCamera, type CameraController } from './useCamera';
import { installBoardTestHooks } from './testHooks';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface BoardViewportProps {
  /** Rendered in world coordinates (unscaled content layer). */
  children?: ReactNode;
  /** Rendered in screen space above the board: zoom controls, hints, later presence. */
  overlay?: ReactNode;
  /** Called on double-click over empty board space with the screen-space point. */
  onBoardDblClick?: (point: { x: number; y: number }) => void;
  /** Called when the user clicks empty board space (short press, no drag). */
  onBoardEmptyClick?: () => void;
  /** When provided, Shift+drag draws a marquee and selects fully-enclosed objects. */
  snapshot?: readonly ObjectSnapshot[];
  /** Called when a marquee completes with the ids fully inside it (always additive). */
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
}

const BoardCameraContext = createContext<CameraController | null>(null);

/** Access the board camera from anywhere inside `<BoardViewport>` (including its overlay). */
export function useBoardCamera(): CameraController {
  const controller = useContext(BoardCameraContext);
  if (!controller) throw new Error('useBoardCamera must be used inside <BoardViewport>');
  return controller;
}

const ORIGIN_WORLD: Point = { x: 0, y: 0 };

interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

function modulo(value: number, period: number): number {
  if (period <= 0) return 0;
  return ((value % period) + period) % period;
}

function measureBoard(el: HTMLElement): Size {
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }
  // Environments without layout (jsdom): fall back to the window size.
  if (typeof window !== 'undefined') {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return { width: 0, height: 0 };
}

/** Convert a wheel event's deltas to CSS pixels regardless of `deltaMode`. */
function wheelPixels(e: WheelEvent, viewport: Size): { deltaX: number; deltaY: number } {
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return { deltaX: e.deltaX * WHEEL_LINE_HEIGHT_PX, deltaY: e.deltaY * WHEEL_LINE_HEIGHT_PX };
  }
  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return {
      deltaX: e.deltaX * viewport.width,
      deltaY: e.deltaY * viewport.height * WHEEL_PAGE_HEIGHT_FRACTION,
    };
  }
  return { deltaX: e.deltaX, deltaY: e.deltaY };
}

/**
 * The infinite board: a full-window surface whose dot grid and content layer are
 * positioned with CSS from the camera. Handles drag-to-pan, scroll, Ctrl/Cmd
 * wheel + Safari pinch zoom, and the Ctrl/Cmd + = / - / 0 shortcuts.
 */
const EMPTY_SNAPSHOT: readonly ObjectSnapshot[] = [];

export function BoardViewport(props: BoardViewportProps) {
  const { children, overlay, onBoardDblClick, onBoardEmptyClick } = props;
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const controller = useCamera(viewport);

  // Marquee selection (Shift+drag over the board surface).
  const marqueeSnapshot = props.snapshot ?? EMPTY_SNAPSHOT;
  const marqueeSelectRef = useRef<((ids: string[]) => void) | null>(null);
  marqueeSelectRef.current = props.onMarqueeSelect
    ? (ids: string[]) => props.onMarqueeSelect?.(ids, true)
    : null;
  const marquee = useMarquee(controller.camera, marqueeSnapshot, (ids) =>
    marqueeSelectRef.current?.(ids),
  );
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  const marqueeActiveRef = useRef(false);

  // Listeners are attached once and read the latest controller through a ref, so
  // re-rendering every frame never re-subscribes DOM events.
  const controllerRef = useRef(controller);
  const viewportSizeRef = useRef(viewport);
  useLayoutEffect(() => {
    controllerRef.current = controller;
    viewportSizeRef.current = viewport;
  });

  // Size of the board area. A resize must not move content relative to the
  // top-left corner, so only the size is stored; the camera is untouched.
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const read = () => {
      const size = measureBoard(el);
      setViewport((prev) => (prev.width === size.width && prev.height === size.height ? prev : size));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pointerPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const el = boardRef.current;
    if (!el) return { x: e.clientX, y: e.clientY };
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const lastPointerRef = useRef<Point | null>(null);
  const downPosRef = useRef<Point | null>(null);
  const dblClickRef = useRef<((point: Point) => void) | null>(null);
  const emptyClickRef = useRef<(() => void) | null>(null);
  dblClickRef.current = onBoardDblClick ?? null;
  emptyClickRef.current = onBoardEmptyClick ?? null;

  // Pointer drag, wheel and Safari gesture listeners on the board surface.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const api = () => controllerRef.current;

    let pointerId: number | null = null;

    const isBoardSurface = (target: EventTarget | null): boolean =>
      target === el || (target instanceof HTMLElement && target.dataset.boardSurface === 'true');

    const endPan = (e?: PointerEvent, cancelled = false) => {
      if (pointerId === null) return;
      const released = pointerId;
      pointerId = null;
      if (typeof el.releasePointerCapture === 'function' && el.hasPointerCapture?.(released)) {
        el.releasePointerCapture(released);
      }
      // A finished marquee selects enclosed objects; a cancelled one leaves the
      // selection unchanged. Neither clears the selection via the empty-click path.
      if (marqueeActiveRef.current) {
        marqueeActiveRef.current = false;
        if (cancelled) marqueeRef.current.cancel();
        else marqueeRef.current.end();
        api().endPan();
        setIsPanning(false);
        return;
      }
      // Detect a short click on empty board space (no drag) -> clear selection
      const down = downPosRef.current;
      downPosRef.current = null;
      if (e && down) {
        const up = pointerPoint(e);
        const dist = Math.hypot(up.x - down.x, up.y - down.y);
        if (dist < 3 && emptyClickRef.current) {
          emptyClickRef.current();
        }
      }
      api().endPan();
      setIsPanning(false);
    };

    const onPointerDown = (e: PointerEvent) => {
      // Only the primary pointer pans. (jsdom's PointerEvent has no `button`.)
      const button = e.button as number | undefined;
      if (button !== undefined && button !== 0) return;
      if (!isBoardSurface(e.target)) return;
      // Shift+drag on the board surface starts a marquee instead of a pan.
      if (e.shiftKey && marqueeSelectRef.current) {
        downPosRef.current = null;
        pointerId = e.pointerId;
        if (typeof el.setPointerCapture === 'function') {
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            // best effort
          }
        }
        marqueeActiveRef.current = true;
        marqueeRef.current.begin(pointerPoint(e));
        return;
      }
      downPosRef.current = pointerPoint(e);
      pointerId = e.pointerId;
      if (typeof el.setPointerCapture === 'function') {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Pointer capture is best effort (jsdom); dragging still works.
        }
      }
      const p = pointerPoint(e);
      lastPointerRef.current = p;
      api().beginPan(p);
      setIsPanning(true);
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = pointerPoint(e);
      lastPointerRef.current = p;
      if (pointerId === null) return;
      if (marqueeActiveRef.current) {
        marqueeRef.current.move(p);
        return;
      }
      api().panMove(p);
    };

    const onWheel = (e: WheelEvent) => {
      // Over the board the board owns the gesture: never let the page scroll or
      // the browser zoom the whole page.
      e.preventDefault();
      const pixels = wheelPixels(e, viewportSizeRef.current);
      const point = pointerPoint(e);
      lastPointerRef.current = point;
      api().wheel({
        deltaX: pixels.deltaX,
        deltaY: pixels.deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point,
      });
    };

    let gestureScale = 1;

    const gesturePoint = (e: SafariGestureEvent): Point =>
      typeof e.clientX === 'number' && typeof e.clientY === 'number'
        ? pointerPoint({ clientX: e.clientX, clientY: e.clientY })
        : (lastPointerRef.current ?? {
            x: viewportSizeRef.current.width / 2,
            y: viewportSizeRef.current.height / 2,
          });

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = (e as SafariGestureEvent).scale || 1;
    };

    const onGestureChange = (e: Event) => {
      const gesture = e as SafariGestureEvent;
      e.preventDefault();
      const scale = gesture.scale;
      if (!Number.isFinite(scale) || scale <= 0) return;
      const ratio = scale / (gestureScale || 1);
      gestureScale = scale;
      api().zoomGesture({ scale: ratio, point: gesturePoint(gesture) });
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };

    const onDblClick = (e: MouseEvent) => {
      if (!isBoardSurface(e.target)) return;
      if (dblClickRef.current) {
        dblClickRef.current(pointerPoint(e));
      }
    };

    const onPointerCancelEv = (e: PointerEvent) => endPan(e, true);

    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPan as EventListener);
    el.addEventListener('pointercancel', onPointerCancelEv as EventListener);
    el.addEventListener('lostpointercapture', endPan);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart as EventListener, { passive: false });
    el.addEventListener('gesturechange', onGestureChange as EventListener, { passive: false });
    el.addEventListener('gestureend', onGestureEnd as EventListener, { passive: false });

    return () => {
      el.removeEventListener('dblclick', onDblClick);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPan as EventListener);
      el.removeEventListener('pointercancel', onPointerCancelEv as EventListener);
      el.removeEventListener('lostpointercapture', endPan);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
      el.removeEventListener('gestureend', onGestureEnd as EventListener);
    };
  }, [pointerPoint]);

  // Keyboard zoom shortcuts. Ctrl/Cmd + = / - / 0 are browser page-zoom shortcuts,
  // so they are claimed (preventDefault) while the board is present.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        controllerRef.current.zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        controllerRef.current.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        controllerRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Test-only camera teleport (see tests/e2e).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return installBoardTestHooks({
      setCamera: (partial) => {
        const current = controllerRef.current.camera;
        controllerRef.current.setCamera({
          x: partial.x ?? current.x,
          y: partial.y ?? current.y,
          zoom: partial.zoom ?? current.zoom,
        });
      },
      getCamera: () => controllerRef.current.camera,
    });
  }, []);

  const { camera } = controller;
  const originScreenPoint = worldToScreen(camera, ORIGIN_WORLD);
  const gridSpacingPx = GRID_SPACING_WORLD * camera.zoom;
  const gridStyle = {
    backgroundSize: `${gridSpacingPx}px ${gridSpacingPx}px`,
    backgroundPosition: `${modulo(-camera.x * camera.zoom, gridSpacingPx)}px ${modulo(
      -camera.y * camera.zoom,
      gridSpacingPx,
    )}px`,
  };
  const worldStyle = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
  };

  return (
    <BoardCameraContext.Provider value={controller}>
      <div
        ref={boardRef}
        className="board-viewport"
        data-testid="board"
        data-camera-x={camera.x}
        data-camera-y={camera.y}
        data-camera-zoom={camera.zoom}
        data-panning={isPanning ? 'true' : 'false'}
        data-grid-spacing={gridSpacingPx}
        style={gridStyle}
      >
        <div className="board-world" data-testid="board-world" style={worldStyle}>
          {children}
          <MarqueeRect rect={marquee.rect} camera={controller.camera} />
        </div>
        <div className="board-overlay">
          <div
            className="origin-marker"
            data-testid="origin-marker"
            aria-hidden="true"
            style={{ left: `${originScreenPoint.x}px`, top: `${originScreenPoint.y}px` }}
          >
            <span className="origin-marker-h" />
            <span className="origin-marker-v" />
          </div>
          {overlay}
        </div>
      </div>
    </BoardCameraContext.Provider>
  );
}

export type { Camera };
