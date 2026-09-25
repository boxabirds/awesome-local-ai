import React from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function ZoomControls(props: ZoomControlsProps) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;

  const handleWheel = (e: React.WheelEvent) => {
    // Stop propagation so Ctrl+wheel over controls doesn't zoom the board
    e.stopPropagation();
  };

  return (
    <div
      data-testid="zoom-controls"
      onWheel={handleWheel}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(255,255,255,0.9)',
        borderRadius: 8,
        padding: '4px 8px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
    >
      <button
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{
          width: 28,
          height: 28,
          border: 'none',
          background: 'transparent',
          fontSize: 18,
          cursor: canZoomOut ? 'pointer' : 'default',
          opacity: canZoomOut ? 1 : 0.4,
        }}
      >
        −
      </button>
      <output aria-live="polite" data-testid="zoom-label" style={{ minWidth: 48, textAlign: 'center', fontSize: 14 }}>
        {zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{
          width: 28,
          height: 28,
          border: 'none',
          background: 'transparent',
          fontSize: 18,
          cursor: canZoomIn ? 'pointer' : 'default',
          opacity: canZoomIn ? 1 : 0.4,
        }}
      >
        +
      </button>
      <button
        aria-label="Reset view"
        onClick={onReset}
        style={{
          border: 'none',
          background: 'transparent',
          fontSize: 13,
          cursor: 'pointer',
          padding: '4px 8px',
        }}
      >
        Reset view
      </button>
    </div>
  );
}
