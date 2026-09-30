import {
  type DragEvent as ReactDragEvent,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { MarqueeRect, useMarquee } from '../board/Marquee';
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
  /** Enables Shift+drag selection on empty space: ids fully inside the rectangle are reported. */
  marquee?: { snapshot: readonly ObjectSnapshot[]; onSelect(ids: string[]): void };
  /** Kept up to date with the current camera (for gestures started outside the viewport). */
  cameraRef?: MutableRefObject<Camera | null>;
  /** Kept up to date with the viewport size (story 9: N creates a note in the view centre). */
  viewportRef?: MutableRefObject<Size | null>;
  /**
   * Set while a placing tool is active (story 9: Text): the board shows a text cursor and a
   * click anywhere, on top of objects too, reports its world point instead of panning,
   * selecting or starting a marquee.
   */
  onPlace?(world: Point): void;
  /**
   * Screen-space layer inside the board surface for a drawing tool (story 10: Shape, Connector).
   * It receives the tool's presses; wheel and pinch still navigate.
   */
  toolLayer?: (view: BoardView) => ReactNode;
  /**
   * Objects matched by hit test rather than by their DOM box (story 10 arrows): the id of such
   * an object that is topmost at a world point, or null. A press there goes to `onPick` (in the
   * capture phase, before any object or the board sees it) and a double-click there creates
   * nothing.
   */
  pickAt?(world: Point, zoom: number, target: EventTarget): string | null;
  onPick?(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  /** File drag and drop on the board surface (story 12 images). */
  drop?: {
    onDragEnter(e: ReactDragEvent<HTMLElement>): void;
    onDragOver(e: ReactDragEvent<HTMLElement>): void;
    onDragLeave(e: ReactDragEvent<HTMLElement>): void;
    onDrop(e: ReactDragEvent<HTMLElement>): void;
  };
}

const NO_OBJECTS: readonly ObjectSnapshot[] = [];

export function BoardViewport(props: BoardViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewport = useElementSize(surfaceRef);
  const controls = useCamera(viewport);
  const { camera, beginPan, panMove, endPan, isPanning } = controls;
  useNavigationListeners(surfaceRef, controls, viewport);
  const pressRef = useRef<Point | null>(null);
  const view: BoardView = { camera, viewport };
  if (props.cameraRef) props.cameraRef.current = camera;
  if (props.viewportRef) props.viewportRef.current = viewport;
  const placeRef = useRef<Point | null>(null);
  const marquee = useMarquee(
    camera,
    props.marquee?.snapshot ?? NO_OBJECTS,
    (ids) => props.marquee?.onSelect(ids),
  );
  const marqueeActive = marquee.rect !== null;

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Capture phase: a placing click never reaches objects or the pan/marquee handlers.
  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!props.onPlace) {
      if (!props.pickAt || !props.onPick || e.button !== PRIMARY_BUTTON) return;
      const id = props.pickAt(screenToWorld(camera, localPoint(e)), camera.zoom, e.target);
      if (id === null) return;
      e.stopPropagation();
      props.onPick(e, id);
      return;
    }
    e.stopPropagation();
    // No focus change and no text selection from the press.
    e.preventDefault();
    placeRef.current = e.button === PRIMARY_BUTTON ? localPoint(e) : null;
  };
  const onPointerUpCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    const at = placeRef.current;
    placeRef.current = null;
    if (!props.onPlace || !at) return;
    e.stopPropagation();
    props.onPlace(screenToWorld(camera, at));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only empty board space starts a pan or a marquee; objects stop propagation.
    if (e.target !== e.currentTarget || e.button !== PRIMARY_BUTTON) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (e.shiftKey && props.marquee) {
      marquee.begin(localPoint(e));
      return;
    }
    pressRef.current = { x: e.clientX, y: e.clientY };
    beginPan({ x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeActive) marquee.move(localPoint(e));
    else if (isPanning) panMove({ x: e.clientX, y: e.clientY });
  };
  const onPointerEnd = () => {
    pressRef.current = null;
    marquee.cancel();
    if (isPanning) endPan();
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeActive) {
      marquee.move(localPoint(e));
      marquee.end();
      return;
    }
    const press = pressRef.current;
    onPointerEnd();
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD_PX) {
      props.onEmptyClick?.();
    }
  };
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !props.onEmptyDoubleClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const world = screenToWorld(camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    // On an arrow's line: not empty space.
    if (props.pickAt?.(world, camera.zoom, e.target) != null) return;
    props.onEmptyDoubleClick(world);
  };

  return (
    <div className="board">
      <div
        ref={surfaceRef}
        className={
          isPanning
            ? 'board-viewport is-panning'
            : props.onPlace
              ? 'board-viewport is-placing-text'
              : 'board-viewport'
        }
        data-testid="board-viewport"
        data-state={isPanning ? 'panning' : 'idle'}
        style={gridStyle(camera)}
        onPointerDownCapture={onPointerDownCapture}
        onPointerUpCapture={onPointerUpCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onDoubleClick={onDoubleClick}
        onDragEnter={props.drop?.onDragEnter}
        onDragOver={props.drop?.onDragOver}
        onDragLeave={props.drop?.onDragLeave}
        onDrop={props.drop?.onDrop}
      >
        <div
          className="world-layer"
          data-testid="world-layer"
          style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
        >
          <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
          {typeof props.children === 'function' ? props.children(view) : props.children}
          <MarqueeRect rect={marquee.rect} camera={camera} />
        </div>
        {props.toolLayer?.(view)}
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
