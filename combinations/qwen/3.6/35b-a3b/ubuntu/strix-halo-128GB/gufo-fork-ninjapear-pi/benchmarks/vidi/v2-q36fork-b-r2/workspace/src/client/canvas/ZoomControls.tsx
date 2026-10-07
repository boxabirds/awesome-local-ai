import * as React from 'react';

interface ZoomControlsProps {
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
}: ZoomControlsProps): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: '#fff',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        padding: '4px 8px',
        zIndex: 1000,
      }}
      role="toolbar"
      aria-label="Zoom controls"
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        onClick={onZoomOut}
        disabled={!canZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
        style={{
          minWidth: '32px',
          minHeight: '32px',
          fontSize: '18px',
          border: 'none',
          background: 'transparent',
          cursor: canZoomOut ? 'pointer' : 'default',
          opacity: canZoomOut ? 1 : 0.4,
          borderRadius: '4px',
        }}
      >
        −
      </button>
      <output
        aria-live="polite"
        style={{
          minWidth: '56px',
          textAlign: 'center',
          fontSize: '14px',
          fontFamily: 'monospace',
          color: '#333',
        }}
      >
        {zoomPercent}%
      </output>
      <button
        onClick={onZoomIn}
        disabled={!canZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
        style={{
          minWidth: '32px',
          minHeight: '32px',
          fontSize: '18px',
          border: 'none',
          background: 'transparent',
          cursor: canZoomIn ? 'pointer' : 'default',
          opacity: canZoomIn ? 1 : 0.4,
          borderRadius: '4px',
        }}
      >
        +
      </button>
      <button
        onClick={onReset}
        aria-label="Reset view"
        title="Reset view (Ctrl/Cmd+0)"
        style={{
          minHeight: '32px',
          fontSize: '12px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: '#333',
          borderRadius: '4px',
          padding: '4px 8px',
        }}
      >
        Reset view
      </button>
    </div>
  );
}
