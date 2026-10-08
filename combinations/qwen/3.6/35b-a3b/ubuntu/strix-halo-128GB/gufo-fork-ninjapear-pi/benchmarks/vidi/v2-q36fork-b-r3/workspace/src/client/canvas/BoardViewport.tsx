import React, { useRef, useCallback, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Point } from './camera';
import { LINE_DELTA, PAGE_DELTA } from '@shared/config';

// Safari gesture event type
declare global {
  interface GestureEvent extends Event {
    scale: number;
  }
}

export interface BoardViewportProps {
  children?: ReactNode;
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
}

export function BoardViewport(props: BoardViewportProps) {
  const { children, onPanMove, onWheel, onEndPan, onKeyDownZoom, style = {} } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const lastPosRef = useRef<Point | null>(null);

  // ── Pointer drag ────────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsPanning(true);
      lastPosRef.current = { x: e.clientX, y: e.clientY };
    },
    [],
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
    setIsPanning(false);
    lastPosRef.current = null;
    onEndPan();
  }, [onEndPan]);

  const handleLostPointerCapture = useCallback(() => {
    setIsPanning(false);
    lastPosRef.current = null;
    onEndPan();
  }, [onEndPan]);

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
        props.onKeyDownZoom?.('zoomIn');
      } else if (e.key === '-') {
        e.preventDefault();
        props.onKeyDownZoom?.('zoomOut');
      } else if (e.key === '0') {
        e.preventDefault();
        props.onKeyDownZoom?.('reset');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.onKeyDownZoom]);

  // ── Computed styles ─────────────────────────────────────────────────
  // These are computed via CSS custom properties passed as inline styles
  // The actual camera values come from the parent component

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : 'grab',
        background: '#f0f0f0',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
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
        style={{
          transform: 'var(--world-transform)',
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
