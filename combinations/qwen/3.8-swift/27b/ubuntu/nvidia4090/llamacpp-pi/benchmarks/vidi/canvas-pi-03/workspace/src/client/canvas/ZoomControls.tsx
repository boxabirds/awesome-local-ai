import { type JSX, type WheelEvent } from 'react';

export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}): JSX.Element {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;

  // Stop wheel propagation so Ctrl-wheel over controls doesn't zoom the board (TC-30)
  const handleWheel = (e: WheelEvent) => {
    e.stopPropagation();
  };

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
        background: 'white',
        borderRadius: 8,
        padding: '8px 12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}
      onWheel={handleWheel}
    >
      <button
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{
          width: 32,
          height: 32,
          border: 'none',
          background: '#f0f0f0',
          borderRadius: 4,
          fontSize: 18,
          cursor: canZoomOut ? 'pointer' : 'default',
        }}
      >
        −
      </button>
      <output
        data-testid="zoom-label"
        aria-live="polite"
        style={{
          minWidth: 48,
          textAlign: 'center',
          fontSize: 14,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{
          width: 32,
          height: 32,
          border: 'none',
          background: '#f0f0f0',
          borderRadius: 4,
          fontSize: 18,
          cursor: canZoomIn ? 'pointer' : 'default',
        }}
      >
        +
      </button>
      <button
        aria-label="Reset view"
        onClick={onReset}
        style={{
          height: 32,
          border: 'none',
          background: '#f0f0f0',
          borderRadius: 4,
          fontSize: 13,
          padding: '0 8px',
          cursor: 'pointer',
        }}
      >
        Reset view
      </button>
    </div>
  );
}
