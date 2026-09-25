import { type JSX } from 'react';

export interface ZoomControlsProps {
  /** Current zoom as a whole number, e.g. 150 for 150%. */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Board zoom control: zoom out, current zoom percentage, zoom in, Reset view.
 * Stateless; everything comes from the camera in the parent.
 */
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
      role="group"
      aria-label="Zoom controls"
      // The board must not react to wheel gestures made over the control.
      onWheel={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        &minus;
      </button>
      <output
        className="zoom-percent"
        data-testid="zoom-percent"
        aria-live="polite"
      >
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" data-testid="reset-view" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
