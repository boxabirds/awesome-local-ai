import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import type { Point, Size } from './camera';
import type { CameraController } from './useCamera';

/** WheelEvent.deltaMode values. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
/** Pixels per scrolled line when the browser reports line-mode deltas (Firefox). */
const WHEEL_LINE_HEIGHT_PX = 16;
/** Only the primary (left) mouse button starts a pan. */
const PRIMARY_BUTTON = 0;
const HALF = 2;

type Mode = 'idle' | 'panning' | 'marquee';

/** Shift+drag selection rectangle handlers (story 7); points are relative to the board area. */
export interface MarqueeHandlers {
  begin(point: Point): void;
  move(point: Point): void;
  end(): void;
  cancel(): void;
}

/** Safari's non-standard GestureEvent (trackpad pinch). */
interface GestureLikeEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

export interface BoardViewportProps {
  controller: CameraController;
  /** Reports the board area's size whenever it changes. */
  onResize(size: Size): void;
  /** Content rendered in world coordinates. */
  children?: ReactNode;
  /** Any press on empty board space (before a possible pan). */
  onEmptyPointerDown?(): void;
  /** A press and release on empty board space that moved less than DRAG_THRESHOLD_PX. */
  onEmptyClick?(): void;
  /** Double-click on empty board space, at a point relative to the board area's top-left. */
  onEmptyDoubleClick?(point: Point): void;
  /** Shift+press on empty board space draws a selection rectangle instead of panning. */
  marquee?: MarqueeHandlers;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function wheelDeltaToPixels(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === DOM_DELTA_LINE) return delta * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === DOM_DELTA_PAGE) return delta * pageSize;
  return delta;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Full-size input surface for the infinite board: a dot-grid background attached to the board,
 * a world layer positioned by the camera, and pointer / wheel / pinch / keyboard navigation.
 */
export function BoardViewport(props: BoardViewportProps) {
  const { controller, onResize, children, onEmptyPointerDown, onEmptyClick, onEmptyDoubleClick, marquee } = props;
  const elementRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const pointerIdRef = useRef<number | null>(null);
  const pressStartRef = useRef<Point | null>(null);
  const pressMovedRef = useRef(false);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  const modeRef = useRef<Mode>('idle');
  modeRef.current = mode;
  const { camera } = controller;

  // Board-area size: measured before first paint, then kept current by ResizeObserver.
  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      onResize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onResize]);

  // Wheel and Safari gestures need non-passive listeners so preventDefault
  // stops page scrolling and browser page zoom.
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return undefined;
    const localPoint = (clientX: number, clientY: number): Point => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      controllerRef.current.wheel({
        deltaX: wheelDeltaToPixels(e.deltaX, e.deltaMode, rect.width),
        deltaY: wheelDeltaToPixels(e.deltaY, e.deltaMode, rect.height),
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };

    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureLikeEvent;
      if (!Number.isFinite(g.scale) || g.scale <= 0) return;
      const ratio = g.scale / lastScale;
      lastScale = g.scale;
      const point =
        Number.isFinite(g.clientX) && Number.isFinite(g.clientY)
          ? localPoint(g.clientX, g.clientY)
          : { x: el.clientWidth / HALF, y: el.clientHeight / HALF };
      controllerRef.current.zoomBy(point, ratio);
    };
    const onGestureEnd = (e: Event) => e.preventDefault();

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
  }, []);

  // Ctrl/Cmd + = / - / 0 zoom the board, never the page.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isEditableTarget(e.target)) return;
      const c = controllerRef.current;
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault();
        c.zoomStep('in');
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        c.zoomStep('out');
      } else if (e.key === '0' || e.code === 'Numpad0') {
        e.preventDefault();
        c.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Escape during a marquee discards it; the selection stays as it was (not cleared).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modeRef.current !== 'marquee') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pointerIdRef.current = null;
      pressStartRef.current = null;
      marqueeRef.current?.cancel();
      setMode('idle');
      modeRef.current = 'idle';
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = elementRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const stopPanning = () => {
    if (pointerIdRef.current === null) return;
    pointerIdRef.current = null;
    controllerRef.current.endPan();
    setMode('idle');
    modeRef.current = 'idle';
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only empty board space starts a pan; objects in later stories handle their own presses.
    if (e.target !== elementRef.current) return;
    if (e.button !== PRIMARY_BUTTON || pointerIdRef.current !== null) return;
    pointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Capture can fail if the pointer is already gone; the drag still works in-window.
    }
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    pressMovedRef.current = false;
    onEmptyPointerDown?.();
    if (e.shiftKey && marquee) {
      marquee.begin(localPoint(e));
      setMode('marquee');
      modeRef.current = 'marquee';
      return;
    }
    controller.beginPan({ x: e.clientX, y: e.clientY });
    setMode('panning');
    modeRef.current = 'panning';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    if (modeRef.current === 'marquee') {
      marqueeRef.current?.move(localPoint(e));
      return;
    }
    const start = pressStartRef.current;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= DRAG_THRESHOLD_PX) {
      pressMovedRef.current = true;
    }
    controller.panMove({ x: e.clientX, y: e.clientY });
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    if (modeRef.current === 'marquee') {
      pointerIdRef.current = null;
      pressStartRef.current = null;
      if (e.type === 'pointerup') {
        marqueeRef.current?.move(localPoint(e));
        marqueeRef.current?.end();
      } else {
        marqueeRef.current?.cancel();
      }
      setMode('idle');
      modeRef.current = 'idle';
      return;
    }
    const isClick = e.type === 'pointerup' && !pressMovedRef.current;
    pressStartRef.current = null;
    stopPanning();
    if (isClick) onEmptyClick?.();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Double-clicks on objects are handled (and stopped) by the objects themselves.
    if (e.target !== elementRef.current || !onEmptyDoubleClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onEmptyDoubleClick({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Dots sit at the centre of each background tile; offset by half a tile so
  // world multiples of the grid spacing land exactly on dots.
  const gridX = positiveModulo(-camera.x * camera.zoom, spacing) - spacing / HALF;
  const gridY = positiveModulo(-camera.y * camera.zoom, spacing) - spacing / HALF;
  const gridStyle: CSSProperties = {
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${gridX}px ${gridY}px`,
  };
  const worldStyle: CSSProperties = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
    transformOrigin: '0 0',
  };

  return (
    <div
      ref={elementRef}
      className={`board-viewport board-viewport--${mode}`}
      data-testid="board-viewport"
      data-mode={mode}
      role="application"
      aria-label="Board"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onDoubleClick={onDoubleClick}
      style={gridStyle}
    >
      <div className="board-world" data-testid="board-world" style={worldStyle}>
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
