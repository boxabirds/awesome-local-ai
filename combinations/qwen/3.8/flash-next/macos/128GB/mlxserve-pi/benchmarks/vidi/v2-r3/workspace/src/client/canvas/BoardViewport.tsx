import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from '../../shared/config';
import type { Camera, Point, Size } from './camera';
import type { WheelInput } from './useCamera';

/** deltaMode conversions to pixels (named constants per design). */
const PIXELS_PER_WHEEL_LINE = 16;
const PIXELS_PER_WHEEL_PAGE = 800;

/** Safari (WebKit) GestureEvent shape — not in the TS DOM lib. */
interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

export interface BoardViewportProps {
  children?: ReactNode;
  camera: Camera;
  onViewportSize(size: Size): void;
  onBeginPan(p: Point): void;
  onPanMove(p: Point): void;
  onEndPan(): void;
  onWheel(e: WheelInput): void;
  /** Zoom around a screen point by a factor (Safari gesture events). */
  onZoomAtPoint(point: Point, factor: number): void;
  onZoomStep(dir: 'in' | 'out'): void;
  onReset(): void;
  /** Double-click on empty board space: create something at that point. */
  onEmptyDblClick(point: Point): void;
  /** Click (press and release without dragging) on empty board space. */
  onEmptyClick(point: Point): void;
  /** Shift+drag marquee: begin, move, end, cancel. */
  onMarqueeBegin?(p: Point): void;
  onMarqueeMove?(p: Point): void;
  onMarqueeEnd?(): void;
  onMarqueeCancel?(): void;
  /**
   * The pointer the board shows over its own surface. 'text' is the Text tool
   * saying what a click here will become, which is the only thing the tool is
   * allowed to change about the board's appearance.
   */
  cursor?: 'default' | 'text';
  /**
   * While the Text tool is active, a press and release in the same spot places
   * text there — on empty board or on top of whatever object is already there,
   * because the tool is about where the words go, not about what is under them.
   * A drag is not a placement, and while the tool is active the board neither
   * pans nor marquees: a tool that also moved the board would be two tools.
   */
  onTextToolClick?(p: Point): void;
}

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

