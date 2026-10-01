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
  dataTestId?: string;
  /** Active tool (story 9+): affects cursor and pointer handling. */
  tool?: 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';
  /** Called on any click (including on objects) when Text tool is active. */
  onTextToolClick?(p: { x: number; y: number }): void;
  /** Callback when pointerdown on board surface while a creation tool is active (shape/connector). */
  onToolPointerDown?(p: { x: number; y: number; shiftKey: boolean }): void;
  /** Callback for pointermove while tool gesture active. */
  onToolPointerMove?(p: { x: number; y: number; shiftKey: boolean }): void;
  /** Callback for pointerup while tool gesture active. */
  onToolPointerUp?(p: { x: number; y: number }): void;
  /** Callback for pointerleave while tool gesture active. */
  onToolPointerCancel?(): void;
  /** Connector hover dots to render (screen-space). */
  connectorDots?: Array<{ side: string; screenX: number; screenY: number; highlighted: boolean }>;
  /** Connector drag line to render (screen-space). */
  connectorDragLine?: { fromX: number; fromY: number; toX: number; toY: number } | null;
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
  dataTestId,
  tool,
  onTextToolClick,
  onToolPointerDown,
  onToolPointerMove,
  onToolPointerUp,
  onToolPointerCancel,
  connectorDots,
  connectorDragLine,
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
  const isCreationTool = tool === 'shape' || tool === 'connector' || tool === 'pen';

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Text tool: click anywhere (including on objects) creates text, no pan/marquee
    if (tool === 'text' && onTextToolClick) {
      e.preventDefault();
      viewportRef.current?.setPointerCapture(e.pointerId);
      panStartRef.current = getPoint(e);
      panMovedRef.current = false;
      emptyClickRef.current = true;
      isPanningRef.current = false; // Not a pan
      return;
    }

    // Shape/Connector tool: capture pointer for creation gesture
    if (isCreationTool && onToolPointerDown) {
      e.preventDefault();
      viewportRef.current?.setPointerCapture(e.pointerId);
      const p = getPoint(e);
      onToolPointerDown({ x: p.x, y: p.y, shiftKey: e.shiftKey });
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
  }, [getPoint, onBeginPan, onMarqueeBegin, isBoardSurface, tool, onTextToolClick]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const p = getPoint(e);
    if (isMarqueeRef.current) {
      onMarqueeMove?.(p);
      return;
    }
    // Text tool: track if moved beyond threshold
    if (tool === 'text') {
      const start = panStartRef.current;
      if (start && Math.hypot(p.x - start.x, p.y - start.y) >= DRAG_THRESHOLD_PX) {
        panMovedRef.current = true;
      }
      return;
    }
    // Shape/Connector tool: forward move
    if (isCreationTool && onToolPointerMove) {
      onToolPointerMove({ x: p.x, y: p.y, shiftKey: e.shiftKey });
      return;
    }
    if (!isPanningRef.current) return;
    const start = panStartRef.current;
    if (start && Math.hypot(p.x - start.x, p.y - start.y) >= DRAG_THRESHOLD_PX) {
      panMovedRef.current = true;
    }
    onPanMove(p);
  }, [getPoint, onPanMove, onMarqueeMove, tool, isCreationTool, onToolPointerMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (isMarqueeRef.current) {
      isMarqueeRef.current = false;
      onMarqueeEnd?.();
      return;
    }
    // Text tool: click (no move) creates text
    if (tool === 'text') {
      if (!panMovedRef.current) {
        const p = getPoint(e);
        onTextToolClick?.(p);
      }
      panMovedRef.current = false;
      emptyClickRef.current = false;
      return;
    }
    // Shape/Connector tool: forward up
    if (isCreationTool && onToolPointerUp) {
      const p = getPoint(e);
      onToolPointerUp(p);
      return;
    }
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    const p = getPoint(e);
    onEndPan();
    // A press on empty space that never became a pan clears the selection.
    if (emptyClickRef.current && !panMovedRef.current) onEmptyClick?.(p);
    emptyClickRef.current = false;
  }, [getPoint, onEndPan, onEmptyClick, onMarqueeEnd, tool, onTextToolClick, isCreationTool, onToolPointerUp]);

  const handlePointerCancel = useCallback(() => {
    if (isMarqueeRef.current) {
      isMarqueeRef.current = false;
      onMarqueeCancel?.();
      return;
    }
    if (isCreationTool && onToolPointerCancel) {
      onToolPointerCancel();
      return;
    }
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    emptyClickRef.current = false;
    onEndPan();
  }, [onEndPan, onMarqueeCancel, isCreationTool, onToolPointerCancel]);

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
        cursor: tool === 'text' ? 'text' : (tool === 'shape' || tool === 'connector' ? 'crosshair' : (tool === 'pen' ? 'none' : (isPanningRef.current ? 'grabbing' : 'default'))),
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
          pointerEvents: isCreationTool ? 'none' : undefined,
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
      {/* Connector hover dots (screen-space overlay) */}
      {connectorDots && connectorDots.length > 0 && (
        <div data-testid="connector-dots" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
          {connectorDots.map((d) => (
            <div
              key={d.side}
              data-testid={`connector-dot-${d.side}`}
              data-highlighted={d.highlighted ? 'true' : 'false'}
              style={{
                position: 'absolute',
                left: d.screenX - 4,
                top: d.screenY - 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: d.highlighted ? '#1976D2' : '#90CAF9',
                border: '1px solid #1976D2',
              }}
            />
          ))}
        </div>
      )}
      {/* Connector drag line */}
      {connectorDragLine && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}>
          <line
            x1={connectorDragLine.fromX}
            y1={connectorDragLine.fromY}
            x2={connectorDragLine.toX}
            y2={connectorDragLine.toY}
            stroke="#1976D2"
            strokeWidth={2}
            strokeDasharray="6 3"
          />
        </svg>
      )}
    </div>
  );
}
