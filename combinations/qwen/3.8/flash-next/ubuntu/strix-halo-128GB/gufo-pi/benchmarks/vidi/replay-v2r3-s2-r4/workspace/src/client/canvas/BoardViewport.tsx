import React, { useRef, useEffect, useCallback } from 'react';
import type { Size } from './camera';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';

export interface BoardViewportProps {
  children?: React.ReactNode;
  camera: { x: number; y: number; zoom: number };
  onBeginPan(p: { x: number; y: number }): void;
  onPanMove(p: { x: number; y: number }): void;
  onEndPan(): void;
  onWheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: { x: number; y: number } }): void;
  onGestureZoom(scale: number, point: { x: number; y: number }): void;
  /** Pointer released on empty board space without dragging (clears the selection). */
  onEmptyClick?(p: { x: number; y: number }): void;
  /** Double-click on empty board space (creates a sticky note there). */
  onEmptyDblClick?(p: { x: number; y: number }): void;
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
  onEmptyClick,
  onEmptyDblClick,
  dataTestId,
}: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const emptyDownRef = useRef<{ x: number; y: number } | null>(null);
  const emptyMovedRef = useRef(false);

  const getPoint = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: e.clientX, y: e.clientY };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const isEmptyTarget = useCallback((target: EventTarget | null): boolean => {
    if (target !== viewportRef.current) {
      const el = target as HTMLElement | null;
      if (!el || !el.dataset.gridLayer) return false;
    }
    return true;
  }, []);

  /** Finish a press on empty space: a press without movement is an empty click. */
  const finishEmptyPress = useCallback(() => {
    const down = emptyDownRef.current;
    const moved = emptyMovedRef.current;
    emptyDownRef.current = null;
    emptyMovedRef.current = false;
    if (down && !moved) onEmptyClick?.(down);
  }, [onEmptyClick]);

  // Pointer handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!isEmptyTarget(e.target)) return;

    e.preventDefault();
    viewportRef.current?.setPointerCapture(e.pointerId);
    isPanningRef.current = true;
    const p = getPoint(e);
    emptyDownRef.current = p;
    emptyMovedRef.current = false;
    onBeginPan(p);
  }, [getPoint, isEmptyTarget, onBeginPan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    const p = getPoint(e);
    const down = emptyDownRef.current;
    if (down && !emptyMovedRef.current) {
      if (Math.hypot(p.x - down.x, p.y - down.y) >= DRAG_THRESHOLD_PX) {
        emptyMovedRef.current = true;
      }
    }
    onPanMove(p);
  }, [getPoint, onPanMove]);

  const handlePointerUp = useCallback(() => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    onEndPan();
    finishEmptyPress();
  }, [onEndPan, finishEmptyPress]);

  const handlePointerCancel = useCallback(() => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    onEndPan();
    emptyDownRef.current = null;
    emptyMovedRef.current = false;
  }, [onEndPan]);

  const handleLostPointerCapture = useCallback(() => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    onEndPan();
    finishEmptyPress();
  }, [onEndPan, finishEmptyPress]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!isEmptyTarget(e.target)) return;
    onEmptyDblClick?.(getPoint(e));
  }, [getPoint, isEmptyTarget, onEmptyDblClick]);

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
