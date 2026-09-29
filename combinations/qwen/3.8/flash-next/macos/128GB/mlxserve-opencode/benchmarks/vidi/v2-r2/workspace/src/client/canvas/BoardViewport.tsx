import { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, Point } from './camera';
import { GRID_SPACING_WORLD } from '../../shared/config';

const LINE_HEIGHT = 16;
const PAGE_HEIGHT = 800;

interface BoardViewportProps {
  camera: Camera;
  onPointerDown(p: Point): void;
  onPointerMove(p: Point): void;
  onPointerUp(): void;
  onWheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  onGestureStart(): void;
  onGestureChange(scale: number, point: Point): void;
}

export function BoardViewport({
  camera,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onGestureStart,
  onGestureChange,
}: BoardViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const panStateRef = useRef(false);

  // Use refs for callbacks to avoid stale closures in addEventListener
  const onPointerDownRef = useRef(onPointerDown);
  onPointerDownRef.current = onPointerDown;
  const onPointerMoveRef = useRef(onPointerMove);
  onPointerMoveRef.current = onPointerMove;
  const onPointerUpRef = useRef(onPointerUp);
  onPointerUpRef.current = onPointerUp;
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onGestureChangeRef = useRef(onGestureChange);
  onGestureChangeRef.current = onGestureChange;

  // Pointer handlers (React synthetic events are fine here)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    // Only start drag on the viewport background, not on UI elements
    if (target.closest('[data-ui-overlay]')) return;
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    panStateRef.current = true;
    setPanning(true);
    onPointerDownRef.current({ x: e.clientX, y: e.clientY });
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!panStateRef.current) return;
    onPointerMoveRef.current({ x: e.clientX, y: e.clientY });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!panStateRef.current) return;
    const el = containerRef.current;
    if (el) {
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
    panStateRef.current = false;
    setPanning(false);
    onPointerUpRef.current();
  }, []);

  const handlePointerCancel = useCallback(() => {
    panStateRef.current = false;
    setPanning(false);
    onPointerUpRef.current();
  }, []);

  const handleLostPointerCapture = useCallback(() => {
    panStateRef.current = false;
    setPanning(false);
    onPointerUpRef.current();
  }, []);

  // Wheel listener (non-passive) — attached directly to avoid React passive issue
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Don't interfere with UI overlays
      if ((e.target as HTMLElement).closest('[data-ui-overlay]')) return;
      e.preventDefault();
      let deltaX = e.deltaX;
      let deltaY = e.deltaY;
      if (e.deltaMode === 1) { // LINE
        deltaX *= LINE_HEIGHT;
        deltaY *= LINE_HEIGHT;
      } else if (e.deltaMode === 2) { // PAGE
        deltaX *= PAGE_HEIGHT;
        deltaY *= PAGE_HEIGHT;
      }
      const rect = el.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      onWheelRef.current({ deltaX, deltaY, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Safari gesture events
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onStart = (e: Event) => {
      e.preventDefault();
      onGestureStartRef.current();
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const ge = e as any;
      const scale = ge.scale || 1;
      const rect = el.getBoundingClientRect();
      const point = {
        x: (ge.clientX || rect.width / 2) - rect.left,
        y: (ge.clientY || rect.height / 2) - rect.top,
      };
      onGestureChangeRef.current(scale, point);
    };
    el.addEventListener('gesturestart', onStart as EventListener, { passive: false });
    el.addEventListener('gesturechange', onChange as EventListener, { passive: false });
    return () => {
      el.removeEventListener('gesturestart', onStart as EventListener);
      el.removeEventListener('gesturechange', onChange as EventListener);
    };
  }, []);

  // Grid background
  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const posX = ((-camera.x * camera.zoom) % gridSpacing + gridSpacing) % gridSpacing;
  const posY = ((-camera.y * camera.zoom) % gridSpacing + gridSpacing) % gridSpacing;

  // World layer transform
  const worldTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

  // Origin marker screen position
  const originScreenX = (0 - camera.x) * camera.zoom;
  const originScreenY = (0 - camera.y) * camera.zoom;

  return (
    <div
      ref={containerRef}
      data-role="viewport"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        backgroundImage: `radial-gradient(circle, #aaa 1px, transparent 1px)`,
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${posX}px ${posY}px`,
        cursor: panning ? 'grabbing' : 'default',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture as any}
    >
      {/* World layer */}
      <div
        data-role="world"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: worldTransform,
          transformOrigin: '0 0',
        }}
      />
      {/* Origin marker */}
      <div
        data-testid="origin-marker"
        style={{
          position: 'absolute',
          left: originScreenX - 6,
          top: originScreenY - 6,
          width: 12,
          height: 12,
          pointerEvents: 'none',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line x1="6" y1="0" x2="6" y2="12" stroke="#666" strokeWidth="1" />
          <line x1="0" y1="6" x2="12" y2="6" stroke="#666" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
