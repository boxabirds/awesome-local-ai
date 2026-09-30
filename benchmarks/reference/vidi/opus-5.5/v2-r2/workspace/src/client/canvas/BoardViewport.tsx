import { type ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD, WHEEL_LINE_HEIGHT_PX } from '../../shared/config';
import type { ToolId } from '../tools/useActiveTool';
import { type Camera, type Point, screenToWorld } from './camera';
import { useBoardCamera } from './useCamera';

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;

/** Non-negative remainder, so the grid offset is always within one tile. */
function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Grid background geometry: dots sit at world multiples of GRID_SPACING_WORLD. */
export function gridStyle(camera: Camera): { size: number; offsetX: number; offsetY: number } {
  const size = GRID_SPACING_WORLD * camera.zoom;
  // Compute the remainder in world units first to keep precision far from the origin.
  const offsetX = mod(-camera.x, GRID_SPACING_WORLD) * camera.zoom - size / 2;
  const offsetY = mod(-camera.y, GRID_SPACING_WORLD) * camera.zoom - size / 2;
  return { size, offsetX, offsetY };
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function shortcutFor(e: KeyboardEvent): 'in' | 'out' | 'reset' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') return 'in';
  if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') return 'out';
  if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') return 'reset';
  return null;
}

interface GestureEventLike extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

export function BoardViewport(props: {
  children?: ReactNode;
  /** Double-click on empty board space, with the point in world units. */
  onEmptyDoubleClick?(world: Point): void;
  /** Press and release on empty board space without dragging. */
  onEmptyClick?(): void;
  /** Shift+drag on empty board space draws this selection rectangle instead of panning. */
  marquee?: { begin(screen: Point): void; move(screen: Point): void; end(): void; cancel(): void };
  /** The active tool; with 'text' a press anywhere on the board (even on an object) places text. */
  tool?: ToolId;
  /**
   * Screen-space layer above the objects: the Shape, Connector and Pen tools own every
   * press there (a Pen drag never pans or moves objects); wheel and pinch still navigate.
   */
  overlay?: ReactNode;
  /** Text tool press, with the point in world units. */
  onPlaceText?(world: Point): void;
}): React.JSX.Element {
  const board = useBoardCamera();
  const { camera, setViewportSize } = board;
  const ref = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const activePointer = useRef<number | null>(null);
  const mode = useRef<'pan' | 'marquee'>('pan');
  const pressStart = useRef<Point | null>(null);
  // Latest handlers for native listeners attached once.
  const boardRef = useRef(board);
  boardRef.current = board;

  const localPoint = (clientX: number, clientY: number): Point => {
    const rect = ref.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  // Viewport size: resizing never moves the camera (anchored at the top-left).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setViewportSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [setViewportSize]);

  // Wheel and Safari gestures need non-passive native listeners to preventDefault.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pageHeight = el.getBoundingClientRect().height;
      const unit =
        e.deltaMode === DOM_DELTA_LINE ? WHEEL_LINE_HEIGHT_PX : e.deltaMode === DOM_DELTA_PAGE ? pageHeight : 1;
      boardRef.current.wheel({
        deltaX: e.deltaX * unit,
        deltaY: e.deltaY * unit,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: localPoint(e.clientX, e.clientY),
      });
    };
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = (e as GestureEventLike).scale || 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEventLike;
      const ratio = g.scale / lastScale;
      lastScale = g.scale;
      boardRef.current.zoomAtPoint(localPoint(g.clientX, g.clientY), ratio);
    };
    const onGestureEnd = (e: Event) => e.preventDefault();
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
  }, []);

  // Ctrl/Cmd + = / − / 0 zoom the board, never the page.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const action = shortcutFor(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'reset') boardRef.current.reset();
      else boardRef.current.zoomStep(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const stopPan = (pointerId: number, released?: Point) => {
    if (activePointer.current !== pointerId) return;
    activePointer.current = null;
    const start = pressStart.current;
    pressStart.current = null;
    if (mode.current === 'marquee') {
      mode.current = 'pan';
      setSelecting(false);
      if (released) {
        props.marquee?.move(released);
        props.marquee?.end();
      } else {
        props.marquee?.cancel();
      }
      return;
    }
    if (released && start && Math.hypot(released.x - start.x, released.y - start.y) < DRAG_THRESHOLD_PX) {
      props.onEmptyClick?.();
    }
    setPanning(false);
    board.endPan();
  };

  // Text tool: the press never pans, marquees or reaches an object; it places text there.
  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (props.tool !== 'text' || e.button !== PRIMARY_BUTTON || activePointer.current !== null) return;
    e.preventDefault();
    e.stopPropagation();
    props.onPlaceText?.(screenToWorld(camera, localPoint(e.clientX, e.clientY)));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only empty board space starts a pan; objects (later stories) stop propagation.
    if (e.target !== e.currentTarget) return;
    if (e.button !== PRIMARY_BUTTON && e.button !== MIDDLE_BUTTON) return;
    if (activePointer.current !== null) return;
    e.preventDefault();
    // A note keeps keyboard focus otherwise (preventDefault stops the focus change).
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-sticky-note]')) {
      document.activeElement.blur();
    }
    activePointer.current = e.pointerId;
    pressStart.current = localPoint(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (e.shiftKey && e.button === PRIMARY_BUTTON && props.marquee) {
      mode.current = 'marquee';
      setSelecting(true);
      props.marquee.begin(localPoint(e.clientX, e.clientY));
      return;
    }
    mode.current = 'pan';
    setPanning(true);
    board.beginPan(localPoint(e.clientX, e.clientY));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== e.pointerId) return;
    if (mode.current === 'marquee') props.marquee?.move(localPoint(e.clientX, e.clientY));
    else board.panMove(localPoint(e.clientX, e.clientY));
  };

  const grid = gridStyle(camera);

  return (
    <div
      ref={ref}
      className={['board-viewport', panning && 'is-panning', props.tool === 'text' && 'is-text-tool', props.tool === 'pen' && 'is-pen-tool']
        .filter(Boolean)
        .join(' ')}
      data-testid="board-viewport"
      data-state={panning ? 'panning' : selecting ? 'selecting' : 'idle'}
      data-tool={props.tool ?? 'select'}
      tabIndex={0}
      aria-label="Board"
      role="application"
      style={{
        backgroundSize: `${grid.size}px ${grid.size}px`,
        backgroundPosition: `${grid.offsetX}px ${grid.offsetY}px`,
      }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => stopPan(e.pointerId, localPoint(e.clientX, e.clientY))}
      onPointerCancel={(e) => stopPan(e.pointerId)}
      onLostPointerCapture={(e) => stopPan(e.pointerId)}
      onDoubleClick={(e) => {
        // Only empty board space creates; notes handle their own double-click.
        if (e.target !== e.currentTarget) return;
        props.onEmptyDoubleClick?.(screenToWorld(camera, localPoint(e.clientX, e.clientY)));
      }}
    >
      <div
        className="board-world"
        data-testid="board-world"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        <div className="board-origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {props.children}
      </div>
      {props.overlay}
    </div>
  );
}
