import type { WheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Zoom controls: − , current zoom, + , Reset view (bottom-right). Stateless and
 * presentational; all zoom values / disabled flags come from the camera.
 */
export function ZoomControls(props: ZoomControlsProps) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;
  return (
    <div
      data-testid="zoom-controls"
      className="zoom-controls"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 6,
        background: 'rgba(255,255,255,0.9)',
        border: '1px solid rgba(0,0,0,0.12)',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        fontSize: 13,
      }}
      onWheel={(e: WheelEvent<HTMLDivElement>) => {
        // Ctrl/Cmd + wheel over the controls must never reach the board.
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={buttonStyle}
      >
        {'\u2212'}
      </button>
      <output
        aria-live="polite"
        aria-label="Zoom level"
        style={{ minWidth: 44, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
      >
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={buttonStyle}
      >
        {'+'}
      </button>
      <button type="button" onClick={onReset} style={buttonStyle}>
        Reset view
      </button>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 8px',
  minWidth: 28,
  cursor: 'pointer',
};