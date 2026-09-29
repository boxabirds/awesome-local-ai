interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function ZoomControls({ zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset }: ZoomControlsProps) {
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="zoom-controls"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'white',
        borderRadius: 8,
        padding: '8px 12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
      onWheel={handleWheel}
    >
      <button
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{
          width: 32,
          height: 32,
          border: 'none',
          background: 'transparent',
          fontSize: 18,
          cursor: canZoomOut ? 'pointer' : 'default',
          opacity: canZoomOut ? 1 : 0.4,
        }}
      >
        −
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={{
          minWidth: 48,
          textAlign: 'center',
          fontSize: 14,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{
          width: 32,
          height: 32,
          border: 'none',
          background: 'transparent',
          fontSize: 18,
          cursor: canZoomIn ? 'pointer' : 'default',
          opacity: canZoomIn ? 1 : 0.4,
        }}
      >
        +
      </button>
      <button
        aria-label="Reset view"
        onClick={onReset}
        style={{
          border: 'none',
          background: 'transparent',
          fontSize: 13,
          cursor: 'pointer',
          padding: '4px 8px',
        }}
      >
        Reset view
      </button>
    </div>
  );
}
