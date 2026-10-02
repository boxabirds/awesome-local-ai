import type { CSSProperties } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

const buttonStyle: CSSProperties = {
  width: 32,
  height: 32,
  fontSize: 18,
  lineHeight: 1,
  border: '1px solid #d0d3da',
  background: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

const labelStyle: CSSProperties = {
  minWidth: 48,
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 13,
};

/**
 * Stateless zoom control fixed to the bottom-right of the board: zoom out, the
 * current zoom percentage, zoom in and Reset view. All state lives in the
 * camera; this component only renders derived values and calls back.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
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
        gap: 6,
        padding: 6,
        background: '#fff',
        border: '1px solid #e2e4ea',
        borderRadius: 10,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        fontFamily: 'system-ui, sans-serif',
        color: '#1b1d23',
      }}
      // Ctrl/Cmd + wheel over the controls must not zoom the board (TC-30):
      // stop the wheel event from reaching the board surface underneath.
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{ ...buttonStyle, cursor: canZoomOut ? 'pointer' : 'default' }}
      >
        −
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={labelStyle}
      >
        {zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{ ...buttonStyle, cursor: canZoomIn ? 'pointer' : 'default' }}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Reset view"
        title="Reset view"
        onClick={onReset}
        style={{ ...buttonStyle, width: 'auto', padding: '0 10px', fontSize: 13 }}
      >
        Reset view
      </button>
    </div>
  );
}
