import { useEffect, useRef } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: − , the current zoom percentage, + and Reset view.
 * Purely presentational: every value and action comes from the camera.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Wheel/pinch over the control belongs to the browser, not to the board, so it must
  // not reach the viewport's board gesture handlers. The browser default is kept.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    const events = ['wheel', 'gesturestart', 'gesturechange', 'gestureend'] as const;
    for (const name of events) el.addEventListener(name, stop, { passive: true });
    return () => {
      for (const name of events) el.removeEventListener(name, stop);
    };
  }, []);

  return (
    <div
      className="zoom-controls"
      ref={containerRef}
      role="group"
      aria-label="Zoom controls"
      data-testid="zoom-controls"
    >
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        &minus;
      </button>
      <output className="zoom-percent" data-testid="zoom-percent" aria-live="polite">
        {zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" className="zoom-reset" data-testid="reset-view" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
