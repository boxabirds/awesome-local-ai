import { useRef, useEffect, useCallback } from 'react';
import type { Camera, Point, Size } from './camera';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

const WHEEL_DELTA_LINE = 16;
const WHEEL_DELTA_PAGE = 100;

interface BoardViewportProps {
  camera: Camera;
  viewport: Size;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  children?: React.ReactNode;
}

export function BoardViewport({ camera, beginPan, panMove, endPan, wheel, children }: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const lastGestureScaleRef = useRef(1);

  // Wheel handler (non-passive)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      let deltaX = e.deltaX;
      let deltaY = e.deltaY;

      if (e.deltaMode === 1) { // LINE
        deltaX *= WHEEL_DELTA_LINE;
        deltaY *= WHEEL_DELTA_LINE;
      } else if (e.deltaMode === 2) { // PAGE
        deltaX *= WHEEL_DELTA_PAGE;
        deltaY *= WHEEL_DELTA_PAGE;
      }

      const rect = el.getBoundingClientRect();
      const point: Point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      wheel({ deltaX, deltaY, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [wheel]);

  // Safari gesture handlers
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleGestureStart = (e: Event) => {
      e.preventDefault();
      lastGestureScaleRef.current = 1;
    };

    const handleGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as { clientX: number; clientY: number; scale: number };
      const rect = el.getBoundingClientRect();
      const point: Point = {
        x: ge.clientX - rect.left,
        y: ge.clientY - rect.top,
      };
      const factor = ge.scale / lastGestureScaleRef.current;
      lastGestureScaleRef.current = ge.scale;

      wheel({
        deltaX: 0,
        deltaY: -Math.log(factor) / WHEEL_ZOOM_SENSITIVITY,
        ctrlOrMeta: true,
        point,
      });
    };

    const handleGestureEnd = (e: Event) => {
      e.preventDefault();
      lastGestureScaleRef.current = 1;
    };

    el.addEventListener('gesturestart', handleGestureStart as EventListener);
    el.addEventListener('gesturechange', handleGestureChange as EventListener);
    el.addEventListener('gestureend', handleGestureEnd as EventListener);
    return () => {
      el.removeEventListener('gesturestart', handleGestureStart as EventListener);
      el.removeEventListener('gesturechange', handleGestureChange as EventListener);
      el.removeEventListener('gestureend', handleGestureEnd as EventListener);
    };
  }, [wheel]);

  // Pointer handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const isBoardTarget = target === viewportRef.current || target.dataset.boardSurface === 'true';
    if (!isBoardTarget) return;

    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isPanningRef.current = true;

    const rect = viewportRef.current!.getBoundingClientRect();
    const point: Point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    beginPan(point);
  }, [beginPan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;

    const rect = viewportRef.current!.getBoundingClientRect();
    const point: Point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    panMove(point);
  }, [panMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    endPan();
  }, [endPan]);

  const handlePointerCancel = useCallback((_e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    endPan();
  }, [endPan]);

  // Compute grid background
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const bgPosX = -(camera.x * camera.zoom) % spacing;
  const bgPosY = -(camera.y * camera.zoom) % spacing;

  return (
    <div
      ref={viewportRef}
      data-testid="board-viewport"
      data-board-surface="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: 'grab',
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgPosX}px ${bgPosY}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {/* Origin marker at world (0,0) */}
        <div
          data-testid="origin-marker"
          style={{
            position: 'absolute',
            left: -6,
            top: -6,
            width: 12,
            height: 12,
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'absolute', left: 5, top: 0, width: 2, height: 12, background: '#999' }} />
          <div style={{ position: 'absolute', left: 0, top: 5, width: 12, height: 2, background: '#999' }} />
        </div>
        {children}
      </div>
    </div>
  );
}
