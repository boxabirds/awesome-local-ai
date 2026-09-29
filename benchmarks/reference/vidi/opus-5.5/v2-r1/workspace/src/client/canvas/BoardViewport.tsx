import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import {
  type Camera,
  type Point,
  type Size,
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
} from './camera';
import { isEditableTarget } from './isEditableTarget';
import { NavigationHint } from './NavigationHint';
import { type CameraControls, useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';

/** Pixels per line when a wheel event reports `deltaMode === DOM_DELTA_LINE`. */
const WHEEL_LINE_HEIGHT_PX = 16;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const PRIMARY_BUTTON = 0;

/** Safari's non-standard pinch event. */
interface GestureEventLike extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(windowSize);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      // jsdom (and a not-yet-laid-out element) report 0; keep the window-based size then.
      if (rect.width > 0 && rect.height > 0) {
        setSize((prev) =>
          prev.width === rect.width && prev.height === rect.height
            ? prev
            : { width: rect.width, height: rect.height },
        );
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Grid background keeping dot centres on world multiples of GRID_SPACING_WORLD. */
function gridStyle(cam: Camera) {
  const spacing = GRID_SPACING_WORLD * cam.zoom;
  // The radial-gradient dot sits in the centre of each tile, hence the half-tile shift.
  const offsetX = mod(-cam.x * cam.zoom - spacing / 2, spacing);
  const offsetY = mod(-cam.y * cam.zoom - spacing / 2, spacing);
  return {
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${offsetX}px ${offsetY}px`,
  };
}

function useNavigationListeners(
  surfaceRef: RefObject<HTMLDivElement | null>,
  controls: CameraControls,
  viewport: Size,
) {
  const { wheel, zoomAt, zoomStep, reset } = controls;

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const localPoint = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    // Non-passive so preventDefault stops page scroll and page zoom (React's onWheel is passive).
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit =
        e.deltaMode === DOM_DELTA_LINE
          ? WHEEL_LINE_HEIGHT_PX
          : e.deltaMode === DOM_DELTA_PAGE
            ? viewport.height
            : 1;
      wheel({
        deltaX: e.deltaX * unit,
        deltaY: e.deltaY * unit,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: localPoint(e.clientX, e.clientY),
      });
    };

    let lastGestureScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastGestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEventLike;
      if (!Number.isFinite(g.scale) || g.scale <= 0) return;
      const ratio = g.scale / lastGestureScale;
      lastGestureScale = g.scale;
      zoomAt(localPoint(g.clientX ?? 0, g.clientY ?? 0), ratio);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      lastGestureScale = 1;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [surfaceRef, wheel, zoomAt, viewport.height]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        zoomStep('out');
      } else if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);
}

/** What board content needs to know about the current view. */
export interface BoardView {
  camera: Camera;
  viewport: Size;
}

export interface BoardViewportProps {
  /** World-layer content (scaled with the camera). */
  children?: ReactNode | ((view: BoardView) => ReactNode);
  /** Screen-space content drawn above the board (toolbars). */
  overlay?: (view: BoardView) => ReactNode;
  /** Double-click on empty board space, at a world point. */
  onEmptyDoubleClick?(world: Point): void;
  /** Press and release on empty board space without dragging. */
  onEmptyClick?(): void;
}

export function BoardViewport(props: BoardViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewport = useElementSize(surfaceRef);
  const controls = useCamera(viewport);
  const { camera, beginPan, panMove, endPan, isPanning } = controls;
  useNavigationListeners(surfaceRef, controls, viewport);
  const pressRef = useRef<Point | null>(null);
  const view: BoardView = { camera, viewport };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only empty board space starts a pan; objects stop propagation.
    if (e.target !== e.currentTarget || e.button !== PRIMARY_BUTTON) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pressRef.current = { x: e.clientX, y: e.clientY };
    beginPan({ x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isPanning) panMove({ x: e.clientX, y: e.clientY });
  };
  const onPointerEnd = () => {
    pressRef.current = null;
    if (isPanning) endPan();
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    onPointerEnd();
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD_PX) {
      props.onEmptyClick?.();
    }
  };
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !props.onEmptyDoubleClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    props.onEmptyDoubleClick(
      screenToWorld(camera, { x: e.clientX - rect.left, y: e.clientY - rect.top }),
    );
  };

  return (
    <div className="board">
      <div
        ref={surfaceRef}
        className={isPanning ? 'board-viewport is-panning' : 'board-viewport'}
        data-testid="board-viewport"
        data-state={isPanning ? 'panning' : 'idle'}
        style={gridStyle(camera)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onDoubleClick={onDoubleClick}
      >
        <div
          className="world-layer"
          data-testid="world-layer"
          style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
        >
          <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
          {typeof props.children === 'function' ? props.children(view) : props.children}
        </div>
      </div>
      <NavigationHint visible={!controls.hasNavigated} />
      {props.overlay?.(view)}
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => controls.zoomStep('in')}
        onZoomOut={() => controls.zoomStep('out')}
        onReset={controls.reset}
      />
    </div>
  );
}
