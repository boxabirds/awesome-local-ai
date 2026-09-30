// Zoom control: zoom out, current zoom percentage, zoom in, Reset view.
// Stateless and presentational; all values and callbacks come from the camera.

import type { JSX } from 'react';

export interface ZoomControlsProps {
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
}: ZoomControlsProps): JSX.Element {
  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      // The controls are UI, not board: a wheel or pinch over them must never
      // zoom the board (and their own default is left to the browser).
      onWheel={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        title="Zoom out (Ctrl/Cmd -)"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        &#8722;
      </button>
      <output
        className="zoom-percent"
        data-testid="zoom-label"
        aria-live="polite"
        aria-label="Zoom level"
      >
        {zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        title="Zoom in (Ctrl/Cmd =)"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button
        type="button"
        className="zoom-reset"
        data-testid="reset-view"
        aria-label="Reset view"
        title="Reset view (Ctrl/Cmd 0)"
        onClick={onReset}
      >
        Reset view
      </button>
    </div>
  );
}
