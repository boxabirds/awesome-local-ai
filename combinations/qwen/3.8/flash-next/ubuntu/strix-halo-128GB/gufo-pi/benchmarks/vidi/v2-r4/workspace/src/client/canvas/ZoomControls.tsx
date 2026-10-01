import type { WheelEvent as ReactWheelEvent } from 'react';

export interface ZoomControlsProps {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * The bottom-right zoom control: − , current percentage, + and Reset view.
 *
 * Stateless and presentational: everything comes from props derived from the
 * camera. Buttons are natively disabled at the zoom limits, so a click there
 * cannot reach the callbacks.
 */
export function ZoomControls({
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps): React.JSX.Element {
  // The control is chrome, not board: a wheel (or pinch) here must not pan or
  // zoom the board. The browser's own behaviour is left alone.
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className="zoom-controls"
      data-testid="zoom-controls"
      onWheel={onWheel}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-out-button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        &minus;
      </button>
      <output
        className="zoom-label"
        data-testid="zoom-label"
        aria-live="polite"
        aria-label="Zoom level"
      >
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="zoom-in-button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button type="button" className="reset-button" onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
