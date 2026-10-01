interface Props {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

const buttonStyle = { minWidth: 32, height: 32, padding: '0 8px', cursor: 'pointer' } as const;

export function ZoomControls(props: Props) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;
  return (
    <div
      className="zoom-controls"
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        background: '#fff',
        border: '1px solid #d5d9e0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        font: '14px system-ui, sans-serif',
      }}
    >
      <button type="button" aria-label="Zoom out" disabled={!canZoomOut} onClick={onZoomOut} style={buttonStyle}>
        −
      </button>
      <output aria-live="polite" style={{ minWidth: 48, textAlign: 'center' }}>{`${zoomPercent}%`}</output>
      <button type="button" aria-label="Zoom in" disabled={!canZoomIn} onClick={onZoomIn} style={buttonStyle}>
        +
      </button>
      <button type="button" onClick={onReset} style={buttonStyle}>Reset view</button>
    </div>
  );
}
