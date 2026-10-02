import React, { useRef, useEffect, useCallback } from 'react';
import type { Size } from './camera';
import { GRID_SPACING_WORLD } from '../../shared/config';

export interface BoardViewportProps {
  children?: React.ReactNode;
  camera: { x: number; y: number; zoom: number };
  onBeginPan(p: { x: number; y: number }): void;
  onPanMove(p: { x: number; y: number }): void;
  onEndPan(): void;
  onWheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: { x: number; y: number } }): void;
  onGestureZoom(scale: number, point: { x: number; y: number }): void;
  /** Double-click on empty board space, at the viewport-local screen point. */
  onCreateAtScreenPoint?(point: { x: number; y: number }): void;
  /** A click (no drag) on empty board space: clear the selection. */
  onEmptyClick?(): void;
  dataTestId?: string;
}

export function BoardViewport({
  children,
  camera,
  onBeginPan,
  onPanMove,
  onEndPan,
  onWheel,
  onGestureZoom,
  onCreateAtScreenPoint,
  onEmptyClick,
  dataTestId,
}: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const movedRef = useRef(false);
  const downPointRef = useRef<{ x: number; y: number } | null>(null);

  const isEmptyTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return el === viewportRef.current || el.dataset.gridLayer === 'true';
  };

  const getPoint = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: e.clientX, y: e.clientY };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // Pointer handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (
      target !== viewportRef.current &&
      !target.dataset.gridLayer
    ) return;

    // No preventDefault(): it would suppress the browser's synthesized dblclick
    // (used to create sticky notes). Text selection is blocked via CSS user-select.
    viewportRef.current?.setPointerCapture(e.pointerId);
    isPanningRef.current = true;
    movedRef.current = false;
    const p = getPoint(e);
    downPointRef.current = p;
    onBeginPan(p);
  }, [getPoint, onBeginPan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    const p = getPoint(e);
    if (downPointRef.current) {
      const dist = Math.hypot(p.x - downPointRef.current.x, p.y - downPointRef.current.y);
      if (dist > 2) movedRef.current = true;
    }
    onPanMove(p);
  }, [getPoint, onPanMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    // A click (no pan movement) on empty board space clears the selection.
    if (!movedRef.current && isEmptyTarget(e.target)) onEmptyClick?.();
    onEndPan();
  }, [onEndPan, onEmptyClick]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // Only create when the double-click lands on empty board space; a
    // double-click on a note is handled (and stopped) by the note itself.
    if (!isEmptyTarget(e.target)) return;
    onCreateAtScreenPoint?.(getPoint(e));
  }, [getPoint, onCreateAtScreenPoint]);

  const handlePointerCancel = useCallback(() => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    onEndPan();
  }, [onEndPan]);

  const handleLostPointerCapture = useCallback(() => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    onEndPan();
  }, [onEndPan]);

  // Wheel handler (non-passive)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const point = getPoint(e);
      let dx = e.deltaX;
      let dy = e.deltaY;

      if (e.deltaMode === 1) {
        dx *= 16;
        dy *= 16;
      } else if (e.deltaMode === 2) {
        dx *= el.clientHeight;
        dy *= el.clientHeight;
      }

      onWheel({
        deltaX: dx,
        deltaY: dy,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point,
      });
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [getPoint, onWheel]);

  // Safari gesture events
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let lastGestureScale = 1;

    const handleGestureStart = (e: Event) => {
      e.preventDefault();
      lastGestureScale = 1;
    };

    const handleGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as any;
      const scale = gesture.scale;
      const ratio = scale / lastGestureScale;
      lastGestureScale = scale;
      const rect = el.getBoundingClientRect();
      const point = { x: gesture.clientX - rect.left, y: gesture.clientY - rect.top };
      onGestureZoom(ratio, point);
    };

    const handleGestureEnd = (e: Event) => {
      e.preventDefault();
    };

    el.addEventListener('gesturestart', handleGestureStart);
    el.addEventListener('gesturechange', handleGestureChange);
    el.addEventListener('gestureend', handleGestureEnd);
    return () => {
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
      el.removeEventListener('gestureend', handleGestureEnd);
    };
  }, [onGestureZoom]);

  // Compute dot grid background
  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const bgPosX = ((-camera.x * camera.zoom) % gridSpacing + gridSpacing) % gridSpacing;
  const bgPosY = ((-camera.y * camera.zoom) % gridSpacing + gridSpacing) % gridSpacing;

  const dotSize = Math.max(1, camera.zoom * 1.5);

  return (
    <div
      ref={viewportRef}
      data-testid={dataTestId ?? 'board-viewport'}
      data-panning={isPanningRef.current ? 'true' : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: isPanningRef.current ? 'grabbing' : 'default',
        backgroundColor: '#fafafa',
        backgroundImage: `radial-gradient(circle, #bbb ${dotSize}px, transparent ${dotSize}px)`,
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${bgPosX}px ${bgPosY}px`,
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
    >
      {/* Grid layer (pointer target) */}
      <div
        data-grid-layer="true"
        style={{ position: 'absolute', inset: 0 }}
      />
      {/* World layer */}
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          width: 0,
          height: 0,
        }}
      >
        {/* Origin marker crosshair */}
        <div
          data-testid="origin-marker"
          style={{
            position: 'absolute',
            left: -5,
            top: -0.5,
            width: 10,
            height: 1,
            backgroundColor: 'red',
          }}
        />
        <div
          data-testid="origin-marker-v"
          style={{
            position: 'absolute',
            left: -0.5,
            top: -5,
            width: 1,
            height: 10,
            backgroundColor: 'red',
          }}
        />
        {children}
      </div>
    </div>
  );
}
