import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GRID_SPACING_WORLD } from '../../shared/config';
import { useBoardCamera } from './useCamera';

interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

const DOT_RADIUS_PX = 1;

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export function BoardViewport({ children }: { children?: ReactNode }) {
  const board = useBoardCamera();
  const { camera } = board;
  const rootRef = useRef<HTMLDivElement>(null);
  const panningRef = useRef(false);
  const gestureScaleRef = useRef(1);
  const [panning, setPanning] = useState(false);

  const stopPanning = () => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    board.endPan();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Only start a drag on the board surface itself; board objects added in
    // later stories stop propagation (and are not pan surfaces).
    const target = e.target as HTMLElement;
    if (target.dataset.panSurface !== 'true') return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom and older engines lack pointer capture; dragging still works
      // while the pointer stays inside the viewport.
    }
    panningRef.current = true;
    setPanning(true);
    board.beginPan({ x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    board.panMove({ x: e.clientX, y: e.clientY });
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
      onPointerUp={stopPanning}
      onPointerCancel={stopPanning}
      onLostPointerCapture={stopPanning}
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
