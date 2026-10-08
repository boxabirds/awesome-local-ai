import React from 'react';

export function ZoomControls({
  zoomPercent,
  canZoomIn: _canZoomInProp,
  canZoomOut: _canZoomOutProp,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoomPercent: number;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}) {
  // Determine disabled state internally for now (props may pass raw values)
  const canZoomIn = true;
  const canZoomOut = true;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#fff',
        borderRadius: 8,
        padding: '6px 12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        aria-label="Zoom out"
        disabled={!_canZoomOutProp}
        onClick={onZoomOut}
        title="Zoom out"
        style={{
          width: 32,
          height: 32,
          fontSize: 18,
          border: 'none',
          borderRadius: 4,
          cursor: _canZoomOutProp ? 'pointer' : 'default',
          background: 'transparent',
        }}
      >
        −
      </button>

      <output
        aria-live="polite"
        style={{
          minWidth: 52,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {zoomPercent}%
      </output>

      <button
        aria-label="Zoom in"
        disabled={!_canZoomInProp}
        onClick={onZoomIn}
        title="Zoom in"
        style={{
          width: 32,
          height: 32,
          fontSize: 18,
          border: 'none',
          borderRadius: 4,
          cursor: _canZoomInProp ? 'pointer' : 'default',
          background: 'transparent',
        }}
      >
        +
      </button>

      <button
        onClick={onReset}
        title="Reset view"
        style={{
          marginLeft: 8,
          padding: '4px 8px',
          fontSize: 13,
          border: '1px solid #ccc',
          borderRadius: 4,
          cursor: 'pointer',
          background: 'transparent',
        }}
      >
        Reset view
      </button>
    </div>
  );
}
