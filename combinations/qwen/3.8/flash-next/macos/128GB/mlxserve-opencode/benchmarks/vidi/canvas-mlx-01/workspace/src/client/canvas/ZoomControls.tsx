import type { JSX } from 'react';

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
 * percentage, zoom in, and Reset view. The buttons are disabled at the limits, and
 * wheel events over the control are not forwarded to the board.
 */
export function ZoomControls(props: ZoomControlsProps): JSX.Element {
  const stop = (event: { stopPropagation(): void }): void => {
    // Ctrl/Cmd + wheel over the control is not a board gesture.
    event.stopPropagation();
  };

  return (
    <div
      className="vidi-zoom-controls"
      data-testid="zoom-controls"
      onWheel={stop}
    >
      <button
        type="button"
        aria-label="Zoom out"
        data-testid="zoom-out"
        disabled={!props.canZoomOut}
        onClick={props.onZoomOut}
      >
        &minus;
      </button>
      <output
        className="vidi-zoom-label"
        data-testid="zoom-label"
        aria-live="polite"
      >{`${props.zoomPercent}%`}</output>
      <button
        type="button"
        aria-label="Zoom in"
        data-testid="zoom-in"
        disabled={!props.canZoomIn}
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button type="button" data-testid="reset-view" onClick={props.onReset}>
        Reset view
      </button>
    </div>
  );
}
