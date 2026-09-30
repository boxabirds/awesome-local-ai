import { useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Point, Camera } from './camera';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

interface BoardViewportProps {
  camera: Camera;
  isPanning: boolean;
  onPointerDown: (p: Point) => void;
  onPointerMove: (p: Point) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onWheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  onKeyZoomIn: () => void;
  onKeyZoomOut: () => void;
  onKeyReset: () => void;
  children?: ReactNode;
}

const WHEEL_LINE_DELTA_PX = 16;
const WHEEL_PAGE_DELTA_PX = 120;

export function BoardViewport({
  camera,
  isPanning,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  onKeyZoomIn,
  onKeyZoomOut,
  onKeyReset,
  children,
}: BoardViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);

  // Pointer drag
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button != null && e.button !== 0) return;
      // Only start pan when the target is the viewport or grid
      const target = e.target as HTMLElement;
      if (target !== containerRef.current && !target.classList.contains('board-grid')) {
        // Allow if it's a direct child of the viewport (like the world layer)
        // but not if it's a control
        if (target.closest('[data-testid="zoom-controls"]')) return;
        if (target.closest('[data-testid="navigation-hint"]')) return;
      }
      isPanningRef.current = true;
      try {
        containerRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // jsdom doesn't support pointer capture
      }
      onPointerDown({ x: e.clientX, y: e.clientY });
    },
    [onPointerDown]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      onPointerMove({ x: e.clientX, y: e.clientY });
    },
    [onPointerMove]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      onPointerUp();
    },
    [onPointerUp]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      onPointerCancel();
    },
    [onPointerCancel]
  );

  // Wheel (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      let dx = e.deltaX;
      let dy = e.deltaY;

      if (e.deltaMode === 1) {
        dx *= WHEEL_LINE_DELTA_PX;
        dy *= WHEEL_LINE_DELTA_PX;
      } else if (e.deltaMode === 2) {
        dx *= WHEEL_PAGE_DELTA_PX;
        dy *= WHEEL_PAGE_DELTA_PX;
      }

      const rect = el.getBoundingClientRect();
      const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      onWheel({ deltaX: dx, deltaY: dy, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [onWheel]);

  // Safari gesture events
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let lastScale = 1;

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as unknown as { scale: number; clientX: number; clientY: number };
      const scaleRatio = gesture.scale / lastScale;
      lastScale = gesture.scale;

      const rect = el.getBoundingClientRect();
      const point: Point = {
        x: (gesture.clientX || 0) - rect.left,
        y: (gesture.clientY || 0) - rect.top,
      };

      const deltaY = -Math.log(scaleRatio) / WHEEL_ZOOM_SENSITIVITY;
      onWheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point });
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
  }, [onWheel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        onKeyZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        onKeyZoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        onKeyReset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onKeyZoomIn, onKeyZoomOut, onKeyReset]);

  // Compute grid background
  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const gridOffsetX = -((camera.x * camera.zoom) % gridSpacing);
  const gridOffsetY = -((camera.y * camera.zoom) % gridSpacing);

  const worldTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <div
      ref={containerRef}
      className="board-viewport"
      data-testid="board-viewport"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        cursor: isPanning ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Dot grid */}
      <div
        className="board-grid"
        data-testid="board-grid"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
          backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
          backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
          pointerEvents: 'none',
        }}
      />

      {/* World layer */}
      <div
        className="world-layer"
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: worldTransform,
          transformOrigin: '0 0',
        }}
      >
        {/* Origin marker (crosshair at world 0,0) */}
        <div
          data-testid="origin-marker"
          style={{
            position: 'absolute',
            left: -8,
            top: -8,
            width: 16,
            height: 16,
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'absolute', left: 7, top: 0, width: 2, height: 16, background: '#999' }} />
          <div style={{ position: 'absolute', left: 0, top: 7, width: 16, height: 2, background: '#999' }} />
        </div>

        {children}
      </div>
    </div>
  );
}
