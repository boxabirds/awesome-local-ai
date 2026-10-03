import { useEffect, useRef } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls(props: ZoomControlsProps) {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;
  const containerRef = useRef<HTMLDivElement>(null);

  // Stop wheel propagation so Ctrl-wheel over controls doesn't zoom the board
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="zoom-controls"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '4px 8px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
        zIndex: 10,
      }}
    >
      <button
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{
          width: 28,
          height: 28,
          border: 'none',
          background: 'transparent',
          fontSize: 18,
          cursor: canZoomOut ? 'pointer' : 'default',
          opacity: canZoomOut ? 1 : 0.4,
        }}
      >
        −
      </button>
      <output aria-live="polite" data-testid="zoom-label" style={{ minWidth: 48, textAlign: 'center', fontSize: 14 }}>
        {zoomPercent}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{
          width: 28,
          height: 28,
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
