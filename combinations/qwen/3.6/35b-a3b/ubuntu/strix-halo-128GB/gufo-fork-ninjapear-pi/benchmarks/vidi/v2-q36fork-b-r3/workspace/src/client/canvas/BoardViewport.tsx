import React, { useRef, useCallback, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Camera, Point } from './camera';
import { screenToWorld } from './camera';
import { LINE_DELTA, PAGE_DELTA } from '@shared/config';

// Safari gesture event type
declare global {
  interface GestureEvent extends Event {
    scale: number;
  }
}

export interface BoardViewportProps {
  children?: ReactNode;
  /** The current camera state */
  camera: Camera;
  /** Called with pointer delta when panning */
  onPanMove(dx: number, dy: number): void;
  /** Called for wheel events */
  onWheel(deltaX: number, deltaY: number, ctrlOrMeta: boolean, point: { x: number; y: number }): void;
  /** Callback when drag ends/cancels */
  onEndPan(): void;
  /** Called for keyboard shortcuts (Ctrl/Cmd + =/-/0) */
  onKeyDownZoom?(action: 'zoomIn' | 'zoomOut' | 'reset'): void;
  /** Grid background styles (set by parent from camera) */
  style?: CSSProperties;
  /** Called when double-clicking empty board space with world coords */
  onCreateSticky?(worldPoint: { x: number; y: number }): string | void;
  /** Called when clicking empty board space (clear selection) */
  onClearSelection?(): void;
  /** Called on pointerdown on empty space before marquee start */
  onEmptyPointerDown?(e: PointerEvent): void;
  /** Called on pointerup on empty space after potential marquee end */
  onEmptyPointerUp?(): void;
  /** Currently active tool ('select' or 'text') */
  activeTool?: 'select' | 'text';
  /** Called when user clicks while Text tool is active */
  onTextClick?(worldPoint: { x: number; y: number }): void;
}

export function BoardViewport(props: BoardViewportProps) {
  const {
    children,
    camera,
    onPanMove,
    onWheel,
    onEndPan,
    onKeyDownZoom,
    style = {},
    onCreateSticky,
    onClearSelection,
    onEmptyPointerDown,
    onEmptyPointerUp,
    activeTool,
    onTextClick,
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const lastPosRef = useRef<Point | null>(null);
  const worldLayerRef = useRef<HTMLDivElement>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  // ── World transform string ───────────────────────────────────────────
  const worldTransform = `translate(${camera.x * camera.zoom}px, ${camera.y * camera.zoom}px) scale(${camera.zoom})`;

  // ── Double-click on empty board → create note ────────────────────────
  const handleDblClickEmpty = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('[data-sticky-id]')) {
        return;
      }
      if (!onCreateSticky) return;
      const wp = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      onCreateSticky(wp);
    },
    [camera, onCreateSticky],
  );

  // ── Click on empty board → clear selection ──────────────────────────
  const handleClickEmpty = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('[data-sticky-id]') ||
          (e.target as HTMLElement).closest('[data-text-id]')) {
        return;
      }
      if ((e.target as HTMLElement).closest('[class*="toolbar"]')) {
        return;
      }
      if ((e.target as HTMLElement).closest('[data-selection-bounds]') ||
          (e.target as HTMLElement).closest('[data-marquee]') ||
          (e.target as HTMLElement).closest('[data-handle]')) {
        return;
      }
      onClearSelection?.();
    },
    [onClearSelection],
  );

  // ── Handle pointer up on empty space (text tool click-to-create) ───
  const handlePointerUpEmpty = useCallback(() => {
    if (activeTool !== 'text' || !pointerDownPosRef.current) {
      pointerDownPosRef.current = null;
      return;
    }
    const pos = pointerDownPosRef.current;
    // Only trigger if it was a quick tap (not a drag)
    // Simple check: compare with current position (rough)
    pointerDownPosRef.current = null;
    if (onTextClick) {
      onTextClick(screenToWorld(camera, { x: pos.x, y: pos.y }));
    }
  }, [camera, activeTool, onTextClick]);

  // ── Pointer drag ────────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('[data-sticky-id]') ||
          (e.target as HTMLElement).closest('[data-text-id]') ||
          (e.target as HTMLElement).closest('[data-selection-bounds]') ||
          (e.target as HTMLElement).closest('[data-marquee]') ||
          (e.target as HTMLElement).closest('[data-handle]')) {
        return; // handled by child elements
      }

      // Text tool active: record position for click-to-create
      if (activeTool === 'text') {
        pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
        return;
      }


      if (e.shiftKey) {
        // Start marquee
        onEmptyPointerDown?.(e.nativeEvent);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch { /* no-op */ }
        return;
      }

      // Plain pan
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsPanning(true);
      lastPosRef.current = { x: e.clientX, y: e.clientY };
    },
    [onEmptyPointerDown, activeTool],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isPanning || !lastPosRef.current) return;
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      onPanMove(dx, dy);
    },
    [isPanning, onPanMove],
  );

  const handlePointerUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      lastPosRef.current = null;
      onEndPan();
    } else {
      // Marquee end
      onEmptyPointerUp?.();
    }
  }, [isPanning, onEndPan, onEmptyPointerUp]);

  const handleLostPointerCapture = useCallback(() => {
    setIsPanning(false);
    lastPosRef.current = null;
    onEndPan();
    onEmptyPointerUp?.();
  }, [onEndPan, onEmptyPointerUp]);

  // ── Wheel handler ───────────────────────────────────────────────────
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const deltaMode = e.deltaMode;
      const dx =
        deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaX * LINE_DELTA : e.deltaX;
      const dy =
        deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * LINE_DELTA : e.deltaY;
      onWheel(dx, dy, !!e.ctrlKey || !!e.metaKey, { x: e.clientX, y: e.clientY });
    };

    el.addEventListener('wheel', onWheelHandler, { passive: false });
    return () => el.removeEventListener('wheel', onWheelHandler);
  }, [onWheel]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        onKeyDownZoom?.('zoomIn');
      } else if (e.key === '-') {
        e.preventDefault();
        onKeyDownZoom?.('zoomOut');
      } else if (e.key === '0') {
        e.preventDefault();
        onKeyDownZoom?.('reset');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDownZoom]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : (activeTool === 'text' ? 'text' : 'grab'),
        background: '#f0f0f0',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
onClick={(e) => {
        if (activeTool === 'text') {
          // Don't clear selection when text tool is active
          return;
        }
        handleClickEmpty(e);
      }}
      onPointerUpCapture={handlePointerUpEmpty}
      onDoubleClickCapture={handleDblClickEmpty}
    >
      {/* Dot grid background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, #999 1px, transparent 1px)',
          ...style,
          pointerEvents: 'none',
        }}
      />
      {/* World layer */}
      <div
        ref={worldLayerRef}
        style={{
          transform: worldTransform,
          transformOrigin: '0 0',
          position: 'relative',
          width: 0,
          height: 0,
        }}
      >
        {/* Origin crosshair marker */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          aria-label="Board origin"
          style={{ position: 'absolute', left: '-12px', top: '-12px', pointerEvents: 'none' }}
        >
          <circle cx="12" cy="12" r="3" fill="#ff4444" />
          <line x1="12" y1="0" x2="12" y2="24" stroke="#ff4444" strokeWidth="0.5" opacity="0.5" />
          <line x1="0" y1="12" x2="24" y2="12" stroke="#ff4444" strokeWidth="0.5" opacity="0.5" />
        </svg>
        {children}
      </div>
    </div>
  );
}
