/**
 * The board's input surface, dot grid and world layer (anchor: viewport.input).
 *
 * - Drag on empty board space pans (pointer capture; ends on up/cancel/lost capture).
 * - Plain wheel pans; Ctrl/Cmd + wheel (and trackpad pinch, which browsers report as
 *   ctrl+wheel) zooms around the pointer. The listener is non-passive so the browser
 *   never scrolls or zooms the page.
 * - Safari GestureEvents (trackpad pinch) zoom around the pointer.
 * - Ctrl/Cmd + = / - / 0 zoom one step / reset, and never zoom the page.
 * - Story 2: a click (press and release within DRAG_THRESHOLD_PX) on empty board space
 *   reports `onBackgroundClick`; a double-click on empty space reports
 *   `onBackgroundDoubleClick` with the world point. Objects stop propagation, so both
 *   only ever fire for empty space.
 * - Story 7: Shift + drag on empty space draws a selection rectangle (`marquee`) instead
 *   of panning; `overlay` is drawn in screen space above the world layer (selection
 *   outlines, handles and bar).
 */
import {
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useBoard } from './BoardContext';
import { screenToWorld, type Point } from './camera';
import type { MarqueeApi } from '../board/Marquee';
import {
  DRAG_THRESHOLD_PX,
  GRID_DOT_RADIUS_PX,
  GRID_MIN_SCREEN_SPACING,
  GRID_SPACING_WORLD,
  WHEEL_LINE_HEIGHT_PX,
} from '../../shared/config';

const PRIMARY_BUTTON = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const GRID_COARSEN_FACTOR = 2;
const HALF = 2;
/** Anti-aliasing width for the dot edge, in CSS pixels. */
const DOT_EDGE_PX = 0.5;

/** Safari's non-standard GestureEvent (trackpad pinch). */
interface GestureLikeEvent extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

function positiveMod(value: number, modulus: number): number {
  const r = value % modulus;
  return r < 0 ? r + modulus : r;
}

/** On-screen dot spacing: GRID_SPACING_WORLD * zoom, doubled while it is too dense. */
export function gridScreenSpacing(zoom: number): number {
  let spacing = GRID_SPACING_WORLD * zoom;
  while (spacing < GRID_MIN_SCREEN_SPACING) spacing *= GRID_COARSEN_FACTOR;
  return spacing;
}

export interface BoardViewportProps {
  children?: ReactNode;
  /** Press and release on empty board space without dragging. */
  onBackgroundClick?(): void;
  /** Double-click on empty board space, at this world point. */
  onBackgroundDoubleClick?(world: Point): void;
  /** Shift + drag on empty space drives this selection rectangle. */
  marquee?: Pick<MarqueeApi, 'begin' | 'move' | 'end' | 'cancel'>;
  /** Screen-space layer above the world layer. */
  overlay?: ReactNode;
}

export function BoardViewport(props: BoardViewportProps): React.JSX.Element {
  const { board, setViewport } = useBoard();
  const { camera } = board;
  const ref = useRef<HTMLDivElement>(null);
  const gestureScale = useRef(1);
  /** Where the current press on empty space started (null when not pressed). */
  const pressStart = useRef<Point | null>(null);
  /** What the current press on empty space does. */
  const pressMode = useRef<'pan' | 'marquee' | null>(null);

  const localPoint = (clientX: number, clientY: number): Point => {
    const rect = ref.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  // Measure the board area.
  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setViewport({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [setViewport]);

  // Wheel and Safari gesture listeners must be non-passive to cancel page scroll/zoom.
  const { wheel, zoomBy, zoomStep, reset } = board;
  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit =
        e.deltaMode === DOM_DELTA_LINE
          ? WHEEL_LINE_HEIGHT_PX
          : e.deltaMode === DOM_DELTA_PAGE
            ? el.clientHeight
            : 1;
      let deltaX = e.deltaX * unit;
      let deltaY = e.deltaY * unit;
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      // Shift + mouse wheel scrolls sideways where the OS has not already converted it.
      if (!ctrlOrMeta && e.shiftKey && deltaX === 0) {
        deltaX = deltaY;
        deltaY = 0;
      }
      const rect = el.getBoundingClientRect();
      wheel({ deltaX, deltaY, ctrlOrMeta, point: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale.current = (e as GestureLikeEvent).scale ?? 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureLikeEvent;
      const scale = g.scale ?? 1;
      const factor = scale / gestureScale.current;
      gestureScale.current = scale;
      const rect = el.getBoundingClientRect();
      const point =
        g.clientX !== undefined && g.clientY !== undefined
          ? { x: g.clientX - rect.left, y: g.clientY - rect.top }
          : { x: el.clientWidth / HALF, y: el.clientHeight / HALF };
      zoomBy(point, factor);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScale.current = 1;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [wheel, zoomBy]);

  // Keyboard shortcuts: Ctrl/Cmd + = / - / 0.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
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

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== PRIMARY_BUTTON) return;
    // Only empty board space starts a pan or a marquee; objects stop propagation.
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = localPoint(e.clientX, e.clientY);
    pressStart.current = p;
    if (e.shiftKey && props.marquee !== undefined) {
      pressMode.current = 'marquee';
      props.marquee.begin(p);
    } else {
      pressMode.current = 'pan';
      board.beginPan(p);
    }
  };
  // panMove/endPan are no-ops unless a pan is in progress (Idle state).
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = localPoint(e.clientX, e.clientY);
    if (pressMode.current === 'marquee') props.marquee?.move(p);
    else board.panMove(p);
  };
  /** Interrupted press: a marquee is discarded, a pan keeps where it got to. */
  const onPointerEnd = () => {
    if (pressMode.current === 'marquee') props.marquee?.cancel();
    pressMode.current = null;
    pressStart.current = null;
    board.endPan();
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = pressStart.current;
    const mode = pressMode.current;
    if (mode === 'marquee') {
      props.marquee?.move(localPoint(e.clientX, e.clientY));
      props.marquee?.end();
      pressMode.current = null;
    }
    onPointerEnd();
    if (start === null || mode !== 'pan') return;
    const p = localPoint(e.clientX, e.clientY);
    if (Math.hypot(p.x - start.x, p.y - start.y) < DRAG_THRESHOLD_PX) props.onBackgroundClick?.();
  };
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || props.onBackgroundDoubleClick === undefined) return;
    props.onBackgroundDoubleClick(screenToWorld(camera, localPoint(e.clientX, e.clientY)));
  };

  const spacing = gridScreenSpacing(camera.zoom);
  // Dots sit on world multiples of the grid spacing; each dot is drawn in the centre of
  // its background tile, so shift the tiles back by half a tile.
  const offsetX = positiveMod(-camera.x * camera.zoom, spacing) - spacing / HALF;
  const offsetY = positiveMod(-camera.y * camera.zoom, spacing) - spacing / HALF;
  const viewportStyle: CSSProperties = {
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${offsetX}px ${offsetY}px`,
    backgroundImage: `radial-gradient(circle, var(--grid-dot) ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX + DOT_EDGE_PX}px)`,
    cursor: board.isPanning ? 'grabbing' : 'grab',
  };
  const worldStyle: CSSProperties = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
    transformOrigin: '0 0',
  };

  return (
    <div
      ref={ref}
      className="board-viewport"
      data-testid="board-viewport"
      data-state={board.isPanning ? 'panning' : 'idle'}
      data-grid-spacing={spacing}
      style={viewportStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onDoubleClick={onDoubleClick}
    >
      <div className="board-world" data-testid="world-layer" style={worldStyle}>
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {props.children}
      </div>
      {props.overlay}
    </div>
  );
}
