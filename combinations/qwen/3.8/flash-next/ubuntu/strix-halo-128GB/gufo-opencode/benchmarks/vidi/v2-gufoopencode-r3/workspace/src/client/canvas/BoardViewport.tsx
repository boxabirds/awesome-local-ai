import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import type { MarqueeController } from '../board/Marquee';
import type { Point } from './camera';
import { useBoardCamera } from './useCamera';

export interface BoardViewportProps {
  children?: ReactNode;
  // Double-click on empty board space (not on an object): world creation hook.
  onDoubleClickEmpty?(screenPoint: Point): void;
  // Press and release on empty board space without dragging.
  onEmptyClick?(): void;
  // Shift+drag on empty space selects objects with a marquee (story 7);
  // without it, Shift+drag pans like everything else.
  marquee?: MarqueeController;
}

interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

const DOT_RADIUS_PX = 1;

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export function BoardViewport({ children, onDoubleClickEmpty, onEmptyClick, marquee }: BoardViewportProps) {
  const board = useBoardCamera();
  const { camera } = board;
  const rootRef = useRef<HTMLDivElement>(null);
  const panningRef = useRef(false);
  const marqueeRef = useRef(false);
  const panStartRef = useRef<Point | null>(null);
  const panMovedRef = useRef(false);
  const gestureScaleRef = useRef(1);
  const [panning, setPanning] = useState(false);

  const stopPanning = () => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    board.endPan();
    if (!panMovedRef.current) onEmptyClick?.();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Only start a drag on the board surface itself; board objects added in
    // later stories stop propagation (and are not pan surfaces).
    const target = e.target as HTMLElement;
    if (target.dataset.panSurface !== 'true') return;
    if (marquee !== undefined && e.shiftKey) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // jsdom lacks pointer capture; events still reach this element.
      }
      marqueeRef.current = true;
      marquee.begin({ x: e.clientX, y: e.clientY });
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom and older engines lack pointer capture; dragging still works
      // while the pointer stays inside the viewport.
    }
    panningRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY };
    panMovedRef.current = false;
    setPanning(true);
    board.beginPan({ x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeRef.current) {
      marquee?.move({ x: e.clientX, y: e.clientY });
      return;
    }
    if (!panningRef.current) return;
    const start = panStartRef.current;
    if (
      start !== null &&
      !panMovedRef.current &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) >= DRAG_THRESHOLD_PX
    ) {
      panMovedRef.current = true;
    }
    board.panMove({ x: e.clientX, y: e.clientY });
  };

  const endMarquee = (commit: boolean) => {
    if (!marqueeRef.current) return;
    marqueeRef.current = false;
    if (commit) marquee?.end();
    else marquee?.cancel();
  };

  const onPointerUp = () => {
    if (marqueeRef.current) {
      endMarquee(true);
      return;
    }
    stopPanning();
  };

  const onPointerCancelOrLost = () => {
    if (marqueeRef.current) {
      endMarquee(false);
      return;
    }
    stopPanning();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Objects stop propagation; anything reaching here is empty board space.
    if (target.dataset.panSurface !== 'true') return;
    onDoubleClickEmpty?.({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;

    // React's onWheel is passive; attach natively so preventDefault can stop
    // page scroll and page zoom (zoom.no_page_zoom).
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      board.wheel({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX, y: e.clientY }
      });
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = (e as GestureEventLike).scale ?? 1;
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as GestureEventLike;
      const scale = gesture.scale ?? 1;
      const previous = gestureScaleRef.current || 1;
      gestureScaleRef.current = scale;
      board.zoomAtPointer(
        { x: gesture.clientX ?? 0, y: gesture.clientY ?? 0 },
        scale / previous
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+' || e.code === 'Equal') {
        e.preventDefault();
        board.zoomStep('in');
      } else if (e.key === '-' || e.key === '_' || e.code === 'Minus') {
        e.preventDefault();
        board.zoomStep('out');
      } else if (e.key === '0' || e.code === 'Digit0') {
        e.preventDefault();
        board.reset();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [board]);

  const gridSpacingPx = GRID_SPACING_WORLD * camera.zoom;
  const gridPositionX = mod(-camera.x * camera.zoom, gridSpacingPx);
  const gridPositionY = mod(-camera.y * camera.zoom, gridSpacingPx);

  return (
    <div
      ref={rootRef}
      data-testid="board-viewport"
      data-pan-surface="true"
      {...(panning ? { 'data-panning': 'true' } : {})}
      className="board-viewport"
      style={{
        cursor: panning ? 'grabbing' : 'grab',
        backgroundImage: `radial-gradient(circle, #c3cad4 ${DOT_RADIUS_PX}px, transparent ${DOT_RADIUS_PX}px)`,
        backgroundSize: `${gridSpacingPx}px ${gridSpacingPx}px`,
        backgroundPosition: `${gridPositionX}px ${gridPositionY}px`
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancelOrLost}
      onLostPointerCapture={onPointerCancelOrLost}
      onDoubleClick={onDoubleClick}
    >
      <div
        data-testid="world-layer"
        className="board-world"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`
        }}
      >
        <div data-testid="origin-marker" className="board-origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
