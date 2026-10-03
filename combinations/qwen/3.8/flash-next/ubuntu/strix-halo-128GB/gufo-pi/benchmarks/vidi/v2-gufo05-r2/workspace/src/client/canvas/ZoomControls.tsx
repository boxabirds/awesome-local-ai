import { useEffect, useRef } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/** Minus sign used for the zoom-out button label. */
const MINUS_SIGN = '−';

/**
 * Zoom control: − / percentage / + / Reset view, fixed to the bottom-right of
 * the board area. Presentational: all state comes from props.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // A wheel gesture over the control is not a board gesture: stop it reaching
  // the board, but leave the browser default alone here.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      event.stopPropagation();
    };
    container.addEventListener('wheel', onWheel, { passive: true });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="zoom-controls" ref={containerRef} data-testid="zoom-controls">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        {MINUS_SIGN}
      </button>
      <output className="zoom-controls__label" aria-live="polite" data-testid="zoom-label">
        {zoomPercent}%
      </output>
      <button type="button" aria-label="Zoom in" disabled={!canZoomIn} onClick={onZoomIn}>
        +
      </button>
      <button type="button" aria-label="Reset view" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
