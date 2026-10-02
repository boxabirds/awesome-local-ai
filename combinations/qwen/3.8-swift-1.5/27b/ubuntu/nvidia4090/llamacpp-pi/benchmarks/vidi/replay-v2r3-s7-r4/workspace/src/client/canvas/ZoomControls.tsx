import { useRef } from 'react';

export function ZoomControls(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  const stopWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      ref={containerRef}
      data-testid="zoom-controls"
      onWheel={stopWheel}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'white',
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '4px 8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        zIndex: 10,
      }}
    >
      <button
        aria-label="Zoom out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
        style={{
          width: 28,
          height: 28,
          border: '1px solid #ccc',
          borderRadius: 4,
          background: 'white',
          cursor: props.canZoomOut ? 'pointer' : 'default',
          fontSize: 16,
          lineHeight: '28px',
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
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {props.zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
        style={{
          width: 28,
          height: 28,
          border: '1px solid #ccc',
          borderRadius: 4,
          background: 'white',
          cursor: props.canZoomIn ? 'pointer' : 'default',
          fontSize: 16,
          lineHeight: '28px',
        }}
      >
        +
      </button>
      <button
        aria-label="Reset view"
        onClick={props.onReset}
        style={{
          height: 28,
          border: '1px solid #ccc',
          borderRadius: 4,
          background: 'white',
          cursor: 'pointer',
          fontSize: 12,
          padding: '0 8px',
        }}
      >
        Reset view
      </button>
    </div>
  );
}
