import * as React from 'react';
import type { Point, Size } from './camera';
import { GRID_SPACING_WORLD, LINE_TO_PIXELS, PAGE_TO_PIXELS } from '../../shared/config';

export interface UseCameraReturn {
  camera: { x: number; y: number; zoom: number };
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(dX: number, dY: number): void;
  endPan(): void;
  wheel(deltaX: number, deltaY: number, ctrlOrMeta: boolean, point: Point): void;
  gestureZoom(scale: number, point: Point): void;
}

interface BoardViewportProps {
  camera: { x: number; y: number; zoom: number };
  useCameraHook: UseCameraReturn;
  children?: React.ReactNode;
}

/**
 * DotGridBackground – creates a repeating dot pattern overlay
 * that moves with the camera via background-size and background-position.
 */
function DotGridBackground({ camera }: { camera: { x: number; y: number; zoom: number } }) {
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Position so the grid appears attached to the board
  const posXM = (-camera.x * camera.zoom) % spacing;
  const posYM = (-camera.y * camera.zoom) % spacing;

  return (
    <>
      <style>{`
        .dot-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: radial-gradient(circle, #c0c0c0 1px, transparent 1px);
          background-size: ${spacing}px ${spacing}px;
          background-position: ${posXM}px ${posYM}px;
          background-repeat: repeat;
        }
        .world-layer {
          position: absolute;
          transform-origin: 0 0;
          width: 0;
          height: 0;
        }
        .origin-marker {
          position: absolute;
          left: -6px;
          top: -6px;
          width: 12px;
          height: 12px;
          pointer-events: none;
        }
        .origin-marker::before,
        .origin-marker::after {
          content: '';
          position: absolute;
          background: #ff4444;
        }
        .origin-marker::before {
          left: 5px; top: 0;
          width: 2px; height: 12px;
        }
        .origin-marker::after {
          top: 5px; left: 0;
          height: 2px; width: 12px;
        }
        .viewport {
          position: fixed;
          inset: 0;
          overflow: hidden;
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
        }
        .viewport.panning {
          cursor: grabbing;
        }
      `}</style>
      <div className="dot-grid" aria-hidden="true" />
    </>
  );
}

function OriginMarker() {
  return (
    <div className="origin-marker" aria-label="Origin (0, 0)" data-testid="origin-marker" />
  );
}

export function BoardViewport(props: BoardViewportProps): React.JSX.Element {
  const { camera, useCameraHook, children } = props;
  const [isPanning, setIsPanning] = React.useState(false);
  const lastPosRef = React.useRef<Point | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { beginPan, panMove, endPan, wheel, gestureZoom } = useCameraHook;

  // Pointer events for drag-to-pan
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      // Only start panning on empty space (the viewport/grid itself)
      // The target should be the viewport or its direct children (grid)
      // Stop propagation if it's something interactive (future objects)
      if (e.pointerType === 'touch') {
        return; // Out of scope: no touch support in story 1
      }
      // Only left mouse button or pen
      if (e.button !== 0 && e.pointerType !== 'pen') return;
      
      setIsPanning(true);
      beginPan({ x: e.clientX, y: e.clientY });
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      
      // Set pointer capture so we continue receiving move events even outside the element
      const el = containerRef.current;
      if (el) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Already captured or error – ignore
        }
      }
    },
    [beginPan],
  );

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning || !lastPosRef.current) return;
      
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      
      panMove(dx, dy);
    },
    [isPanning, panMove],
  );

  const handlePointerUp = React.useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      endPan();
    }
    lastPosRef.current = null;
  }, [isPanning, endPan]);

  const handleLostPointerCapture = React.useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      endPan();
    }
    lastPosRef.current = null;
  }, [isPanning, endPan]);

  // Wheel handler — attach with passive: false via ref effect
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      
      // Convert deltaMode to pixels
      let deltaX = e.deltaX;
      let deltaY = e.deltaY;
      if (e.deltaMode === 1) {
        // LINE mode
        deltaX *= LINE_TO_PIXELS;
        deltaY *= LINE_TO_PIXELS;
      } else if (e.deltaMode === 2) {
        // PAGE mode
        deltaX *= PAGE_TO_PIXELS;
        deltaY *= PAGE_TO_PIXELS;
      }
      
      // Get point relative to viewport
      const rect = el.getBoundingClientRect();
      const point: Point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      
      wheel(deltaX, deltaY, ctrlOrMeta, point);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [wheel]);

  // Safari gesture events (only available on WebKit)
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleGestureStart = (e: Event) => {
      (e as GestureEvent).preventDefault();
    };

    const handleGestureChange = (e: Event) => {
      (e as GestureEvent).preventDefault();
      const ge = e as GestureEvent;
      if (!Number.isFinite(ge.scale)) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      gestureZoom(ge.scale, { x: cx, y: cy });
    };

    el.addEventListener('gesturestart', handleGestureStart as EventListener);
    el.addEventListener('gesturechange', handleGestureChange as EventListener);
    return () => {
      el.removeEventListener('gesturestart', handleGestureStart as EventListener);
      el.removeEventListener('gesturechange', handleGestureChange as EventListener);
    };
  }, [gestureZoom]);

  const worldTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <>
      <DotGridBackground camera={camera} />
      <div
        ref={containerRef}
        className={`viewport${isPanning ? ' panning' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handleLostPointerCapture}
        onLostPointerCapture={handleLostPointerCapture}
        role="application"
        aria-label="Infinite whiteboard canvas"
      >
        <div className="world-layer" style={{ transform: worldTransform }}>
          <OriginMarker />
          {children}
        </div>
      </div>
    </>
  );
}
