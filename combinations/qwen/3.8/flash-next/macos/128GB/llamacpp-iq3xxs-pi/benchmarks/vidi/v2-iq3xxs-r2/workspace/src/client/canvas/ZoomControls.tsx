import type { JSX } from 'react';

export interface ZoomControlsProps {
  readonly zoomPercent: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

/**
 * Bottom-right zoom control: −, the current zoom as a whole-number percentage, +,
 * and Reset view. Stateless: everything comes from the camera in `App`.
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
      className="vidi6-zoom-controls"
      data-testid="zoom-controls"
      role="group"
      aria-label="Zoom"
      onWheel={(event) => {
        // Ctrl/Cmd + wheel over the control belongs to the browser, never to the board.
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="vidi6-zoom-button"
        data-testid="zoom-out"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        &#8722;
      </button>
      <output className="vidi6-zoom-label" data-testid="zoom-label" aria-live="polite">
        {`${zoomPercent}%`}
      </output>
      <button
        type="button"
        className="vidi6-zoom-button"
        data-testid="zoom-in"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        +
      </button>
      <button
        type="button"
        className="vidi6-reset-button"
        data-testid="reset-view"
        onClick={onReset}
      >
        Reset view
      </button>
    </div>
  );
}
