import type { CSSProperties, JSX } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

const buttonStyle: CSSProperties = {
  minWidth: 28,
  height: 28,
  padding: '0 6px',
  fontSize: 15,
  lineHeight: 1,
  border: '1px solid #d0d0c8',
  borderRadius: 6,
  background: '#ffffff',
  cursor: 'pointer',
};

const disabledStyle: CSSProperties = {
  opacity: 0.4,
  cursor: 'default',
};

/**
 * Bottom-right zoom control: − / percentage / + / Reset view.
 *
 * Stateless and presentational; wired to `useCamera` in App.tsx. The
 * container stops wheel propagation so a Ctrl-wheel over the controls never
 * zooms the board.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps): JSX.Element {
  return (
    <div
      data-testid="zoom-controls"
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'rgba(255, 255, 255, 0.92)',
        border: '1px solid #d8d8d0',
        borderRadius: 10,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
      }}
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{ ...buttonStyle, ...(!canZoomOut ? disabledStyle : {}) }}
      >
        −
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={{ minWidth: '3.5ch', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
      >
        {zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{ ...buttonStyle, ...(!canZoomIn ? disabledStyle : {}) }}
      >
        +
      </button>
      <button type="button" aria-label="Reset view" onClick={onReset} style={buttonStyle}>
        Reset view
      </button>
    </div>
  );
}
