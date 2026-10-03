import type { JSX, WheelEvent as ReactWheelEvent } from 'react';

/**
 * Zoom controls: − , current zoom, + and Reset view, fixed to the bottom-right
 * corner of the board area. Purely presentational: every action is a callback.
 */
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
  // The controls are not the board: a wheel or pinch over them must never zoom
  // the board (it keeps its normal browser behaviour instead).
  const stopWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      role="group"
      aria-label="Zoom"
      onWheel={stopWheel}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        &minus;
      </button>
      <output className="zoom-percent" data-testid="zoom-label" aria-live="polite">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" className="zoom-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
