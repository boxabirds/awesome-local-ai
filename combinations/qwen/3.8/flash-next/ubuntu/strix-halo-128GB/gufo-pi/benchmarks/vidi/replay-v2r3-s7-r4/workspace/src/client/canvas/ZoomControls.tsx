import React, { useCallback } from 'react';

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
  const handleWheel = useCallback((e: React.WheelEvent) => {
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
        gap: 4,
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: '4px 8px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
      }}
      onWheel={handleWheel}
    >
      <button
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, padding: '2px 6px' }}
      >
        −
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={{ minWidth: 40, textAlign: 'center', fontSize: 14 }}
      >
        {zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, padding: '2px 6px' }}
      >
        +
      </button>
      <button
        aria-label="Reset view"
        onClick={onReset}
        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 6px' }}
      >
        Reset view
      </button>
    </div>
  );
}
