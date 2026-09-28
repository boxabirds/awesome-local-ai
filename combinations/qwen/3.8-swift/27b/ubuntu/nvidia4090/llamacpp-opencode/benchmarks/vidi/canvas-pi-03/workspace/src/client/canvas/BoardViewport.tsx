import { useRef, useEffect, useCallback, type ReactNode, type JSX } from 'react';
import type { Camera, Point } from './camera';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

// Delta mode conversion constants
const LINE_HEIGHT = 16;
const PAGE_FACTOR = 0.9;

function convertDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT;
  if (deltaMode === 2) return delta * PAGE_FACTOR * window.innerHeight;
  return delta;
}

export interface BoardViewportProps {
  children?: ReactNode;
  camera: Camera;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  zoomStepIn: () => void;
  zoomStepOut: () => void;
  reset: () => void;
  setCamera: (cam: Camera) => void;
}

export function BoardViewport(props: BoardViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);

  // ResizeObserver (viewport size tracked for future use)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {});
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Use refs for the handlers to avoid stale closures in event listeners
  const camRef = useRef(props);
  camRef.current = props;

  // Pointer drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const container = containerRef.current;
    if (!container) return;
    if (target === container || target === worldRef.current) {
      container.setPointerCapture(e.pointerId);
      const rect = container.getBoundingClientRect();
      camRef.current.beginPan({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    camRef.current.panMove({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const container = containerRef.current;
    if (container) container.releasePointerCapture(e.pointerId);
    camRef.current.endPan();
  }, []);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    const container = containerRef.current;
    if (container) container.releasePointerCapture(e.pointerId);
    camRef.current.endPan();
  }, []);

  // Wheel handler (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const deltaX = convertDelta(e.deltaX, e.deltaMode);
      const deltaY = convertDelta(e.deltaY, e.deltaMode);
      camRef.current.wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Safari gesture handlers
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
      const ge = e as any;
      const scale = ge.scale as number;
      if (scale === 0) return;
      const ratio = scale / lastScale;
      lastScale = scale;
      const deltaY = -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY;
      camRef.current.wheel({
        deltaX: 0,
        deltaY,
        ctrlOrMeta: true,
        point: { x: 0, y: 0 },
      });
    };

    el.addEventListener('gesturestart', onGestureStart as any, { passive: false } as any);
    el.addEventListener('gesturechange', onGestureChange as any, { passive: false } as any);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart as any);
      el.removeEventListener('gesturechange', onGestureChange as any);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          camRef.current.zoomStepIn();
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          camRef.current.zoomStepOut();
        } else if (e.key === '0') {
          e.preventDefault();
          camRef.current.reset();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Expose test hook (only in test mode)
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      (window as any).__vidi6 = {
        setCamera: (c: any) => camRef.current.setCamera(c),
      };
    }
  }, []);

  // Compute grid style
  const { zoom, x: camX, y: camY } = props.camera;
  const gridSpacing = GRID_SPACING_WORLD * zoom;
  const gridOffsetX = ((-camX * zoom) % gridSpacing + gridSpacing) % gridSpacing;
  const gridOffsetY = ((-camY * zoom) % gridSpacing + gridSpacing) % gridSpacing;

  return (
    <div
      ref={containerRef}
      data-testid="board-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        cursor: 'grab',
        backgroundColor: '#f8f9fa',
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      <div
        ref={worldRef}
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: `scale(${zoom}) translate(${-camX}px, ${-camY}px)`,
          transformOrigin: '0 0',
        }}
      >
        <div
          data-testid="origin-marker"
          style={{
            position: 'absolute',
            left: -4,
            top: -4,
            width: 8,
            height: 8,
            border: '1px solid #666',
            borderRadius: '50%',
            pointerEvents: 'none',
          }}
        />
        {props.children}
      </div>
    </div>
  );
}
