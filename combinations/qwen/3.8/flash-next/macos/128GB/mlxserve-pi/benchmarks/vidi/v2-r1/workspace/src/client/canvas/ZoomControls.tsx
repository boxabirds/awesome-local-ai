import { type CSSProperties, type ReactNode } from 'react';

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
  borderRadius: 8,
  backgroundColor: 'rgba(255, 255, 255, 0.92)',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
  fontFamily: 'var(--vidi6-font)',
  fontSize: 13,
};

const labelStyle: CSSProperties = {
  minWidth: 48,
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
};

/**
 * Zoom control in the bottom-right corner: zoom out (-), the current zoom
 * percentage, zoom in (+) and Reset view. Stateless and presentational; the
 * buttons are native, so a disabled button never calls its callback.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps): ReactNode {
  return (
    <div
      data-testid="zoom-controls"
      style={containerStyle}
      onWheel={(event) => {
        // The controls are not the board: a Ctrl/Cmd + wheel (pinch) over them
        // must not zoom the board (TC-30).
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="vidi6-icon-button"
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        {'\u2212'}
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-level"
        style={labelStyle}
      >
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="vidi6-icon-button"
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        {'+'}
      </button>
      <button type="button" data-testid="reset-view" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
