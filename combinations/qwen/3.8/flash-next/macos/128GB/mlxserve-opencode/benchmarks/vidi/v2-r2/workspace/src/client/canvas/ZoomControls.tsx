import { useCallback } from 'react';

interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  const stopWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      data-ui-overlay
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#fff',
        borderRadius: 6,
        padding: '4px 8px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        fontSize: 14,
      }}
      onWheel={stopWheel}
    >
      <button
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: 16 }}
      >
        −
      </button>
      <output aria-live="polite" style={{ minWidth: 44, textAlign: 'center', fontSize: 14 }}>
        {zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: 16 }}
      >
        +
      </button>
      <button
        onClick={onReset}
        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: 13, marginLeft: 4 }}
      >
        Reset view
      </button>
    </div>
  );
}
