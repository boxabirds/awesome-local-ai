import type { CSSProperties } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
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
  background: '#fff',
  border: '1px solid #d0d5dd',
  borderRadius: 8,
  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
  font: '14px system-ui, sans-serif',
  userSelect: 'none',
};
const buttonStyle: CSSProperties = { minWidth: 32, height: 32, cursor: 'pointer' };
const labelStyle: CSSProperties = { minWidth: 48, textAlign: 'center' };

export function ZoomControls(props: ZoomControlsProps) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;
  return (
    <div
      className="zoom-controls"
      style={containerStyle}
      onWheel={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" aria-label="Zoom out" style={buttonStyle} disabled={!canZoomOut} onClick={onZoomOut}>
        −
      </button>
      <output aria-live="polite" style={labelStyle}>{`${zoomPercent}%`}</output>
      <button type="button" aria-label="Zoom in" style={buttonStyle} disabled={!canZoomIn} onClick={onZoomIn}>
        +
      </button>
      <button type="button" style={buttonStyle} onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
