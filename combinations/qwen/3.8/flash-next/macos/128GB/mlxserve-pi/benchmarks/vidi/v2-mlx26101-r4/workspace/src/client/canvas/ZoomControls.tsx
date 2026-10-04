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
 * Zoom control in the bottom-right corner: zoom out, the current zoom as a whole
 * percentage, zoom in, and Reset view. Buttons are natively disabled at the zoom
 * limits, so a disabled button cannot call its callback.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps): JSX.Element {
  // The control is not the board: a wheel or pinch here must never zoom the board,
  // and the browser's own default stays untouched.
  const stopWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      onWheel={stopWheel}
    >
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        &minus;
      </button>
      <output
        className="zoom-controls__label"
        data-testid="zoom-label"
        aria-live="polite"
        title="Zoom level"
      >
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-controls__button"
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button
        type="button"
        className="zoom-controls__button zoom-controls__button--text"
        data-testid="reset-view"
        onClick={onReset}
      >
        Reset view
      </button>
    </div>
  );
}
