import { useRef, useEffect, useCallback, type JSX } from 'react';
import type { Camera, Point } from './camera';
import { GRID_SPACING_WORLD } from '../../shared/config';

export interface BoardViewportProps {
  children?: React.ReactNode;
  camera: Camera;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

export function BoardViewport(props: BoardViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const gestureScaleRef = useRef(1);

  // Pointer events for drag panning
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target !== containerRef.current && !target.dataset.grid) return;

      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      isPanningRef.current = true;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      props.beginPan({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [props.beginPan],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      props.panMove({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [props.panMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      props.endPan();
    },
    [props.endPan],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      props.endPan();
    },
    [props.endPan],
  );

  // Wheel event (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      let deltaX = e.deltaX;
      let deltaY = e.deltaY;

      if (e.deltaMode === 1) {
        deltaX *= 16;
        deltaY *= 16;
      } else if (e.deltaMode === 2) {
        deltaX *= 100;
        deltaY *= 100;
      }

      props.wheel({ deltaX, deltaY, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [props.wheel]);

  // Safari gesture events
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = 1;
    };

    const handleGestureChange = (e: Event) => {
      e.preventDefault();
      const gestureEvent = e as unknown as { scale: number };
      const scale = gestureEvent.scale;
      if (!scale || scale === gestureScaleRef.current) return;

      const factor = scale / gestureScaleRef.current;
      gestureScaleRef.current = scale;

      const rect = el.getBoundingClientRect();
      const center: Point = { x: rect.width / 2, y: rect.height / 2 };
      const deltaY = -Math.log(factor) / 0.01;
      props.wheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point: center });
    };

    const handleGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = 1;
    };

    el.addEventListener('gesturestart', handleGestureStart);
    el.addEventListener('gesturechange', handleGestureChange);
    el.addEventListener('gestureend', handleGestureEnd);
    return () => {
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
      el.removeEventListener('gestureend', handleGestureEnd);
    };
  }, [props.wheel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        props.zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        props.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        props.reset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [props.zoomStep, props.reset]);

  // Compute grid background
  const spacing = GRID_SPACING_WORLD * props.camera.zoom;
  const bgX = -((props.camera.x * props.camera.zoom) % spacing);
  const bgY = -((props.camera.y * props.camera.zoom) % spacing);

  return (
    <div
      ref={containerRef}
      data-testid="board-viewport"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'grab',
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        backgroundColor: '#fafafa',
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
          width: '100%',
          height: '100%',
          transform: `scale(${props.camera.zoom}) translate(${-props.camera.x}px, ${-props.camera.y}px)`,
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
          <div
            style={{
              position: 'absolute',
              left: 7,
              top: 0,
              width: 2,
              height: 16,
              backgroundColor: '#999',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 7,
              width: 16,
              height: 2,
              backgroundColor: '#999',
            }}
          />
        </div>
        {props.children}
      </div>
    </div>
  );
}
