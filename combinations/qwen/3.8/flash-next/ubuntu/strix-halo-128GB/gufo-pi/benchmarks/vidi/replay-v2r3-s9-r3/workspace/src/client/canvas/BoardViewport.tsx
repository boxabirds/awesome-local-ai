import React, { useRef, useEffect, useCallback } from 'react';
import type { Size } from './camera';
import { GRID_SPACING_WORLD, DRAG_THRESHOLD_PX } from '../../shared/config';

export interface BoardViewportProps {
  children?: React.ReactNode;
  camera: { x: number; y: number; zoom: number };
  onBeginPan(p: { x: number; y: number }): void;
  onPanMove(p: { x: number; y: number }): void;
  onEndPan(): void;
  onWheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: { x: number; y: number } }): void;
  onGestureZoom(scale: number, point: { x: number; y: number }): void;
  /** A press on empty board space that did not turn into a pan. */
  onEmptyClick?(p: { x: number; y: number }): void;
  /** A double-click on empty board space (not on an object). */
  onEmptyDblClick?(p: { x: number; y: number }): void;
  /** Shift+drag on empty space: marquee selection. */
  onMarqueeBegin?(p: { x: number; y: number }): void;
  onMarqueeMove?(p: { x: number; y: number }): void;
  onMarqueeEnd?(): void;
  onMarqueeCancel?(): void;
  /** When true, cursor is 'text' and pointerdown does not pan or marquee. */
  textToolActive?: boolean;
  /** Called on any board click (including on objects) when text tool is active. */
  onTextToolClick?(p: { x: number; y: number }): void;
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
  onMarqueeBegin,
  onMarqueeMove,
  onMarqueeEnd,
  onMarqueeCancel,
  textToolActive = false,
  onTextToolClick,
  dataTestId,
}: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const isMarqueeRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const panMovedRef = useRef(false);
  const emptyClickRef = useRef(false);

  const isBoardSurface = useCallback((target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return el === viewportRef.current || el.dataset.gridLayer === 'true';
  }, []);

  const getPoint = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: e.clientX, y: e.clientY };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // Pointer handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Text tool: any pointerdown on the board surface creates text, no pan/marquee
    if (textToolActive) {
      e.preventDefault();
      const p = getPoint(e);
      onTextToolClick?.(p);
      return;
    }

    if (!isBoardSurface(e.target)) return;

    e.preventDefault();
    viewportRef.current?.setPointerCapture(e.pointerId);
    const p = getPoint(e);
    panStartRef.current = p;

    // Shift+drag on empty space starts marquee instead of pan
    if (e.shiftKey && onMarqueeBegin) {
      isMarqueeRef.current = true;
      onMarqueeBegin(p);
    } else {
      isPanningRef.current = true;
      emptyClickRef.current = true;
      panMovedRef.current = false;
      onBeginPan(p);
    }
  }, [getPoint, onBeginPan, onMarqueeBegin, isBoardSurface, textToolActive, onTextToolClick]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const p = getPoint(e);
    if (isMarqueeRef.current) {
      onMarqueeMove?.(p);
      return;
    }
    if (!isPanningRef.current) return;
    const start = panStartRef.current;
    if (start && Math.hypot(p.x - start.x, p.y - start.y) >= DRAG_THRESHOLD_PX) {
      panMovedRef.current = true;
    }
    onPanMove(p);
  }, [getPoint, onPanMove, onMarqueeMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (isMarqueeRef.current) {
      isMarqueeRef.current = false;
      onMarqueeEnd?.();
      return;
    }
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    const p = getPoint(e);
    onEndPan();
    // A press on empty space that never became a pan clears the selection.
    if (emptyClickRef.current && !panMovedRef.current) onEmptyClick?.(p);
    emptyClickRef.current = false;
  }, [getPoint, onEndPan, onEmptyClick, onMarqueeEnd]);

  const handlePointerCancel = useCallback(() => {
    if (isMarqueeRef.current) {
      isMarqueeRef.current = false;
      onMarqueeCancel?.();
      return;
    }
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    emptyClickRef.current = false;
    onEndPan();
  }, [onEndPan, onMarqueeCancel]);

  const handleLostPointerCapture = useCallback(() => {
    if (isMarqueeRef.current) {
      isMarqueeRef.current = false;
      onMarqueeCancel?.();
      return;
    }
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    emptyClickRef.current = false;
    onEndPan();
  }, [onEndPan, onMarqueeCancel]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!isBoardSurface(e.target)) return;
    onEmptyDblClick?.(getPoint(e));
  }, [getPoint, onEmptyDblClick, isBoardSurface]);

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
        cursor: textToolActive ? 'text' : (isPanningRef.current ? 'grabbing' : 'default'),
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
