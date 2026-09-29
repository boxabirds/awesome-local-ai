import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Camera, Point, Size } from './camera';
import { GRID_SPACING_WORLD } from '@shared/config';

const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;
const LINE_HEIGHT = 16;
const PAGE_HEIGHT = 800;

export interface BoardViewportProps {
  camera: Camera;
  children?: React.ReactNode;
  beginPan?(p: Point): void;
  panMove?(p: Point): void;
  endPan?(): void;
  wheel?(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  gestureZoom?(scale: number, point: Point): void;
}

export function BoardViewport({
  camera,
  children,
  beginPan,
  panMove,
  endPan,
  wheel,
  gestureZoom,
}: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);

  // Wheel handler with passive: false
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !wheel) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      let deltaX = e.deltaX;
      let deltaY = e.deltaY;
      if (e.deltaMode === DELTA_MODE_LINE) {
        deltaX *= LINE_HEIGHT;
        deltaY *= LINE_HEIGHT;
      } else if (e.deltaMode === DELTA_MODE_PAGE) {
        deltaX *= PAGE_HEIGHT;
        deltaY *= PAGE_HEIGHT;
      }
      const rect = el.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      wheel({ deltaX, deltaY, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [wheel]);

  // Safari gesture events
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !gestureZoom) return;
    let lastGestureScale = 1;

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastGestureScale = 1;
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gestureEvent = e as any;
      const scale = gestureEvent.scale;
      if (scale !== undefined) {
        const ratio = scale / lastGestureScale;
        lastGestureScale = scale;
        const rect = el.getBoundingClientRect();
        const cx = gestureEvent.clientX ?? (rect.left + rect.width / 2);
        const cy = gestureEvent.clientY ?? (rect.top + rect.height / 2);
        const point = { x: cx - rect.left, y: cy - rect.top };
        gestureZoom(ratio, point);
      }
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
    };

    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [gestureZoom]);

  // Pointer events for panning
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const el = viewportRef.current;
    if (!el || !beginPan) return;
    const target = e.target as HTMLElement;
    // Only start pan if target is viewport or world layer or grid
    if (
      target !== el &&
      !target.classList.contains('board-world-layer') &&
      !target.classList.contains('board-grid') &&
      !target.closest('.board-grid')
    ) {
      return;
    }
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    pointerIdRef.current = e.pointerId;
    isPanningRef.current = true;
    beginPan({ x: e.clientX, y: e.clientY });
  }, [beginPan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current || e.pointerId !== pointerIdRef.current) return;
    if (panMove) panMove({ x: e.clientX, y: e.clientY });
  }, [panMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== pointerIdRef.current) return;
    isPanningRef.current = false;
    pointerIdRef.current = null;
    if (endPan) endPan();
  }, [endPan]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== pointerIdRef.current) return;
    isPanningRef.current = false;
    pointerIdRef.current = null;
    if (endPan) endPan();
  }, [endPan]);

  // Grid background computation
  const gridSpacingPx = GRID_SPACING_WORLD * camera.zoom;
  const bgPosX = ((-camera.x * camera.zoom) % gridSpacingPx + gridSpacingPx) % gridSpacingPx;
  const bgPosY = ((-camera.y * camera.zoom) % gridSpacingPx + gridSpacingPx) % gridSpacingPx;

  const gridStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'radial-gradient(circle, #bbb 1px, transparent 1px)',
    backgroundSize: `${gridSpacingPx}px ${gridSpacingPx}px`,
    backgroundPosition: `${bgPosX}px ${bgPosY}px`,
    pointerEvents: 'none',
  };

  const worldStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
    transformOrigin: '0 0',
    width: 0,
    height: 0,
  };

  return (
    <div
      ref={viewportRef}
      data-testid="board-viewport"
      className="board-viewport"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: 'grab',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerUp}
    >
      <div className="board-grid" style={gridStyle} data-testid="board-grid" />
      <div
        className="board-world-layer"
        style={worldStyle}
        data-testid="world-layer"
        data-camera-x={camera.x}
        data-camera-y={camera.y}
        data-camera-zoom={camera.zoom}
      >
        <div
          data-testid="origin-marker"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '20px',
            height: '20px',
            marginLeft: '-10px',
            marginTop: '-10px',
            pointerEvents: 'none',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20">
            <line x1="10" y1="0" x2="10" y2="20" stroke="#666" strokeWidth="1" />
            <line x1="0" y1="10" x2="20" y2="10" stroke="#666" strokeWidth="1" />
            <circle cx="10" cy="10" r="3" fill="none" stroke="#666" strokeWidth="1" />
          </svg>
        </div>
        {children}
      </div>
    </div>
  );
}
