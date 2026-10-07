import { type CSSProperties, type ReactNode } from 'react';

export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}): ReactNode {
  const containerStyle: CSSProperties = {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
    fontSize: '14px',
    zIndex: 10,
  };

  const buttonBase: CSSProperties = {
    width: '32px',
    height: '32px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#f8f9fa',
    cursor: props.canZoomIn || props.canZoomOut ? 'pointer' : 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
  };

  return (
    <div style={containerStyle} data-testid="zoom-controls">
      <button
        aria-label="Zoom out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
        style={{
          ...buttonBase,
          opacity: props.canZoomOut ? 1 : 0.4,
          cursor: props.canZoomOut ? 'pointer' : 'default',
        }}
      >
        −
      </button>
      <output
        aria-live="polite"
        style={{ minWidth: '50px', textAlign: 'center', fontWeight: 500 }}
        data-testid="zoom-percent"
      >
        {props.zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
        style={{
          ...buttonBase,
          opacity: props.canZoomIn ? 1 : 0.4,
          cursor: props.canZoomIn ? 'pointer' : 'default',
        }}
      >
        +
      </button>
      <button
        aria-label="Reset view"
        onClick={props.onReset}
        style={{
          ...buttonBase,
          width: 'auto',
          padding: '0 8px',
          fontSize: '12px',
        }}
      >
        Reset view
      </button>
    </div>
  );
}
