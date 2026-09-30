import { useRef, useEffect, useState } from 'react';
import type { Camera, Point, Size } from './camera';
import { GRID_SPACING_WORLD } from '../../shared/config';

interface BoardViewportProps {
  camera: Camera;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  children?: React.ReactNode;
}

export function BoardViewport({ camera, beginPan, panMove, endPan, wheel }: BoardViewportProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);

  // Non-passive wheel listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const LINE_HEIGHT = 16;
      const PAGE_HEIGHT = 100;
      const scale = e.deltaMode === 1 ? LINE_HEIGHT : e.deltaMode === 2 ? PAGE_HEIGHT : 1;
      const rect = el.getBoundingClientRect();
      const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      wheel({
        deltaX: e.deltaX * scale,
        deltaY: e.deltaY * scale,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point,
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [wheel]);

  // Safari gesture events
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastScale = 1;
    const gestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as { scale: number; clientX: number; clientY: number };
      const ratio = ge.scale / lastScale;
      lastScale = ge.scale;
      const rect = el.getBoundingClientRect();
      const point: Point = { x: ge.clientX - rect.left, y: ge.clientY - rect.top };
      const WHEEL_ZOOM_SENSITIVITY = 0.01;
      const deltaY = -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY;
      wheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point });
    };
    el.addEventListener('gesturestart', gestureStart);
    el.addEventListener('gesturechange', gestureChange);
    return () => {
      el.removeEventListener('gesturestart', gestureStart);
      el.removeEventListener('gesturechange', gestureChange);
    };
  }, [wheel]);

  // Keyboard shortcuts
  useEffect(() => {
    // Keyboard handlers are managed by the parent via zoomStep/reset
    // This is a no-op placeholder for future use
  }, []);

  // Pointer handlers (using native event listeners for reliability)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      isPanningRef.current = true;
      setIsPanning(true);
      lastPointRef.current = { x: e.clientX, y: e.clientY };
      beginPan({ x: e.clientX, y: e.clientY });
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isPanningRef.current || !lastPointRef.current) return;
      lastPointRef.current = { x: e.clientX, y: e.clientY };
      panMove({ x: e.clientX, y: e.clientY });
    };

    const onPointerUp = (_e: PointerEvent) => {
      isPanningRef.current = false;
      setIsPanning(false);
      lastPointRef.current = null;
      endPan();
    };

    const onPointerCancel = (_e: PointerEvent) => {
      isPanningRef.current = false;
      setIsPanning(false);
      lastPointRef.current = null;
      endPan();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [beginPan, panMove, endPan]);

  // Dot grid
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const bgX = ((-camera.x * camera.zoom) % spacing + spacing) % spacing;
  const bgY = ((-camera.y * camera.zoom) % spacing + spacing) % spacing;

  return (
    <div
      ref={containerRef}
      data-testid="board-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        cursor: isPanning ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
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
        {/* Origin crosshair marker at world (0,0) */}
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
      </div>
    </div>
  );
}
