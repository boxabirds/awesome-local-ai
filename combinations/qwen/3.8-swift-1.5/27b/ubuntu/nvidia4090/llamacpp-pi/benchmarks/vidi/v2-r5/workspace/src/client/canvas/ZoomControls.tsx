// src/client/canvas/ZoomControls.tsx
import { useCallback } from 'react';
import type { ReactElement, WheelEvent as ReactWheelEvent } from 'react';

export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}): ReactElement {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;

  // Stop wheel propagation so Ctrl-wheel over controls doesn't zoom the board
  const onWheel = useCallback((e: ReactWheelEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      data-testid="zoom-controls"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(255,255,255,0.9)',
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '6px 12px',
        zIndex: 10,
      }}
      onWheel={onWheel}
      onPointerDown={e => e.stopPropagation()}
    >
      <button
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{
          width: 28,
          height: 28,
          border: '1px solid #ccc',
          borderRadius: 4,
          background: '#fff',
          fontSize: 16,
          cursor: canZoomOut ? 'pointer' : 'default',
          opacity: canZoomOut ? 1 : 0.5,
        }}
      >
        −
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={{ minWidth: 48, textAlign: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}
      >
        {zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{
          width: 28,
          height: 28,
          border: '1px solid #ccc',
          borderRadius: 4,
          background: '#fff',
          fontSize: 16,
          cursor: canZoomIn ? 'pointer' : 'default',
          opacity: canZoomIn ? 1 : 0.5,
        }}
      >
        +
      </button>
      <button
        data-testid="reset-view"
        onClick={onReset}
        style={{
          height: 28,
          border: '1px solid #ccc',
          borderRadius: 4,
          background: '#fff',
          fontSize: 12,
          padding: '0 8px',
          cursor: 'pointer',
        }}
      >
        Reset view
      </button>
    </div>
  );
}
