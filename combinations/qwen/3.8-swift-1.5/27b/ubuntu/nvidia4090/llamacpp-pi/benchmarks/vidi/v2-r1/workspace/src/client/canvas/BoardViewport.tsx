import { useRef, useEffect, useCallback, ReactNode } from 'react';
import { Camera, Point } from './camera';
import { GRID_SPACING_WORLD } from '@shared/config';

interface BoardViewportProps {
  camera: Camera;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  zoomAtPointer: (point: Point, factor: number) => void;
  zoomStep: (dir: 'in' | 'out') => void;
  reset: () => void;
  isPanning: boolean;
  children?: ReactNode;
}

const WHEEL_DELTA_LINE = 16;
const WHEEL_DELTA_PAGE = 100;

export function BoardViewport({
  camera,
  beginPan,
  panMove,
  endPan,
  wheel,
  zoomAtPointer,
  zoomStep,
  reset,
  isPanning,
  children,
}: BoardViewportProps) {
  const ref = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const getPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // Pointer events for drag panning
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Only start drag on the viewport/grid itself
    const target = e.target as HTMLElement;
    if (target !== ref.current && !target.classList.contains('board-grid')) return;
    draggingRef.current = true;
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      // jsdom doesn't support setPointerCapture
    }
    beginPan(getPoint(e));
  }, [beginPan, getPoint]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    panMove(getPoint(e));
  }, [panMove, getPoint]);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    endPan();
  }, [endPan]);

  const onPointerUp = useCallback((_e: React.PointerEvent) => {
    endDrag();
  }, [endDrag]);

  const onPointerCancel = useCallback((_e: React.PointerEvent) => {
    endDrag();
  }, [endDrag]);

  // Wheel event (non-passive to allow preventDefault)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      let dx = e.deltaX;
      let dy = e.deltaY;

      if (e.deltaMode === 1) { // DeltaMode.LINE
        dx *= WHEEL_DELTA_LINE;
        dy *= WHEEL_DELTA_LINE;
      } else if (e.deltaMode === 2) { // DeltaMode.PAGE
        dx *= WHEEL_DELTA_PAGE;
        dy *= WHEEL_DELTA_PAGE;
      }

      const rect = el.getBoundingClientRect();
      wheel({
        deltaX: dx,
        deltaY: dy,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [wheel]);

  // Safari gesture events
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let lastScale = 1;

    const handleGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };

    const handleGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as unknown as { scale: number; clientX: number; clientY: number };
      if (gesture.scale && gesture.scale !== lastScale) {
        const ratio = gesture.scale / lastScale;
        lastScale = gesture.scale;
        const rect = el.getBoundingClientRect();
        zoomAtPointer(
          { x: gesture.clientX - rect.left, y: gesture.clientY - rect.top },
          ratio,
        );
      }
    };

    el.addEventListener('gesturestart', handleGestureStart);
    el.addEventListener('gesturechange', handleGestureChange);
    return () => {
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
    };
  }, [zoomAtPointer]);

  // Keyboard shortcuts: Ctrl/Cmd + =, -, 0
  const zoomStepRef = useRef(zoomStep);
  const resetRef = useRef(reset);
  zoomStepRef.current = zoomStep;
  resetRef.current = reset;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStepRef.current('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomStepRef.current('out');
      } else if (e.key === '0') {
        e.preventDefault();
        resetRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Grid background calculation
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  // Background position: grid dots align with world coordinates
  const bgPosX = ((-camera.x * camera.zoom) % spacing + spacing) % spacing;
  const bgPosY = ((-camera.y * camera.zoom) % spacing + spacing) % spacing;

  return (
    <div
      ref={ref}
      className="board-viewport"
      data-testid="board-viewport"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : 'grab',
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgPosX}px ${bgPosY}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      <div
        className="board-grid"
        data-testid="board-grid"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
        }}
      />
      <div
        className="world-layer"
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {/* Origin marker (crosshair at world 0,0) */}
        <div
          data-testid="origin-marker"
          aria-label="Origin"
          style={{
            position: 'absolute',
            left: -4,
            top: -4,
            width: 8,
            height: 8,
            border: '1px solid #999',
            borderRadius: '50%',
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'absolute', left: 3, top: 0, width: 1, height: 8, background: '#999' }} />
          <div style={{ position: 'absolute', left: 0, top: 3, width: 8, height: 1, background: '#999' }} />
        </div>
        {children}
      </div>
    </div>
  );
}
