import { useEffect, useRef } from 'react';
import type React from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls(props: ZoomControlsProps): React.JSX.Element {
  const { zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onReset } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Ctrl/Cmd + wheel over the controls must NOT zoom the board. We stop the event
  // from bubbling toward the board but do NOT preventDefault, so the browser's
  // own page zoom still works when the cursor is over the controls (TC-30).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const btnStyle: React.CSSProperties = {
    minWidth: 32,
    height: 32,
    fontSize: 18,
    lineHeight: 1,
    border: '1px solid #d0d0d0',
    background: '#fff',
    borderRadius: 6,
    cursor: 'pointer',
    color: '#222',
  };

  return (
    <div
      ref={containerRef}
      data-testid="zoom-controls"
      role="group"
      aria-label="Zoom controls"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: 6,
        background: '#ffffff',
        border: '1px solid #e2e2e2',
        borderRadius: 10,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        style={{ ...btnStyle, opacity: canZoomOut ? 1 : 0.4 }}
      >
        &minus;
      </button>
      <output
        aria-live="polite"
        data-testid="zoom-label"
        style={{
          minWidth: 48,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 14,
          color: '#222',
        }}
      >
        {zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        style={{ ...btnStyle, opacity: canZoomIn ? 1 : 0.4 }}
      >
        +
      </button>
      <button
        type="button"
        onClick={onReset}
        style={{ ...btnStyle, minWidth: 'auto', padding: '0 10px', fontSize: 14 }}
      >
        Reset view
      </button>
    </div>
  );
}