function gestureScale(e: Event): number {
  const scale = (e as GestureEventLike).scale;
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * The input surface and renderer of the infinite board:
 * - a dot grid drawn with a repeating CSS background that pans/zooms with
 *   the camera (its position is taken modulo the spacing so values stay
 *   small even a million units from the start),
 * - a world layer positioned with a single CSS transform,
 * - pointer-drag panning, non-passive wheel handling, Safari gesture
 *   zooming and Ctrl/Cmd + =/−/0 keyboard shortcuts.
 */
export function BoardViewport(props: BoardViewportProps) {
  const { camera } = props;
  const [panning, setPanning] = useState(false);
  const [marqueeing, setMarqueeing] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const downPointRef = useRef<Point | null>(null);
  const marqueeModeRef = useRef(false);
  const placingRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const propsRef = useRef(props);

  useEffect(() => {
    propsRef.current = props;
  });

  // Report the viewport size (ResizeObserver); camera x, y is unchanged by
  // resizes by design. getBoundingClientRect is used (not clientWidth) so
  // jsdom component tests can drive a deterministic size.
  useEffect(() => {
    const el = surfaceRef.current;
    if (el === null) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      propsRef.current.onViewportSize({ width: rect.width, height: rect.height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Wheel: attached natively with passive:false (React's onWheel is passive)
  // and preventDefault-ed for EVERY wheel over the board, so the page never
  // scrolls or zooms (zoom.no_page_zoom).
  useEffect(() => {
    const el = surfaceRef.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaMode === 1 ? PIXELS_PER_WHEEL_LINE : e.deltaMode === 2 ? PIXELS_PER_WHEEL_PAGE : 1;
      const deltaX = e.deltaX * factor;
      const deltaY = e.deltaY * factor;
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta && deltaX === 0 && deltaY === 0) return;
      propsRef.current.onWheel({ deltaX, deltaY, ctrlOrMeta, point: { x: e.clientX, y: e.clientY } });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Safari trackpad pinch arrives as gesturestart/gesturechange (GestureEvent).
  // Preventing these keeps the browser's page zoom from changing; each change
  // zooms the board around the pointer by the scale ratio.
  useEffect(() => {
    const el = surfaceRef.current;
    if (el === null) return;
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = gestureScale(e);
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = gestureScale(e);
      const ratio = scale / lastScale;
      lastScale = scale;
      if (Number.isFinite(ratio) && ratio > 0 && ratio !== 1) {
        const ge = e as GestureEventLike;
        const point = { x: ge.clientX ?? 0, y: ge.clientY ?? 0 };
        propsRef.current.onZoomAtPoint(point, ratio);
      }
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // Ctrl/Cmd + =/− zoom one step, Ctrl/Cmd + 0 resets; preventDefault stops
  // the browser's own page zoom shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        propsRef.current.onZoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        propsRef.current.onZoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        propsRef.current.onReset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const isBoardSurface = (e: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>): boolean =>
    e.target === e.currentTarget; // empty board space (the grid itself)

  /** Viewport-relative coordinates (the camera's screen space). */
  const relative = (clientX: number, clientY: number): Point => {
    const el = surfaceRef.current;
    if (el === null) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!isBoardSurface(e)) return;
    // The Text tool is deciding what this press means, so the board itself is
    // not going anywhere: no pan, no marquee, until the tool has been answered.
    if (propsRef.current.cursor === 'text') return;
    pointerIdRef.current = e.pointerId;
    downPointRef.current = relative(e.clientX, e.clientY);
    const el = surfaceRef.current;
    if (el !== null && typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone; drag just won't be captured */
      }
    }
    // Shift+drag on empty space starts a marquee (if handler provided).
    if (e.shiftKey && props.onMarqueeBegin !== undefined) {
      marqueeModeRef.current = true;
      setMarqueeing(true);
      props.onMarqueeBegin({ x: e.clientX, y: e.clientY });
    } else {
      marqueeModeRef.current = false;
      setPanning(true);
      props.onBeginPan({ x: e.clientX, y: e.clientY });
    }
  };

  /**
   * The Text tool's click is watched in the capturing phase, on the way *in*: an
   * object under the pointer takes the pointer for itself and stops the event
   * reaching the board, and the tool still has to know where it was pointed. This
   * is the one handler on the surface that is allowed to hear a click on an
   * object, and it hears nothing but this.
   */
  const onPlacePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (propsRef.current.cursor !== 'text' || !e.isPrimary) {
      placingRef.current = null;
      return;
    }
    placingRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  };

  const onPlacePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const down = placingRef.current;
    placingRef.current = null;
    if (down === null || down.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= DRAG_THRESHOLD_PX) return;
    propsRef.current.onTextToolClick?.(relative(e.clientX, e.clientY));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === null || e.pointerId !== pointerIdRef.current) return;
    if (marqueeModeRef.current && props.onMarqueeMove !== undefined) {
      props.onMarqueeMove({ x: e.clientX, y: e.clientY });
    } else {
      props.onPanMove({ x: e.clientX, y: e.clientY });
    }
  };

  const endDrag = (pointerId: number, up: Point | null, cancelled = false) => {
    if (pointerIdRef.current !== pointerId) return;
    const down = downPointRef.current;
    pointerIdRef.current = null;
    downPointRef.current = null;
    const wasMarquee = marqueeModeRef.current;
    marqueeModeRef.current = false;
    setPanning(false);
    setMarqueeing(false);
    const el = surfaceRef.current;
    if (el !== null && typeof el.releasePointerCapture === 'function') {
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
    }
    if (wasMarquee) {
      if (cancelled) {
        if (props.onMarqueeCancel !== undefined) props.onMarqueeCancel();
      } else {
        if (props.onMarqueeEnd !== undefined) props.onMarqueeEnd();
      }
      return;
    }
    // The board simply stays where it was at the moment of interruption.
    props.onEndPan();
    // A press and release in the same spot is a click on empty board space:
    // it clears the selection (a note drag stops propagation and gets here).
    if (up !== null && down !== null && Math.hypot(up.x - down.x, up.y - down.y) < DRAG_THRESHOLD_PX) {
      props.onEmptyClick(up);
    }
  };

  const { x, y, zoom } = camera;
  const spacing = GRID_SPACING_WORLD * zoom;
  const gridOffsetX = mod(-x * zoom, spacing);
  const gridOffsetY = mod(-y * zoom, spacing);

  return (
    <div
      ref={surfaceRef}
      className={`board-viewport${panning ? ' is-panning' : ''}${props.cursor === 'text' ? ' is-text-tool' : ''}`}
      data-testid="board-viewport"
      data-state={panning ? 'panning' : 'idle'}
      data-cursor={props.cursor === 'text' ? 'text' : undefined}
      style={{
        backgroundImage: 'radial-gradient(circle, rgba(20, 20, 30, 0.22) 1px, transparent 1.5px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerDownCapture={onPlacePointerDown}
      onPointerUpCapture={onPlacePointerUp}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e.pointerId, relative(e.clientX, e.clientY), false)}
      onPointerCancel={(e) => endDrag(e.pointerId, null, true)}
      onLostPointerCapture={(e) => endDrag(e.pointerId, null, true)}
      onDoubleClick={(e) => {
        // Only empty board space: a double-click on a note edits that note.
        if (!isBoardSurface(e)) return;
        props.onEmptyDblClick(relative(e.clientX, e.clientY));
      }}
    >
      <div
        className="world-layer"
        data-testid="world-layer"
        style={{ transform: `scale(${zoom}) translate(${-x}px, ${-y}px)`, transformOrigin: '0 0' }}
      >
        <span
          className="board-marker origin-marker"
          data-testid="origin-marker"
          aria-hidden="true"
          style={{ transform: `scale(${1 / zoom})` }}
        />
        {import.meta.env.MODE === 'test' ? (
          <span
            className="board-marker far-marker"
            data-testid="far-marker"
            aria-hidden="true"
            style={{
              left: `${UNBOUNDED_PAN_TESTED_EXTENT}px`,
              top: `${UNBOUNDED_PAN_TESTED_EXTENT}px`,
              transform: `scale(${1 / zoom})`,
            }}
          />
        ) : null}
        {props.children}
      </div>
    </div>
  );
}
