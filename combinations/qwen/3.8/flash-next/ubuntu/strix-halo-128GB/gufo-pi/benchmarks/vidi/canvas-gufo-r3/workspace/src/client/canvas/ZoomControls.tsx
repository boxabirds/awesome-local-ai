import React from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  // Stop wheel propagation so Ctrl-wheel over the controls does not zoom the board.
  // Do NOT preventDefault here: the controls live outside the board, so browser page
  // zoom is allowed over them (TC-30).
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="zoom-controls"
      onWheel={handleWheel}
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: 'rgba(255,255,255,0.9)',
        borderRadius: '8px',
        padding: '4px 8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
      }}
    >
      <button
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{
          width: '32px',
          height: '32px',
          border: 'none',
          background: 'transparent',
          cursor: canZoomOut ? 'pointer' : 'default',
          fontSize: '18px',
          borderRadius: '4px',
        }}
      >
        −
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={{ minWidth: '48px', textAlign: 'center', fontSize: '14px' }}
      >
        {zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{
          width: '32px',
          height: '32px',
          border: 'none',
          background: 'transparent',
          cursor: canZoomIn ? 'pointer' : 'default',
          fontSize: '18px',
          borderRadius: '4px',
        }}
      >
        +
      </button>
      <button
        aria-label="Reset view"
        onClick={onReset}
        style={{
          padding: '4px 8px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: '13px',
          borderRadius: '4px',
          marginLeft: '4px',
        }}
      >
        Reset view
      </button>
    </div>
  );
}
