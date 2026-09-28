export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

const BTN: React.CSSProperties = {
  width: 32,
  height: 32,
  border: 'none',
  background: 'transparent',
  fontSize: 18,
  lineHeight: '32px',
  cursor: 'pointer',
  borderRadius: 6,
  color: '#2c2f36',
};

/**
 * Bottom-right zoom control: − , percentage, +, Reset view. Stateless; derives
 * its enabled/disabled state from props. Ctrl/Cmd + wheel over the control is
 * stopped so it never zooms the board (TC-30).
 */
export function ZoomControls(props: ZoomControlsProps) {
  const stopWheel = (e: React.WheelEvent) => {
    // Ctrl/Cmd + wheel over the control must not reach the board, but the
    // browser default is intentionally left alone here (TC-30).
    e.stopPropagation();
  };
  return (
    <div
      data-testid="zoom-controls"
      onWheel={stopWheel}
      onWheelCapture={stopWheel}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#ffffff',
        border: '1px solid #d6d9de',
        borderRadius: 8,
        padding: 4,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        aria-label="Zoom out"
        style={BTN}
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        −
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={{
          minWidth: 48,
          textAlign: 'center',
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          color: '#2c2f36',
        }}
      >
        {props.zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        style={BTN}
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Reset view"
        data-testid="reset-view"
        style={{ ...BTN, width: 'auto', padding: '0 8px', fontSize: 13 }}
        onClick={props.onReset}
      >
        Reset view
      </button>
    </div>
  );
}
