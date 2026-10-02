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
  /** Double-click on empty board space (screen point). Story 2 creates a note here. */
  onDoubleClickBoard?(p: { x: number; y: number }): void;
  /** Release on empty board space without dragging (screen point). Clears selection. */
  onClickEmpty?(p: { x: number; y: number }): void;
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
  onDoubleClickBoard,
  onClickEmpty,
  dataTestId,
}: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);

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

    e.preventDefault();
    viewportRef.current?.setPointerCapture(e.pointerId);
    isPanningRef.current = true;
    const p = getPoint(e);
    pressStartRef.current = p;
    movedRef.current = false;
    onBeginPan(p);
  }, [getPoint, onBeginPan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    const p = getPoint(e);
    const start = pressStartRef.current;
    if (start && Math.hypot(p.x - start.x, p.y - start.y) >= DRAG_THRESHOLD_PX) {
      movedRef.current = true;
    }
    onPanMove(p);
  }, [getPoint, onPanMove]);

  const handlePointerUp = useCallback(() => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    const p = pressStartRef.current;
    const wasClick = !movedRef.current;
    pressStartRef.current = null;
    movedRef.current = false;
    onEndPan();
    if (wasClick && p) onClickEmpty?.(p);
  }, [onEndPan, onClickEmpty]);

  const handlePointerCancel = useCallback(() => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    pressStartRef.current = null;
    movedRef.current = false;
    onEndPan();
  }, [onEndPan]);

  const handleLostPointerCapture = useCallback(() => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    pressStartRef.current = null;
    movedRef.current = false;
    onEndPan();
  }, [onEndPan]);

  // Double-click on empty board space (sticky.create_dblclick).
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target !== viewportRef.current &&
      !target.dataset.gridLayer
    ) return;
    e.preventDefault();
    onDoubleClickBoard?.(getPoint(e));
  }, [getPoint, onDoubleClickBoard]);

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
