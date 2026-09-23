export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Stateless zoom control cluster (bottom-right). Buttons are natively disabled at
 * the limits, so a disabled click cannot fire its callback (TC-32). A wheel over
 * the cluster stops propagation so Ctrl/Cmd + scroll there never reaches the board
 * (TC-30).
 */
export function ZoomControls(props: ZoomControlsProps) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;
  return (
    <div
      data-testid="zoom-controls"
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        background: "var(--panel-bg)",
        border: "1px solid var(--panel-border)",
        borderRadius: 10,
        boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
      }}
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={buttonStyle}
      >
        −
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={{ minWidth: 44, textAlign: "center", fontVariantNumeric: "tabular-nums" }}
      >
        {zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={buttonStyle}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Reset view"
        onClick={onReset}
        style={{ ...buttonStyle, width: "auto", padding: "0 10px" }}
      >
        Reset view
      </button>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: "1px solid var(--panel-border)",
  background: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  font: "inherit",
};
