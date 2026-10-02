import { useEffect, useRef } from 'react';

interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function ZoomControls({ zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset }: ZoomControlsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Stop wheel propagation so Ctrl-wheel over controls doesn't zoom the board
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
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
        background: 'white',
        borderRadius: 8,
        padding: '4px 8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
    >
      <button
        aria-label="Zoom out"
        data-testid="zoom-out"
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

      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={{
          minWidth: 48,
          textAlign: 'center',
          fontSize: 14,
          fontFamily: 'monospace',
        }}
      >
        {zoomPercent}%
      </output>

      <button
        aria-label="Zoom in"
        data-testid="zoom-in"
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
        data-testid="reset-view"
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
