import type { WheelEvent } from 'react';

// Stateless zoom control cluster (anchor: zoom.controls). Presentational only:
// renders the given values and calls the given callbacks when enabled.

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function ZoomControls(props: ZoomControlsProps) {
  // Ctrl/Cmd wheel over the controls must never zoom the board (TC-30). We stop
  // propagation here; the board's wheel listener also ignores events originating
  // inside this cluster (see BoardViewport).
  const handleWheel = (e: WheelEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      onWheel={handleWheel}
    >
      <button
        type="button"
        aria-label="Zoom out"
        className="zoom-btn"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        {'\u2212'}
      </button>
      <output
        aria-live="polite"
        className="zoom-percent"
        data-testid="zoom-percent"
      >
        {props.zoomPercent}%
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        className="zoom-btn"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
      >
        {'+'}
      </button>
      <button
        type="button"
        aria-label="Reset view"
        className="reset-btn"
        onClick={props.onReset}
      >
        Reset view
      </button>
    </div>
  );
}
