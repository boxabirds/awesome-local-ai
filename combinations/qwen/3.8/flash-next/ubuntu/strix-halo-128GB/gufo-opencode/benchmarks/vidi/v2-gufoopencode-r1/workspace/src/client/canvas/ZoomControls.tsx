import type { CSSProperties } from 'react';
export interface ZoomControlsProps {
  readonly zoomPercent: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

const containerStyle: CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 4,
  background: '#ffffff',
  border: '1px solid #d6dae1',
  borderRadius: 8,
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)'
};

const buttonStyle: CSSProperties = {
  minWidth: 32,
  height: 32,
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1
};

export function ZoomControls(props: ZoomControlsProps) {
  return (
    <div
      data-testid="zoom-controls"
      style={containerStyle}
      onWheel={(e) => {
        // Ctrl/Cmd-wheel over the controls must never zoom the board.
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label="Zoom out"
        style={buttonStyle}
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        −
      </button>
      <output aria-live="polite" data-testid="zoom-label" style={{ minWidth: '4.5ch', textAlign: 'center' }}>
        {props.zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        style={buttonStyle}
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button type="button" style={buttonStyle} onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
