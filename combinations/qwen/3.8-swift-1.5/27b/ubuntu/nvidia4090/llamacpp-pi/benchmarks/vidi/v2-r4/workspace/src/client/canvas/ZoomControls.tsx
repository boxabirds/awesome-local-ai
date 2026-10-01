import type { JSX } from 'react';

export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}): JSX.Element {
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
        backgroundColor: '#fff',
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '8px 12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        zIndex: 1000,
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
        style={{
          width: 32,
          height: 32,
          border: '1px solid #ccc',
          borderRadius: 4,
          backgroundColor: '#fff',
          fontSize: 18,
          cursor: props.canZoomOut ? 'pointer' : 'default',
          opacity: props.canZoomOut ? 1 : 0.5,
        }}
      >
        −
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={{
          minWidth: 48,
          textAlign: 'center',
          fontSize: 14,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {props.zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
        style={{
          width: 32,
          height: 32,
          border: '1px solid #ccc',
          borderRadius: 4,
          backgroundColor: '#fff',
          fontSize: 18,
          cursor: props.canZoomIn ? 'pointer' : 'default',
          opacity: props.canZoomIn ? 1 : 0.5,
        }}
      >
        +
      </button>
      <button
        aria-label="Reset view"
        data-testid="reset-view"
        onClick={props.onReset}
        style={{
          height: 32,
          border: '1px solid #ccc',
          borderRadius: 4,
          backgroundColor: '#fff',
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
