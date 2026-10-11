import type { JSX, WheelEvent as ReactWheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * The board's zoom control: zoom out, the current zoom level, zoom in and Reset
 * view. Stateless and presentational; everything it knows comes from the camera.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps): JSX.Element {
  // The control is chrome, not board: a wheel or pinch over it never zooms the
  // board, and the browser keeps its own default there.
  const stopWheel = (event: ReactWheelEvent<HTMLDivElement>) => event.stopPropagation();

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      role="group"
      aria-label="Zoom controls"
      onWheel={stopWheel}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output
        className="zoom-controls__value"
        data-testid="zoom-label"
        aria-live="polite"
        aria-label="Zoom level"
      >
        {zoomPercent}%
      </output>
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        <span aria-hidden="true">+</span>
      </button>
      <button
        type="button"
        className="zoom-controls__reset"
        aria-label="Reset view"
        data-testid="reset-view"
        onClick={onReset}
      >
        Reset view
      </button>
    </div>
  );
}
